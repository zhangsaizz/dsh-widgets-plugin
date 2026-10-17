/**
 * Official DeepSeek-account wallets as extra balance rows.
 *
 * Harness 0.2.1 exposes the signed-in Platform account through the `account`
 * Remote namespace (`getBalance` on `ctx.remote.account`, backed by the
 * credential provider's Platform Web query). The dashboard reuses those wallets
 * so the same floating panel also answers "how much is left on my account?",
 * without a second plugin or a Host-side balance provider.
 *
 * Boundaries:
 *  - Amounts arrive as server-precision decimal strings; normal (recharge /
 *    pay-as-you-go) and bonus wallets stay separate lists. This module sums each
 *    list per currency and maps them onto the domain's `total` = `toppedUp` +
 *    `granted` vocabulary, one row per currency.
 *  - A wallet whose string does not parse is dropped rather than counted as
 *    zero; when every wallet of a currency is dropped, that currency yields no
 *    row (never a fabricated `0`).
 *  - A signed-out account (`null`) and a failed read both yield no rows, so the
 *    panel is byte-for-byte unchanged on shells without an account provider or
 *    before sign-in.
 *  - The account Remote is read late-bound (`ctx.get('remote.account')`) on the
 *    normal refresh; a failure there never affects the provider listing.
 *
 * @module @dsh-plugins/balance/client/account-balance
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { BalanceAccount, BalanceListEntry } from '../types.ts'

/** Synthetic provider-route prefix; the full key is `<prefix>:<currency>`. */
export const ACCOUNT_PROVIDER_PREFIX = 'deepseek-account'
/** Synthetic vendor id, so the widget can localize the display name. */
export const ACCOUNT_VENDOR = 'deepseek-account'
/**
 * Client version sent to the Host for the Platform request headers. The Host
 * derives the Platform client headers from it; it is our package build, not a
 * claim about the hosting shell's version.
 */
export const ACCOUNT_CLIENT_VERSION = '0.1.0'

/** Client identity for one account call (the Host turns it into Platform headers). */
export interface AccountClientMetadataLike {
  readonly version: string
  readonly locale: string
  readonly timezoneOffsetSeconds: number
}

/** One Platform wallet: a currency and a server-precision decimal string. */
export interface AccountWalletLike {
  readonly currency: 'CNY' | 'USD'
  readonly balance: string
}

/** `getBalance` outcome: ready wallets (recharge + bonus) or a failed read. */
export type AccountBalanceLike =
  | {
    readonly status: 'ready'
    readonly value: readonly AccountWalletLike[]
    readonly bonusWallets: readonly AccountWalletLike[]
  }
  | { readonly status: 'failed' }

/** The narrow `account` Remote face this reader needs (late-bound, never injected). */
export interface AccountRemoteLike {
  getBalance: (client: AccountClientMetadataLike) => Promise<RemoteResult<AccountBalanceLike | null>>
}

/** Late-bound lookup: the account Remote belongs to the optional account plugin. */
export type AccountRemoteProvider = () => AccountRemoteLike | undefined

/**
 * Build the request identity for one account call.
 * @param locale - active UI language; the Host reduces it to the Platform wire locale.
 * @returns metadata carrying the active language and the local UTC offset.
 */
