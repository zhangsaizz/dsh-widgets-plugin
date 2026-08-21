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

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the `widgets.card` SlotMap merge and the `card-container`
// LocaleNamespaceMap merge the card types below depend on.
import type {} from '@dsh-plugins/client-ui-card-container/client'
import type { WidgetCardComponent } from '@dsh-plugins/client-ui-card-container/client'
import css from './cards.module.css'

/** Select the live session-list snapshot for the card. */
function selectSessions(s: SessionListState): SessionListState {
  return s
}

/** Compact busy-count card (running or busy). */
export function SessionMonitorCard(props: PropsRuntime<'widgets.card'> & PropsLocale<'card-container'>) {
  const { useSessions, t } = props
  const sessions = useSessions(selectSessions)
  // byId is keyed by SessionId (a branded string); index through a plain view.
  const byId = sessions.byId as Readonly<Record<string, SessionSummary>>
  const busy = sessions.ids.filter((id) => {
    const row = byId[id]
    if (!row || row.blank) return false
    if (row.running) return true
    if (row.pendingInteraction !== undefined) return true
    return false
  }).length
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
