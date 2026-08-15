/** Package-owned invariant companion. @module @dsh-plugins/balance/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-plugins/balance'

/** Cordis companion plugin name. */
export const name = 'balance-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the balance registry has one private writer
 * ({@link BalanceRuntime.register}/{@link BalanceRuntime.query}), route
 * uniqueness and provider metadata are enforced all-or-nothing at
 * registration, and the credential value never crosses a log or wire surface,
 * so no second authority exists to check at runtime.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['balance'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
