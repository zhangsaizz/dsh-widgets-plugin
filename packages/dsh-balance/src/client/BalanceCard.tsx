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
import type { BalanceAccount } from '../types.ts'
import { ACCOUNT_VENDOR, officialAccountRows } from './account-balance.ts'
import type { BalanceController, BalanceViewState } from './controller.ts'
import { trendIcon } from './icons.tsx'
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

/** Format one amount with up to four decimals, trailing zeros stripped, and
 *  thousands separators so large balances stay readable at a glance. */
function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const abs = Math.abs(value)
  // Group the integer part, keep at most 4 decimals, then drop trailing zeros.
  const [integer, fraction] = abs.toFixed(4).split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const trimmedFraction = fraction.replace(/0+$/, '')
  const sign = value < 0 ? '-' : ''
  return trimmedFraction === '' ? `${sign}${grouped}` : `${sign}${grouped}.${trimmedFraction}`
}

/** The signed-in official account's first ok wallet row (CNY before USD), or null. */
function officialAccountOf(view: BalanceViewState): BalanceAccount | null {
  return officialAccountRows(view.accounts)[0] ?? null
}

/** Resolve the card's account: the provider's ok account, else the official account. */
function okAccountOf(view: BalanceViewState): BalanceAccount | null {
  const account = view.result?.account
  if (view.result?.bound === true && account?.status === 'ok') return account
  return officialAccountOf(view)
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
  // With a resolved account (provider or official) the note is noise: the card
  // exists to show the actual balance, and the official row makes it available
  // even when the model provider has no key configured.
  const note = account === null ? stateNoteOf(view, t) : null

  if (account === null || note !== null) {
    return (
      <div className={css.statCard}>
        <span className={css.statNote}>{note ?? t('loading')}</span>
      </div>
    )
  }

  const glyph = trendIcon(account.trend, { size: 11 })
  const name = account.vendor === ACCOUNT_VENDOR ? t('accountVendor') : account.displayName
  return (
    <div className={css.statCard}>
      <span className={css.amountRow}>
        <span className={css.statValue} data-trend={account.trend}>{formatAmount(account.total)}</span>
        <span className={css.statCurrency}>{account.currency}</span>
        {glyph !== null ? <span className={css.statTrend} data-trend={account.trend} role="img" aria-label={account.trend}>{glyph}</span> : null}
      </span>
      <span className={css.statName} title={name}>
        {name}
        {account.label !== '' && account.label !== name ? ` · ${account.label}` : ''}
      </span>
    </div>
  )
}
// Full-row card: the balance is a headline metric. `.spec` is read by the card
// container's cardSpecOf (a plain static on the component function).
(BalanceCard as { spec?: 'small' | 'medium' | 'large' }).spec = 'large'
