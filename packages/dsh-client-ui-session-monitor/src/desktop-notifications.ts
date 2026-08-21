/**
 * Desktop notification inbox store: the durable, host-authoritative list of
 * session events that may need the user's attention (approvals, questions,
 * plan reviews, errored rounds, …) or that the user may want to see (round
 * completion, subagent completion).
 *
 * Why host-side: the desktop widget lives in the Tauri WebView2 webview, whose
 * storage partition is separate from the browser's, and a client-side diff of
 * the session snapshot would lose everything on restart and have no shared
 * read/unread state. The store therefore lives on the Host: events are folded
 * into notification records here (from the `session/event` feed, the approval
 * audit log, and a browser-half relay for client-transient interaction
 * pauses), acked state is persisted into the harness settings document, and
 * both the desktop widget and (later) the web app read the same list.
 *
 * Each record is one identifiable event: `id` is stable (used for ack), the
 * `(sessionId, kind, round)` triple drives idempotency so repeated relays and
 * polls never duplicate a record — except `done`, which coalesces per session
 * under the stable id `<sessionId>:done` (a long session must not flood the
 * inbox with one record per round; later rounds refresh the same record).
 * `ackedAt` marks the record read; `resolved` marks a condition that already
 * passed (e.g. an approval was decided) without the user having acknowledged
 * it.
 *
 * @module @dsh-plugins/client-ui-session-monitor/desktop-notifications
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Every notification kind the inbox knows. P2 kinds are generated but off by
 *  default in the UI (filtered client-side). */
export type NotifyKind =
  | 'approval'
  | 'question'
  | 'plan-review'
  | 'error'
  | 'blocked'
  | 'max-tokens'
  | 'subagent'
  | 'done'
  | 'aborted'
  | 'interrupted'
  | 'title'
  | 'new-session'

/** All valid kinds, as a runtime set (persisted records are validated on load). */
export const NOTIFY_KINDS: ReadonlySet<string> = new Set<NotifyKind>([
  'approval', 'question', 'plan-review', 'error', 'blocked', 'max-tokens',
  'subagent', 'done', 'aborted', 'interrupted', 'title', 'new-session',
])

/** One inbox record (immutable; updates produce a new record object). */
export interface InboxNotification {
  /** Stable record id — used by ack. */
  readonly id: string
  /** The session this event belongs to (jump target). */
  readonly sessionId: string
  /** Event kind (see {@link NotifyKind}). */
  readonly kind: NotifyKind
  /** Session title snapshot at event time (empty → the client falls back). */
  readonly title: string
  /** Turn number when the event is turn-boundary-scoped. */
  readonly round?: number
  /** Event wall time (Unix epoch milliseconds). */
  readonly at: number
  /** When the user acknowledged the record (absent = unread). */
  readonly ackedAt?: number
  /** The condition already passed (approval decided, interaction closed). */
  readonly resolved?: boolean
}

/** Settings namespace holding the persisted inbox (separate section from the
 *  shared monitor options, which stay in `session-monitor`). */
export const INBOX_NS = settingsNamespace('session-monitor-inbox')

/** Cap on retained records; the oldest are dropped beyond this. */
const MAX_NOTES = 200
/** Acked/resolved records older than this are archived (unacked records are
 *  never time-pruned — only the cap applies). */
const RETENTION_MS = 7 * 24 * 60 * 60_000

/** Wire shape of one snapshot for the desktop widget. */
export interface InboxSnapshot {
  /** Monotonic store revision (number of records ever created). */
  readonly seq: number
  /** Records needing attention (not acked and not resolved). */
  readonly unread: number
  /** All retained records, insertion order (oldest first). */
  readonly notes: readonly InboxNotification[]
}

/** Ack targets: one or more ids, all records of one session, or everything. */
export interface AckTarget {
  readonly ids?: readonly string[]
  readonly sessionId?: string
  readonly all?: boolean
}

/** Host-side notification inbox. */
export class NotificationStore {
  private notes: InboxNotification[] = []
  private seq = 0
  /** Persist hook (debounced by the caller); absent = in-memory only. */
  private persist: (() => void) | null = null

