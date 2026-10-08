/**
 * Session-monitor compact card view for the card container (`widgets.card`).
 *
 * The card container declares `widgets.card` as a standard, optional adapter
 * contract: a widget opt-in to render its own compact card inside the
 * container's grid by registering into that slot. This widget owns its card —
 * the busy-count selection below uses the same snapshot the floating
 * SessionMonitorWidget reads, so the two can never drift apart.
 *
 * Registration (see ./index.ts): `ctx.slots.inject('widgets.card', …)` with
 * the entry id equal to this widget's `shell.overlay` id (`session-monitor`),
 * a priority of 0 (the container registers no built-in cards — this is the
 * sole card for the id), and `locale: 'card-container'` reusing the card
 * container's shared stat vocabulary.
 *
 * @module @dsh-plugins/client-ui-session-monitor/client/cards
 */

import { useEffect, useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the `useSessions` / `useSessionStatus` standard-prop merge
// from ui-session (`useSessionPendingInteraction` was replaced by the unified
// status snapshot in 0.1.7).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the `widgets.card` SlotMap merge and the `card-container`
// LocaleNamespaceMap merge the card types below depend on.
import type {} from '@dsh-plugins/client-ui-card-container/client'
import type { WidgetCardComponent } from '@dsh-plugins/client-ui-card-container/client'
import { jobWatchTargets, useWatchedJobRows } from './jobs-bridge.ts'
import { useArchivedSessions } from './archive-bridge.ts'
import { SETTINGS_CHANGED_EVENT, SETTINGS_KEY, loadSettings } from './settings.ts'
import css from './cards.module.css'

/** Select the live session-list snapshot for the card. */
function selectSessions(s: SessionListState): SessionListState {
  return s
}

/** Compact busy-count card (running or busy) — mirrors the floating widget's
 *  `busyCount` so the two surfaces never disagree. */
export function SessionMonitorCard(props: PropsRuntime<'widgets.card'> & PropsLocale<'card-container'>) {
  const { useSessions, useSessionStatus, t } = props
  const sessions = useSessions(selectSessions)
  /**
   * Unified per-session status (0.1.7). The selector returns the snapshot Map
   * itself — a store-owned, reference-stable value — and the derived Set is
   * memoized: building a fresh Set inside the selector would fail the hook's
   * default `Object.is` comparison and re-render this card on every status
   * notification (the hook takes an `eq` argument, but deriving is cheaper).
   */
  const sessionStatus = useSessionStatus((m) => m)
  /** Sessions waiting on a user interaction. */
  const pendingInteractions = useMemo(() => {
    const pending = new Set<string>()
    for (const [id, status] of sessionStatus) {
      if (status.pendingInteraction !== undefined) pending.add(id)
    }
    return pending
  }, [sessionStatus])
  // byId is keyed by SessionId (a branded string); index through a plain view.
  const byId = sessions.byId as Readonly<Record<string, SessionSummary>>
  /**
   * Canonical running bit per listed Session (same rule as the floating
   * widget's `runningById`): the unified status map is the harness's own
   * liveness source — its session tree reads `statuses.get(id)?.running ??
   * row.running` — and it clears on the Host's status edge, so a Session that
   * stopped on an aborted / errored turn stops counting as busy here even when
   * a list row lags behind.
   */
  const runningById = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const id of sessions.ids) {
      const row = sessions.byId[id]
      if (row === undefined) continue
      map.set(id, sessionStatus.get(id)?.running ?? row.running)
    }
    return map
  }, [sessions, sessionStatus])
  /** Whether one listed Session is running, by the canonical source above. */
  const isRunning = (id: string): boolean => runningById.get(id) === true
  /**
   * Session ids the user archived (see ./archive-bridge.ts). The card mirrors
   * the floating widget, which hides them: an archived Session is put-away work
   * and must not inflate the busy count.
   */
  const archivedIds = useArchivedSessions()
  /** Whether one listed Session is archived (state the list snapshot omits). */
  const isArchived = (id: string): boolean => archivedIds.has(id)
  // Watch only the Sessions that can have a roster (running, or already holding
  // a live job) — 0.1.7 serves rosters per Session, so watching the whole list
  // would keep one stream open per listed Session. The card aggregates counts
  // rather than labelling a row, so it does not need the current Session.
  // Archived Sessions are skipped: they are hidden from the count and the Host
  // stopped their work when archiving.
  const watchedIds = useMemo(
    () => sessions.ids.filter((id) => !isArchived(id)),
    [sessions, archivedIds],
  )
  const jobRows = useWatchedJobRows((rows) => jobWatchTargets(
    watchedIds,
    isRunning,
    rows,
    undefined,
  ))
  // Respect the "show subagents" toggle the same way the floating widget does:
  // a hidden subagent row must not inflate the count, but its PARENT still
  // counts as busy (see below). Re-read on every settings change, so a toggle
  // in the config panel updates the card live.
  const [showSubagents, setShowSubagents] = useState(() => loadSettings().showSubagents)
  useEffect(() => {
    // Same-tab change (config panel) plus cross-tab change — the storage event
    // fires only in the OTHER tabs, exactly like the floating widget, so the
    // card never lags a showSubagents toggle made in another tab.
    const onSettings = (): void => setShowSubagents(loadSettings().showSubagents)
    const onStorage = (e: StorageEvent): void => {
      if (e.key === SETTINGS_KEY) setShowSubagents(loadSettings().showSubagents)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettings)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettings)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  // Live running-subagent count per ancestor (same as the widget's 子×N
  // aggregation: every running subagent contributes +1 to each ancestor).
  const subagentsByParent = new Map<string, number>()
  for (const id of sessions.ids) {
    const row = byId[id]
    if (!row || row.origin !== 'subagent' || !isRunning(id) || !row.parentId) continue
    if (isArchived(id)) continue
    const seen = new Set<string>()
    let pid: string | undefined = row.parentId
    while (pid !== undefined && !seen.has(pid)) {
      seen.add(pid)
      subagentsByParent.set(pid, (subagentsByParent.get(pid) ?? 0) + 1)
      pid = byId[pid]?.parentId
    }
  }
  // Live background-job count per session (same still-running predicate as the
  // widget: only `running` / `stopping` jobs count — settled jobs linger in
  // the registry until the owning session is disposed).
  const runningJobsBySession = new Map<string, number>()
  for (const id of sessions.ids) {
    const jobs = jobRows[id]
    if (!jobs || jobs.length === 0) continue
    let n = 0
    for (const job of jobs) if (job.status === 'running' || job.status === 'stopping') n++
    if (n > 0) runningJobsBySession.set(id, n)
  }
  const busy = sessions.ids.reduce((n, id) => {
    const row = byId[id]
    if (!row || row.blank) return n
    if (row.origin === 'subagent' && !showSubagents) return n
    // An archived Session is not busy for this count: the floating widget hides
    // the row, so counting it here would make the two surfaces disagree.
    if (isArchived(id)) return n
    if (isRunning(id)) return n + 1
    if (pendingInteractions.has(id)) return n + 1
    if ((subagentsByParent.get(id) ?? 0) > 0 || (runningJobsBySession.get(id) ?? 0) > 0) return n + 1
    return n
  }, 0)
  return (
    <div className={css.statCard}>
      <span className={css.statValue}>{busy}</span>
      <span className={css.statLabel}>{t('cardBusyLabel')}</span>
      {/* The session count follows the same visibility rule as the busy count:
          archived Sessions are put away, so neither figure includes them. */}
      <span className={css.statMeta}>{t('cardSessionMeta', { n: String(watchedIds.length) })}</span>
    </div>
  )
}
// Two-column medium stat.
(SessionMonitorCard as WidgetCardComponent).spec = 'medium'
