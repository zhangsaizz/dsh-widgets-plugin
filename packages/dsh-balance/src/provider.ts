/**
 * Service Provider role of the balance capability seam: the abstract
 * {@link BalanceProvider} a vendor implements, its registration metadata, and
 * the raw account data it returns. The runtime owns binding, credential
 * resolution, timeouts, and trend folding; a provider owns one vendor's HTTP
 * endpoint and response normalization.
 *
 * @module @dsh-plugins/balance
 */

/** Static facts one balance provider declares about itself and its bindings. */
export interface BalanceProviderInfo {
  /** Unique vendor id (e.g. `deepseek`, `openrouter`). */
  readonly vendor: string
  /** Human display name (e.g. `DeepSeek`). */
  readonly displayName: string
  /** LLM provider routes this vendor answers balance queries for. */
  readonly providers: readonly string[]
  /** Credential reference (environment-variable name) resolved per query. */
  readonly credentialRef: string
  /** Inline credential value; when present it is used directly instead of resolving {@link credentialRef}. */
  readonly credential?: string
  /** Whether the vendor exposes a public balance endpoint through its API key. */
  readonly supported: boolean
}

/** Raw normalized account data a provider returns (before trend folding). */
export interface BalanceAccountData {
  /** ISO 4217 currency code. */
  readonly currency: string
  /** Current total balance/credits. */
  readonly total: number
  /** Granted/credit amount, when the vendor distinguishes it. */
  readonly granted?: number
  /** Topped-up/cash amount, when the vendor distinguishes it. */
  readonly toppedUp?: number
  /** Human account label, when the vendor reports one. */
  readonly label?: string
}

/**
 * One vendor's balance implementation. Registrations are effects: the runtime
 * binds every route in {@link BalanceProviderInfo.providers} for the
 * provider's lifetime and withdraws them on disposal.
 */
export abstract class BalanceProvider {
  /** Static binding facts for this vendor. */
  abstract readonly info: BalanceProviderInfo

  /**
   * Fetch and normalize this vendor's balance.
   * @param credential - the resolved API key value (never logged or echoed).
   * @param signal - aborts when the runtime's request deadline passes.
   * @returns the normalized account data.
   */
  abstract query(credential: string, signal?: AbortSignal): Promise<BalanceAccountData>
}
