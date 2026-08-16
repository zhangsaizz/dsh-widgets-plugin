/**
 * Session monitor plugin, browser half: one register() call contributes the
 * floating SessionMonitorWidget into the shell.overlay list, and a second one
 * registers its configuration panel into the widget manager's "Configure"
 * dialog (`widgets.config`, id `session-monitor`). The session LIST and
 * running bits ride the standard `useSessions` global prop — the runtime
 * pushes session-list and running-status updates reactively, so the list needs
 * no Host RPC. Only the turn-end REASON table (toast refinement) is polled
 * from the Host status route every few seconds. The jump-to-session verb
 * closes over `ctx.sessions.open`.
 *
 * @module @dsh-plugins/client-ui-session-monitor/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the shell.overlay SlotMap merge from ui-layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `widgets.config` SlotMap merge declared by the widget
// manager (the config panel lives in its "Configure" dialog).
import type {} from '@dsh-plugins/client-ui-widget-manager/client'
import { SessionMonitorWidget } from './SessionMonitorWidget.tsx'
import type { SessionMonitorInject } from './SessionMonitorWidget.tsx'
import { SessionSettings } from './SessionSettings.tsx'
import type { SessionSettingsInjected } from './SessionSettings.tsx'
import { en, zh } from './locales.ts'
import type { SessionMonitorKey } from './locales.ts'

export type { MonitorSettings } from './settings.ts'
export { DEFAULT_SETTINGS, SETTINGS_KEY, POS_KEY, loadSettings, saveSettings } from './settings.ts'
export type { SessionMonitorInject, SessionMonitorWidgetProps } from './SessionMonitorWidget.tsx'
export type { SessionSettingsInjected } from './SessionSettings.tsx'
export type { SessionMonitorKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dictionary namespace owned by this plugin. */
    'session-monitor': SessionMonitorKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'session-monitor'

/**
 * Required services: the slot registry, the client sessions service (for
 * jump-to-session) and the locale face.
 */
export const inject = ['slots', 'sessions', 'locale']

/**
 * Client plugin body: register the floating dashboard and its config panel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-monitor: dictionaries')

  const t = ctx.locale.bind(NS)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'session-monitor',
    order: 90,
    locale: NS,
    inject: (): SessionMonitorInject => ({
      open: (sessionId) => { ctx.sessions.open(sessionId as SessionId) },
    }),
  }, SessionMonitorWidget))

  // The config panel: registered only while the widget manager declares the
  // `widgets.config` slot, so installs without the manager simply skip it.
  ctx.slots.inject('widgets.config', () => ctx.slots.register({
    name: 'widgets.config',
    id: 'session-monitor',
    order: 0,
    inject: (): SessionSettingsInjected => ({ t }),
  }, SessionSettings))
}
