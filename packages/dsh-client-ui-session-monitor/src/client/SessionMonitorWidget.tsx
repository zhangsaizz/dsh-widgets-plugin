/**
 * The session monitor dashboard widget: a floating, draggable panel
 * registered into the shell.overlay list. It projects the live session list
 * through the standard `useSessions` prop — no Host RPC, no polling — and:
 *
 *  - lists the live (non-blank, non-subagent by default) sessions with their
 *    status (running / idle / round-done), title, pending-interaction flag and
 *    last-update time; a parent row shows a 子×N badge while it has N
 *    subagents running (subagent rows themselves stay filtered out);
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
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import {
  MAX_SCALE, MIN_SCALE, SETTINGS_CHANGED_EVENT, clampToViewport, loadLastActive,
  loadPos, loadScale, loadSettings, playChime, saveLastActive, savePos, saveScale,
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
  | 'interaction'
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
}

/** A finished round waiting for its Host turn-end reason before toasting. */
interface PendingAlert {
  at: number
  baseKind: ToastKind
  title: string
  sessionId: string
}

/** Turn-end reasons that deserve their own notification kind (vs plain done). */
const REASON_KINDS: ReadonlySet<string> = new Set([
  'error', 'aborted', 'blocked', 'max-tokens', 'interrupted',
])

/** Map a Host turn-end reason onto a toast kind; completed/unknown keep the base kind. */
function mapReasonKind(reason: string | undefined, base: ToastKind): ToastKind {
  return reason !== undefined && REASON_KINDS.has(reason) ? reason as ToastKind : base
}

/** Per-kind notification copy (title + body builder), shared by toasts and system notifications. */
function toastCopy(t: TranslateNS<'session-monitor'>, kind: ToastKind): { title: string; body: (title: string) => string } {
  switch (kind) {
    case 'interaction': return { title: t('interactionTitle'), body: (title) => t('interactionBody', { title }) }
    case 'subagent': return { title: t('subagentTitle'), body: (title) => t('toastBody', { title }) }
    case 'error': return { title: t('errorTitle'), body: (title) => t('errorBody', { title }) }
    case 'aborted': return { title: t('abortedTitle'), body: (title) => t('abortedBody', { title }) }
    case 'blocked': return { title: t('blockedTitle'), body: (title) => t('blockedBody', { title }) }
    case 'max-tokens': return { title: t('maxTokensTitle'), body: (title) => t('maxTokensBody', { title }) }
    case 'interrupted': return { title: t('interruptedTitle'), body: (title) => t('interruptedBody', { title }) }
    default: return { title: t('toastTitle'), body: (title) => t('toastBody', { title }) }
  }
}

