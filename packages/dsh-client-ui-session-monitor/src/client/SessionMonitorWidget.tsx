/**
 * The session monitor dashboard widget: a floating, draggable panel
 * registered into the shell.overlay list. It projects the live session list
 * through the standard `useSessions` prop — the list and running bits ride
 * the reactive projection with no Host RPC; only the turn-end REASON table
 * plus the executing-TOOL table (progress labels) are polled from the Host
 * status route every few seconds — and:
 *
 *  - lists the live (non-blank, non-subagent by default) sessions with their
 *    status (running / idle / round-done), title, pending-interaction flag and
 *    last-update time; a parent row shows a 子×N badge while it has N
 *    subagents running (subagent rows themselves stay filtered out);
 *  - rows with tasks in flight (a running turn, running subagents, background
 *    jobs) show a thin indeterminate progress bar + a label naming what is
 *    executing right now: the current model tool call and in-progress round
 *    for running rows (Host-tracked), the subagent/job load for busy rows;
 *    sessions running a task GOAL show a determinate bar instead — the goal
 *    projection rides `row.projectionValues.goal`, so rounds-started / cap
 *    renders as a real percentage (「目标 第 X/Y 轮」, plus the current tool);
 *  - watches `running` true→false edges and, per the user settings, pops a
 *    toast notification for every finished round ("完成一轮"), with 跳转
 *    (jump) and 知道了 (dismiss) actions — auto-dismiss or confirm-required;
 *  - clicking a row (or a toast's jump button) switches the app to that
 *    session through the injected `open` action (ctx.sessions.open).
 *
 * Settings and the panel position persist to localStorage; the config panel
 * (widgets.config) writes the same keys and announces changes via a window
 * event this component listens to.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type {
  InjectFace, PropsLocale, PropsRuntime, TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {
  PendingInteractionStatus, SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  MAX_SCALE, MIN_SCALE, POS_KEY, SETTINGS_CHANGED_EVENT, SETTINGS_KEY, clampToViewport, loadDone,
  loadLastActive, loadPos, loadScale, loadSettings, playChime, saveDone, saveLastActive, savePos, saveScale,
} from './settings.ts'
import type { MonitorSettings } from './settings.ts'
import css from './SessionMonitorWidget.module.css'

/** Injected business face: the jump-to-session verb (backed by ctx.sessions.open). */
export interface SessionMonitorInject {
  open: (sessionId: string) => void
}

/** Full composed props for the widget (runtime + inject + locale shares). */
export type SessionMonitorWidgetProps =
  & PropsRuntime<'shell.overlay'>
  & InjectFace<SessionMonitorInject>
  & PropsLocale<'session-monitor'>

/** What a round-completion toast represents; each kind gets a distinct accent. */
type ToastKind =
  | 'done'
  | 'approval'
  | 'plan-review'
  | 'question'
  | 'subagent'
  | 'error'
  | 'aborted'
  | 'blocked'
  | 'max-tokens'
  | 'interrupted'

/** One queued round-completion toast. */
interface Toast {
  key: number
  sessionId: string
  title: string
  at: number
  kind: ToastKind
  /** Round number this completion represents (Host count preferred, else observed). */
  round?: number
}

/** One session's currently-open model tool call (Host-tracked via tool/call →
 *  tool/result; absent while the session is between tools or the Host is
 *  down). Feeds the "正在执行 …" progress label on running rows. */
interface CurrentTool {
  /** Tool name as the model invoked it (e.g. web_search, bash). */
  name: string
  /** Event wall time of the tool/call (epoch ms). */
  at: number
}

/**
 * Loose client-side view of the `goal` session projection. The authoritative
 * shape is declared by `@deepseek-ai/dsh-goal` (`GoalProjection | null` in the
 * SessionProjectionMap), which is intentionally NOT in this package's
 * typecheck graph — same loose-shape convention as desktop-snapshot.ts. The
 * projection rides `row.projectionValues.goal` reactively (no Host RPC):
 * `roundsStarted / maxGoalRounds` is the determinate goal-round progress.
 */
interface GoalProjectionLoose {
  readonly goal?: {
    /** Durable lifecycle phase: active / paused / blocked / complete. */
    readonly phase?: string
    /** Total admitted goal-round cap. */
    readonly maxGoalRounds?: number
  }
  /** Highest admitted round number for this goal. */
  readonly roundsStarted?: number
}

/** Read one row's goal projection through the loose shape (absent/null = no
 *  goal). The cast is safe: `projectionValues` is a partial projection map. */
function goalProjectionOf(row: SessionSummary): GoalProjectionLoose | null | undefined {
  const goal = (row.projectionValues as { goal?: unknown } | undefined)?.goal
  if (goal === null || goal === undefined) return goal
  return goal as GoalProjectionLoose
}

/** A finished round waiting for its Host turn-end reason before toasting. */
interface PendingAlert {
  at: number
  baseKind: ToastKind
  title: string
  sessionId: string
  /** Round number as observed by this widget (Host cumulative count may replace it). */
  round: number
  /** Emit without waiting for the Host turn-end reason (interaction pauses
   *  have no turn/end record to wait for — the kind is known immediately). */
  immediate?: boolean
}

/** Turn-end reasons that deserve their own notification kind (vs plain done). */
const REASON_KINDS: ReadonlySet<string> = new Set([
  'error', 'aborted', 'blocked', 'max-tokens', 'interrupted',
])

/** Map a Host turn-end reason onto a toast kind; completed/unknown keep the base kind. */
function mapReasonKind(reason: string | undefined, base: ToastKind): ToastKind {
  return reason !== undefined && REASON_KINDS.has(reason) ? reason as ToastKind : base
}

/** Map a session's pending-interaction status onto its notification kind. */
function interactionKind(status: PendingInteractionStatus | undefined): ToastKind {
  if (status === 'approval') return 'approval'
  if (status === 'plan-review') return 'plan-review'
  return 'question'
}

/** Window event the widget dispatches for client-transient interaction pauses
 *  (question / plan-review) so the browser half can relay them into the Host
 *  inbox — those states never hit the session log, so without this relay the
 *  desktop widget could never see "waiting for you" items. */
export const RELAY_EVENT = 'dsh.smon.relay'

/** Narrow a pending-interaction status to the kinds the Host relay accepts
 *  (`approval` is host-side via the approval audit log). */
function interactionRelayKind(status: PendingInteractionStatus | undefined): 'question' | 'plan-review' | undefined {
  return status === 'question' || status === 'plan-review' ? status : undefined
}

/** Dispatch an interaction-pause relay event (open = appeared, closed = gone). */
function relayInteraction(
  sessionId: string,
  kind: 'question' | 'plan-review' | undefined,
  state: 'open' | 'closed',
  title?: string,
): void {
  if (kind === undefined) return
  try {
    window.dispatchEvent(new CustomEvent(RELAY_EVENT, { detail: { sessionId, kind, state, title } }))
  } catch { /* events unavailable */ }
}

/** Per-kind notification copy (title + body builder), shared by toasts and system notifications. */
function toastCopy(t: TranslateNS<'session-monitor'>, kind: ToastKind): { title: string; body: (title: string, round?: number) => string } {
  switch (kind) {
    case 'approval': return { title: t('approvalTitle'), body: (title) => t('approvalBody', { title }) }
    case 'plan-review': return { title: t('planReviewTitle'), body: (title) => t('planReviewBody', { title }) }
    case 'question': return { title: t('questionTitle'), body: (title) => t('questionBody', { title }) }
    case 'subagent': return { title: t('subagentTitle'), body: (title, round) => t('toastBody', { title, round }) }
    case 'error': return { title: t('errorTitle'), body: (title) => t('errorBody', { title }) }
    case 'aborted': return { title: t('abortedTitle'), body: (title) => t('abortedBody', { title }) }
    case 'blocked': return { title: t('blockedTitle'), body: (title) => t('blockedBody', { title }) }
    case 'max-tokens': return { title: t('maxTokensTitle'), body: (title) => t('maxTokensBody', { title }) }
    case 'interrupted': return { title: t('interruptedTitle'), body: (title) => t('interruptedBody', { title }) }
    default: return { title: t('toastTitle'), body: (title, round) => t('toastBody', { title, round }) }
  }
}

