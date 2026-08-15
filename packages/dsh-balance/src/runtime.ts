/**
 * Balance runtime (`ctx.balance`): the registry that binds LLM provider
 * routes to vendor balance providers, resolves credentials per query, and
 * folds the last-observation trend so the UI can render up/down without
 * keeping its own history. Published to the browser through the generated
 * `balance/query` Remote.
 *
 * @module @dsh-plugins/balance
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { BalanceProvider } from './provider.ts'
import type { BalanceAccountData, BalanceProviderInfo } from './provider.ts'
import type {
  BalanceAccount, BalanceListEntry, BalanceListResult, BalanceQueryRequest, BalanceQueryResult, BalanceTrend,
} from './types.ts'

export type * from './types.ts'
export { BalanceProvider } from './provider.ts'
export type { BalanceAccountData, BalanceProviderInfo } from './provider.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    balance: BalanceRuntime
  }
}

/** Deployment-varying request policy. */
export interface Config {
  /** Per-query fetch deadline in milliseconds (default 10000). */
  readonly requestTimeoutMs?: number
}

/** Absolute floor below which two totals count as unchanged. */
const FLAT_EPSILON = 1e-9

const DEFAULT_TIMEOUT_MS = 10000

/** One bound route: the provider and the registration facts it was bound under. */
interface Binding {
  readonly provider: BalanceProvider
  readonly info: BalanceProviderInfo
}

/** Validate the one deployment-varying tunable at the configuration boundary. */
function resolveTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(`balance: requestTimeoutMs must be a positive finite number, got ${String(value)}`)
  }
  return timeoutMs
}

/** Validate a provider registration's metadata in full before committing any route. */
function validateInfo(info: BalanceProviderInfo): void {
  if (info.vendor.length === 0) throw new Error('balance: a provider vendor id must be non-empty')
  if (info.displayName.length === 0) throw new Error(`balance: provider "${info.vendor}" has an empty displayName`)
  if (info.credentialRef.length === 0) {
    throw new Error(`balance: provider "${info.vendor}" has an empty credentialRef`)
  }
  if (info.providers.length === 0) {
    throw new Error(`balance: provider "${info.vendor}" must bind at least one LLM provider route`)
  }
  for (const route of info.providers) {
    if (route.length === 0) {
      throw new Error(`balance: provider "${info.vendor}" declares an empty LLM provider route`)
    }
  }
}

/**
 * The balance service. Providers register through {@link BalanceRuntime.register};
 * each registration is an effect binding every declared route and withdrawing
 * them on disposal. A query resolves the route to a provider, the credential,
 * then the vendor account, and folds the trend from the previous observation.
 */
export class BalanceRuntime extends TypertRemoteService {
  static inject: string[] = []

