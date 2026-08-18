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
import { buildDesktopSnapshot } from './desktop-snapshot.ts'
import { MONITOR_SETTINGS_NS, MonitorSettingsSchema } from './desktop-settings.ts'
import type { MonitorSettingsWire } from './desktop-settings.ts'
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

/**
 * Mount the monitoring half: record every `turn/end` reason, drop records for
 * disposed sessions, and attach the optional status route whenever a
 * `webServer` service is present (skipped on non-web profiles).
 * @param ctx - host context.
 */
export function apply(ctx: Context): void {
  const store = new TurnEndStore()

  ctx.on('session/event', (session: { id: string }, event: import('@deepseek-ai/dsh-session').SessionEvent) => {
    if (event.type !== 'turn/end') return
    store.upsert(session.id, { reason: event.data.reason.kind, at: event.time })
  })

  ctx.on('session/disposed', (session: { id: string }) => {
    store.remove(session.id)
  })

  ctx.inject(['webServer', 'sessions', 'settings'], (webCtx) => {
    webCtx.effect(() => {
      // Shared settings store (single source of truth for web + desktop; the
      // web half mirrors it into its localStorage, the desktop reads/writes it
      // directly — see desktop-settings.ts).
      const settingsScope = webCtx.settings.register(MONITOR_SETTINGS_NS, MonitorSettingsSchema)
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
      ]
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'session-monitor: status/snapshot/widget/settings/jump routes')
  })
}
