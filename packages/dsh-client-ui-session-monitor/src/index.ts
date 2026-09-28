/**
 * Session monitor plugin, host half: listens to the session event feed for
 * `turn/end` events and keeps a small in-memory table of completion reasons
 * (`completed | aborted | blocked | error | max-tokens | interrupted`),
 * exposed over a same-origin route that the browser half polls. This is the
 * only data that lets the dashboard distinguish "finished normally" from
 * "errored / aborted / token-limit" notifications — the client session list
 * does not carry turn-end reasons. Pure client installs (without this half)
 * still work: the browser falls back to its base notification kinds.
 *
 * It also folds the currently-EXECUTING model tool call per session from the
 * `tool/call` → `tool/result` event pair (closed on turn end), served on the
 * same routes as `tools` — that is the "进度显示" (progress display) data for
 * running rows in the monitor lists: the newest open tool call is what the
 * session is doing right now.
 *
 * @module @dsh-plugins/client-ui-session-monitor
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls the `webServer` service merge onto Context (dsh-host-webserver).
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: pulls the host `ctx.settings` (SettingsForms) Context merge.
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: pulls the Loader's `Fiber.entry` declaration (the 0.1.7 settings
// namespace is the profile plugin entry id).
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Session } from '@deepseek-ai/dsh-session'
import { buildDesktopSnapshot, eventsOf, lastTitle } from './desktop-snapshot.ts'
import { installTurnEndProjection } from './turn-end-projection.ts'
import { MONITOR_SETTINGS_FIELD, MONITOR_SETTINGS_NS, MonitorSettingsSchema } from './desktop-settings.ts'
import type { MonitorSettingsWire } from './desktop-settings.ts'
import { INBOX_FIELD, InboxStoreSchema, NotificationStore } from './desktop-notifications.ts'
import type { InboxStore, NotifyKind } from './desktop-notifications.ts'
// Inlined by the host bundle build (esbuild `text` loader) — the standalone
// desktop widget page (see ./widget-page.html for the full doc comment).
import pageHtml from './widget-page.html'
import { readJsonBody, requestHeader, responseHtml, responseJson, SETTINGS_REVISION_HEADER } from './http.ts'

/** One remembered `turn/end` fact for a session. */
export interface TurnEndRecord {
  /** The turn-end reason kind: completed | aborted | blocked | error | max-tokens | interrupted. */
  readonly reason: string
  /** Event wall time (Unix epoch milliseconds). */
  readonly at: number
  /**
   * Cumulative finished-round count for the session (host lifetime, survives
   * page reloads). Every `turn/end` increments it; the browser uses it as the
   * authoritative "第 N 轮" number in completion notifications.
   */
  readonly round: number
}

/**
 * Host-half config. In harness 0.1.7 a plugin's Config entry IS its settings
 * namespace — `SettingsProvider.register` was removed — so the two sections
 * this half used to register separately are the two volatile fields below. A
 * volatile field resolves to a live reference, and `.default({})` on top of a
 * schema whose fields all carry defaults makes that reference always hold a
 * complete value; the Loader commits a configuration write in place instead of
 * remounting the plugin.
 */
export const Config = z.object({
  /** Shared widget options (web config panel ⇄ desktop widget). */
  settings: MonitorSettingsSchema.default({}).volatile(),
  /** Notification inbox: persists across webview/process restarts. */
  inbox: InboxStoreSchema.default({}).volatile(),
})

/** Hand-written twin of {@link Config}'s resolved shape (declaration-emit safe:
 *  the inferred schemastery type would name cosmokit internals, TS2742). */
export interface Config {
  /** Live reference to the shared widget options. */
  readonly settings: Volatile<MonitorSettingsWire>
  /** Live reference to the persisted notification inbox. */
  readonly inbox: Volatile<InboxStore>
}

/** One volatile Config field viewed as a settings section (`get` + merge write). */
interface ConfigSection<T> {
  /** Current resolved section (schema defaults already applied). */
  get(): T
  /**
   * Merge `section` into this field's stored value and persist it.
   *
   * Deliberately a MERGE, not a wholesale replacement: harness 0.1.7's
   * `SettingsForms.update` deep-merges the patch, so keys absent from `section`
   * keep their stored values (and arrays — `inbox.notes` — are still replaced
   * wholesale, since `mergeLayers` only recurses into plain objects). Callers
   * here always pass a complete section, so today's two call sites behave like a
   * replace; a caller meaning to reset absent keys to their schema defaults must
   * go through `SettingsForms.replace` instead.
   * @param section - the values to write.
   * @param expectedRevision - optional optimistic-concurrency precondition: the
   *   entry revision the caller based `section` on. A mismatch rejects with the
   *   harness's settings-conflict error instead of overwriting a concurrent
   *   write. Only the externally-driven settings route passes one (see it), and
   *   only when the CLIENT supplied it.
   */
  merge(section: Partial<T>, expectedRevision?: number): Promise<void>
}

