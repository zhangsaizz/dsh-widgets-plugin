/**
 * Balance vendors plugin: registers the shipped vendor balance providers into
 * `ctx.balance`. Each registration is an effect on this plugin's fiber, so
 * unloading the plugin withdraws every route binding in one cascade.
 *
 * @module @dsh-plugins/balance-vendors
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BalanceProvider } from '@dsh-plugins/balance'
import {
  DeepSeekBalanceProvider,
  MoonshotBalanceProvider,
  NewApiBalanceProvider,
  OpenRouterBalanceProvider,
  PROVIDERS,
  SiliconFlowBalanceProvider,
} from './providers.ts'
import type { BalanceBindingConfig } from '@dsh-plugins/balance'
import { bindingSchema, BalanceSettingsSchema, BALANCE_SETTINGS_NS } from './settings.ts'
import { BalanceWebBackend, installBalanceWeb } from './web.ts'

export { NEW_API_QUOTA_PER_USD, PROVIDERS, UNSUPPORTED_VENDORS } from './providers.ts'
export {
  DeepSeekBalanceProvider,
  MoonshotBalanceProvider,
  NewApiBalanceProvider,
  OpenRouterBalanceProvider,
  SiliconFlowBalanceProvider,
  UnsupportedBalanceProvider,
} from './providers.ts'

/** Cordis plugin name. */
export const name = 'balance-vendors'
/** Services required before the providers can register (settings is needed for the settings section + web route). */
export const inject = ['balance', 'settings']

/** Deployment config; New API is a self-hosted instance, so its origin is a tunable. */
export interface Config {
  /** New API instance base URL (default http://localhost:3000). */
  newApiBaseURL?: string
  /** Static user-managed bindings applied at boot — fill credentials directly here. */
  bindings?: BalanceBindingConfig[]
}

export const Config: z<Config> = z.object({
  newApiBaseURL: z.string().default('http://localhost:3000'),
  bindings: z.array(bindingSchema).default([]),
})

export type { BalanceBindingConfig } from '@dsh-plugins/balance'

export { BalanceSettingsSchema, BALANCE_SETTINGS_NS } from './settings.ts'

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
function createVendorProvider(binding: BalanceBindingConfig): BalanceProvider {
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
    default: throw new Error(`balance-vendors: unknown balance vendor "${binding.vendor}"`)
  }
}

/**
 * Register every shipped vendor provider, then apply the user-managed bindings
 * from the `balance` settings section (each is registered as an effect on this
 * fiber; settings changes reconcile the set). Route bindings live and die with
 * this plugin's fiber through {@link BalanceRuntime.register}'s effect.
 * @param ctx - host context carrying the balance runtime.
 * @param config - deployment tunables (New API instance origin).
 */
export function apply(ctx: Context, config: Config = {}): void {
  for (const provider of PROVIDERS) ctx.balance.register(provider)
  ctx.balance.register(new NewApiBalanceProvider(
    config.newApiBaseURL === undefined ? {} : { baseURL: config.newApiBaseURL },
  ))

  for (const binding of config.bindings ?? []) {
    ctx.balance.register(createVendorProvider(binding))
  }

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
        ctx.logger.warn('balance-vendors: skipping settings binding for provider "%s"', binding.provider)
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
  }, 'balance-vendors: settings bindings')

  const backend = new BalanceWebBackend(ctx)
  installBalanceWeb(ctx, backend)
}
