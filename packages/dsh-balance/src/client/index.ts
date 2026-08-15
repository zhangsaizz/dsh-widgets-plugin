/**
 * Balance capability seam, client half: mounts the generated balance Remote
 * (`balance/query` + `balance/list`) into the client `remote` service so
 * consumers such as the web dashboard can resolve `remote.balance` without the
 * host api-remotes assembly hardcoding the contribution.
 *
 * @module @dsh-plugins/balance/client
 */

import { TYPERT_REMOTE } from '../../lib/typert.remote-client.js'

/** Required service: the typed Client Remote contribution mount. */
export const inject = ['remote']

/**
 * Mount the balance Remote contribution; the returned disposer withdraws it
 * when this plugin's client fiber is disposed.
 * @param ctx - client root context carrying the `remote` mount service.
 * @returns the disposer removing the mounted Remote namespace.
 */
export async function apply(ctx) {
  const dispose = await ctx.remote.$mount(TYPERT_REMOTE)
  return async () => {
    await dispose()
  }
}
