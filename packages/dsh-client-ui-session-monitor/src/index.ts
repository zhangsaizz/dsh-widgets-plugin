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
 * CORS is intentionally permissive on these routes: the desktop shell loads
 * the widget page same-origin, but its startup probe page runs on the Tauri
 * `tauri://localhost` origin and must be able to check reachability. The data
 * is loopback-local monitor telemetry (session ids, titles, activity times,
 * UI preferences).
 */
const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function responseJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Cache-Control', 'no-store')
  for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value)
  res.writeHead(status)
  res.end(bytes)
}

function responseHtml(res: import('node:http').ServerResponse, html: string): void {
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

  /** Best-known title for a session: from its event log, then the cache. */
  const titleOf = (session: { id: string }): string => {
    const fromLog = lastTitle(eventsOf(session as Session))
    if (fromLog !== undefined) {
      titles.set(session.id, fromLog)
      return fromLog
    }
    return titles.get(session.id) ?? ''
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
      const depth = Math.max(0, (turnDepth.get(session.id) ?? 1) - 1)
      turnDepth.set(session.id, depth)
      if (isSubagent) {
        // A subagent's finished turn notifies its parent, not itself — and only
        // when it closed the child's LAST open turn (the child is done).
        const parent = header?.parentSession
        if (depth === 0 && parent !== undefined) {
          inbox.push('subagent', parent, titles.get(parent) ?? parent, { at: ev.time })
        }
        return
      }
      const kind = REASON_NOTIFY_KIND[ev.data.reason?.kind ?? ''] ?? 'done'
      inbox.push(kind, session.id, titleOf(session), { round: ev.data.turn, at: ev.time })
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
      inbox.load(storedInbox.seq, storedInbox.notes)
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
          handler: (_req, res) => {
            responseJson(res, 200, { ok: true, value: { sessions: store.snapshot() } })
          },
        }),
        // Desktop widget data: the session snapshot (rows fold the store +
        // event logs; cold persisted rows merge through a TTL-cached probe —
        // see desktop-snapshot.ts).
        webCtx.webServer.register({
          kind: 'exact',
          path: SESSIONS_ROUTE,
          handler: async (_req, res) => {
            try {
              responseJson(res, 200, { ok: true, value: await buildDesktopSnapshot(webCtx) })
            } catch (error) {
              const message = error instanceof Error ? error.stack ?? error.message : String(error)
              webCtx.logger.warn(`session-monitor: snapshot failed: ${message}`)
              responseJson(res, 500, { ok: false, error: message })
            }
          },
        }),
        // Desktop widget page: the standalone, self-contained monitor UI.
        webCtx.webServer.register({
          kind: 'exact',
          path: WIDGET_ROUTE,
          handler: (_req, res) => {
            responseHtml(res, pageHtml)
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
                responseJson(res, 400, { ok: false, error: 'invalid settings body' })
                return
              }
              try {
                await settingsScope.replace(body)
                responseJson(res, 200, { ok: true, value: settingsScope.get() })
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                webCtx.logger.warn(`session-monitor: settings save failed: ${message}`)
                responseJson(res, 400, { ok: false, error: message })
              }
              return
            }
            responseJson(res, 200, { ok: true, value: settingsScope.get() })
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
                  responseJson(res, 200, { ok: true, webAlive: isWebAlive(), value: null })
                  return
                }
                if (body.consume === true) {
                  const pending = readPendingJump(pendingJump)
                  if (pending !== null) pending.consumed = true
                  responseJson(res, 200, { ok: true, webAlive: isWebAlive(), value: null })
                  return
                }
                if (typeof body.sessionId === 'string' && body.sessionId.length > 0) {
                  pendingJump = { sessionId: body.sessionId, at: Date.now(), consumed: false }
                  // Wake every long-poll waiter so background tabs consume
                  // without waiting for their next timer tick.
                  releaseJumpWaiters()
                  responseJson(res, 200, { ok: true, webAlive: isWebAlive(), value: null })
                  return
                }
              }
              responseJson(res, 400, { ok: false, error: 'invalid jump body' })
              return
            }
            const pending = readPendingJump(pendingJump)
            responseJson(res, 200, {
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
              responseJson(res, 405, { ok: false, error: 'GET only' })
              return
            }
            const existing = readPendingJump(pendingJump)
            if (existing !== null && !existing.consumed) {
              responseJson(res, 200, {
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
              responseJson(res, 200, { ok: true, webAlive: isWebAlive(), value })
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
          handler: (_req, res) => {
            responseJson(res, 200, { ok: true, value: inbox.snapshot() })
          },
        }),
        // Acknowledge inbox records: { ids: [...] } | { sessionId } | { all: true }.
        webCtx.webServer.register({
          kind: 'exact',
          path: NOTIFICATIONS_ACK_ROUTE,
          handler: async (req, res) => {
            if (req.method !== 'POST') {
              responseJson(res, 405, { ok: false, error: 'POST only' })
              return
            }
            const body = await readJsonBody(req) as
              { ids?: unknown; sessionId?: unknown; all?: unknown } | null
            if (body === null || typeof body !== 'object') {
              responseJson(res, 400, { ok: false, error: 'invalid ack body' })
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
              responseJson(res, 400, { ok: false, error: 'nothing to ack' })
              return
            }
            const count = inbox.ack({ ids, sessionId, all })
            responseJson(res, 200, { ok: true, value: { count } })
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
              responseJson(res, 405, { ok: false, error: 'POST only' })
              return
            }
            const body = await readJsonBody(req) as
              { sessionId?: unknown; kind?: unknown; state?: unknown; title?: unknown } | null
            if (body === null || typeof body !== 'object') {
              responseJson(res, 400, { ok: false, error: 'invalid event body' })
              return
            }
            const sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0
              ? body.sessionId
              : undefined
            const kind = body.kind === 'question' || body.kind === 'plan-review' || body.kind === 'new-session'
              ? body.kind as 'question' | 'plan-review' | 'new-session'
              : undefined
            if (sessionId === undefined || kind === undefined) {
              responseJson(res, 400, { ok: false, error: 'invalid sessionId/kind' })
              return
            }
            if (body.state === 'closed') {
              inbox.resolve(sessionId, kind)
              responseJson(res, 200, { ok: true, value: null })
              return
            }
            const title = typeof body.title === 'string' ? body.title : ''
            inbox.pushInteraction(sessionId, kind, title)
            responseJson(res, 200, { ok: true, value: null })
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
