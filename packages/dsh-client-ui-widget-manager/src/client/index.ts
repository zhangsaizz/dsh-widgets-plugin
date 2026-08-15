/**
 * Widget manager plugin, browser half: one `settings.section` registration
 * (`id` "widgets") contributes the project widget list page, whose controller
 * enables / disables the `shell.overlay` widgets at runtime (shadow entries
 * win the widget cells while disabled). State persists to localStorage and
 * reconciles against the live overlay ledger.
 *
 * The section also DECLARES the `widgets.config` child slot: a widget's own
 * package registers its configuration panel there (keyed by the widget id),
 * and the manager page opens it in a dialog through a "Configure" button on
 * the matching row. Widget config therefore lives with the widget in the
 * manager — not as a separate settings-menu page.
 *
 * @module @dsh-plugins/client-ui-widget-manager/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the shell.overlay SlotMap merge from ui-layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the settings.section SlotMap merge from ui-settings.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { WidgetManagerController } from './controller.ts'
import { WidgetManagerSettings } from './WidgetManagerSettings.tsx'
import type { WidgetManagerSettingsInjected } from './WidgetManagerSettings.tsx'
import { en, zh } from './locales.ts'
import type { WidgetManagerLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dictionary namespace owned by this plugin. */
    widgets: WidgetManagerLocaleKey
  }
  interface SlotMap {
    /**
     * One widget's configuration panel, contributed by the widget's own
     * package into the manager's "Configure" dialog. List slot: each entry's
     * `id` is the widget id; the manager renders a row's config through
     * `renderSlot('widgets.config', {}, { only: widgetId })`.
     */
    'widgets.config': {
      kind: 'list'
      scope: 'root'
    }
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'widgets'

/** Required services: the slot registry and the locale face. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: the widget manager settings page and its controller.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'widget-manager: dictionaries')

  const t = ctx.locale.bind(NS)
  const controller = new WidgetManagerController(ctx)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'widgets',
    order: 10,
    label: () => t('navLabel'),
    locale: NS,
    inject: (): WidgetManagerSettingsInjected => ({
      hooks: { widgets: controller },
      toggle: (id) => { controller.toggle(id) },
    }),
    children: {
      'widgets.config': { kind: 'list', scope: 'root' },
    },
  }, WidgetManagerSettings))
}
