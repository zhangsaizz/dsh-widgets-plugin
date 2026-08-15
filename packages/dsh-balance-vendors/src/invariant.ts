/** Package-owned invariant companion. @module @dsh-plugins/balance-vendors/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-plugins/balance-vendors'

/** Cordis companion plugin name. */
export const name = 'balance-vendors-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: each provider is a stateless HTTP fetch + pure
 * normalization with no shared mutable state, route binding and uniqueness are
 * owned by the balance runtime, and the credential value never reaches a log
 * or error message, so no second authority exists to check at runtime.
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
