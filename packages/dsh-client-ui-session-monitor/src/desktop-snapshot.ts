/**
 * Desktop snapshot builder: folds the session store into the compact JSON rows
 * the standalone desktop widget polls (`/_dsh/session-monitor/sessions`).
 *
 * The row set mirrors what the web widget's `useSessions` list shows, so the
 * two monitors stay consistent: ATTACHED (in-memory) sessions plus COLD
 * persisted sessions. Everything for attached rows is derived from the store
 * and its event logs — no extra services, no new peer dependencies:
 *
 *  - `running`: the last turn-boundary event wins (`turn/start` opens a turn,
 *    `turn/end` closes it; trailing non-turn events like titles or approval
 *    audit records do not change it). Equivalent to the agent's lifecycle
 *    status for live sessions.
 *  - `title`: the last `session/title` event (the same log the title service
 *    folds).
 *  - `pending`: the last approval audit event (`approval/asked` without a
 *    following `approval/decided`). Question / plan-review pendings are
 *    client-transient states that never hit the log, so they are intentionally
 *    absent from this snapshot.
 *  - `subagents`: count of LIVE child sessions with `origin === 'subagent'`
 *    whose parent is this session AND that are currently running (mirrors the
 *    browser widget's 子×N badge semantics).
 *
 * Cold rows (persisted but not attached) come from `sessionPersistence` when
 * present — the same source the official `session.list` RPC merges. Their
 * recency/blank come from the projection cache (`sessionProjectionCache`),
 * and title / last-activity from a per-session `readFrom` probe cached with a
 * TTL so a 2s poll does not re-read every artifact. A missing persistence
 * service simply yields attached-only rows.
 *
 * Type notes: this module runs on the HOST context, where `ctx.sessions` is
 * the `dsh-session` `SessionStore`. The `dsh-client-runtime/client` module
 * augmentation (pulled in by the browser half of this same package) re-declares
 * `Context.sessions` as the client `ISessions` face, so the store is reached
 * through an explicit cast. Plugin-merged event types (`session/title`,
 * `approval/asked`, `approval/decided`) are declared by peer packages that are
 * intentionally NOT in this package's typecheck graph, so events are viewed
 * through a loose local shape; persistence services are accessed via `get()`
 * with a loose shape for the same reason.
 *
 * @module @dsh-plugins/client-ui-session-monitor/desktop-snapshot
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionStore } from '@deepseek-ai/dsh-session'

/** One row of the desktop monitor snapshot. */
export interface DesktopSessionRow {
  /** The host session id. */
  readonly sessionId: string
  /** Last accepted title (absent while the session is still untitled). */
  readonly title?: string
  /** Whether a turn is currently open (the agent is mid-loop). */
  readonly running: boolean
  /** No turn has run yet (fresh, list-hidden sessions). */
  readonly blank: boolean
  /** List-parity recency: creation time or the last user prompt, whichever is newer. */
  readonly updatedAt: number
  /** Wall time of the newest event in the log (actual last activity). */
  readonly lastActive: number
  /** Coarse product classification for subagent children. */
  readonly origin?: 'subagent'
  /** The session this one was forked from (seed lineage). */
  readonly parentSessionId?: string
  /** An approval question is currently waiting for a decision. */
  readonly pending?: 'approval'
  /** Live running subagent children count (parent-row 子×N badge). */
  readonly subagents: number
  /** Whether this row came from persistence (not attached in this process). */
  readonly cold?: boolean
}

/** A snapshot of sessions for the desktop widget. */
export interface DesktopSnapshot {
  /** Snapshot wall time (Unix epoch milliseconds). */
  readonly at: number
  /** Sessions: attached (creation order) + cold persisted, unsorted. */
  readonly sessions: readonly DesktopSessionRow[]
}

/** Loose event view: covers the base event vocabulary plus plugin-merged
 *  types (`session/title`, `approval/asked`, `approval/decided`) without
 *  pulling those peer packages into the typecheck graph. */
interface AnyEvent {
  readonly type: string
  readonly time: number
  readonly data: {
    readonly title?: string
    readonly source?: { readonly kind?: string }
  }
}

/** Loose view of the persisted session header (`dsh-session` SessionHeader). */
interface LooseHeader {
  readonly id: string
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: string
  readonly origin?: 'subagent'
}

/** Loose view of `ctx.sessionPersistence` (dsh-session-persistence). */
interface LoosePersistence {
  list(): Promise<LooseHeader[]>
  readFrom(id: string, fromSeq: number): Promise<{ meta: LooseHeader; events: AnyEvent[] }>
}

function eventsOf(session: Session): readonly AnyEvent[] {
  return session.events as unknown as readonly AnyEvent[]
}

/** Is the session's agent currently mid-turn? The last turn-boundary event
 *  decides — `turn/start` opens a turn, `turn/end` closes it, and everything
 *  else leaves the state unchanged. */
function isRunning(session: Session): boolean {
  let running = false
  for (const event of eventsOf(session)) {
    if (event.type === 'turn/start') running = true
    else if (event.type === 'turn/end') running = false
  }
  return running
}

/** Last accepted title from the log, or undefined while untitled. */
function lastTitle(events: readonly AnyEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event.type === 'session/title') return event.data.title
  }
  return undefined
}

/** Is an approval decision still pending? The last approval audit event wins. */
function approvalPending(events: readonly AnyEvent[]): boolean {
  let pending = false
  for (const event of events) {
    if (event.type === 'approval/asked') pending = true
    else if (event.type === 'approval/decided') pending = false
  }
  return pending
}

/** Wall time of the newest event in the log (undefined for an empty log). */
function lastEventTime(events: readonly AnyEvent[]): number | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    if (typeof events[index].time === 'number') return events[index].time
  }
  return undefined
}

