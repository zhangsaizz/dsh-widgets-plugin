/**
 * Balance compact card view for the card container (`widgets.card`).
 *
 * The card container declares `widgets.card` as a standard, optional adapter
 * contract: a widget opt-in to render its own compact card inside the
 * container's grid by registering into that slot. This widget owns its card —
 * the same `useBalance` controller that feeds the floating dashboard, so the
 * two can never drift apart. The card shows the current session's resolved
 * balance (amount + currency + trend, with the vendor name), or a short state
 * note when none is available yet.
 *
 * Registration (see ./index.ts): `ctx.slots.inject('widgets.card', …)` with
 * the entry id equal to this widget's `shell.overlay` id (`balance`), a
 * priority of 0 (the container registers no fallback, so this is the sole
 * balance card), and an inject face binding `hooks.balance` to this plugin's
 * controller so the card gets the `useBalance` selector hook.
 *
 * @module @dsh-plugins/balance/client/balance-card
 */

import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the `widgets.card` SlotMap merge the props below depend on.
import type {} from '@dsh-plugins/client-ui-card-container/client'
import type { BalanceAccount, BalanceTrend } from '../types.ts'
import type { BalanceController, BalanceViewState } from './controller.ts'
import css from './BalanceCard.module.css'

/** Injected business face: the live balance source (bound as `useBalance`). */
export interface BalanceCardInject {
  hooks: { balance: BalanceController }
}

/** Full composed props for the card (runtime + locale + inject share). */
export type BalanceCardProps =
  & PropsRuntime<'widgets.card'>
  & PropsLocale<'balance'>
  & InjectFace<BalanceCardInject>

/** Format one amount with up to four decimals, trailing zeros stripped. */
function formatAmount(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, '')
}

/** Trend glyph: up/down arrows, a muted dash for flat, nothing for unknown. */
function trendGlyph(trend: BalanceTrend): string | null {
  if (trend === 'up') return '▲'
  if (trend === 'down') return '▼'
  if (trend === 'flat') return '–'
  return null
}

/** Resolve the current account: the ok account, or null while unavailable. */
function okAccountOf(view: BalanceViewState): BalanceAccount | null {
  const account = view.result?.account
  if (view.result?.bound === true && account?.status === 'ok') return account
  return null
}

/** Short state note when no ok balance is available, or null when there is one. */
function stateNoteOf(view: BalanceViewState, t: TranslateNS<'balance'>): string | null {
  if (view.phase === 'no-session') return t('noSession')
  if (view.phase === 'loading' && view.result === null) return t('loading')
  if (view.provider === null || view.result === null) return t('noModel')
  // A transport-level failure arrives as an error ACCOUNT (bound:false +
  // status:'error'), so its message must win over the generic "unbound" text.
  if (view.result.account !== undefined && view.result.account.status === 'error') {
    return view.result.account.errorMessage ?? t('error')
  }
  if (!view.result.bound || view.result.account === undefined) return t('unbound')
  switch (view.result.account.status) {
    case 'unconfigured': return t('unconfigured')
    case 'unsupported': return t('unsupported')
    case 'error': return view.result.account.errorMessage ?? t('error')
    case 'ok': return null
  }
}

/** Compact real balance card. */
export function BalanceCard({ useBalance, t }: BalanceCardProps) {
  // Defensive: the card only renders inside the container, which wires the
  // `useBalance` inject. If it is ever missing (e.g. an assembly oddity), degrade
  // to the grid's placeholder instead of crashing the cell.
  if (typeof useBalance !== 'function') return null
  const view = useBalance((s: BalanceViewState) => s)
  const account = okAccountOf(view)
  const note = stateNoteOf(view, t)

  if (account === null || note !== null) {
    return (
      <div className={css.statCard}>
        <span className={css.statNote}>{note ?? t('loading')}</span>
      </div>
    )
  }

  const glyph = trendGlyph(account.trend)
  return (
    <div className={css.statCard}>
      <span className={css.amountRow}>
        <span className={css.statValue} data-trend={account.trend}>{formatAmount(account.total)}</span>
        <span className={css.statCurrency}>{account.currency}</span>
        {glyph !== null ? <span className={css.statTrend} data-trend={account.trend} aria-label={account.trend}>{glyph}</span> : null}
      </span>
      <span className={css.statName} title={account.displayName}>
        {account.displayName}
        {account.label !== '' && account.label !== account.displayName ? ` · ${account.label}` : ''}
      </span>
    </div>
  )
}
// Full-row card: the balance is a headline metric. `.spec` is read by the card
// container's cardSpecOf (a plain static on the component function).
(BalanceCard as { spec?: 'small' | 'medium' | 'large' }).spec = 'large'
