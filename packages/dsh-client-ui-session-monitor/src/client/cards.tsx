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
 * a priority of 0 (the container's built-in fallbacks sit at 10, so this
 * always wins the cell), and `locale: 'card-container'` reusing the card
 * container's shared stat vocabulary.
 *
 * @module @dsh-plugins/client-ui-session-monitor/client/cards
 */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the `widgets.card` SlotMap merge and the `card-container`
// LocaleNamespaceMap merge the card types below depend on.
import type {} from '@dsh-plugins/client-ui-card-container/client'
import type { WidgetCardComponent } from '@dsh-plugins/client-ui-card-container/client'
import { SETTINGS_CHANGED_EVENT, SETTINGS_KEY, loadSettings } from './settings.ts'
import css from './cards.module.css'

/** Select the live session-list snapshot for the card. */
function selectSessions(s: SessionListState): SessionListState {
  return s
}

/** Compact busy-count card (running or busy) — mirrors the floating widget's
 *  `busyCount` so the two surfaces never disagree. */
export function SessionMonitorCard(props: PropsRuntime<'widgets.card'> & PropsLocale<'card-container'>) {
  const { useSessions, t } = props
  const sessions = useSessions(selectSessions)
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
  // byId is keyed by SessionId (a branded string); index through a plain view.
  const byId = sessions.byId as Readonly<Record<string, SessionSummary>>
  // Live running-subagent count per ancestor (same as the widget's 子×N
  // aggregation: every running subagent contributes +1 to each ancestor).
  const subagentsByParent = new Map<string, number>()
  for (const id of sessions.ids) {
    const row = byId[id]
    if (!row || row.origin !== 'subagent' || !row.running || !row.parentId) continue
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
  const jobsBySession = new Map<string, number>()
  for (const id of sessions.ids) {
    const jobs = sessions.jobsBySession[id]
    if (!jobs || jobs.length === 0) continue
    let n = 0
    for (const job of jobs) if (job.status === 'running' || job.status === 'stopping') n++
    if (n > 0) jobsBySession.set(id, n)
  }
  const busy = sessions.ids.reduce((n, id) => {
    const row = byId[id]
    if (!row || row.blank) return n
    if (row.origin === 'subagent' && !showSubagents) return n
    if (row.running) return n + 1
    if (row.pendingInteraction !== undefined) return n + 1
    if ((subagentsByParent.get(id) ?? 0) > 0 || (jobsBySession.get(id) ?? 0) > 0) return n + 1
    return n
  }, 0)
  return (
    <div className={css.statCard}>
      <span className={css.statValue}>{busy}</span>
      <span className={css.statLabel}>{t('cardBusyLabel')}</span>
      <span className={css.statMeta}>{t('cardSessionMeta', { n: String(sessions.ids.length) })}</span>
    </div>
  )
}
// Two-column medium stat.
(SessionMonitorCard as WidgetCardComponent).spec = 'medium'
