/**
 * Balance plugin, browser half: mounts the generated balance Remote
 * (`balance/query` + `balance/list`) into the client `remote` service, then
 * registers the floating BalanceWidget into the shell.overlay list, seats the
 * view-settings store (zoom/dock/collapse), and injects the BalanceController
 * as a bound useBalance hook plus a manual refresh verb. The balance providers
 * config panel is registered into the widget manager's "Configure" dialog
 * (`widgets.config` slot), not into the settings menu.
 *
 * `remote.balance` is provided by this same apply (via `$mount`), so it is
 * read after the mount. It is deliberately NOT listed in `inject`: cordis
 * resolves declared injects along the fiber parent chain at load time, and
 * this plugin's own `$mount` contribution lives in a sibling fiber — declaring
 * `remote.balance` would stall the plugin as inactive instead of making the
 * property resolvable. The store lookup uses `ctx.get('remote.balance')`
 * (isolate-keyed, no inject requirement), which returns the same namespace
 * service object `ctx.remote.balance` would expose.
 *
 * @module @dsh-plugins/balance/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the generated balance Remote namespace and the ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell.overlay SlotMap merge from ui-layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `widgets.config` SlotMap merge declared by the widget
// manager (the config panel lives in its "Configure" dialog, not in the
// settings menu).
import type {} from '@dsh-plugins/client-ui-widget-manager/client'
import { TYPERT_REMOTE } from '../../lib/typert.remote-client.js'
import { BalanceController } from './controller.ts'
import type { BalanceRemote, ModelDirectoriesLike } from './controller.ts'
import { BalanceWidget } from './BalanceWidget.tsx'
import type { BalanceInject } from './BalanceWidget.tsx'
import { BalanceSettings } from './BalanceSettings.tsx'
import type { BalanceSettingsInjected } from './BalanceSettings.tsx'
import { createBalanceViewStore } from './store.ts'
import { en, zh } from './locales.ts'
import type { BalanceKey } from './locales.ts'

export type { BalanceController, BalancePhase, BalanceRemote, BalanceViewState, ModelDirectoriesLike } from './controller.ts'
export type { BalanceInject, BalanceWidgetProps } from './BalanceWidget.tsx'
export type { BalanceSettingsInjected } from './BalanceSettings.tsx'
export type { BalanceKey } from './locales.ts'
export { createBalanceViewStore } from './store.ts'
export type { BalanceViewSettings, DockCorner } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dictionary namespace owned by this plugin. */
    balance: BalanceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'balance'

/** Fixed periodic refresh interval; settings-controlled interval is deferred work. */
export const REFRESH_INTERVAL_MS = 30_000

/**
 * Required services: the Remote mount service, overlay slots, sessions,
 * connection, and copy. `remote.balance` is intentionally absent: it is
 * provided by this same apply via `$mount`, and cordis would treat a declared
 * inject of it as an unmet dependency (see the module header).
 */
export const inject = ['remote', 'slots', 'sessions', 'connection', 'locale']

/**
 * Client plugin body: mount the balance Remote first so `ctx.remote.balance`
 * is available, then the floating dashboard, its object layer and the config
 * panel. The Host answers balance/query; the controller follows the current
 * session + model and refreshes on a fixed interval.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  ctx.effect(() => () => { void disposeRemote() }, 'balance: remote mount')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'balance: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const t = ctx.locale.bind(NS)
  const controller = new BalanceController(
    ctx.get('remote.balance') as BalanceRemote,
    ctx.sessions,
    connection.api.sessions,
    ctx.get('modelDirectories') as ModelDirectoriesLike | undefined,
    REFRESH_INTERVAL_MS,
  )

  ctx.effect(() => {
    const disposeRegistration = ctx.slots.register({
      name: 'shell.overlay',
      id: 'balance',
      order: 100,
      store: createBalanceViewStore,
      locale: NS,
      inject: (): BalanceInject => ({
        hooks: { balance: controller },
        refresh: () => { void controller.refresh() },
      }),
    }, BalanceWidget)
    return () => {
      disposeRegistration()
      controller.dispose()
    }
  }, 'balance: widget registration')

  // The Balance providers config panel. It lives in the widget manager's
  // "Configure" dialog (`widgets.config` slot, declared by
  // @dsh-plugins/client-ui-widget-manager) rather than as a settings-menu
  // page: registered only while the manager declares the slot, so installs
  // without the manager simply skip it (config then requires the manager —
  // the recommended install is the bundle).
  ctx.slots.inject('widgets.config', () => ctx.slots.register({
    name: 'widgets.config',
    id: 'balance',
    order: 0,
    inject: (): BalanceSettingsInjected => ({ t }),
  }, BalanceSettings))
}