  /** Attach the persistence hook (called on every mutation). */
  attach(persist: () => void): void {
    this.persist = persist
  }

  /** Load a persisted store (validates and prunes on the way in). */
  load(seq: number, notes: readonly InboxNotification[]): void {
    const seen = new Set<string>()
    const out: InboxNotification[] = []
    for (const note of notes) {
      const normalized = this.normalize(note)
      if (normalized === null || seen.has(normalized.id)) continue
      seen.add(normalized.id)
      out.push(normalized)
    }
    this.seq = typeof seq === 'number' && Number.isFinite(seq) && seq >= 0 ? Math.floor(seq) : 0
    this.notes = out
    this.prune()
  }

  /** Read snapshot for the widget (prunes expired records first). */
  snapshot(): InboxSnapshot {
    this.prune()
    return {
      seq: this.seq,
      unread: this.notes.filter((note) => note.ackedAt === undefined && note.resolved !== true).length,
      notes: this.notes.slice(),
    }
  }

  /** Plain JSON for persistence. */
  toJSON(): { seq: number; notes: InboxNotification[] } {
    return { seq: this.seq, notes: this.notes.slice() }
  }

  /**
   * Append (or refresh) one record. Idempotent by id: an existing record keeps
   * its acked state and only its title / time / round / resolved flag refresh.
   * @returns the resulting record, or null when the kind is unknown.
   */
  push(
    kind: NotifyKind,
    sessionId: string,
    title: string,
    opts: { id?: string; round?: number; at?: number; resolved?: boolean } = {},
  ): InboxNotification | null {
    if (!NOTIFY_KINDS.has(kind)) return null
    const at = opts.at ?? Date.now()
    const id = opts.id ?? `${sessionId}:${kind}:${opts.round ?? `e${at}`}`
    const existing = this.notes.find((note) => note.id === id)
    if (existing !== undefined) {
      const next: InboxNotification = {
        ...existing,
        title: title || existing.title,
        at,
        ...(opts.round !== undefined ? { round: opts.round } : {}),
        ...(opts.resolved === true ? { resolved: true } : {}),
      }
      this.notes = this.notes.map((note) => (note.id === id ? next : note))
      return next
    }
    const note: InboxNotification = {
      id,
      sessionId,
      kind,
      title,
      at,
      ...(opts.round === undefined ? {} : { round: opts.round }),
      ...(opts.resolved === true ? { resolved: true } : {}),
    }
    this.notes.push(note)
    this.seq++
    this.prune()
    this.persist?.()
    return note
  }

  /** Mark every still-open record of one kind for a session as resolved
   *  (e.g. `approval/decided` resolves the pending approval). Resolving ALL open
   *  records (not just the latest) is the defensive form: the dedup in
   *  pushInteraction normally keeps one open slot per (session, kind), but a
   *  direct push could leave more than one, and each would otherwise stay unread
   *  forever once its condition passed. */
  resolve(sessionId: string, kind: NotifyKind): void {
    let changed = false
    for (let index = this.notes.length - 1; index >= 0; index--) {
      const note = this.notes[index]
      if (note.sessionId === sessionId && note.kind === kind && note.resolved !== true) {
        this.notes[index] = { ...note, resolved: true }
        changed = true
      }
    }
    if (changed) this.persist?.()
  }

  /**
   * Relay-path push for interaction pauses (question / plan-review): while an
   * OPEN record for the same (session, kind) exists, this is a no-op — the
   * client relays on appearance, which may repeat; only a closed→open cycle
   * creates a fresh record.
   * @returns the resulting (existing or new) record.
   */
  pushInteraction(sessionId: string, kind: NotifyKind, title: string, at = Date.now()): InboxNotification {
    for (let index = this.notes.length - 1; index >= 0; index--) {
      const note = this.notes[index]
      if (note.sessionId === sessionId && note.kind === kind && note.resolved !== true && note.ackedAt === undefined) {
        return note
      }
    }
    const created = this.push(kind, sessionId, title, { id: `${sessionId}:${kind}:${at}`, at })
    return created ?? { id: `${sessionId}:${kind}:${at}`, sessionId, kind, title, at }
  }