/** Per-kind icon glyph shown next to the toast title (geometric text glyphs). */
function toastIcon(kind: ToastKind): string {
  switch (kind) {
    case 'approval': return '⏳'
    case 'plan-review': return '📋'
    case 'question': return '❓'
    case 'subagent': return '⇄'
    case 'error': return '✕'
    case 'aborted': return '⏹'
    case 'blocked': return '⚠'
    case 'max-tokens': return '⛶'
    case 'interrupted': return '⏸'
    default: return '✓'
  }
}

/** How many toasts may stack in 'auto' mode (oldest dropped beyond this). */
const MAX_TOASTS = 5
/** 'confirm' mode cap: unconfirmed toasts are never evicted by new arrivals
 *  within this many simultaneous sessions (per-session toasts merge instead). */
const MAX_CONFIRM_TOASTS = 12
/** Default corner placement while the user has not dragged the panel. */
const DEFAULT_RIGHT = 16
const DEFAULT_BOTTOM = 150
/** Panel width used to clamp dragging; matches the CSS width. */
const PANEL_W = 268
/** BroadcastChannel name for cross-tab acknowledgment sync. */
const SYNC_CHANNEL = 'dsh-smon-sync'
/** Poll interval for the Host turn-end reason table (and the `tools` table). */
const POLL_INTERVAL_MS = 3000
/** Host status route: turn-end reasons + currently-executing tools. */
const STATUS_ROUTE = '/_dsh/session-monitor/status'
/** Host inbox route: the durable "not handled yet" unread count (badge). */
const INBOX_ROUTE = '/_dsh/session-monitor/notifications'
/** Host inbox ack route: marking records read (handling them clears the badge). */
const INBOX_ACK_ROUTE = '/_dsh/session-monitor/notifications/ack'
/** Badge poll cadence — slower than the reasons table, the count is not urgent. */
const INBOX_POLL_MS = 5000
/** How long a Host turn-end record may precede the client's edge detection
 *  and still count as the reason for THAT round. The Host records the turn-end
 *  at event wall time, which precedes the client's running-flip detection by a
 *  few hundred ms to one poll interval; a record strictly AFTER the detection
 *  belongs to a later round, so the window is one-sided (see flushPending). */
const REASON_FRESH_WINDOW_MS = 10_000

/** Cross-tab sync message: one tab acknowledged a completion; the others
 *  mirror the cleanup so a reminder acknowledged anywhere stops nagging
 *  everywhere. */
type SyncMessage =
  | { type: 'opened'; sessionId: string }
  | { type: 'toast-dismissed'; sessionId: string }
  | { type: 'done-cleared-all' }

/** Pointer-drag state for the panel. */
interface DragState {
  /** 'move' drags the panel; 'resize' drags the bottom-right zoom handle. */
  mode: 'move' | 'resize'
  pointerId: number
  startX: number
  startY: number
  originLeft: number
  originTop: number
  startScale: number
}

/** Compact relative-time label for a session's updatedAt (uses the ticking `now`). */
function formatAgo(ts: number, now: number, t: TranslateNS<'session-monitor'>): string {
  const delta = Math.max(0, now - ts)
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return t('justNow')
  if (minutes < 60) return t('minutesAgo', { n: String(minutes) })
  return t('hoursAgo', { n: String(Math.floor(minutes / 60)) })
}

/** True when two sets hold exactly the same members (O(n) content compare). */
function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}

/** True when two tool tables hold exactly the same entries (content compare so
 *  the 3s status poll does not re-render the panel when nothing changed). */
function sameTools(a: Readonly<Record<string, CurrentTool>>, b: Readonly<Record<string, CurrentTool>>): boolean {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  for (const key of aKeys) {
    const ta = a[key]
    const tb = b[key]
    if (tb === undefined || tb.name !== ta.name || tb.at !== ta.at) return false
  }
  return true
}

/**
 * Whether the user is currently NOT looking at this page: the tab is hidden,
 * the window is minimized, or the browser window simply lost focus. Both the
 * current-session suppression and the OS-level system notification hinge on
 * this — an in-page toast only helps while the user can see the page.
 */
function isUserAway(): boolean {
  return typeof document !== 'undefined'
    && (document.visibilityState === 'hidden' || !document.hasFocus())
}

/**
 * Order the visible rows: busy first (running, or not running but still doing
 * work — running subagents or background jobs), then round-done, then idle;
 * each group newest first.
 */
function orderRows(list: readonly SessionSummary[], doneIds: ReadonlySet<string>, busyIds: ReadonlySet<string>): SessionSummary[] {
  const rows = list.slice()
  rows.sort((a, b) => {
    const rankA = a.running || busyIds.has(a.id) ? 0 : doneIds.has(a.id) ? 1 : 2
    const rankB = b.running || busyIds.has(b.id) ? 0 : doneIds.has(b.id) ? 1 : 2
    if (rankA !== rankB) return rankA - rankB
    return b.updatedAt - a.updatedAt
  })
  return rows
}