/** The narrow `ctx.settings` (SettingsForms) face this half writes through. */
interface SettingsFormsFace {
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
}

/**
 * The settings namespace this plugin was mounted under. Harness 0.1.7
 * namespaces are profile plugin entry ids, so the plugin addresses its own
 * Config entry; `fallback` covers a mount that carries no Loader entry.
 *
 * The id read here is the entry's RAW id (`options.id`) — the one
 * `settings.describe()` reports — not `Entry.id`, which the loader prefixes
 * with its owning entry's id (our bundle mounts this plugin as
 * `@dsh-plugins/dsh-widgets-plugin/ui-session-monitor` in the entry tree while
 * the settings namespace stays `ui-session-monitor`).
 */
function ownSettingsNamespace(ctx: Context, fallback: string): string {
  const id = ctx.fiber.entry?.options?.id
  return id !== undefined && id.length > 0 ? id : fallback
}

/**
 * View one volatile Config field of this plugin's own entry as the settings
 * section harness 0.1.5 registered. Writes merge the field into the entry's
 * volatile form (`update`), so the plugin's other volatile sections keep their
 * stored values — `replace` would reset them to the composition base.
 */
function configSection<T>(
  settings: SettingsFormsFace,
  ns: string,
  key: string,
  read: () => T,
): ConfigSection<T> {
  return {
    get: () => read(),
    merge: async (section: Partial<T>, expectedRevision?: number) => {
      await settings.update(ns, { [key]: section }, expectedRevision)
    },
  }
}

/** Exact route the browser half polls for turn-end reasons. */
export const STATUS_ROUTE = '/_dsh/session-monitor/status'
/** Exact route the desktop widget polls for the live session snapshot. */
export const SESSIONS_ROUTE = '/_dsh/session-monitor/sessions'
/** Exact route serving the standalone desktop widget page. */
export const WIDGET_ROUTE = '/_dsh/session-monitor/widget'
/** Exact route for the shared settings store (GET snapshot / POST save). */
export const SETTINGS_ROUTE = '/_dsh/session-monitor/settings'
/** Exact route for the desktop→web jump request queue (GET / POST). */
export const JUMP_ROUTE = '/_dsh/session-monitor/jump'
/** Exact route for the web half's long-poll on jump requests. Background tabs
 *  throttle `setInterval` (Chrome clamps it to ~1/min after a few minutes), so
 *  the jump consumer cannot rely on timers — a held fetch is never throttled. */
export const JUMP_POLL_ROUTE = '/_dsh/session-monitor/jump/poll'
/** Exact route for the desktop widget's notification inbox (GET snapshot). */
export const NOTIFICATIONS_ROUTE = '/_dsh/session-monitor/notifications'
/** Exact route acknowledging inbox records (POST { ids | sessionId | all }). */
export const NOTIFICATIONS_ACK_ROUTE = '/_dsh/session-monitor/notifications/ack'
/** Exact route relaying client-transient interaction pauses (question /
 *  plan-review) from the web half to the inbox (POST, idempotent). */
export const EVENTS_ROUTE = '/_dsh/session-monitor/events'

/** Max remembered sessions; the oldest entry is dropped beyond this. */
const MAX_RECORDS = 100
/** Forget records older than this — the browser polls every few seconds. */
const RECORD_TTL_MS = 5 * 60_000
/** Pending jump requests older than this are dropped (the web half polls ~1s). */
const JUMP_TTL_MS = 30_000

/** One pending desktop→web jump request (single slot; new posts replace). */
interface PendingJump {
  readonly sessionId: string
  readonly at: number
  consumed: boolean
}

/** Prune and read the pending jump (null when absent or expired). */
function readPendingJump(pending: PendingJump | null): PendingJump | null {
  if (pending === null) return null
  if (Date.now() - pending.at > JUMP_TTL_MS) return null
  return pending
}

/** In-memory turn-end reason store (insertion-ordered, TTL-pruned). */
class TurnEndStore {
  private readonly records = new Map<string, TurnEndRecord>()
  /** Cumulative per-session round counters — live for the session's life (not TTL-pruned). */
  private readonly rounds = new Map<string, number>()

  upsert(sessionId: string, record: Omit<TurnEndRecord, 'round'>): void {
    const round = (this.rounds.get(sessionId) ?? 0) + 1
    this.rounds.set(sessionId, round)
    this.records.set(sessionId, { ...record, round })
    if (this.records.size > MAX_RECORDS) {
      // Map preserves insertion order — drop the oldest entry.
      const oldest = this.records.keys().next().value
      if (oldest !== undefined) this.records.delete(oldest)
    }
    this.prune()
  }

