/**
 * Pure types of the balance domain: the ONE home of the wire vocabulary the
 * balance query Remote carries, free of host-side imports (cordis, the
 * runtime, the provider role). Two namespace projections serve it — `./types`
 * for host consumers, `./client` re-exported through the typert-generated
 * Remote face for client aggregates.
 *
 * @module @dsh-plugins/balance/types
 */

/** Direction the account balance moved since the last observation. */
export type BalanceTrend = 'up' | 'down' | 'flat' | 'unknown'

/** Lifecycle of one resolved account balance. */
export type BalanceAccountStatus = 'ok' | 'unconfigured' | 'unsupported' | 'error'

/** One balance query: the LLM provider route and an optional model id for context. */
export interface BalanceQueryRequest {
  /** LLM provider route (e.g. `deepseek-official`), the binding key into the balance registry. */
  readonly provider: string
  /** Optional exact model id; advisory context only, never a routing fact. */
  readonly model?: string
}

/**
 * One resolved account balance, detached and JSON-safe. The three amounts
 * (`total`/granted/topped-up) are vendor-neutral: `total` is the value the
 * trend and scroll animation key off, while `granted` and `toppedUp` are
 * best-effort breakdowns a vendor may or may not expose.
 */
export interface BalanceAccount {
  /** Balance vendor id (e.g. `deepseek`, `openrouter`). */
  readonly vendor: string
  /** Human display name of the balance vendor (e.g. `DeepSeek`). */
  readonly displayName: string
  /** Human account label (email, org, project) when the vendor reports one. */
  readonly label: string
  /** ISO 4217 currency code the amounts are denominated in. */
  readonly currency: string
  /** Current total balance/credits. */
  readonly total: number
  /** Granted/credit amount, when the vendor distinguishes it. */
  readonly granted?: number
  /** Topped-up/cash amount, when the vendor distinguishes it. */
  readonly toppedUp?: number
  /** Direction vs the runtime's last observation for this provider. */
  readonly trend: BalanceTrend
  /** Signed difference vs the last observation (0 on the first, or when flat). */
  readonly delta: number
  /** Epoch milliseconds of the vendor-side observation. */
  readonly updatedAt: number
  /** Resolved lifecycle status. */
  readonly status: BalanceAccountStatus
  /** Stable machine code when `status` is `error`. */
  readonly errorCode?: string
  /** Human-readable failure reason when `status` is `error`. */
  readonly errorMessage?: string
}

/** Result of one balance query for a provider route. */
export interface BalanceQueryResult {
  /** The requested LLM provider route, echoed back verbatim. */
  readonly provider: string
  /** Whether a balance provider is bound to this LLM provider route. */
  readonly bound: boolean
  /** The resolved account, present exactly while `bound` is true. */
  readonly account?: BalanceAccount
}

/** One provider route's balance in a multi-account listing. */
export interface BalanceListEntry {
  /** LLM provider route (e.g. `deepseek-official`). */
  readonly provider: string
  /** Whether a balance provider is bound to this route. */
  readonly bound: boolean
  /** The resolved account, present exactly while `bound` is true. */
  readonly account?: BalanceAccount
}

/** Result of listing every bound provider route's balance. */
export interface BalanceListResult {
  /** One entry per bound provider route, in registration order. */
  readonly accounts: readonly BalanceListEntry[]
}

/** One user-managed balance binding (the `balance` settings section). */
export interface BalanceBindingConfig {
  /** LLM provider route this binding answers balance queries for. */
  readonly provider: string
  /** Balance vendor type (deepseek, moonshot, openrouter, siliconflow, new-api). */
  readonly vendor: string
  /** Credential reference resolved per query. */
  readonly credentialRef: string
  /** Inline credential value; overrides {@link credentialRef} when present. */
  readonly credential?: string
  /** Optional vendor endpoint override (self-hosted instances). */
  readonly baseURL?: string
}
