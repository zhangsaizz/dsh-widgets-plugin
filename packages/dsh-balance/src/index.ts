/**
 * The balance plugin, one package: the `ctx.balance` capability seam
 * (Service Definition, provider role, domain types, generated Remotes), the
 * shipped vendor providers plus user-managed bindings (settings section +
 * same-origin Web route), and the Web dashboard surface (browser half,
 * `exports["./client"]`). Formerly three packages (`balance`,
 * `balance-vendors`, `client-ui-balance`); merged into one plugin row.
 *
 * @module @dsh-plugins/balance
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BalanceRuntime } from './runtime.ts'
import type { BalanceBindingConfig } from './types.ts'
import { BalanceWebBackend, installBalanceWeb } from './web.ts'
import { BALANCE_SETTINGS_NS, BalanceSettingsSchema, bindingSchema } from './settings.ts'
import {
  DeepSeekBalanceProvider,
  MoonshotBalanceProvider,
  NewApiBalanceProvider,
  NEW_API_QUOTA_PER_USD,
  OpenRouterBalanceProvider,
  PROVIDERS,
  SiliconFlowBalanceProvider,
  UnsupportedBalanceProvider,
  UNSUPPORTED_VENDORS,
} from './providers.ts'

export type * from './types.ts'
export { BalanceProvider } from './provider.ts'
export type { BalanceAccountData, BalanceProviderInfo } from './provider.ts'
export { BalanceRuntime } from './runtime.ts'
export {
  DeepSeekBalanceProvider,
  MoonshotBalanceProvider,
  NewApiBalanceProvider,
  NEW_API_QUOTA_PER_USD,
  OpenRouterBalanceProvider,
  PROVIDERS,
  SiliconFlowBalanceProvider,
  UnsupportedBalanceProvider,
  UNSUPPORTED_VENDORS,
} from './providers.ts'

/** Cordis plugin name. */
export const name = 'balance'
/** Services required before providers, the settings section and the Web route can register. */
export const inject = ['settings']

/** Deployment config: request policy, New API origin, and static bindings. */
export interface Config {
  /** Per-query fetch deadline in milliseconds (default 10000). */
  readonly requestTimeoutMs?: number
  /** New API instance base URL (default http://localhost:3000). */
  readonly newApiBaseURL?: string
  /** Static user-managed bindings applied at boot — fill credentials directly here. */
  bindings?: BalanceBindingConfig[]
}

export const Config: z<Config> = z.object({
  requestTimeoutMs: z.number().min(Number.MIN_VALUE).max(Number.MAX_SAFE_INTEGER).default(10000),
  newApiBaseURL: z.string().default('http://localhost:3000'),
  bindings: z.array(bindingSchema).default([]),
})

/** Read the user-managed bindings out of a schema-validated settings section. */
function readBindings(section: unknown): BalanceBindingConfig[] {
  const raw = (section as { bindings?: unknown } | null)?.bindings
  if (!Array.isArray(raw)) return []
  const bindings: BalanceBindingConfig[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const provider = record['provider']
    const vendor = record['vendor']
    const credentialRef = typeof record['credentialRef'] === 'string' ? record['credentialRef'] : ''
    const credential = typeof record['credential'] === 'string' ? record['credential'] : ''
    if (typeof provider !== 'string' || provider.length === 0) continue
    if (typeof vendor !== 'string' || vendor.length === 0) continue
    if (credentialRef.length === 0 && credential.length === 0) continue
    bindings.push({
      provider,
      vendor,
      credentialRef,
      ...(credential.length === 0 ? {} : { credential }),
      ...(typeof record['baseURL'] === 'string' ? { baseURL: record['baseURL'] } : {}),
    })
  }
  return bindings
}

/** Build the provider instance for one user-managed binding. */
function createVendorProvider(binding: BalanceBindingConfig): import('./provider.ts').BalanceProvider {
  const options: { providers: readonly string[]; credentialRef: string; credential?: string; baseURL?: string } = {
    providers: [binding.provider],
    credentialRef: binding.credentialRef,
  }
  if (binding.credential !== undefined) options.credential = binding.credential
  if (binding.baseURL !== undefined) options.baseURL = binding.baseURL
  switch (binding.vendor) {
    case 'deepseek': return new DeepSeekBalanceProvider(options)
    case 'moonshot': return new MoonshotBalanceProvider(options)
    case 'openrouter': return new OpenRouterBalanceProvider(options)
    case 'siliconflow': return new SiliconFlowBalanceProvider(options)
    case 'new-api': return new NewApiBalanceProvider(options)
    default: throw new Error(`balance: unknown balance vendor "${binding.vendor}"`)
  }
}

/**
 * Mount the balance line: construct the runtime (self-registers `ctx.balance`
 * through the Service base constructor), register every shipped vendor plus
 * the static `bindings`, then watch the `balance` settings section for
 * user-managed bindings and attach the same-origin settings Web route. Every
 * registration is an effect on this fiber, so unloading the plugin withdraws
 * all route bindings and the Web route in one cascade.
 * @param ctx - host context.
 * @param config - validated deployment tunables.
 */
export function apply(ctx: Context, config: Config = {}): void {
  // 1. Capability seam: constructing the runtime registers `ctx.balance`.
  new BalanceRuntime(ctx, { requestTimeoutMs: config.requestTimeoutMs })

  // 2. Shipped vendor providers, then static deployment bindings.
  for (const provider of PROVIDERS) ctx.balance.register(provider)
  ctx.balance.register(new NewApiBalanceProvider(
    config.newApiBaseURL === undefined ? {} : { baseURL: config.newApiBaseURL },
  ))
  for (const binding of config.bindings ?? []) {
    ctx.balance.register(createVendorProvider(binding))
  }

  // 3. Settings-section bindings (reconcile on change) + same-origin Web route.
  const settings = ctx.get('settings')
  if (settings === undefined) return
  const scope = settings.register(BALANCE_SETTINGS_NS, BalanceSettingsSchema)
  const disposers = new Map<string, () => void>()
  const reconcile = (section: unknown): void => {
    for (const dispose of disposers.values()) dispose()
    disposers.clear()
    for (const binding of readBindings(section)) {
      try {
        disposers.set(binding.provider, ctx.balance.register(createVendorProvider(binding)))
      } catch (error) {
        // A malformed entry is a user-document problem, not a plugin failure:
        // skip it and surface the reason once.
        ctx.logger.warn('balance: skipping settings binding for provider "%s"', binding.provider)
        ctx.logger.warn(error)
      }
    }
  }
  const stopWatch = scope.watch((next) => { reconcile(next) })
  reconcile(scope.get())
  ctx.effect(() => () => {
    stopWatch()
    for (const dispose of disposers.values()) dispose()
    disposers.clear()
  }, 'balance: settings bindings')

  const backend = new BalanceWebBackend(ctx)
  installBalanceWeb(ctx, backend)
}