  remove(sessionId: string): void {
    this.records.delete(sessionId)
    this.rounds.delete(sessionId)
  }

  snapshot(): Record<string, TurnEndRecord> {
    this.prune()
    return Object.fromEntries(this.records)
  }

  /** Cumulative per-session finished-round counts — NOT TTL-pruned (the
   *  counters live for the session's life), so consumers can derive the
   *  IN-PROGRESS round of a long-running turn: `count + 1`. */
  roundCounts(): Record<string, number> {
    return Object.fromEntries(this.rounds)
  }

  private prune(): void {
    const cutoff = Date.now() - RECORD_TTL_MS
    for (const [id, record] of this.records) {
      if (record.at < cutoff) this.records.delete(id)
    }
  }
}

/** Loose event view covering plugin-merged event types (`approval/asked`,
 *  `approval/decided`, `session/title`) that are intentionally not in this
 *  package's typecheck graph (see desktop-snapshot.ts). */
interface LooseSessionEvent {
  readonly type: string
  readonly time: number
  readonly data: {
    readonly title?: string
    readonly reason?: { readonly kind?: string }
    readonly turn?: number
    readonly name?: string
    readonly callId?: string
    readonly arguments?: string
  }
}

/** Loose view of the parts of a session header the event handlers need. */
interface LooseSessionHeader {
  readonly origin?: 'subagent'
  readonly parentSession?: string
}

/** Map a turn-end reason onto its inbox notification kind. */
const REASON_NOTIFY_KIND: Record<string, NotifyKind> = {
  completed: 'done',
  aborted: 'aborted',
  blocked: 'blocked',
  error: 'error',
  'max-tokens': 'max-tokens',
  interrupted: 'interrupted',
}

/** Model tool names that block on a human answer (host-side question /
 *  plan-review detection — these waits never hit the session log otherwise). */
const ASK_TOOL_NAME = 'ask_user_question'
const PLAN_REVIEW_TOOL_NAME = 'exit_plan_mode'

/** Classify an ask_user_question call's pending kind from its arguments JSON:
 *  a question item declaring `intent: { kind: 'plan-review', … }` is a plan
 *  review (the same predicate the client applies at the wire boundary);
 *  everything else is a plain question. */
function questionKindFromArgs(raw: string | undefined): 'question' | 'plan-review' {
  if (typeof raw !== 'string' || raw.length === 0) return 'question'
  try {
    const parsed = JSON.parse(raw) as { questions?: unknown }
    if (!Array.isArray(parsed.questions)) return 'question'
    for (const item of parsed.questions) {
      if (item === null || typeof item !== 'object') continue
      const intent = (item as { intent?: { kind?: unknown } }).intent
      if (intent !== null && typeof intent === 'object' && intent.kind === 'plan-review') return 'plan-review'
    }
    return 'question'
  } catch {
    return 'question'
  }
}

/** Clamp a wire-settings object to the ranges the client applies on read
 *  (src/client/settings.ts): autoDismissSec 2–60, timeWindowMin 0–1440. The
 *  web half pushes its RAW localStorage blob, which can hold a stale/out-of-
 *  range value even though the widget clamps on read; the Host section is the
 *  single source of truth both sides read, so it must bound the values and
 *  never let a `timeWindowMin: 99999` reach the desktop widget (which applies
 *  the server value as-is). Mutates and returns `body`; unknown/missing fields
 *  are left to the schema (which fills defaults) — only the two numeric ranges
 *  are enforced here. */
function clampSettingsWire(body: Record<string, unknown>): Record<string, unknown> {
  if (typeof body.autoDismissSec === 'number' && Number.isFinite(body.autoDismissSec)) {
    body.autoDismissSec = Math.min(60, Math.max(2, Math.round(body.autoDismissSec)))
  }
  if (typeof body.timeWindowMin === 'number' && Number.isFinite(body.timeWindowMin)) {
    body.timeWindowMin = Math.min(1440, Math.max(0, Math.round(body.timeWindowMin)))
  }
  return body
}

/**
 * Parse the optional optimistic-concurrency precondition on a settings write.
 * @param req - the incoming request.
 * @returns the client's expected revision, or undefined when absent/invalid
 *   (an unparseable value is treated as "no precondition", not as "revision 0",
 *   so a typo cannot silently turn every write into a conflict).
 */