/** Per-kind icon glyph shown next to the toast title (geometric text glyphs). */
function toastIcon(kind: ToastKind): string {
  switch (kind) {
    case 'interaction': return '⏳'
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
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(new Set())
  /** Per-session last-observed-activity ms (persisted; feeds the recent window). */
  const [lastActive, setLastActive] = useState<Record<string, number>>(loadLastActive)
  /**
   * Monotonic "now" refreshed every 30s. The session snapshot only changes on
   * list mutations, so without this the recent-window filter (and the relative
   * timestamps) would only be evaluated at load time and stale sessions would
   * never age out.
   */
  const [now, setNow] = useState(() => Date.now())

  /** Last-observed running bits per session; a true→false edge = one finished round. */
  const prevRunningRef = useRef<Map<string, boolean>>(new Map())
  const settingsRef = useRef(settings)
  const doneIdsRef = useRef(doneIds)
  const toastKeyRef = useRef(0)
  const dragRef = useRef<DragState | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  /** Whether the current drag moved far enough to count as a drag (vs a tap). */
  const movedRef = useRef(false)
  /** Live system-Notification instances per session, so other surfaces can dismiss them. */
  const notifyInstRef = useRef<Map<string, Notification>>(new Map())
  /** Host turn-end reason table (sessionId → { reason, at }), refreshed by polling. */
  const reasonsRef = useRef<Record<string, { reason: string; at: number }>>({})
  /** Whether the Host status route answered at least once ('unknown' before the first poll). */
  const hostStatusRef = useRef<'unknown' | 'up' | 'down'>('unknown')
  /** Finished rounds waiting for their Host reason before the toast is emitted. */
  const pendingRef = useRef<Map<string, PendingAlert>>(new Map())

  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { doneIdsRef.current = doneIds }, [doneIds])

  // Re-read settings whenever the config panel writes them.
  useEffect(() => {
    const handler = (): void => {
      setSettings(loadSettings())
      setScale(loadScale())
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, handler)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, handler)
  }, [])

  // Tick "now" so the time-window filter and relative timestamps age sessions
  // out while the page stays open without any session-list mutation.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

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
      setLastActive((prevMap) => {
        const merged = { ...prevMap }
        for (const [id, ts] of bumps) merged[id] = ts
        saveLastActive(merged)
        return merged
      })
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
      // opted in; once they are away, the round still notifies.
      if (row.id === sessions.current && !cfg.notifyCurrent && !userAway) continue
      newDone.add(row.id)
      // Base kind from what the client alone can observe; the Host reason may
      // refine it to error / aborted / blocked / max-tokens / interrupted.
      const baseKind: ToastKind = row.pendingInteraction
        ? 'interaction'
        : row.origin === 'subagent'
          ? 'subagent'
          : 'done'
      pendingRef.current.set(row.id, {
        at: now,
        baseKind,
        title: row.displayTitle || row.id,
        sessionId: row.id,
      })
    }
    if (newDone.size !== doneIdsRef.current.size) setDoneIds(newDone)
    // With no Host reachable, emit pending toasts immediately instead of
    // waiting for the next poll.
    flushPending()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions])

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
      const recFresh = rec !== undefined && rec.at >= alert.at
      const stale = now - alert.at > 12_000
      let kind: ToastKind
      if (host === 'down' || stale) {
        kind = alert.baseKind
      } else if (recFresh) {
        kind = mapReasonKind(rec.reason, alert.baseKind)
      } else {
        // Wait for the next poll to resolve the reason.
        continue
      }
      emit.push({ key: ++toastKeyRef.current, sessionId, title: alert.title, at: alert.at, kind })
      settled.push(sessionId)
    }
    for (const id of settled) pending.delete(id)
    if (emit.length === 0) return
    if (cfg.sound) playChime()
    if (cfg.notify) {
      setToasts((prevToasts) => {
        if (cfg.notifyMode === 'confirm') {
          // Confirm mode: a session's newer round replaces its older toast, and
          // unconfirmed toasts are never evicted by new arrivals. Newest first.
          const deduped = prevToasts.filter((t) => !emit.some((nt) => nt.sessionId === t.sessionId))
          return [...emit, ...deduped].slice(0, MAX_CONFIRM_TOASTS)
        }
        // Auto mode: newest first, oldest dropped beyond the stack cap.
        return [...emit, ...prevToasts].slice(0, MAX_TOASTS)
      })
    }
    // The system notification exists to reach the user while they are NOT
    // looking at the page (tab hidden / window unfocused): the in-page toast
    // already covers the "user is here" case, so skip the OS-level popup then.
    if (cfg.browserNotify && isUserAway()) {
      for (const toast of emit) {
        const copy = toastCopy(t, toast.kind)
        sendBrowserNotify(copy.title, copy.body(toast.title), toast.sessionId)
      }
    }
  }

  // Poll the Host turn-end reason table and drive the pending-alert queue.
  useEffect(() => {
    let cancelled = false
    const tick = async (): Promise<void> => {
      let up: boolean
      try {
        const res = await fetch('/_dsh/session-monitor/status', { cache: 'no-store' })
        if (!res.ok) throw new Error(`status ${res.status}`)
        const body: any = await res.json()
        if (cancelled) return
        if (body && body.ok && body.value && typeof body.value.sessions === 'object') {
          reasonsRef.current = body.value.sessions
        }
        up = true
      } catch {
        if (cancelled) return
        up = false
      }
      hostStatusRef.current = up ? 'up' : 'down'
      flushPending()
    }
    void tick()
    const id = window.setInterval(() => { void tick() }, 3000)
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

  // Re-clamp a stored position into the viewport on resize.
  useEffect(() => {
    if (!pos) return
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    const p = clampToViewport(pos.x, pos.y, rect.width, rect.height)
    if (p.x !== pos.x || p.y !== pos.y) setPos(p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, window.innerWidth, window.innerHeight])

  /** Running subagent count per parent session (shown as a 子×N badge on the parent row). */
  const runningSubagentsByParent = useMemo(() => {
    const map = new Map<string, number>()
    for (const id of sessions.ids) {
      const row = sessions.byId[id]
      if (!row || row.origin !== 'subagent' || !row.running || !row.parentId) continue
      map.set(row.parentId, (map.get(row.parentId) ?? 0) + 1)
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
    // window (runningOnly stays strict: only row.running counts there).
    const busyIds = new Set<string>()
    for (const row of live) {
      if (row.running) continue
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
    const visible = settings.runningOnly ? inWindow.filter((row) => row.running) : inWindow
    // The "N older sessions hidden" hint is about the time window only: in
    // running-only mode the idle rows are hidden by that switch, not by time,
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

  function handleOpen(sessionId: string): void {
    const next = new Set(doneIdsRef.current)
    next.delete(sessionId)
    setDoneIds(next)
    // Opening a session consumes its completion notice — dismiss any system
    // notification still showing for it too (cross-channel link).
    closeBrowserNotify(sessionId)
    open(sessionId)
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

  function dismissToast(key: number): void {
    setToasts((prev) => prev.filter((toast) => toast.key !== key))
  }

  /** Dismiss every in-page toast belonging to one session — the finished round
   *  was acknowledged elsewhere (currently: the system notification's click). */
  function dismissSessionToasts(sessionId: string): void {
    setToasts((prev) => prev.filter((toast) => toast.sessionId !== sessionId))
  }

  function clearDone(): void {
    setDoneIds(new Set())
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
      setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, d.startScale + (dx + dy) / 180)))
      return
    }
    if (Math.abs(dx) + Math.abs(dy) > 4) movedRef.current = true
    const rect = anchorRef.current?.getBoundingClientRect()
    // The anchor scales from its top-left corner: the pointer sees visual
    // (scaled) positions, so convert the desired visual position back to the
    // layout position by dividing by the scale.
    const p = clampToViewport(
      (d.originLeft + dx) / scale,
      (d.originTop + dy) / scale,
      rect?.width ?? PANEL_W,
      rect?.height ?? 60,
    )
    setPos(p)
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    // A tap on the collapsed pill (no movement) re-expands the panel.
    const wasTap = d.mode === 'move' && !movedRef.current
    dragRef.current = null
    setDragging(false)
    if (wasTap && collapsed) setCollapsed(false)
  }

  useEffect(() => {
    savePos(pos)
  }, [pos])

  useEffect(() => {
    saveScale(scale)
  }, [scale])

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
      </div>
    )
  } else {
    body = (
      <div className={[css.panel, dragging ? css.dragging : ''].filter(Boolean).join(' ')}>
        <div className={css.header} onPointerDown={(e) => startDrag(e, 'move')}>
          <span className={css.titleDot} />
          <span className={css.title}>{t('title')}</span>
          <span className={css.count}>{t('busyCount', { count: String(busyCount) })}</span>
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
              const statusText = row.running
                ? t('running')
                : busySub
                  ? t('subagentsActive')
                  : busyJobs
                    ? t('jobsActive')
                    : done && settings.showDone
                      ? t('roundDone')
                      : t('idle')
              const statusCls = busySub ? css.statusSub : busyJobs ? css.statusJobs : undefined
              return (
                <div
                  key={row.id}
                  className={[css.row, isCurrent ? css.current : ''].filter(Boolean).join(' ')}
                  onClick={() => handleOpen(row.id)}
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
                      {row.pendingInteraction ? <span className={css.status}>{t('pendingInput')}</span> : null}
                      <span className={css.time}>{formatAgo(row.updatedAt, now, t)}</span>
                    </div>
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
              const kindCls = toast.kind === 'interaction' ? css.toastInteraction
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
                  <div className={css.toastBody}>{copy.body(toast.title)}</div>
                  <div className={css.toastActions}>
                    <button
                      className={css.jumpBtn}
                      onClick={() => { handleOpen(toast.sessionId); dismissToast(toast.key) }}
                    >
                      {t('jump')}
                    </button>
                    <button
                      className={css.dismissBtn}
                      onClick={() => { dismissToast(toast.key); closeBrowserNotify(toast.sessionId) }}
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
