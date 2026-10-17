/**
 * Widget manager plugin, browser half: one `plugins.tab` registration (id
 * "widgets") contributes a "Widgets" tab to the harness Plugins page, whose
 * controller enables / disables the `shell.overlay` widgets at runtime (shadow
 * entries win the widget cells while disabled). State persists to localStorage
 * and reconciles against the live overlay ledger.
 *
 * The tab also DECLARES the `widgets.config` child slot: a widget's own package
 * registers its configuration panel there (keyed by the widget id), and the tab
 * opens it in a dialog through a "Configure" button on the matching row. Widget
 * management therefore lives entirely inside the plugin surface — it is not a
 * Settings page, and its per-widget configuration is not a separate
 * settings-menu page either.
 *
 * @module @dsh-plugins/client-ui-widget-manager/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell.overlay SlotMap merge from ui-layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the `ctx.slots` (SlotRegistry) Context merge from ui-renderer.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `plugins.tab` SlotMap merge from the harness plugin manager.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { WidgetManagerController } from './controller.ts'
import { WidgetsPluginsTab } from './PluginsTab.tsx'
import type { WidgetsPluginsTabInjected } from './PluginsTab.tsx'
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
 * Client plugin body: the widget list tab on the Plugins page and its controller.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'widget-manager: dictionaries')

  const t = ctx.locale.bind(NS)
  const controller = new WidgetManagerController(ctx)

  // The widget list as a tab on the harness **Plugins** page (`plugins.tab`
  // list slot). `label` names the tab; the slot's owner props add `openPackage`
  // so the tab can deep-link to this bundle's detail page. The tab DECLARES
  // `widgets.config` — a slot has exactly one declarer — so the per-widget
  // configuration panels other packages contribute render in this tab's
  // Configure dialog.
  ctx.slots.inject('plugins.tab', () => ctx.slots.register({
    name: 'plugins.tab',
    id: 'widgets',
    order: 50,
    label: () => t('pluginsTabLabel'),
    locale: NS,
    inject: (): WidgetsPluginsTabInjected => ({
      hooks: { widgets: controller },
      toggle: (id) => { controller.toggle(id) },
    }),
    children: {
      'widgets.config': { kind: 'list', scope: 'root' },
    },
  }, WidgetsPluginsTab))
}
