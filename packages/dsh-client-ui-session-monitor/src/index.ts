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

/** Max remembered sessions; the oldest entry is dropped beyond this. */
const MAX_RECORDS = 100
/** Forget records older than this — the browser polls every few seconds. */
const RECORD_TTL_MS = 5 * 60_000

function responseJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Cache-Control', 'no-store')
  res.writeHead(status)
  res.end(bytes)
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

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const dispose = webCtx.webServer.register({
        kind: 'exact',
        path: STATUS_ROUTE,
        handler: (_req, res) => {
          responseJson(res, 200, { ok: true, value: { sessions: store.snapshot() } })
        },
      })
      return () => dispose()
    }, 'session-monitor: status route')
  })
}