  static Config: z<Config> = z.object({
    requestTimeoutMs: z.number().min(Number.MIN_VALUE).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_TIMEOUT_MS),
  })

  private readonly timeoutMs: number
  private readonly bindings = new Map<string, Binding>()
  /** Last observed total per LLM provider route (process-local trend seed). */
  private readonly lastTotals = new Map<string, number>()

  /**
   * @param ctx - host context; the credential seam is read optionally through `ctx.get`.
   * @param config - validated request policy.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'balance')
    this.timeoutMs = resolveTimeout(config.requestTimeoutMs)
  }

  /**
   * Register one vendor's balance provider. All-or-nothing: a route already
   * bound by another registration rejects the whole set, leaving the registry
   * unchanged. Disposed with the calling fiber.
   * @param provider - the provider whose routes are bound.
   * @returns the disposer withdrawing every route this registration holds.
   */
  register(provider: BalanceProvider): () => void {
    const info = provider.info
    validateInfo(info)
    const dispose = this.ctx.effect(function* (this: BalanceRuntime) {
      for (const route of info.providers) {
        if (this.bindings.has(route)) {
          throw new Error(`balance: LLM provider route "${route}" is already bound to a balance provider`)
        }
      }
      for (const route of info.providers) this.bindings.set(route, { provider, info })
      yield () => {
        for (const route of info.providers) {
          if (this.bindings.get(route)?.provider === provider) this.bindings.delete(route)
        }
      }
    }.bind(this), 'balance.register()')
    return () => void dispose()
  }

  /**
   * Resolve one provider route's balance through its bound vendor.
   * Published as the `balance/query` Remote. Business conditions — an unbound
   * route, a missing credential, an unsupported vendor, or a vendor API failure
   * — return as {@link BalanceQueryResult} branches rather than rejecting, so
   * the UI renders them as states instead of treating them as transport faults.
   * @param request - the LLM provider route and optional model id.
   * @returns the resolved result.
   */
  @Remote('query')
  async query(request: BalanceQueryRequest): Promise<BalanceQueryResult> {
    const binding = this.bindings.get(request.provider)
    if (binding === undefined) return { provider: request.provider, bound: false }
    return this.queryOne(request.provider, binding)
  }

  /**
   * List every bound provider route's balance, in registration order. The
   * multi-account dashboard view reads this; each entry goes through the same
   * credential/unsupported/error resolution as a single query, and vendors are
   * interrogated sequentially so a slow one cannot spike concurrent requests.
   * @returns one entry per bound route.
   */
  @Remote('list')
  async list(): Promise<BalanceListResult> {
    const accounts: BalanceListEntry[] = []
    for (const [provider, binding] of this.bindings) {
      accounts.push(await this.queryOne(provider, binding))
    }
    return { accounts }
  }

  /** Resolve one bound route through its vendor (shared by `query` and `list`). */
  private async queryOne(provider: string, binding: Binding): Promise<BalanceQueryResult> {
    if (!binding.info.supported) {
      return {
        provider,
        bound: true,
        account: this.staticAccount(provider, binding.info, {
          status: 'unsupported',
          label: binding.info.displayName,
        }),
      }
    }
    const credential = binding.info.credential ?? await this.resolveCredential(binding.info.credentialRef)
    if (credential === undefined) {
      return {
        provider,
        bound: true,
        account: this.staticAccount(provider, binding.info, {
          status: 'unconfigured',
          label: binding.info.displayName,
        }),
      }
    }
    const signal = AbortSignal.timeout(this.timeoutMs)
    try {
      const data = await binding.provider.query(credential, signal)
      return {
        provider,
        bound: true,
        account: this.foldTrend(provider, binding.info, data),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'balance query failed'
      const aborted = signal.aborted
      return {
        provider,
        bound: true,
        account: this.staticAccount(provider, binding.info, {
          status: 'error',
          label: binding.info.displayName,
          errorCode: aborted ? 'timeout' : 'provider-error',
          errorMessage: aborted ? `request exceeded ${String(this.timeoutMs)}ms` : message,
        }),
      }
    }
  }

  /**
   * Resolve a credential reference through the credential seam, falling back
   * to the process environment when no seam is mounted. Never returns an empty
   * value (an empty stored secret is absent, per the seam-wide rule).
   * @param ref - the reference to resolve.
   * @returns the value, or undefined while unconfigured.
   */
  private async resolveCredential(ref: string): Promise<string | undefined> {
    const credentials = this.ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(credentialRef(ref))
      return hit?.value
    }
    const ambient = process.env[ref]
    return ambient !== undefined && ambient.length > 0 ? ambient : undefined
  }

  /** Resolve the model-provider display name for a route, falling back to the vendor name. */
  private modelDisplayName(provider: string, info: BalanceProviderInfo): string {
    const llm = this.ctx.get('llm')
    if (llm !== undefined && typeof llm.listConfigurableProviders === 'function') {
      const match = llm.listConfigurableProviders().find((entry) => entry.provider === provider)
      if (match !== undefined && typeof match.displayName === 'string' && match.displayName.length > 0) {
        return match.displayName
      }
    }
    return info.displayName
  }

  /** Fold the previous observation into trend/delta and remember the new total. */
  private foldTrend(provider: string, info: BalanceProviderInfo, data: BalanceAccountData): BalanceAccount {
    const previous = this.lastTotals.get(provider)
    this.lastTotals.set(provider, data.total)
    const delta = previous === undefined ? 0 : data.total - previous
    const trend: BalanceTrend = previous === undefined
      ? 'unknown'
      : Math.abs(delta) < FLAT_EPSILON ? 'flat' : delta > 0 ? 'up' : 'down'
    return {
      vendor: info.vendor,
      displayName: this.modelDisplayName(provider, info),
      label: data.label ?? info.displayName,
      currency: data.currency,
      total: data.total,
      ...(data.granted === undefined ? {} : { granted: data.granted }),
      ...(data.toppedUp === undefined ? {} : { toppedUp: data.toppedUp }),
      trend,
      delta,
      updatedAt: Date.now(),
      status: 'ok',
    }
  }

  /** Build a non-ok account view (unconfigured/unsupported/error) with no amounts. */
  private staticAccount(
    provider: string,
    info: BalanceProviderInfo,
    fields: Pick<BalanceAccount, 'status' | 'label'> & Partial<BalanceAccount>,
  ): BalanceAccount {
    return {
      vendor: info.vendor,
      displayName: this.modelDisplayName(provider, info),
      label: fields.label,
      currency: '',
      total: 0,
      trend: 'unknown',
      delta: 0,
      updatedAt: Date.now(),
      status: fields.status,
      ...(fields.errorCode === undefined ? {} : { errorCode: fields.errorCode }),
      ...(fields.errorMessage === undefined ? {} : { errorMessage: fields.errorMessage }),
    }
  }
}

export default BalanceRuntime