function readExpectedRevision(req: IncomingMessage): number | undefined {
  const raw = requestHeader(req, SETTINGS_REVISION_HEADER)
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** Publish the settings revision on a response (see {@link SETTINGS_REVISION_HEADER}). */
function setRevisionHeader(res: ServerResponse, revision: number | undefined): void {
  if (revision === undefined) return
  res.setHeader(SETTINGS_REVISION_HEADER, String(revision))
}

/** Whether a settings write was refused because the section moved under it. */
function isSettingsConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { code?: unknown }).code === 'SETTINGS_CONFLICT'
}

/**
 * Mount the monitoring half: record every `turn/end` reason, fold session
 * events into the notification inbox (turn ends, approvals, titles, subagent
 * completions), drop records for disposed sessions, and attach the optional
 * routes whenever a `webServer` service is present (skipped on non-web
 * profiles).
 * @param ctx - host context.
 * @param config - resolved plugin config (see {@link Config}); its two volatile
 *   fields are the shared-options and inbox settings sections.
 */
export function apply(ctx: Context, config: Config): void {
  const store = new TurnEndStore()
  const inbox = new NotificationStore()
  // Register the framework-native `sessionMonitorTurnEnd` projection alongside
  // the in-memory store above (see ./turn-end-projection.ts). Both are fed by
  // the same committed events today; the projection is what lets browser
  // clients read turn-end reasons off `SessionSummary.projectionValues`
  // instead of polling STATUS_ROUTE.
  installTurnEndProjection(ctx)
  // The plugin ships its own configuration surfaces (the Widgets manager dialog
  // + the desktop app, both over `/_dsh/session-monitor/settings`), so opt out of
  // the harness's schema-generated form: both Config fields are volatile by
  // design, which is what makes the entry form-eligible in 0.1.7, and a generated
  // form would expose the raw notification `inbox` array. `configure` throws if
  // called twice for one plugin instance — hence exactly one effect.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(
      () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
      'session-monitor: settings page policy',
    )
  })
  /** Open-turn depth per session (turn/start +1, turn/end −1) — drives the
   *  "subagent finished" edge (only the LAST turn end of a child notifies). */
  const turnDepth = new Map<string, number>()
  /** Last-seen title per session (used for the parent row of subagent notes). */
  const titles = new Map<string, string>()
  /** Open human-answer tool calls (callId → session + kind) so `tool/result`
   *  (or a turn end) can resolve the matching inbox record. */
  const openQuestions = new Map<string, { sessionId: string; kind: 'question' | 'plan-review' }>()
  /** Open model tool calls (callId → session + tool name + wall time): folds
   *  "what is this session executing right now" for the list progress display.
   *  A call is recorded on `tool/call` and closed on `tool/result` (or when its
   *  turn ends — every open call dies with the turn). */
  const openTools = new Map<string, { sessionId: string; name: string; at: number }>()
  /** The persisted inbox is loaded once per plugin instance — re-activating
   *  the inject scope (e.g. a webServer service restart) must not overwrite
   *  the live store with a stale persisted snapshot. */
  let inboxLoaded = false

  /** Resolve every open question wait of one session (answered via result, or
   *  cancelled/aborted because the turn ended). */
  const resolveOpenQuestions = (sessionId: string): void => {
    for (const [callId, open] of openQuestions) {
      if (open.sessionId === sessionId) {
        openQuestions.delete(callId)
        inbox.resolve(sessionId, open.kind)
      }
    }
  }

  /** Close every open tool call of one session (a turn ended, or the session
   *  was disposed) — a stale "executing" label must not outlive its turn. */
  const closeSessionTools = (sessionId: string): void => {
    for (const [callId, open] of openTools) {
      if (open.sessionId === sessionId) openTools.delete(callId)
    }
  }

  /** Snapshot of the newest open tool call per session (sessionId → tool). A
   *  session with parallel open calls reports its most recent one — that is
   *  the activity a monitor row should read as "executing now". */
  function currentTools(): Record<string, { name: string; at: number }> {
    const bySession = new Map<string, { name: string; at: number }>()
    for (const open of openTools.values()) {
      const prev = bySession.get(open.sessionId)
      if (prev === undefined || open.at >= prev.at) {
        bySession.set(open.sessionId, { name: open.name, at: open.at })
      }
    }
    return Object.fromEntries(bySession)
  }

  /** Best-known title for a session: the `session/title` handler keeps the
   *  cache fresh, so the common path must NOT rescan the whole event log —
   *  the log scan is only a backfill for sessions seen before any title event
   *  arrived (or whose cached title was cleared on dispose). */
  const titleOf = (session: { id: string }): string => {
    const cached = titles.get(session.id)
    if (cached !== undefined && cached.length > 0) return cached
    const fromLog = lastTitle(eventsOf(session as Session))
    if (fromLog !== undefined) {
      titles.set(session.id, fromLog)
      return fromLog
    }
    return ''
  }

  ctx.on('session/event', (session: { id: string }, event: import('@deepseek-ai/dsh-session').SessionEvent) => {
    const ev = event as unknown as LooseSessionEvent
    const header = (session as { header?: LooseSessionHeader }).header
    const isSubagent = header?.origin === 'subagent'

    if (ev.type === 'turn/start') {
      turnDepth.set(session.id, (turnDepth.get(session.id) ?? 0) + 1)
      return
    }
    if (ev.type === 'turn/end') {
      store.upsert(session.id, { reason: ev.data.reason?.kind ?? 'completed', at: ev.time })
      // A turn that ends closes every still-open human-answer wait (answered,
      // cancelled, or aborted) — resolve them so no record dangles.
      resolveOpenQuestions(session.id)
      // ...and every open tool call dies with the turn: a finished turn has no
      // "executing" tool left to report.
      closeSessionTools(session.id)
      const depth = Math.max(0, (turnDepth.get(session.id) ?? 1) - 1)
      turnDepth.set(session.id, depth)
      if (isSubagent) {
        // A subagent's finished turn notifies its parent, not itself — and only
        // when it closed the child's LAST open turn (the child is done). The
        // child id is part of the record id so two children completing in the
        // same millisecond cannot collapse into one notification.
        const parent = header?.parentSession
        if (depth === 0 && parent !== undefined) {
          inbox.push('subagent', parent, titles.get(parent) ?? parent, {
            id: `${parent}:subagent:${session.id}:${ev.time}`,
            at: ev.time,
          })
        }
        return
      }
      const kind = REASON_NOTIFY_KIND[ev.data.reason?.kind ?? ''] ?? 'done'
      // 'done' records coalesce per session (fixed id): a long-running session
      // would otherwise flood the inbox with one record per round and push
      // older, still-open P0 records (approvals / errors) past the 200-cap.
      // Later rounds refresh the same record (round / at / title) while
      // preserving its acked state — a read "done" stays read.
      inbox.push(kind, session.id, titleOf(session), {
        ...(kind === 'done' ? { id: `${session.id}:done` } : {}),
        round: ev.data.turn,
        at: ev.time,
      })
      return
    }
    if (isSubagent) return // no other inbox kinds for subagent sessions

    // Host-side question / plan-review detection: these waits are mux frames
    // (never session-log events), but they are always entered through a model
    // tool call — ask_user_question for questions, exit_plan_mode for plan
    // review — so the tool call/result edges are the host signal. The web
    // relay stays as a redundant backup (deduped by pushInteraction).
    if (ev.type === 'tool/call') {
      if (typeof ev.data.callId !== 'string') return
      // Record EVERY open model tool call — the progress display folds the
      // session's currently-executing tool from these (see currentTools).
      if (typeof ev.data.name === 'string' && ev.data.name.length > 0) {
        openTools.set(ev.data.callId, {
          sessionId: session.id,
          name: ev.data.name,
          at: typeof ev.time === 'number' ? ev.time : Date.now(),
        })
      }
      if (ev.data.name === PLAN_REVIEW_TOOL_NAME) {
        if (openQuestions.has(ev.data.callId)) return
        openQuestions.set(ev.data.callId, { sessionId: session.id, kind: 'plan-review' })
        inbox.pushInteraction(session.id, 'plan-review', titleOf(session), ev.time)
        return
      }
      if (ev.data.name === ASK_TOOL_NAME) {
        if (openQuestions.has(ev.data.callId)) return
        const kind = questionKindFromArgs(ev.data.arguments)
        openQuestions.set(ev.data.callId, { sessionId: session.id, kind })
        inbox.pushInteraction(session.id, kind, titleOf(session), ev.time)
        return
      }
      return
    }
    if (ev.type === 'tool/result') {
      if (typeof ev.data.callId !== 'string') return
      openTools.delete(ev.data.callId)
      const open = openQuestions.get(ev.data.callId)
      if (open !== undefined) {
        openQuestions.delete(ev.data.callId)
        inbox.resolve(open.sessionId, open.kind)
      }
      return
    }

    if (ev.type === 'approval/asked') {
      inbox.push('approval', session.id, titleOf(session), { at: ev.time })
      return
    }
    if (ev.type === 'approval/decided') {
      inbox.resolve(session.id, 'approval')
      return
    }
    if (ev.type === 'session/title') {
      const title = ev.data.title
      if (typeof title === 'string' && title.length > 0) {
        titles.set(session.id, title)
        inbox.push('title', session.id, title, { id: `${session.id}:title`, at: ev.time })
      }
    }
  })

  ctx.on('session/created', (session: { id: string }) => {
    const header = (session as { header?: LooseSessionHeader }).header
    if (header?.origin === 'subagent') return
    inbox.push('new-session', session.id, '', { id: `${session.id}:new-session` })
  })

  ctx.on('session/disposed', (session: { id: string }) => {
    store.remove(session.id)
    turnDepth.delete(session.id)
    titles.delete(session.id)
    for (const [callId, open] of openQuestions) {
      if (open.sessionId === session.id) openQuestions.delete(callId)
    }
    closeSessionTools(session.id)
  })

  ctx.inject(['webServer', 'sessions', 'settings'], (webCtx) => {
    webCtx.effect(() => {
      // Shared settings store (single source of truth for web + desktop; the
      // web half mirrors it into its localStorage, the desktop reads/writes it
      // directly — see desktop-settings.ts). Harness 0.1.7: these are two
      // volatile fields of this plugin's own Config entry, addressed by the
      // entry id the plugin was mounted under.
      const ns = ownSettingsNamespace(ctx, MONITOR_SETTINGS_NS)
      const settingsScope = configSection(webCtx.settings, ns, MONITOR_SETTINGS_FIELD, () => config.settings.get())
      /**
       * The entry's current revision, as the settings seam reports it: the
       * precondition a client bases its next write on, returned on every
       * settings response.
       */
      const settingsRevision = (): number | undefined =>
        webCtx.settings.describe().find((row) => row.ns === ns)?.revision
      // Notification inbox: persisted in its own section (survives
      // webview/process restarts; shared with any future web-side consumer).
      const inboxScope = configSection(webCtx.settings, ns, INBOX_FIELD, () => config.inbox.get())
      const storedInbox = inboxScope.get()
      if (!inboxLoaded) {
        inbox.load(storedInbox.seq, storedInbox.notes)
        inboxLoaded = true
      }
      let persistTimer: ReturnType<typeof setTimeout> | undefined
      /**
       * Snapshot the inbox and persist it NOW (no debounce). No
       * `expectedRevision` is passed: this section has a single writer — this
       * half — and every write sends the complete `{seq, notes}` snapshot, so a
       * revision guard could only turn an interleaved-but-newer write into a
       * spurious conflict (the revision is per ENTRY, shared with the settings
       * section the web panel writes through the route).
       */
      const flushInbox = (): Promise<void> => {
        if (persistTimer !== undefined) {
          clearTimeout(persistTimer)
          persistTimer = undefined
        }
        const payload = inbox.toJSON()
        return inboxScope.merge({ seq: payload.seq, notes: payload.notes }).catch((error: unknown) => {
          webCtx.logger.warn(`session-monitor: inbox persist failed: ${String(error)}`)
        })
      }
      // Terminal mutations (ack / resolve) land immediately so the ≤1s debounce
      // window cannot swallow them; ordinary pushes stay coalesced.
      inbox.attach((immediate) => {
        if (immediate) {
          void flushInbox()
          return
        }
        if (persistTimer !== undefined) return
        persistTimer = setTimeout(() => { void flushInbox() }, 1000)
      })
      let pendingJump: PendingJump | null = null
      /** Last heartbeat from an open Harness web tab (the client half pings). */
      let lastWebPingAt: number | null = null
      const isWebAlive = (): boolean =>
        lastWebPingAt !== null && Date.now() - lastWebPingAt < 10_000
      /** Long-poll waiters (the web half's jump consumers). */
      const jumpWaiters = new Set<() => void>()
      const releaseJumpWaiters = (): void => {
        for (const release of jumpWaiters) release()
        jumpWaiters.clear()
      }

      const disposers = [
        webCtx.webServer.register({
          kind: 'exact',
          path: STATUS_ROUTE,
          handler: (req, res) => {
            responseJson(req, res, 200, {
              ok: true,
              value: { sessions: store.snapshot(), tools: currentTools(), rounds: store.roundCounts() },
            })
          },
        }),
        // Desktop widget data: the session snapshot (rows fold the store +
        // event logs; cold persisted rows merge through a TTL-cached probe —
        // see desktop-snapshot.ts) plus the turn-end reason table, so the
        // widget needs no separate /status poll: the round-reason is fresh at
        // the exact moment it observes a running→false edge.
        webCtx.webServer.register({
          kind: 'exact',
          path: SESSIONS_ROUTE,
          handler: async (req, res) => {
            try {
              const snapshot = await buildDesktopSnapshot(webCtx)
              responseJson(req, res, 200, {
                ok: true,
                value: { ...snapshot, reasons: store.snapshot(), tools: currentTools(), rounds: store.roundCounts() },
              })
            } catch (error) {
              const message = error instanceof Error ? error.stack ?? error.message : String(error)
              webCtx.logger.warn(`session-monitor: snapshot failed: ${message}`)
              responseJson(req, res, 500, { ok: false, error: message })
            }
          },
        }),
        // Desktop widget page: the standalone, self-contained monitor UI.
        webCtx.webServer.register({
          kind: 'exact',
          path: WIDGET_ROUTE,
          handler: (req, res) => {
            responseHtml(req, res, pageHtml)
          },
        }),
        // Shared settings: GET the resolved section; POST merges into it. The
        // web half pushes on every local save and pulls on boot + poll; the
        // desktop widget reads/writes the same store.
        //
        // Optimistic concurrency (optional): GET returns the entry's revision in
        // `X-DSH-Settings-Revision`, and a POST that carries that header asserts
        // the section has not moved since — a stale writer gets 409
        // `settings-conflict` instead of silently clobbering the other writer.
        // A POST without the header keeps the historical last-write-wins
        // behavior, which is what the desktop app relies on.
        webCtx.webServer.register({
          kind: 'exact',
          path: SETTINGS_ROUTE,
          handler: async (req, res) => {
            if (req.method === 'POST') {
              const body = await readJsonBody(req) as Record<string, unknown> | null
              if (body === null || typeof body !== 'object') {
                responseJson(req, res, 400, { ok: false, error: 'invalid settings body' })
                return
              }
              const expected = readExpectedRevision(req)
              try {
                await settingsScope.merge(clampSettingsWire(body) as Partial<MonitorSettingsWire>, expected)
                const value = clampSettingsWire({ ...(settingsScope.get() as unknown as Record<string, unknown>) })
                setRevisionHeader(res, settingsRevision())
                responseJson(req, res, 200, { ok: true, value })
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                const conflict = isSettingsConflict(error)
                webCtx.logger.warn(`session-monitor: settings save failed: ${message}`)
                responseJson(req, res, conflict ? 409 : 400, {
                  ok: false,
                  error: message,
                  ...(conflict ? { code: 'settings-conflict' } : {}),
                })
              }
              return
            }
            const value = clampSettingsWire({ ...(settingsScope.get() as unknown as Record<string, unknown>) })
            setRevisionHeader(res, settingsRevision())
            responseJson(req, res, 200, { ok: true, value })
          },
        }),
        // Jump queue: the desktop posts { sessionId } when the user clicks a
        // session row; an open Harness web tab polls, opens the session and
        // marks it consumed; the desktop falls back to the browser when no tab
        // consumed it in time. Also handles { consume: true } and the web
        // client's { ping: true } heartbeat (webAlive lets the desktop wait
        // long enough for consumption instead of falling back too early).
        webCtx.webServer.register({
          kind: 'exact',
          path: JUMP_ROUTE,
          handler: async (req, res) => {
            if (req.method === 'POST') {
              const body = await readJsonBody(req) as { sessionId?: unknown; consume?: unknown; ping?: unknown } | null
              if (body !== null && typeof body === 'object') {
                if (body.ping === true) {
                  lastWebPingAt = Date.now()
                  responseJson(req, res, 200, { ok: true, webAlive: isWebAlive(), value: null })
                  return
                }
                if (body.consume === true) {
                  const pending = readPendingJump(pendingJump)
                  if (pending !== null) pending.consumed = true
                  responseJson(req, res, 200, { ok: true, webAlive: isWebAlive(), value: null })
                  return
                }
                if (typeof body.sessionId === 'string' && body.sessionId.length > 0) {
                  pendingJump = { sessionId: body.sessionId, at: Date.now(), consumed: false }
                  // Wake every long-poll waiter so background tabs consume
                  // without waiting for their next timer tick.
                  releaseJumpWaiters()
                  responseJson(req, res, 200, { ok: true, webAlive: isWebAlive(), value: null })
                  return
                }
              }
              responseJson(req, res, 400, { ok: false, error: 'invalid jump body' })
              return
            }
            const pending = readPendingJump(pendingJump)
            responseJson(req, res, 200, {
              ok: true,
              webAlive: isWebAlive(),
              value: pending === null ? null : {
                sessionId: pending.sessionId,
                at: pending.at,
                consumed: pending.consumed,
              },
            })
          },
        }),
        // Long-poll: the web half holds this GET open until a jump arrives
        // (or a 25s timeout). Held fetches are immune to the background-tab
        // timer throttling that would stall a setInterval-based poll.
        webCtx.webServer.register({
          kind: 'exact',
          path: JUMP_POLL_ROUTE,
          handler: (req, res) => {
            if (req.method !== 'GET') {
              responseJson(req, res, 405, { ok: false, error: 'GET only' })
              return
            }
            const existing = readPendingJump(pendingJump)
            if (existing !== null && !existing.consumed) {
              responseJson(req, res, 200, {
                ok: true,
                webAlive: isWebAlive(),
                value: { sessionId: existing.sessionId, at: existing.at, consumed: existing.consumed },
              })
              return
            }
            let settled = false
            const finish = (value: { sessionId: string; at: number; consumed: boolean } | null): void => {
              if (settled) return
              settled = true
              jumpWaiters.delete(release)
              if (timeout !== undefined) clearTimeout(timeout)
              responseJson(req, res, 200, { ok: true, webAlive: isWebAlive(), value })
            }
            const release = (): void => {
              const pending = readPendingJump(pendingJump)
              finish(pending === null ? null : {
                sessionId: pending.sessionId,
                at: pending.at,
                consumed: pending.consumed,
              })
            }
            const timeout = setTimeout(() => finish(null), 25_000)
            jumpWaiters.add(release)
            res.on('close', () => {
              jumpWaiters.delete(release)
              if (!settled) clearTimeout(timeout)
            })
          },
        }),
        // Notification inbox: GET returns the full snapshot (seq + unread count
        // + records). The desktop widget polls it like the session snapshot and
        // diffs by record signature; a future web-side badge can read the same
        // list. Records are capped/archived in the store.
        webCtx.webServer.register({
          kind: 'exact',
          path: NOTIFICATIONS_ROUTE,
          handler: (req, res) => {
            responseJson(req, res, 200, { ok: true, value: inbox.snapshot() })
          },
        }),
        // Acknowledge inbox records: { ids: [...] } | { sessionId } | { all: true }.
        webCtx.webServer.register({
          kind: 'exact',
          path: NOTIFICATIONS_ACK_ROUTE,
          handler: async (req, res) => {
            if (req.method !== 'POST') {
              responseJson(req, res, 405, { ok: false, error: 'POST only' })
              return
            }
            const body = await readJsonBody(req) as
              { ids?: unknown; sessionId?: unknown; all?: unknown } | null
            if (body === null || typeof body !== 'object') {
              responseJson(req, res, 400, { ok: false, error: 'invalid ack body' })
              return
            }
            const ids = Array.isArray(body.ids)
              ? body.ids.filter((value): value is string => typeof value === 'string')
              : undefined
            const sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0
              ? body.sessionId
              : undefined
            const all = body.all === true
            if (ids === undefined && sessionId === undefined && !all) {
              responseJson(req, res, 400, { ok: false, error: 'nothing to ack' })
              return
            }
            const count = inbox.ack({ ids, sessionId, all })
            responseJson(req, res, 200, { ok: true, value: { count } })
          },
        }),
        // Web half relay: client-transient interaction pauses (question /
        // plan-review) never hit the session log, so the browser half posts
        // them here. { sessionId, kind, state: 'open'|'closed', title? } —
        // idempotent: 'open' is a no-op while an open record exists; 'closed'
        // resolves the latest open record of that kind.
        webCtx.webServer.register({
          kind: 'exact',
          path: EVENTS_ROUTE,
          handler: async (req, res) => {
            if (req.method !== 'POST') {
              responseJson(req, res, 405, { ok: false, error: 'POST only' })
              return
            }
            const body = await readJsonBody(req) as
              { sessionId?: unknown; kind?: unknown; state?: unknown; title?: unknown } | null
            if (body === null || typeof body !== 'object') {
              responseJson(req, res, 400, { ok: false, error: 'invalid event body' })
              return
            }
            const sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0
              ? body.sessionId
              : undefined
            const kind = body.kind === 'question' || body.kind === 'plan-review' || body.kind === 'new-session'
              ? body.kind as 'question' | 'plan-review' | 'new-session'
              : undefined
            if (sessionId === undefined || kind === undefined) {
              responseJson(req, res, 400, { ok: false, error: 'invalid sessionId/kind' })
              return
            }
            if (body.state === 'closed') {
              inbox.resolve(sessionId, kind)
              responseJson(req, res, 200, { ok: true, value: null })
              return
            }
            const title = typeof body.title === 'string' ? body.title : ''
            inbox.pushInteraction(sessionId, kind, title)
            responseJson(req, res, 200, { ok: true, value: null })
          },
        }),
      ]
      return () => {
        // Final best-effort flush for whatever is still inside the debounce
        // window. Terminal mutations (ack / resolve) no longer rely on it — they
        // persist on their own (see the persistence hook above) — and it can
        // still fail under harness 0.1.7: the Config write goes through
        // configEditor.edit, which refuses to run once the owning fiber is no
        // longer ACTIVE, and cordis flips the state before this disposer body
        // resumes. `flushInbox` logs that instead of swallowing it.
        void flushInbox()
        for (const dispose of disposers) dispose()
      }
    }, 'session-monitor: status/snapshot/widget/settings/jump/inbox routes')
  })
}
