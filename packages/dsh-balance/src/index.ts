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

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls the host `ctx.settings` (SettingsForms) Context merge and
// the Loader's `loader/volatile-update` event + `Fiber.entry` declarations.
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { BalanceRuntime } from './runtime.ts'
import type { BalanceBindingConfig } from './types.ts'
import { BalanceWebBackend, installBalanceWeb } from './web.ts'
import { bindingSchema } from './settings.ts'
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

/**
 * Deployment config: request policy, New API origin, and user-managed
 * bindings.
 *
 * In harness 0.1.7 this Config entry IS the plugin's settings section:
 * `SettingsProvider.register` was removed, every settings namespace is a
 * profile plugin entry's Config, and a `volatile` field is the live-editable
 * part — a configuration surface reads it through `ctx.settings.describe()` and
 * writes it through `ctx.settings.update()` (see ./web.ts), the Loader commits
 * the new value into the running fiber in place instead of remounting the
 * plugin, and it announces the commit with `loader/volatile-update`.
 *
 * A volatile field's resolved value is a live reference, hence `Volatile` here:
 * {@link apply} reads it through `.get()`.
 */
export const Config = z.object({
  /** Per-query fetch deadline in milliseconds (default 10000). */
  requestTimeoutMs: z.number().min(Number.MIN_VALUE).max(Number.MAX_SAFE_INTEGER).default(10000),
  /** New API instance base URL (default http://localhost:3000). */
  newApiBaseURL: z.string().default('http://localhost:3000'),
  /**
   * User-managed bindings: static deployment entries written in
   * `cordis.patch.yml` AND the document the provider settings panel edits
   * through `/_dsh/balance/settings`. Adding a binding for a route the shipped
   * providers already cover still conflicts ("route already bound"); see the
   * bundle's patch comments.
   */
  bindings: z.array(bindingSchema).default([]).volatile(),
})

/** Hand-written twin of {@link Config}'s resolved shape (declaration-emit safe:
 *  the inferred schemastery type would name cosmokit internals, TS2742). */
export interface Config {
  /** Per-query fetch deadline in milliseconds. */
  readonly requestTimeoutMs: number
  /** New API instance base URL. */
  readonly newApiBaseURL: string
  /** Live reference to the user-managed bindings. */
  readonly bindings: Volatile<BindingEntry[]>
}

/** One schema-validated element of the `bindings` config field. */
export interface BindingEntry {
  /** LLM provider route this binding answers balance queries for. */
  readonly provider: string
  /** Balance vendor type (deepseek, moonshot, openrouter, siliconflow, new-api). */
  readonly vendor: string
  /** Credential reference resolved per query. */
  readonly credentialRef?: string
  /** Inline credential value; overrides {@link credentialRef} when present. */
  readonly credential?: string
  /** Optional vendor endpoint override (self-hosted instances). */
  readonly baseURL?: string
}

/**
 * Project schema-validated Config entries onto the domain binding type: blank
 * the optional slots, drop entries that carry no credential source at all (an
 * incomplete entry is a user-document problem, not a plugin failure), and keep
 * `credential` / `baseURL` only when actually set.
 */
function readBindings(entries: readonly BindingEntry[]): BalanceBindingConfig[] {
  const bindings: BalanceBindingConfig[] = []
  for (const entry of entries) {
    if (entry.provider.length === 0 || entry.vendor.length === 0) continue
    const credentialRef = entry.credentialRef ?? ''
    const credential = entry.credential ?? ''
    if (credentialRef.length === 0 && credential.length === 0) continue
    bindings.push({
      provider: entry.provider,
      vendor: entry.vendor,
      credentialRef,
      ...(credential.length === 0 ? {} : { credential }),
      ...(entry.baseURL === undefined || entry.baseURL.length === 0 ? {} : { baseURL: entry.baseURL }),
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
 * through the Service base constructor), register every shipped vendor, then
 * register the Config's user-managed `bindings` and re-register them whenever
 * the Loader commits a live edit, and finally attach the same-origin settings
 * Web route. Every registration is an effect on this fiber, so unloading the
 * plugin withdraws all route bindings and the Web route in one cascade.
 * @param ctx - host context.
 * @param config - resolved deployment config (see {@link Config}).
 */
export function apply(ctx: Context, config: Config): void {
  // 0. The plugin ships its own configuration surface (the Widgets manager's
  //    provider panel, backed by /_dsh/balance/settings), so opt out of the
  //    harness's schema-generated form for this entry. `bindings` being volatile
  //    is what makes the entry form-eligible in 0.1.7, and `configure` throws if
  //    called twice for one plugin instance — hence exactly one effect. Read
  //    through `ctx.get` so a bare mount without the settings service (tests, a
  //    host embedding the plugin) still applies.
  const settings = ctx.get('settings')
  if (settings !== undefined) {
    ctx.effect(() => settings.configure({ auto: false }), 'balance: settings page policy')
  }

  // 1. Capability seam: constructing the runtime registers `ctx.balance`.
  new BalanceRuntime(ctx, { requestTimeoutMs: config.requestTimeoutMs })

  // 2. Shipped vendor providers (they already own their default routes), then
  //    the New API instance for the self-hosted route.
  for (const provider of PROVIDERS) ctx.balance.register(provider)
  ctx.balance.register(new NewApiBalanceProvider({ baseURL: config.newApiBaseURL }))

  // 3. User-managed bindings — the plugin's settings section. `bindings` is a
  //    volatile Config field (see Config): a configuration surface writes it
  //    through ctx.settings.update (./web.ts), the Loader commits the value
  //    into this fiber in place, and `loader/volatile-update` is emitted here,
  //    which is what drives the re-registration. A route already bound by a
  //    shipped provider conflicts ("route already bound"): the offending entry
  //    is skipped with one warning instead of failing the plugin.
  const disposers = new Map<string, () => void>()
  const reconcile = (entries: readonly BindingEntry[]): void => {
    for (const dispose of disposers.values()) dispose()
    disposers.clear()
    for (const binding of readBindings(entries)) {
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
  const currentBindings = (): readonly BindingEntry[] => config.bindings.get()
  reconcile(currentBindings())
  ctx.on('loader/volatile-update', () => { reconcile(currentBindings()) })
  ctx.effect(() => () => {
    for (const dispose of disposers.values()) dispose()
    disposers.clear()
  }, 'balance: settings bindings')

  const backend = new BalanceWebBackend(ctx)
  installBalanceWeb(ctx, backend)
}
