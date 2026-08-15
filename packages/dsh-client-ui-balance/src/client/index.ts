/**
 * Balance dashboard plugin, browser half: one register() call contributes the
 * floating BalanceWidget into the shell.overlay list, seats the view-settings
 * store (zoom/dock/collapse), and injects the BalanceController as a bound
 * useBalance hook plus a manual refresh verb. The Host answers balance/query;
 * this controller follows the current session + model and refreshes on a fixed
 * interval.
 *
 * @module @dsh-plugins/client-ui-balance/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the generated balance Remote namespace and the ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell.overlay SlotMap merge from ui-layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings.section SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { BalanceController } from './controller.ts'
import type { ModelDirectoriesLike } from './controller.ts'
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

/** Required services: slots, sessions, the balance Remote, connection, and copy. */
export const inject = ['slots', 'sessions', 'remote', 'remote.balance', 'connection', 'locale']

/**
 * Client plugin body: the floating balance dashboard and its object layer.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-balance: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const t = ctx.locale.bind(NS)
  const controller = new BalanceController(
    ctx.remote.balance,
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
  }, 'ui-balance: widget registration')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'balance',
    order: 20,
    label: () => t('settingsNav'),
    inject: (): BalanceSettingsInjected => ({ t }),
  }, BalanceSettings))
}
