/**
 * Balance capability seam, Service Definition and runtime half: the
 * `ctx.balance` service binds LLM provider routes to vendor balance
 * providers and answers balance queries over the generated `balance/query`
 * Remote. Concrete vendors live in `@dsh-plugins/balance-vendors`; the
 * Web dashboard lives in `@dsh-plugins/client-ui-balance`.
 *
 * @module @dsh-plugins/balance
 */

export type * from './types.ts'
export { BalanceProvider } from './provider.ts'
export type { BalanceAccountData, BalanceProviderInfo } from './provider.ts'
export { BalanceRuntime, default } from './runtime.ts'
export type { Config } from './runtime.ts'