/** List-parity recency: creation time or the last user prompt, whichever is newer. */
function sessionUpdatedAt(events: readonly AnyEvent[], createdAt: number): number {
  let lastPromptAt: number | undefined
  for (const event of events) {
    if (event.type === 'user/message' && event.data.source?.kind === 'user') {
      lastPromptAt = event.time
    }
  }
  return Math.max(createdAt, lastPromptAt ?? 0)
}

// ── cold (persisted) session merging ────────────────────────────────
/** TTL for the per-session cold probe cache (title / last activity reads). */
const COLD_PROBE_TTL_MS = 30_000
/** Re-list persisted session metadata at most this often. */
const COLD_LIST_TTL_MS = 8_000

interface ColdProbe {
  readonly row: DesktopSessionRow
  readonly at: number
}

const coldProbes = new Map<string, ColdProbe>()
let coldListAt = 0

/** Read title / last activity / updatedAt for one cold session (cached). */
async function probeColdSession(
  persistence: LoosePersistence,
  meta: LooseHeader,
  cachedMetadata: { blank?: boolean; lastPromptAt?: number } | undefined,
): Promise<DesktopSessionRow | null> {
  try {
    const { events } = await persistence.readFrom(meta.id, 0)
    const blank = cachedMetadata?.blank === false
      ? false
      : !events.some((event) => event.type === 'turn/start')
    const title = lastTitle(events)
    const lastActive = lastEventTime(events) ?? meta.createdAt
    const updatedAt = Math.max(meta.createdAt, cachedMetadata?.lastPromptAt ?? 0)
    return {
      sessionId: meta.id,
      ...(title === undefined ? {} : { title }),
      running: false,
      blank,
      updatedAt,
      lastActive,
      ...(meta.origin === undefined ? {} : { origin: meta.origin }),
      ...(meta.parentSession === undefined ? {} : { parentSessionId: meta.parentSession }),
      subagents: 0,
      cold: true,
    }
  } catch {
    return null
  }
}

/** Merge cold persisted sessions into the row set (same source as the web
 *  `session.list` RPC), using the projection cache when available and a
 *  TTL-cached artifact probe otherwise. */
async function mergeColdSessions(
  ctx: Context,
  attachedIds: ReadonlySet<string>,
  rows: DesktopSessionRow[],
): Promise<void> {
  const persistence = ctx.get('sessionPersistence') as LoosePersistence | undefined
  if (persistence === undefined) return
  // Re-list the metadata at most every few seconds.
  const now = Date.now()
  if (coldListAt !== 0 && now - coldListAt < COLD_LIST_TTL_MS) {
    // Reuse cached probes only; skip enumeration this cycle.
    for (const probe of coldProbes.values()) {
      if (now - probe.at < COLD_PROBE_TTL_MS && !attachedIds.has(probe.row.sessionId)) {
        rows.push(probe.row)
      }
    }
    return
  }
  coldListAt = now

  const projectionCache = ctx.get('sessionProjectionCache') as
    | { cachedSnapshot(meta: LooseHeader): { values?: Record<string, unknown> } | undefined }
    | undefined

  let metas: LooseHeader[]
  try {
    metas = await persistence.list()
  } catch {
    return
  }
  for (const meta of metas) {
    if (attachedIds.has(meta.id) || meta.cwd === undefined) continue
    const cached = coldProbes.get(meta.id)
    if (cached !== undefined && now - cached.at < COLD_PROBE_TTL_MS) {
      rows.push(cached.row)
      continue
    }
    const metadata = projectionCache?.cachedSnapshot(meta)?.values?.sessionListMetadata as
      | { blank?: boolean; lastPromptAt?: number }
      | undefined
    const row = await probeColdSession(persistence, meta, metadata)
    if (row !== null) {
      coldProbes.set(meta.id, { row, at: now })
      rows.push(row)
    }
  }
}

/** Fold the session store (attached) + persistence (cold) into the snapshot. */
export async function buildDesktopSnapshot(ctx: Context): Promise<DesktopSnapshot> {
  // Host context: `ctx.sessions` is the dsh-session SessionStore (the client
  // ISessions face only exists in the browser context).
  const store = ctx.sessions as unknown as SessionStore
  const sessions = store.list()

  // Pass 1: count live running subagent children per parent (子×N badge).
  const runningSubagents = new Map<string, number>()
  for (const session of sessions) {
    const parent = session.header.parentSession
    if (session.header.origin === 'subagent' && parent !== undefined && isRunning(session)) {
      runningSubagents.set(parent, (runningSubagents.get(parent) ?? 0) + 1)
    }
  }

  // Pass 2: project attached sessions into their wire rows.
  const rows: DesktopSessionRow[] = []
  const attachedIds = new Set<string>()
  for (const session of sessions) {
    const header = session.header
    attachedIds.add(session.id)
    const events = eventsOf(session)
    const title = lastTitle(events)
    const blank = !events.some((event) => event.type === 'turn/start')
    const pending = approvalPending(events)
    rows.push({
      sessionId: session.id,
      ...(title === undefined ? {} : { title }),
      running: isRunning(session),
      blank,
      updatedAt: sessionUpdatedAt(events, header.createdAt),
      lastActive: lastEventTime(events) ?? header.createdAt,
      ...(header.origin === undefined ? {} : { origin: header.origin }),
      ...(header.parentSession === undefined ? {} : { parentSessionId: header.parentSession }),
      ...(pending ? { pending: 'approval' as const } : {}),
      subagents: runningSubagents.get(session.id) ?? 0,
    })
  }

  // Pass 3: merge cold persisted sessions (same list the web widget sees).
  await mergeColdSessions(ctx, attachedIds, rows)

  return { at: Date.now(), sessions: rows }
}
