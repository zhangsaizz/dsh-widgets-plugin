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

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `webServer` service merge onto Context (dsh-host-webserver).
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Session } from '@deepseek-ai/dsh-session'
import { buildDesktopSnapshot, eventsOf, lastTitle } from './desktop-snapshot.ts'
import { MONITOR_SETTINGS_NS, MonitorSettingsSchema } from './desktop-settings.ts'
import type { MonitorSettingsWire } from './desktop-settings.ts'
import { INBOX_NS, InboxStoreSchema, NotificationStore } from './desktop-notifications.ts'
import type { NotifyKind } from './desktop-notifications.ts'
// Inlined by the host bundle build (esbuild `text` loader) — the standalone
// desktop widget page (see ./widget-page.html for the full doc comment).
import pageHtml from './widget-page.html'

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
/** Cap on the JSON body the settings/jump routes accept. */
const MAX_BODY_BYTES = 64 * 1024

/**
 * CORS is intentionally permissive on these routes — but only for trusted
 * consumers: the desktop shell loads the widget page same-origin, its startup
 * probe page runs on the Tauri `tauri://localhost` origin, and the web app is
 * served from wherever the user opened it. Every response is gated on the
 * request `Origin`: anything else gets a bare 403 with no CORS headers, so a
 * random website open in the user's browser can neither read the inbox
 * (session titles!) nor ack records nor overwrite settings. `allowOpaque`
 * additionally admits `Origin: null` — that is how the tauri://localhost →
 * widget page top-level NAVIGATION arrives — and is only used for the HTML
 * page; JSON data routes keep it closed so a sandboxed iframe cannot
 * exfiltrate them. The data is loopback-local monitor telemetry (session ids,
 * titles, activity times, UI preferences).
 */
const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function requestHeader(req: import('node:http').IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name]
  return typeof raw === 'string' ? raw : undefined
}

/** Whether a request `Origin` may read/write these routes. The web app and the
 *  widget page are served from whatever host the user opened (127.0.0.1,
 *  localhost, or a LAN IP), so an origin is accepted when it matches this
 *  request's own `Host` header, plus any loopback hostname outright (the
 *  Tauri probe page and port-forwarded dev setups). Everything else — notably
 *  any random website open in the user's browser — is rejected. */
function originAllowed(origin: string | undefined, host: string | undefined, allowOpaque: boolean): boolean {
  if (origin === undefined) return true // same-origin / non-browser clients
  if (origin === 'null') return allowOpaque
  if (origin === 'tauri://localhost') return true
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (typeof host === 'string' && url.host === host) return true
    const hostname = url.hostname
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
  } catch {
    return false
  }
}

/** Reject an out-of-policy request with a bare 403 (no CORS headers, so the
 *  browser cannot read the response nor pass a preflight). */
function rejectForbidden(res: import('node:http').ServerResponse): void {
  res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('forbidden')
}

function responseJson(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  status: number,
  body: unknown,
): void {
  if (!originAllowed(requestHeader(req, 'origin'), requestHeader(req, 'host'), false)) {
    rejectForbidden(res)
    return
  }
  const bytes = Buffer.from(JSON.stringify(body))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Cache-Control', 'no-store')
  for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value)
  res.writeHead(status)
  res.end(bytes)
}

function responseHtml(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  html: string,
): void {
  // The widget page must survive the tauri://localhost → 127.0.0.1 top-level
  // navigation, whose Origin is opaque ('null') — the page itself carries no
  // data, only the script that then fetches the gated JSON routes.
  if (!originAllowed(requestHeader(req, 'origin'), requestHeader(req, 'host'), true)) {
    rejectForbidden(res)
    return
  }
  const bytes = Buffer.from(html)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Cache-Control', 'no-store')
  for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value)
  res.writeHead(200)
  res.end(bytes)
}

/** Read a JSON request body (bounded; malformed input resolves to null). */
async function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    received += buffer.length
    if (received > MAX_BODY_BYTES) return null
    chunks.push(buffer)
  }
  if (chunks.length === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

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

/**
 * Mount the monitoring half: record every `turn/end` reason, fold session
 * events into the notification inbox (turn ends, approvals, titles, subagent
 * completions), drop records for disposed sessions, and attach the optional
 * routes whenever a `webServer` service is present (skipped on non-web
 * profiles).
 * @param ctx - host context.
 */
export function apply(ctx: Context): void {
  const store = new TurnEndStore()
  const inbox = new NotificationStore()
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
      // directly — see desktop-settings.ts).
      const settingsScope = webCtx.settings.register(MONITOR_SETTINGS_NS, MonitorSettingsSchema)
      // Notification inbox: persisted in its own settings section (survives
      // webview/process restarts; shared with any future web-side consumer).
      const inboxScope = webCtx.settings.register(INBOX_NS, InboxStoreSchema)
      const storedInbox = inboxScope.get()
      if (!inboxLoaded) {
        inbox.load(storedInbox.seq, storedInbox.notes)
        inboxLoaded = true
      }
      let persistTimer: ReturnType<typeof setTimeout> | undefined
      const persistInbox = (): void => {
        if (persistTimer !== undefined) return
        persistTimer = setTimeout(() => {
          persistTimer = undefined
          const payload = inbox.toJSON()
          inboxScope.replace({ seq: payload.seq, notes: payload.notes }).catch((error) => {
            webCtx.logger.warn(`session-monitor: inbox persist failed: ${String(error)}`)
          })
        }, 1000)
      }
      inbox.attach(persistInbox)
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
        // Shared settings: GET the resolved section; POST replaces it. The web
        // half pushes on every local save and pulls on boot + poll; the
        // desktop widget reads/writes the same store.
        webCtx.webServer.register({
          kind: 'exact',
          path: SETTINGS_ROUTE,
          handler: async (req, res) => {
            if (req.method === 'POST') {
              const body = await readJsonBody(req) as Partial<MonitorSettingsWire> | null
              if (body === null || typeof body !== 'object') {
                responseJson(req, res, 400, { ok: false, error: 'invalid settings body' })
                return
              }
              try {
                await settingsScope.replace(body)
                responseJson(req, res, 200, { ok: true, value: settingsScope.get() })
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                webCtx.logger.warn(`session-monitor: settings save failed: ${message}`)
                responseJson(req, res, 400, { ok: false, error: message })
              }
              return
            }
            responseJson(req, res, 200, { ok: true, value: settingsScope.get() })
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
        if (persistTimer !== undefined) {
          clearTimeout(persistTimer)
          persistTimer = undefined
        }
        // Final flush so the last mutations survive a plugin stop.
        const payload = inbox.toJSON()
        void inboxScope.replace({ seq: payload.seq, notes: payload.notes }).catch(() => undefined)
        for (const dispose of disposers) dispose()
      }
    }, 'session-monitor: status/snapshot/widget/settings/jump/inbox routes')
  })
}