  /** Mark records acked per the target; returns how many changed. */
  ack(target: AckTarget = {}): number {
    const { ids, sessionId, all } = target
    const idSet = ids !== undefined ? new Set(ids) : undefined
    const now = Date.now()
    let changed = 0
    this.notes = this.notes.map((note) => {
      if (note.ackedAt !== undefined) return note
      const match = all === true
        || (idSet !== undefined && idSet.has(note.id))
        || (sessionId !== undefined && note.sessionId === sessionId)
      if (!match) return note
      changed++
      return { ...note, ackedAt: now }
    })
    if (changed > 0) this.persist?.()
    return changed
  }

  /** Validate one persisted record; null when malformed or of an unknown kind. */
  private normalize(note: InboxNotification): InboxNotification | null {
    if (note === null || typeof note !== 'object') return null
    if (typeof note.id !== 'string' || note.id.length === 0) return null
    if (typeof note.sessionId !== 'string' || note.sessionId.length === 0) return null
    if (typeof note.kind !== 'string' || !NOTIFY_KINDS.has(note.kind)) return null
    if (typeof note.title !== 'string') return null
    if (typeof note.at !== 'number' || !Number.isFinite(note.at)) return null
    return {
      id: note.id,
      sessionId: note.sessionId,
      kind: note.kind as NotifyKind,
      title: note.title,
      // The persistence schema defaults absent round/ackedAt to 0 — treat
      // non-positive values as absent (0 is also falsy for the widget).
      ...(typeof note.round === 'number' && Number.isFinite(note.round) && note.round > 0
        ? { round: Math.floor(note.round) }
        : {}),
      at: note.at,
      ...(typeof note.ackedAt === 'number' && Number.isFinite(note.ackedAt) && note.ackedAt > 0
        ? { ackedAt: note.ackedAt }
        : {}),
      ...(note.resolved === true ? { resolved: true } : {}),
    }
  }

  /** Enforce the cap and archive acked/resolved records past retention. */
  private prune(): void {
    const cutoff = Date.now() - RETENTION_MS
    this.notes = this.notes.filter((note) => {
      if (note.at >= cutoff) return true
      return !(note.ackedAt !== undefined || note.resolved === true)
    })
    if (this.notes.length <= MAX_NOTES) return
    const overflow = this.notes.length - MAX_NOTES
    const kept: InboxNotification[] = []
    let dropped = 0
    // Prefer evicting acked/resolved records first: the unread count drives the
    // "not handled yet" badge, so the cap must never silently shrink it while a
    // handled record is still available to drop instead. this.notes is append-
    // ordered, so eviction always drops the least recent record of a state.
    for (const note of this.notes) {
      if (dropped < overflow && (note.ackedAt !== undefined || note.resolved === true)) {
        dropped++
        continue
      }
      kept.push(note)
    }
    // Only when every record is unread (or not enough handled ones existed) do
    // we fall back to evicting the oldest unread ones.
    if (kept.length > MAX_NOTES) kept.splice(0, kept.length - MAX_NOTES)
    this.notes = kept
  }
}

/** Schema for the persisted inbox section (absent section resolves to empty).
 *  Optional fields carry non-positive defaults (this schemastery version has no
 *  `.optional()`); {@link NotificationStore.normalize} restores true absence. */
export const InboxStoreSchema: z<{ seq: number; notes: InboxNotification[] }> = z.object({
  seq: z.number().default(0),
  notes: z.array(z.object({
    id: z.string(),
    sessionId: z.string(),
    kind: z.union([
      'approval', 'question', 'plan-review', 'error', 'blocked', 'max-tokens',
      'subagent', 'done', 'aborted', 'interrupted', 'title', 'new-session',
    ] as const),
    title: z.string().default(''),
    at: z.number(),
    round: z.number().default(0),
    ackedAt: z.number().default(0),
    resolved: z.boolean().default(false),
  })).default([]),
})
