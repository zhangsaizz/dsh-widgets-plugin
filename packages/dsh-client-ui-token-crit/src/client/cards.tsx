/**
 * Token-crit compact card view for the card container (`widgets.card`).
 *
 * The card container declares `widgets.card` as a standard, optional adapter
 * contract: a widget opt-in to render its own compact card inside the
 * container's grid by registering into that slot. This widget owns its card —
 * the token-usage selection below is the SAME projection the floating
 * TokenCritWidget reads, so the two can never drift apart.
 *
 * Registration (see ./index.ts): `ctx.slots.inject('widgets.card', …)` with
 * the entry id equal to this widget's `shell.overlay` id (`token-crit`), a
 * priority of 0 (the container's built-in fallbacks sit at 10, so this always
 * wins the cell), and `locale: 'card-container'` reusing the card container's
 * shared stat vocabulary.
 *
 * @module @dsh-plugins/client-ui-token-crit/client/cards
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the `widgets.card` SlotMap merge and the `card-container`
// LocaleNamespaceMap merge the card types below depend on.
import type {} from '@dsh-plugins/client-ui-card-container/client'
import type { WidgetCardComponent } from '@dsh-plugins/client-ui-card-container/client'
import css from './cards.module.css'

/** Cumulative token-usage projection value (from the token-meter). */
interface TokenUsage {
  uncachedInputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** Select the current session's token usage — mirrors the TokenCritWidget.
 *  `projectionValues` is typed `Partial<SessionProjectionMap>` whose declared
 *  keys don't include `tokenUsage`, so read through the projection-value
 *  record like the floating widget does. */
function selectUsage(s: SessionListState): TokenUsage | undefined {
  const cid = s.current
  if (!cid) return undefined
  const byId = s.byId as Readonly<Record<string, SessionSummary>>
  const entry = byId[cid]
  if (!entry || !entry.projectionValues) return undefined
  const values = entry.projectionValues as Record<string, unknown>
  return values.tokenUsage as TokenUsage | undefined
}

/** Compact number formatting (1.2K / 3.4M / 1.1B). */
function compact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n))
}

/** Compact token-usage card. */
export function TokenCritCard(props: PropsRuntime<'widgets.card'> & PropsLocale<'card-container'>) {
  const { useSessions, t } = props
  const usage = useSessions(selectUsage)
  const input = usage
    ? (usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    : 0
  const output = usage ? (usage.outputTokens ?? 0) : 0
  const total = input + output
  return (
    <div className={css.statCard}>
      <span className={css.statValue}>{compact(total)}</span>
      <span className={css.statLabel}>{t('cardTokenLabel')}</span>
      <span className={css.statMeta}>
        {t('cardTokenIn', { n: compact(input) })} · {t('cardTokenOut', { n: compact(output) })}
      </span>
    </div>
  )
}
// One-column compact stat.
(TokenCritCard as WidgetCardComponent).spec = 'small'