export function accountClientMetadata(locale: string): AccountClientMetadataLike {
  return {
    version: ACCOUNT_CLIENT_VERSION,
    locale,
    // Date.getTimezoneOffset reports minutes west of UTC; Platform wants seconds east.
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}

/**
 * Parse one wallet amount; a malformed string makes the whole wallet disappear.
 *
 * `Number('')` and `Number(' ')` are `0`, so a blank string must be rejected
 * before the numeric parse — otherwise a broken projection would fabricate a
 * zero-balance wallet instead of dropping it.
 * @param wallet - Platform wallet projection.
 * @returns the numeric amount, or undefined when the string is not a finite number.
 */
function walletAmount(wallet: AccountWalletLike): number | undefined {
  if (typeof wallet.balance !== 'string') return undefined
  const text = wallet.balance.trim()
  if (text === '') return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : undefined
}

/** Sum one wallet list for a currency, dropping unparseable entries. */
function sumWallets(
  wallets: readonly AccountWalletLike[] | undefined,
  currency: AccountWalletLike['currency'],
): { present: boolean; sum: number } {
  let present = false
  let sum = 0
  for (const wallet of wallets ?? []) {
    if (wallet.currency !== currency) continue
    const amount = walletAmount(wallet)
    if (amount === undefined) continue
    present = true
    sum += amount
  }
  return { present, sum }
}

/**
 * Whether a listing entry is one of this module's synthetic account rows.
 * @param entry - one all-accounts listing entry.
 * @returns true for the official-account wallet rows.
 */
export function isAccountRow(entry: BalanceListEntry): boolean {
  return entry.account?.vendor === ACCOUNT_VENDOR
}

/**
 * Replace the wallet rows in a listing, keeping every provider row as-is.
 * @param previous - the previously published listing (may be null before the first read).
 * @param entries - freshly resolved wallet rows (possibly empty).
 * @returns provider rows followed by the fresh wallet rows.
 */
export function mergeAccountRows(
  previous: readonly BalanceListEntry[] | null,
  entries: readonly BalanceListEntry[],
): BalanceListEntry[] {
  return [...(previous ?? []).filter(entry => !isAccountRow(entry)), ...entries]
}

/**
 * Round a wallet sum to the two decimals the official account UI displays
 * (the dashboard renders provider balances at that precision too; platform
 * wallet strings carry 16 decimals of internal precision).
 * @param value - summed wallet amount.
 * @returns the value rounded to two decimals.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * The signed-in official account's resolved wallet rows, in listing order
 * (the controller appends them CNY-then-USD).
 * @param accounts - the published all-accounts listing, or null before the first read.
 * @returns synthetic wallet accounts with `status: 'ok'`, empty when signed out.
 */
export function officialAccountRows(accounts: readonly BalanceListEntry[] | null): BalanceAccount[] {
  const rows: BalanceAccount[] = []
  for (const entry of accounts ?? []) {
    const account = entry.account
    if (account !== undefined && account.vendor === ACCOUNT_VENDOR && account.status === 'ok') rows.push(account)
  }
  return rows
}

/**
 * Map a Platform account balance onto dashboard rows, one per reported currency.
 * @param balance - the `getBalance` value; `null`/absent means signed out or no account.
 * @param now - epoch milliseconds stamped as the observation time.
 * @returns synthetic bound entries in CNY-then-USD order (empty when nothing is reported).
 */
export function accountBalanceEntries(
  balance: AccountBalanceLike | null | undefined,
  now: number,
): BalanceListEntry[] {
  if (balance === null || balance === undefined || balance.status !== 'ready') return []
  const entries: BalanceListEntry[] = []
  for (const currency of ['CNY', 'USD'] as const) {
    const recharge = sumWallets(balance.value, currency)
    const bonus = sumWallets(balance.bonusWallets, currency)
    // A recharge wallet makes the currency row exist even at zero (the official
    // account page shows `¥0.00`); a ZERO bonus-only currency is noise (the
    // official UI filters `bonus <= 0` the same way).
    if (!recharge.present && (!bonus.present || bonus.sum === 0)) continue
    const total = round2(recharge.sum + bonus.sum)
    const granted = round2(bonus.sum)
    const toppedUp = round2(recharge.sum)
    const account: BalanceAccount = {
      vendor: ACCOUNT_VENDOR,
      displayName: 'DeepSeek',
      label: '',
      currency,
      total,
      granted,
      toppedUp,
      trend: 'unknown',
      delta: 0,
      updatedAt: now,
      status: 'ok',
    }
    entries.push({ provider: `${ACCOUNT_PROVIDER_PREFIX}:${currency}`, bound: true, account })
  }
  return entries
}