export function SessionMonitorWidget(props: SessionMonitorWidgetProps) {
  const { t, open } = props
  /** The live session-list snapshot (stable reference between changes). */
  const sessions = props.useSessions((s: SessionListState) => s)

  const [settings, setSettings] = useState<MonitorSettings>(loadSettings)
  const [collapsed, setCollapsed] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(loadPos)
  const [scale, setScale] = useState(loadScale)
  const [dragging, setDragging] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  /** Sessions that finished a round since last visited. Persisted (loadDone
   *  prunes expired entries and sessions that no longer exist), so a reload
   *  keeps the badge; toasts/pending are in-memory only. */
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(() => loadDone(new Set(sessions.ids)))
  /** Per-session last-observed-activity ms (persisted; feeds the recent window). */
  const [lastActive, setLastActive] = useState<Record<string, number>>(loadLastActive)
  /**
   * Monotonic "now" refreshed every 30s. The session snapshot only changes on
   * list mutations, so without this the recent-window filter (and the relative
   * timestamps) would only be evaluated at load time and stale sessions would
   * never age out.
   */
  const [now, setNow] = useState(() => Date.now())
  /** Unread Host-inbox count (0 = nothing needs attention). */
  const [inboxUnread, setInboxUnread] = useState(0)
  /** Currently-executing tool per session (Host-tracked; state so the row
   *  progress labels update when the status poll lands a change). */
  const [tools, setTools] = useState<Readonly<Record<string, CurrentTool>>>({})

  /** Last-observed running bits per session; a true→false edge = one finished round. */
  const prevRunningRef = useRef<Map<string, boolean>>(new Map())
  const settingsRef = useRef(settings)
  const doneIdsRef = useRef(doneIds)
  const lastActiveRef = useRef(lastActive)
  /** Latest flushPending, so the mount-time poll loop never captures a stale closure. */
  const flushPendingRef = useRef<() => void>(() => undefined)
  const toastKeyRef = useRef(0)
  const dragRef = useRef<DragState | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  /** Whether the current drag moved far enough to count as a drag (vs a tap). */
  const movedRef = useRef(false)
  /** Live system-Notification instances per session, so other surfaces can dismiss them. */
  const notifyInstRef = useRef<Map<string, Notification>>(new Map())
  /** Host turn-end reason table (sessionId → { reason, at }), refreshed by polling. */
  const reasonsRef = useRef<Record<string, { reason: string; at: number; round?: number }>>({})
  /** Host cumulative finished-round counts (sessionId → count; NOT TTL-pruned),
   *  refreshed by the same poll — the IN-PROGRESS round of a running turn is
   *  `count + 1`, accurate even for long turns. */
  const roundsHostRef = useRef<Record<string, number>>({})
  /** Whether the Host status route answered at least once ('unknown' before the first poll). */
  const hostStatusRef = useRef<'unknown' | 'up' | 'down'>('unknown')
  /** Finished rounds waiting for their Host reason before the toast is emitted. */
  const pendingRef = useRef<Map<string, PendingAlert>>(new Map())
  /** Per-session finished-round counter observed by THIS widget (fallback when
   *  the Host is absent; the Host's cumulative count is preferred when fresh). */
  const roundsRef = useRef<Map<string, number>>(new Map())
  /** Last-observed pending-interaction presence per session (appearance edges). */
  const prevInteractionRef = useRef<Map<string, PendingInteractionStatus | undefined>>(new Map())
  /** Newest unread inbox record's session (badge click jumps to it). */
  const newestUnreadRef = useRef<string | null>(null)
  /** Live BroadcastChannel for cross-tab acknowledgment sync (null when unavailable). */
  const syncChannelRef = useRef<BroadcastChannel | null>(null)
  /** Last-observed session-id set; shrinking ids = disposed sessions. */
  const prevIdsRef = useRef<ReadonlySet<string>>(new Set())
  /** Latest dragged position / scale, so drag-end can persist them once
   *  instead of writing localStorage on every pointermove (sync writes jank). */
  const posRef = useRef<{ x: number; y: number } | null>(null)
  const scaleRef = useRef(scale)
  /** Latest current-session id for the return-cleanup listener (below). */
  const currentIdRef = useRef<string | undefined>(sessions.current)
  /** Previous current-session id for the app-open acknowledgment effect. */
  const prevCurrentRef = useRef<string | undefined>(undefined)
  /** Skip the first run of that effect: the mount-time current is not an "opened" event. */
  const currentFirstRunRef = useRef(true)

  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { doneIdsRef.current = doneIds }, [doneIds])
  useEffect(() => { lastActiveRef.current = lastActive }, [lastActive])
  useEffect(() => { currentIdRef.current = sessions.current })
  // Re-point the flush ref every render: flushPending closes over the latest
  // `t`/settings, so the mount-time poll loop must not hold the first frame's.
  useEffect(() => { flushPendingRef.current = flushPending })
  // Persist the done marks on every change so a reload keeps the record of
  // finished rounds (toasts and pending alerts stay in-memory by design).
  useEffect(() => { saveDone(doneIds) }, [doneIds])

  // Re-read settings/position/scale whenever the config panel writes them.
  useEffect(() => {
    const handler = (): void => {
      const p = loadPos()
      posRef.current = p
      setPos(p)
      setSettings(loadSettings())
      setScale(loadScale())
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, handler)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, handler)
  }, [])

  // Cross-tab acknowledgment sync: when one tab dismisses a toast, opens a
  // session, or clears the done marks, the other tabs' widgets mirror it, so a
  // completion acknowledged anywhere stops nagging everywhere. BroadcastChannel
  // never echoes to the sender, and absence degrades to per-tab behavior.
  useEffect(() => {
    let channel: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(SYNC_CHANNEL)
    } catch { /* BroadcastChannel unavailable */ }
    if (!channel) return
    syncChannelRef.current = channel
    channel.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as SyncMessage | undefined
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'opened' || msg.type === 'toast-dismissed') {
        setToasts((prev) => prev.filter((t) => t.sessionId !== msg.sessionId))
      }
      if (msg.type === 'opened') {
        // The session was opened in another tab — acknowledge the completion
        // here too: clear its done mark and close any live system notification.
        setDoneIds((ds) => {
          if (!ds.has(msg.sessionId)) return ds
          const next = new Set(ds)
          next.delete(msg.sessionId)
          return next
        })
        closeBrowserNotify(msg.sessionId)
      } else if (msg.type === 'done-cleared-all') {
        setDoneIds(new Set())
      }
    }
    return () => {
      syncChannelRef.current = null
      channel?.close()
    }
  }, [])

  // Settings saved in another tab (the config panel writes localStorage): the
  // `storage` event fires only in the other tabs, so re-read there.
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === SETTINGS_KEY) setSettings(loadSettings())
      else if (e.key === POS_KEY) {
        const p = loadPos()
        posRef.current = p
        setPos(p)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Session disposal cleanup: once a session leaves the list, drop its pending
  // alerts, toasts, done marks and system notifications — a reminder for a
  // vanished session is just noise. The empty-start guard avoids treating the
  // first snapshot as "everything was disposed".
  useEffect(() => {
    const prev = prevIdsRef.current
    const next = new Set<string>(sessions.ids)
    prevIdsRef.current = next
    if (prev.size === 0) return
    const removed: string[] = []
    for (const id of prev) if (!next.has(id)) removed.push(id)
    if (removed.length === 0) return
    for (const id of removed) {
      // A pending interaction vanished with the session — resolve it in the
      // Host inbox (otherwise a "waiting for you" record would dangle forever).
      const prevKind = prevInteractionRef.current.get(id)
      if (prevKind === 'question' || prevKind === 'plan-review') relayInteraction(id, prevKind, 'closed')
      pendingRef.current.delete(id)
      roundsRef.current.delete(id)
      prevInteractionRef.current.delete(id)
      prevRunningRef.current.delete(id)
      closeBrowserNotify(id)
    }
    setToasts((ts) => ts.filter((t) => !removed.includes(t.sessionId)))
    setDoneIds((ds) => {
      let changed = false
      const nextDs = new Set(ds)
      for (const id of removed) if (nextDs.delete(id)) changed = true
      return changed ? nextDs : ds
    })
  }, [sessions.ids])

  // Tick "now" so the time-window filter and relative timestamps age sessions
  // out while the page stays open without any session-list mutation.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  // "Returned to the page" cleanup: the completion notices exist to reach the
  // user while they are NOT looking at the page (tab hidden, window
  // minimized, or the browser window simply lost focus — another program in
  // front). Once they actually come back (window refocused / tab shown), the
  // CURRENT session's notices have served their purpose — the conversation
  // they were viewing is right there, so the finished round needs no further
  // pestering: close any live system notification, clear the session's
  // "round done" badge, drop its in-page toast, and cancel a round whose
  // Host reason was still pending (a late reason must not re-toast after the
  // return). This runs regardless of whether a system notification was
  // actually delivered — the user is back either way, so the in-page toast
  // and badge would only linger stale. Scope: ONLY the current session
  // (other sessions' completions still await the user's attention and must
  // not be silently dropped). Each tab cleans its own notice instances — no
  // cross-tab broadcast: another tab may have a different current session,
  // and its own return event cleans its own instance.
  //
  // The away↔back edge must be tracked on BOTH directions. Listening to
  // `focus` alone is not enough: switching to another program leaves the tab
  // `visible` (the window is merely unfocused) and fires NO event on the way
  // out, so prevAway would never become true and the later `focus` would not
  // be recognized as a return. `blur` records the away transition,
  // `visibilitychange` covers tab hidden/shown and window minimize/restore.
  useEffect(() => {
    let prevAway = isUserAway()
    const sync = (): void => {
      const away = isUserAway()
      const returned = prevAway && !away
      prevAway = away
      if (!returned) return
      const id = currentIdRef.current
      if (id === undefined) return
      closeBrowserNotify(id)
      // Cancel a still-pending alert first: if its Host turn-end reason had
      // not been resolved by the time the user came back, the next poll would
      // otherwise toast a round the user is already looking at.
      pendingRef.current.delete(id)
      setToasts((ts) => {
        if (!ts.some((t) => t.sessionId === id)) return ts
        return ts.filter((t) => t.sessionId !== id)
      })
      setDoneIds((ds) => {
        if (!ds.has(id)) return ds
        const next = new Set(ds)
        next.delete(id)
        return next
      })
    }
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  // "Session opened through the app" acknowledgment: the moment the app's
  // CURRENT session changes to a defined session (opened via the app's own UI
  // — sidebar, history, … — not the widget's rows/toasts), that session's
  // completion notices are stale: the user is looking at it now. Mirror
  // handleOpen: clear its done mark, toasts, pending alert and any live system
  // notification, and broadcast the acknowledgment so other tabs stop nagging
  // for it too. The FIRST run is skipped: the mount-time current is not an
  // "opened" event, and a done mark restored for it after a reload must
  // survive. While the user is away no app-side switch happens without them,
  // so nothing fires then — the return-cleanup owns that window.
  useEffect(() => {
    const prev = prevCurrentRef.current
    const next = sessions.current
    prevCurrentRef.current = next
    if (currentFirstRunRef.current) {
      currentFirstRunRef.current = false
      return
    }
    if (next === undefined || prev === next || isUserAway()) return
    pendingRef.current.delete(next)
    closeBrowserNotify(next)
    setToasts((ts) => {
      if (!ts.some((t) => t.sessionId === next)) return ts
      return ts.filter((t) => t.sessionId !== next)
    })
    setDoneIds((ds) => {
      if (!ds.has(next)) return ds
      const n = new Set(ds)
      n.delete(next)
      return n
    })
    broadcastSync({ type: 'opened', sessionId: next })
  }, [sessions.current])

  // Round-completion detection: diff the running bits across snapshots.
  useEffect(() => {
    const prev = prevRunningRef.current
    const next = new Map<string, boolean>()
    const finished: SessionSummary[] = []
    for (const id of sessions.ids) {
      const row = sessions.byId[id]
      if (!row) continue
      next.set(id, row.running)
      if (prev.get(id) === true && !row.running) finished.push(row)
    }
    prevRunningRef.current = next

    const cfg = settingsRef.current
    const now = Date.now()
    // Whether the user is actually looking at this page. The current-session
    // suppression below assumes exactly that: if they switched away (another
    // tab, a minimized window, or the browser window simply lost focus), a
    // finished round of the *current* session still deserves a notification —
    // the in-page toast waits for them on return, and the system notification
    // (when enabled) reaches them on the OS level.
    const userAway = isUserAway()
    // Record the moment a session starts or finishes a round as its last
    // activity (feeds the recent-window filter; updatedAt only tracks prompts).
    // The `prev.has(id)` guard is load-bearing: `prev` starts empty on mount,
    // so without it the first snapshot would stamp EVERY session as "active
    // just now", wipe the persisted last-active map, and disable the
    // time-window filter after every page reload.
    const bumps = new Map<string, number>()
    for (const id of next.keys()) {
      if (prev.has(id) && prev.get(id) !== next.get(id)) bumps.set(id, now)
    }
    if (bumps.size > 0) {
      const merged = { ...lastActiveRef.current }
      for (const [id, ts] of bumps) merged[id] = ts
      // Persist OUTSIDE the state updater: updaters must stay pure (StrictMode
      // double-invokes them, and a write inside would also duplicate per bump).
      saveLastActive(merged)
      setLastActive(merged)
    }
    // A session that starts a new round loses its stale "round done" mark.
    const newDone = new Set(doneIdsRef.current)
    for (const id of next.keys()) {
      if (next.get(id)) newDone.delete(id)
    }
    // Queue finished rounds as pending alerts: the toast is emitted by the
    // poll driver below once the Host turn-end reason is known (or immediately
    // when no Host is present), so error/aborted rounds get the right kind.
    for (const row of finished) {
      // Subagents are filtered out by default — skip them entirely unless
      // "show subagents" is enabled (then they show up and notify too).
      if (row.origin === 'subagent' && !cfg.showSubagents) continue
      // Current session: skip only while the user is looking at it AND has not
      // opted in; once they are away, the round still notifies. Exception:
      // rounds that stop waiting for the user's input/confirmation always
      // notify — "your turn" is the one case the user must not miss, even
      // while looking at the page (the ordinary "round done" can stay silent).
      if (row.id === sessions.current && !cfg.notifyCurrent && !userAway && !row.pendingInteraction) continue
      newDone.add(row.id)
      // Base kind from what the client alone can observe; the Host reason may
      // refine it to error / aborted / blocked / max-tokens / interrupted.
      const baseKind: ToastKind = row.pendingInteraction
        ? interactionKind(row.pendingInteraction)
        : row.origin === 'subagent'
          ? 'subagent'
          : 'done'
      // Round number as observed by this widget: every finished edge counts as
      // one round (goal-mode multi-rounds included). The Host's cumulative
      // count replaces this in flushPending when available.
      roundsRef.current.set(row.id, (roundsRef.current.get(row.id) ?? 0) + 1)
      // The pending slot is one per session: if an earlier alert for the same
      // session is STILL waiting for its Host reason, a new round would
      // overwrite (and silently drop) it — emit the earlier one now with its
      // base kind so no finished round goes unnotified.
      const previous = pendingRef.current.get(row.id)
      if (previous !== undefined && previous.immediate !== true && settingsRef.current.notify) {
        appendToasts([{
          key: ++toastKeyRef.current,
          sessionId: previous.sessionId,
          title: previous.title,
          at: previous.at,
          kind: previous.baseKind,
          round: previous.round,
        }])
      }
      pendingRef.current.set(row.id, {
        at: now,
        baseKind,
        title: row.displayTitle || row.id,
        sessionId: row.id,
        round: roundsRef.current.get(row.id) ?? 1,
      })
    }
    // Interaction pauses (approval / plan-review / question): a session that
    // stops to wait for the user mid-turn does NOT flip `running`, so the
    // round-edge loop above never fires for it. Watch pendingInteraction
    // APPEARANCE instead. Rows that finished a round in the same run were
    // already queued above (their base kind reflects the interaction); the
    // `tracked` guard skips pre-existing pending states on first mount, so
    // only pauses that happen while the widget is open notify.
    const finishedIds = new Set<string>(finished.map((row) => row.id))
    // byId is keyed by SessionId (a branded string); index through a plain view.
    const byId = sessions.byId as Readonly<Record<string, SessionSummary>>
    for (const id of next.keys()) {
      const row = byId[id]
      if (!row) continue
      const prevKind = prevInteractionRef.current.get(id)
      const wasPending = prevKind !== undefined
      const nowPending = row.pendingInteraction !== undefined
      const tracked = prevInteractionRef.current.has(id)
      prevInteractionRef.current.set(id, row.pendingInteraction)
      // Closed edge: a pause ended (or changed kind) while the widget is open —
      // relay it so the Host inbox resolves the record.
      if (tracked && wasPending && !nowPending) {
        relayInteraction(id, interactionRelayKind(prevKind), 'closed')
        continue
      }
      if (!tracked || !nowPending || wasPending) continue
      if (finishedIds.has(id)) continue
      if (row.origin === 'subagent' && !cfg.showSubagents) continue
      // Interaction toasts are exempt from the current-session suppression —
      // "your turn" must not be missed even while looking at the page (same
      // rule as the round-edge path). Emitted immediately: no turn/end record
      // exists to wait for. Also relay the pause into the Host inbox so the
      // desktop widget sees it.
      relayInteraction(id, interactionRelayKind(row.pendingInteraction), 'open', row.displayTitle || row.id)
      pendingRef.current.set(row.id, {
        at: now,
        baseKind: interactionKind(row.pendingInteraction),
        title: row.displayTitle || row.id,
        sessionId: row.id,
        round: roundsRef.current.get(row.id) ?? 1,
        immediate: true,
      })
    }
    // Compare by CONTENT, not size: a snapshot where one session's mark is
    // added and another's removed keeps the same size — skipping then would
    // lose the new mark and keep the stale one (and doneIdsRef would lag too).
    if (!sameSet(newDone, doneIdsRef.current)) setDoneIds(newDone)
    // With no Host reachable, emit pending toasts immediately instead of
    // waiting for the next poll.
    flushPending()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions])

  /** Append toasts with the mode's dedupe/eviction policy (newest first). */
  function appendToasts(emit: Toast[]): void {
    if (emit.length === 0) return
    setToasts((prevToasts) => {
      if (settingsRef.current.notifyMode === 'confirm') {
        // Confirm mode: a session's newer round replaces its older toast, and
        // unconfirmed toasts are never evicted by new arrivals. Newest first.
        const deduped = prevToasts.filter((t) => !emit.some((nt) => nt.sessionId === t.sessionId))
        return [...emit, ...deduped].slice(0, MAX_CONFIRM_TOASTS)
      }
      // Auto mode: newest first, oldest dropped beyond the stack cap.
      return [...emit, ...prevToasts].slice(0, MAX_TOASTS)
    })
  }

  /**
   * Emit toasts (and browser notifications) for finished rounds once their
   * Host turn-end reason is known. Without a Host, pending rounds flush with
   * their base kind right away; with one, each poll resolves the reason (or a
   * stale fallback kicks in after 12s for rounds the Host never saw).
   */
  function flushPending(): void {
    const cfg = settingsRef.current
    const pending = pendingRef.current
    if (pending.size === 0) return
    const now = Date.now()
    const host = hostStatusRef.current
    const emit: Toast[] = []
    const settled: string[] = []
    for (const [sessionId, alert] of pending) {
      const rec = reasonsRef.current[sessionId]
      // The Host records the turn-end at event wall time, which precedes the
      // client's running-flip detection (the status frame arrives after the
      // event). A record matches THIS round when it sits in a window
      // immediately BEFORE the alert — a record strictly after the detection
      // belongs to a later round, so it must not mislabel this toast.
      const recFresh = rec !== undefined && rec.at <= alert.at && rec.at >= alert.at - REASON_FRESH_WINDOW_MS
      const stale = now - alert.at > 12_000
      let kind: ToastKind
      if (alert.immediate === true) {
        // Interaction pauses carry no turn/end record — the kind is known now.
        kind = alert.baseKind
      } else if (host === 'down' || stale) {
        kind = alert.baseKind
      } else if (recFresh) {
        kind = mapReasonKind(rec.reason, alert.baseKind)
      } else {
        // Wait for the next poll to resolve the reason.
        continue
      }
      // Round number: the Host's cumulative per-session count is authoritative
      // when fresh (it counts every turn/end, surviving page reloads); the
      // widget's own observed count is the fallback (Host down / stale).
      const round = recFresh && rec.round !== undefined ? rec.round : alert.round
      emit.push({ key: ++toastKeyRef.current, sessionId, title: alert.title, at: alert.at, kind, round })
      settled.push(sessionId)
    }
    for (const id of settled) pending.delete(id)
    if (emit.length === 0) return
    // The chime is an audible alert for when the user is NOT looking at the
    // page (a background tab can still play it); while they are present the
    // visual toast is enough — same away-gate as the system notification.
    if (cfg.sound && isUserAway()) playChime()
    if (cfg.notify) appendToasts(emit)
    // The system notification exists to reach the user while they are NOT
    // looking at the page (tab hidden / window unfocused): the in-page toast
    // already covers the "user is here" case, so skip the OS-level popup then.
    if (cfg.browserNotify && isUserAway()) {
      for (const toast of emit) {
        const copy = toastCopy(t, toast.kind)
        sendBrowserNotify(copy.title, copy.body(toast.title, toast.round), toast.sessionId)
      }
    }
  }

  // Poll the Host status route (turn-end reasons + executing tools) and drive
  // the pending-alert queue. Polled unconditionally: the same response feeds
  // the row progress labels ("正在执行 …"), which must stay fresh even when
  // the user disabled both notification surfaces.
  useEffect(() => {
    let cancelled = false
    const tick = async (): Promise<void> => {
      let up: boolean
      try {
        const res = await fetch(STATUS_ROUTE, { cache: 'no-store' })
        if (!res.ok) throw new Error(`status ${res.status}`)
        const body: any = await res.json()
        if (cancelled) return
        // A null/array `sessions` would poison reasonsRef and crash the next
        // flushPending lookup — only accept a plain object.
        if (body && body.ok && body.value && typeof body.value.sessions === 'object'
          && body.value.sessions !== null && !Array.isArray(body.value.sessions)) {
          reasonsRef.current = body.value.sessions
        }
        // Same guard for the tools table; content-compare so an unchanged
        // table does not re-render the panel every poll.
        if (body && body.ok && body.value && typeof body.value.tools === 'object'
          && body.value.tools !== null && !Array.isArray(body.value.tools)) {
          const next: Record<string, CurrentTool> = {}
          for (const [id, tool] of Object.entries(body.value.tools)) {
            if (tool !== null && typeof tool === 'object'
              && typeof (tool as CurrentTool).name === 'string'
              && typeof (tool as CurrentTool).at === 'number') {
              next[id] = { name: (tool as CurrentTool).name, at: (tool as CurrentTool).at }
            }
          }
          setTools((prev) => (sameTools(prev, next) ? prev : next))
        }
        // Cumulative round counts: same plain-object guard; numbers only.
        if (body && body.ok && body.value && typeof body.value.rounds === 'object'
          && body.value.rounds !== null && !Array.isArray(body.value.rounds)) {
          const next: Record<string, number> = {}
          for (const [id, count] of Object.entries(body.value.rounds)) {
            if (typeof count === 'number' && Number.isFinite(count)) next[id] = count
          }
          roundsHostRef.current = next
        }
        up = true
      } catch {
        if (cancelled) return
        up = false
      }
      hostStatusRef.current = up ? 'up' : 'down'
      flushPendingRef.current()
    }
    void tick()
    const id = window.setInterval(() => { void tick() }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  // Unread inbox badge: poll the Host inbox count independently of the toast
  // settings — the inbox is the durable "not handled yet" surface, so it must
  // light up even when round-completion toasts are off. An absent host (route
  // 404) keeps the last value (0), degrading gracefully.
  useEffect(() => {
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(INBOX_ROUTE, { cache: 'no-store' })
        if (!res.ok) throw new Error(`inbox ${res.status}`)
        const body: any = await res.json()
        if (cancelled) return
        applyInboxSnapshot(body)
      } catch { /* host absent → keep last */ }
    }
    void tick()
    const id = window.setInterval(() => { void tick() }, INBOX_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  // Auto-dismiss toasts in 'auto' mode (timers restart on any toast change).
  useEffect(() => {
    if (settings.notifyMode !== 'auto' || toasts.length === 0) return
    const timers = toasts.map((toast) =>
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.key !== toast.key))
      }, settings.autoDismissSec * 1000))
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [toasts, settings.notifyMode, settings.autoDismissSec])

  // Keep a free/stored position inside the viewport: clamp once when it
  // changes, and again whenever the window resizes. The window-size sources
  // are not reactive by themselves, so an explicit resize listener is
  // required — a deps-array-only version would never re-run on resize.
  useEffect(() => {
    if (!pos) return
    const clamp = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const current = posRef.current ?? pos
      const p = clampToViewport(current.x, current.y, rect.width, rect.height)
      if (p.x !== current.x || p.y !== current.y) {
        posRef.current = p
        setPos(p)
        savePos(p)
      }
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [pos])

  /**
   * Running subagent count per session (shown as a 子×N badge on the row).
   * Aggregates the WHOLE descendant chain, not just direct children: every
   * running subagent contributes +1 to each ancestor up its parent line, so a
   * main session counts all nested subagents working under it (a nested
   * subagent's own row, when visible, counts only what is under it).
   */
  const runningSubagentsByParent = useMemo(() => {
    const map = new Map<string, number>()
    for (const id of sessions.ids) {
      const row = sessions.byId[id]
      if (!row || row.origin !== 'subagent' || !row.running || !row.parentId) continue
      const seen = new Set<string>()
      // byId is keyed by SessionId (a branded string); the ancestor chain walks
      // parentId strings, so index through a plain-string view.
      const byId = sessions.byId as Readonly<Record<string, SessionSummary>>
      let pid: string | undefined = row.parentId
      while (pid !== undefined && !seen.has(pid)) {
        seen.add(pid)
        map.set(pid, (map.get(pid) ?? 0) + 1)
        pid = byId[pid]?.parentId
      }
    }
    return map
  }, [sessions])

  /**
   * Live background-job count per session (shown as a 后×N badge on the row),
   * mirrored from the runtime's `session/jobs` mirror (`jobsBySession`). Only
   * still-executing jobs (`running` / `stopping`) count: settled jobs
   * (`completed` / `killed` / `failed`) linger in the registry until the owner
   * session is disposed, so including them would show stale totals.
   */
  const runningJobsBySession = useMemo(() => {
    const map = new Map<string, number>()
    for (const id of sessions.ids) {
      const jobs = sessions.jobsBySession[id]
      if (!jobs || jobs.length === 0) continue
      let n = 0
      for (const job of jobs) {
        if (job.status === 'running' || job.status === 'stopping') n++
      }
      if (n > 0) map.set(id, n)
    }
    return map
  }, [sessions])

  // Sessions currently doing work: in a turn, or not in a turn but with
  // subagents / background jobs executing. Feeds the header and collapsed-pill
  // counts — a parent waiting on running subagents is not idle, so it must
  // count. Placed after the two busyness sources (TDZ — see the rows memo).
  const busyCount = useMemo(
    () => sessions.ids.reduce((n, id) => {
      const row = sessions.byId[id]
      if (!row || row.blank) return n
      if (row.origin === 'subagent' && !settings.showSubagents) return n
      if (row.running) return n + 1
      // A session pausing for the user's input/confirmation is not idle — it
      // counts as needing attention (and stays visible, see the rows memo).
      if (row.pendingInteraction !== undefined) return n + 1
      if ((runningSubagentsByParent.get(id) ?? 0) > 0 || (runningJobsBySession.get(id) ?? 0) > 0) return n + 1
      return n
    }, 0),
    [sessions, settings.showSubagents, runningSubagentsByParent, runningJobsBySession],
  )

  // The visible rows projection. Deliberately placed after the two busyness
  // sources above: it reads runningSubagentsByParent / runningJobsBySession,
  // and JavaScript's temporal dead zone would throw if it ran before them.
  const { rows, hiddenCount } = useMemo(() => {
    const live = sessions.ids
      .map((id) => sessions.byId[id])
      .filter((row): row is SessionSummary =>
        !!row && !row.blank && (settings.showSubagents || row.origin !== 'subagent'))
    // "Busy" rows are still doing work even though the session itself is not
    // in a turn: it has subagents or background jobs executing. They are
    // treated like running rows — ranked on top and kept visible by the time
    // window. The "busy only" filter keeps both running AND busy rows (hiding
    // only genuinely idle ones), consistent with the busy-status labeling.
    const busyIds = new Set<string>()
    for (const row of live) {
      if (row.running) continue
      // A session pausing for the user's input/confirmation is not idle: it
      // must stay visible (time-window exemption) and rank on top — "your
      // turn" is the row most worth seeing.
      if (row.pendingInteraction !== undefined) { busyIds.add(row.id); continue }
      if ((runningSubagentsByParent.get(row.id) ?? 0) > 0 || (runningJobsBySession.get(row.id) ?? 0) > 0) {
        busyIds.add(row.id)
      }
    }
    const windowMs = settings.timeWindowMin * 60_000
    const inWindow = windowMs > 0
      ? live.filter((row) => {
          // Running and busy sessions are always recent — never hide them.
          if (row.running || busyIds.has(row.id)) return true
          // The current session is always visible too — never hide what the
          // user is actively using, even when its updatedAt is old.
          if (row.id === sessions.current) return true
          return now - Math.max(row.updatedAt, lastActive[row.id] ?? 0) <= windowMs
        })
      : live
    const visible = settings.runningOnly ? inWindow.filter((row) => row.running || busyIds.has(row.id)) : inWindow
    // The "N older sessions hidden" hint is about the time window only: in
    // busy-only mode the idle rows are hidden by that switch, not by time,
    // so counting them here would mislead.
    const hiddenCount = settings.runningOnly ? 0 : live.length - visible.length
    return { rows: orderRows(visible, doneIds, busyIds), hiddenCount }
  }, [sessions, settings.runningOnly, settings.timeWindowMin, settings.showSubagents, lastActive, now, doneIds, runningSubagentsByParent, runningJobsBySession])

  /** Close the live system notification for one session (no-op when none is showing). */
  function closeBrowserNotify(sessionId: string): void {
    const inst = notifyInstRef.current.get(sessionId)
    if (!inst) return
    notifyInstRef.current.delete(sessionId)
    try { inst.close() } catch { /* notification already gone */ }
  }

  /** Send a cross-tab sync message (no-op when the channel is unavailable). */
  function broadcastSync(msg: SyncMessage): void {
    try {
      syncChannelRef.current?.postMessage(msg)
    } catch { /* channel unavailable */ }
  }

  function handleOpen(sessionId: string): void {
    const next = new Set(doneIdsRef.current)
    next.delete(sessionId)
    setDoneIds(next)
    // Opening a session consumes its completion notice — dismiss any system
    // notification still showing for it too (cross-channel link).
    closeBrowserNotify(sessionId)
    // A round whose Host reason was still pending must not toast after the
    // session is already open — drop the queued alert.
    pendingRef.current.delete(sessionId)
    open(sessionId)
    // A completion acknowledged here is acknowledged everywhere (other tabs).
    broadcastSync({ type: 'opened', sessionId })
  }

  /** Mark one session's inbox records read (POST ack; resolves when the Host
   *  committed, rejects when it is unreachable). */
  function ackSession(sessionId: string): Promise<void> {
    return fetch(INBOX_ACK_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      cache: 'no-store',
    }).then((res) => {
      if (!res.ok) throw new Error(`ack ${res.status}`)
    })
  }

  /** Re-read the inbox snapshot and update the badge count + newest-unread
   *  target (shared by the poll and the post-ack refresh). */
  function applyInboxSnapshot(body: any): void {
    const value = body && body.ok ? body.value : undefined
    if (!value || typeof value.unread !== 'number' || !Array.isArray(value.notes)) return
    setInboxUnread((prev) => (prev === value.unread ? prev : value.unread))
    let newest: string | null = null
    for (let index = value.notes.length - 1; index >= 0; index--) {
      const note = value.notes[index]
      if (note && typeof note.sessionId === 'string'
        && note.ackedAt === undefined && note.resolved !== true) {
        newest = note.sessionId
        break
      }
    }
    newestUnreadRef.current = newest
  }

  /**
   * Unread-badge click = 处理 (handle): jump to the newest unread session and
   * mark that session's records read — the web-side equivalent of the desktop
   * inbox's 处理 + ackOnJump, and the ONLY way the red dot can clear from the
   * web widget (done/title/new-session records never auto-resolve). The badge
   * refreshes right AFTER the ack commits server-side, so the red dot drops
   * without waiting for the next 5s poll.
   */
  function handleInboxBadge(): void {
    const target = newestUnreadRef.current
    if (!target) return
    try { open(target) } catch { /* unknown session — still ack the records */ }
    ackSession(target)
      .then(() => fetch(INBOX_ROUTE, { cache: 'no-store' }))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`inbox ${res.status}`))))
      .then((body: any) => { applyInboxSnapshot(body) })
      .catch(() => { /* host absent — the next poll retries */ })
  }

  /**
   * Send a browser/system notification for one finished round. Independent of
   * the in-widget toast: only fires when the Notification API exists and the
   * permission is granted. Same-session notifications share a `tag`, so the
   * browser replaces the older one instead of stacking. Clicking the
   * notification focuses the window, jumps to the session, and dismisses the
   * matching in-page toasts — the click acknowledges that finished round.
   */
  function sendBrowserNotify(title: string, body: string, sessionId: string): void {
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
      // A newer round replaces the previous notification for the same session.
      closeBrowserNotify(sessionId)
      const n = new Notification(title, {
        body,
        tag: 'dsh-smon:' + sessionId,
      })
      notifyInstRef.current.set(sessionId, n)
      n.onclose = () => { notifyInstRef.current.delete(sessionId) }
      n.onclick = () => {
        // Clicking the notification: focus the window, jump to the session
        // (which also clears its "round done" mark and closes the notification
        // itself — `close()` runs even if the jump throws), then drop the
        // matching in-page toasts: the click acknowledges that finished round,
        // so the toast's own 跳转/知道了 would be redundant.
        try { window.focus() } catch { /* focus unavailable */ }
        try { handleOpen(sessionId) } finally {
          try { n.close() } catch { /* notification already gone */ }
        }
        dismissSessionToasts(sessionId)
      }
    } catch { /* notification unavailable */ }
  }

  function dismissToast(key: number, sessionId?: string): void {
    setToasts((prev) => prev.filter((toast) => toast.key !== key))
    // An explicit dismissal acknowledges the round — sync it across tabs
    // (auto-dismissals stay local: the other tab's toast may still be unseen).
    if (sessionId !== undefined) broadcastSync({ type: 'toast-dismissed', sessionId })
  }

  /** Dismiss every in-page toast belonging to one session — the finished round
   *  was acknowledged elsewhere (currently: the system notification's click). */
  function dismissSessionToasts(sessionId: string): void {
    setToasts((prev) => prev.filter((toast) => toast.sessionId !== sessionId))
  }

  function clearDone(): void {
    setDoneIds(new Set())
    broadcastSync({ type: 'done-cleared-all' })
  }

  function startDrag(e: ReactPointerEvent<HTMLDivElement>, mode: 'move' | 'resize'): void {
    if (e.button !== 0) return
    const target = e.currentTarget
    try { target.setPointerCapture(e.pointerId) } catch { /* jsdom */ }
    const rect = anchorRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    dragRef.current = {
      mode,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      startScale: scale,
    }
    movedRef.current = false
    setDragging(true)
    e.preventDefault()
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (d.mode === 'resize') {
      if (Math.abs(dx) + Math.abs(dy) > 2) movedRef.current = true
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, d.startScale + (dx + dy) / 180))
      scaleRef.current = nextScale
      setScale(nextScale)
      return
    }
    if (Math.abs(dx) + Math.abs(dy) > 4) movedRef.current = true
    const rect = anchorRef.current?.getBoundingClientRect()
    // The anchor scales from its top-left corner, so the visual top-left
    // corner sits EXACTLY on the layout corner — a drag tracks the cursor 1:1
    // in visual pixels. No scale division: dividing made the panel drift at
    // zoom ≠ 1 (it ran ahead at < 1×, lagged at > 1×). The clamp uses the
    // visual (scaled) size to keep the whole rendered box inside the viewport.
    const p = clampToViewport(
      d.originLeft + dx,
      d.originTop + dy,
      rect?.width ?? PANEL_W,
      rect?.height ?? 60,
    )
    posRef.current = p
    setPos(p)
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    // A tap on the collapsed pill (no movement) re-expands the panel.
    const wasTap = d.mode === 'move' && !movedRef.current
    dragRef.current = null
    setDragging(false)
    // Persist once at drag end instead of on every pointermove: synchronous
    // localStorage writes per event were part of the drag jank.
    if (d.mode === 'resize') {
      saveScale(scaleRef.current)
    } else if (posRef.current) {
      savePos(posRef.current)
    }
    if (wasTap && collapsed) setCollapsed(false)
  }

  const anchorStyle: CSSProperties = {
    position: 'fixed',
    zIndex: 9998,
    pointerEvents: 'auto',
    touchAction: 'none',
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
  }
  if (pos) {
    anchorStyle.left = pos.x
    anchorStyle.top = pos.y
  } else {
    anchorStyle.right = DEFAULT_RIGHT
    anchorStyle.bottom = DEFAULT_BOTTOM
  }

  const currentId = sessions.current

  let body
  if (collapsed) {
    body = (
      <div
        className={[css.pill, dragging ? css.dragging : ''].filter(Boolean).join(' ')}
        title={t('expand')}
        onPointerDown={(e) => startDrag(e, 'move')}
      >
        <span className={css.pillIcon}>◫</span>
        <span className={css.pillText}>{t('title')}</span>
        <span className={css.pillCount}>{busyCount}</span>
        {inboxUnread > 0 && (
          <span
            className={css.pillBadge}
            title={t('inboxBadgeTitle', { count: String(inboxUnread) })}
            role="button"
            tabIndex={0}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => handleInboxBadge()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                handleInboxBadge()
              }
            }}
          >
            {inboxUnread}
          </span>
        )}
      </div>
    )
  } else {
    body = (
      <div className={[css.panel, dragging ? css.dragging : ''].filter(Boolean).join(' ')}>
        <div className={css.header} onPointerDown={(e) => startDrag(e, 'move')}>
          <span className={css.titleDot} />
          <span className={css.title}>{t('title')}</span>
          <span className={css.count}>{t('busyCount', { count: String(busyCount) })}</span>
          {inboxUnread > 0 && (
            <button
              className={css.inboxBadge}
              title={t('inboxBadgeTitle', { count: String(inboxUnread) })}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => handleInboxBadge()}
            >
              {inboxUnread}
            </button>
          )}
          <button
            className={css.iconBtn}
            title={t('dockToContainer')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              try {
                window.dispatchEvent(new CustomEvent('dsh.card-container.dock', { detail: 'session-monitor' }))
              } catch { /* events unavailable */ }
            }}
          >
            ⤢
          </button>
          <button
            className={css.iconBtn}
            title={t('collapse')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsed(true)}
          >
            —
          </button>
        </div>
        <div className={css.list}>
          {rows.length === 0
            ? <div className={css.empty}>{settings.runningOnly ? t('noRunning') : t('noSessions')}</div>
            : rows.map((row) => {
              const isCurrent = row.id === currentId
              const done = doneIds.has(row.id)
              const subRunning = runningSubagentsByParent.get(row.id) ?? 0
              const jobsRunning = runningJobsBySession.get(row.id) ?? 0
              // A session that is not in a turn but still has subagents (or
              // background jobs) executing is "busy", not idle: label it so
              // instead of showing 空闲 next to a 子×N / 后×N badge. The busy
              // labels also win over the 本轮完成 text — "still working" is the
              // more current signal (the dot keeps its done color meanwhile).
              const busySub = !row.running && subRunning > 0
              const busyJobs = !row.running && subRunning === 0 && jobsRunning > 0
              // Plan mode: the session presented a plan and is waiting for the
              // user's review — a distinct wait worth naming (the client
              // derives `plan-review` from the plan-review-routed question
              // frame), instead of lumping it into the generic 等待输入.
              const planReview = row.pendingInteraction === 'plan-review'
              const statusText = planReview
                ? t('planReviewWait')
                : row.pendingInteraction !== undefined
                  ? t('pendingInput')
                  : row.running
                    ? t('running')
                    : busySub
                      ? t('subagentsActive')
                      : busyJobs
                        ? t('jobsActive')
                        : done && settings.showDone
                          ? t('roundDone')
                          : t('idle')
              const statusCls = planReview
                ? css.statusPlan
                : busySub ? css.statusSub : busyJobs ? css.statusJobs : undefined
              // ── Task-execution progress ──────────────────────────────────
              // A session with work in flight (a running turn, running
              // subagents, or background jobs) gets a thin animated bar plus a
              // label naming what is executing. Running rows name the current
              // model tool call (Host-tracked) and the in-progress round; busy
              // rows name their subagent/job load.
              //
              // GOAL MODE overrides the generic bar: when the session carries a
              // `goal` projection (a task goal is being processed — the agent
              // loops round after round toward it), the bar becomes DETERMINATE
              // — roundsStarted / maxGoalRounds is a real percentage — and the
              // label reads 「目标 第 X/Y 轮」 (+ the current tool while one is
              // executing). Paused / blocked goals stay visible even on idle
              // rows (「目标已暂停/受阻」 is worth seeing).
              const goalProj = goalProjectionOf(row)
              const goalPhase = goalProj?.goal?.phase
              const goalActive = goalProj?.goal !== undefined && goalPhase !== 'complete'
              const goalPausedOrBlocked = goalActive && (goalPhase === 'paused' || goalPhase === 'blocked')
              const goalPct = goalActive && (goalProj.goal?.maxGoalRounds ?? 0) > 0
                ? Math.min(100, Math.round(((goalProj.roundsStarted ?? 0) / (goalProj.goal?.maxGoalRounds ?? 1)) * 100))
                : undefined
              const active = row.running || subRunning > 0 || jobsRunning > 0 || goalPausedOrBlocked
              let progressCls: string | undefined
              let progressLabel: string | undefined
              if (active) {
                if (goalActive) {
                  // Goal progress wins the bar: determinate, round/cap label.
                  const cap = String(goalProj.goal?.maxGoalRounds ?? 0)
                  const started = String(goalProj.roundsStarted ?? 0)
                  if (goalPhase === 'blocked') {
                    progressCls = css.progressGoalBlocked
                    progressLabel = t('goalBlocked', { round: started, cap })
                  } else if (goalPhase === 'paused') {
                    progressCls = css.progressGoalPaused
                    progressLabel = t('goalPaused', { round: started, cap })
                  } else {
                    progressCls = css.progressGoal
                    const toolName = tools[row.id]?.name
                    progressLabel = toolName !== undefined
                      ? t('goalProgressTool', { round: started, cap, tool: toolName })
                      : t('goalProgress', { round: started, cap })
                  }
                } else if (row.running) {
                  progressCls = css.progressRunning
                  // Round number of the IN-PROGRESS turn: the Host's cumulative
                  // finished-round count + 1 (accurate even for long turns — the
                  // count is not TTL-pruned), else the widget's own observed
                  // count + 1, else 1.
                  const hostCount = roundsHostRef.current[row.id]
                  const round = (hostCount ?? roundsRef.current.get(row.id) ?? 0) + 1
                  const toolName = tools[row.id]?.name
                  progressLabel = toolName !== undefined
                    ? t('progressTool', { round: String(round), tool: toolName })
                    : t('roundOf', { n: String(round) })
                } else if (busySub) {
                  progressCls = css.progressSub
                  progressLabel = t('progressSub', { n: String(subRunning) })
                } else {
                  progressCls = css.progressJobs
                  // Name the first still-executing job when exactly one is
                  // running; a multi-job session just gets the count.
                  const jobs = sessions.jobsBySession[row.id] ?? []
                  const firstLabel = jobs.find((j) => j.status === 'running' || j.status === 'stopping')?.label
                  progressLabel = firstLabel !== undefined && jobsRunning === 1
                    ? t('progressJobOne', { label: firstLabel })
                    : t('progressJobs', { n: String(jobsRunning) })
                }
              }
              return (
                <div
                  key={row.id}
                  className={[css.row, isCurrent ? css.current : ''].filter(Boolean).join(' ')}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpen(row.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      handleOpen(row.id)
                    }
                  }}
                  title={isCurrent ? undefined : t('jump')}
                >
                  <span
                    className={[
                      css.dot,
                      row.running ? css.dotRunning : '',
                      done && !row.running ? css.dotDone : '',
                    ].filter(Boolean).join(' ')}
                  />
                  <div className={css.rowMain}>
                    <div className={css.rowTitle}>{row.displayTitle || row.id}</div>
                    <div className={css.rowMeta}>
                      {row.origin === 'subagent' ? <span className={css.badge}>{t('subagent')}</span> : null}
                      {isCurrent ? <span className={css.badge}>{t('current')}</span> : null}
                      {subRunning > 0
                        ? <span className={[css.badge, css.subBadge].filter(Boolean).join(' ')}>{t('subagentsRunning', { n: String(subRunning) })}</span>
                        : null}
                      {jobsRunning > 0
                        ? <span className={[css.badge, css.jobsBadge].filter(Boolean).join(' ')}>{t('jobsRunning', { n: String(jobsRunning) })}</span>
                        : null}
                      <span className={[css.status, statusCls ?? ''].filter(Boolean).join(' ')}>
                        {statusText}
                      </span>
                      {/* Activity time: the newer of the host's updatedAt (prompt
                          time) and the widget's last-observed activity, so a busy
                          row whose updatedAt is stale still shows "recent". */}
                      <span className={css.time}>{formatAgo(Math.max(row.updatedAt, lastActive[row.id] ?? 0), now, t)}</span>
                    </div>
                    {active && progressCls !== undefined
                      ? (
                        <div className={css.progress}>
                          <div
                            className={[css.progressBar, progressCls].filter(Boolean).join(' ')}
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={goalActive ? goalProj.goal?.maxGoalRounds ?? 0 : undefined}
                            aria-valuenow={goalActive ? goalProj.roundsStarted ?? 0 : undefined}
                            aria-label={progressLabel}
                          >
                            {/* Determinate goal fill: rounds-started / round-cap
                                as a real percentage (goal mode only — the
                                generic bars stay indeterminate sweeps). */}
                            {goalPct !== undefined
                              ? <div className={css.progressFill} style={{ width: `${goalPct}%` }} />
                              : null}
                          </div>
                          {progressLabel !== undefined
                            ? <div className={css.progressLabel}>{progressLabel}</div>
                            : null}
                        </div>
                      )
                      : null}
                  </div>
                </div>
              )
            })}
        </div>
        {doneIds.size > 0 && !settings.runningOnly
          ? (
            <div className={css.footer}>
              {hiddenCount > 0
                ? <span className={css.footerHint}>{t('hiddenRecent', { n: String(hiddenCount) })}</span>
                : null}
              <button className={css.clearBtn} onClick={clearDone}>{t('clearDone')}</button>
            </div>
          )
          : hiddenCount > 0
            ? (
              <div className={css.footer}>
                <span className={css.footerHint}>{t('hiddenRecent', { n: String(hiddenCount) })}</span>
              </div>
            )
            : null}
      </div>
    )
  }

  return (
    <>
      <div
        ref={anchorRef}
        className={css.anchor}
        style={anchorStyle}
        data-widget-id="session-monitor"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {body}
        {collapsed ? null : (
          <div
            className={css.resize}
            title={t('resizeHint')}
            onPointerDown={(e) => startDrag(e, 'resize')}
          />
        )}
      </div>
      {toasts.length > 0
        ? (
          <div className={css.toasts}>
            {toasts.map((toast) => {
              const kindCls = toast.kind === 'approval' ? css.toastApproval
                : toast.kind === 'plan-review' ? css.toastPlanReview
                  : toast.kind === 'question' ? css.toastQuestion
                    : toast.kind === 'subagent' ? css.toastSubagent
                      : toast.kind === 'error' ? css.toastError
                        : toast.kind === 'aborted' ? css.toastAborted
                          : toast.kind === 'blocked' ? css.toastBlocked
                            : toast.kind === 'max-tokens' ? css.toastMaxTokens
                              : toast.kind === 'interrupted' ? css.toastInterrupted
                                : css.toastDone
              const copy = toastCopy(t, toast.kind)
              return (
                <div key={toast.key} className={[css.toast, kindCls].filter(Boolean).join(' ')}>
                  <div className={css.toastHead}>
                    <span className={css.toastTitle}>
                      <span className={css.toastIcon} aria-hidden="true">{toastIcon(toast.kind)}</span>
                      {copy.title}
                    </span>
                    <span className={css.toastTime}>{formatAgo(toast.at, now, t)}</span>
                  </div>
                  <div className={css.toastBody}>{copy.body(toast.title, toast.round)}</div>
                  <div className={css.toastActions}>
                    <button
                      className={css.jumpBtn}
                      onClick={() => { handleOpen(toast.sessionId); dismissToast(toast.key) }}
                    >
                      {t('jump')}
                    </button>
                    <button
                      className={css.dismissBtn}
                      onClick={() => { dismissToast(toast.key, toast.sessionId); closeBrowserNotify(toast.sessionId) }}
                    >
                      {t('dismiss')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          )
        : null}
    </>
  )
}
