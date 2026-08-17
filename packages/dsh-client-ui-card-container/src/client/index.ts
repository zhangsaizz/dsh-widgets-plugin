/**
 * Card container plugin, browser half:
 *
 *  - one register() call contributes the floating CardContainerWidget into the
 *    shell.overlay list (id `card-container`) and, in the same breath, DECLARES
 *    the `widgets.card` child slot — the compact card-view seat. Widgets (or
 *    this package's built-in views) register card views there keyed by the
 *    widget id, and the container renders each docked widget's card through
 *    `renderSlot('widgets.card', {}, { only: id, fallback })`;
 *  - the controller (injected as the `useContainer` hook) owns the docked
 *    order, the dock shadows that hide the floating panels, and the tray of
 *    available widgets;
 *  - built-in compact card views for the known widgets (token-crit,
 *    session-monitor, balance-generic) are registered into `widgets.card` at a
 *    HIGH priority (10), so a widget package's own card (default priority 0,
 *    lower renders first) wins whenever one exists;
 *  - a configuration panel is registered into the widget manager's
 *    "Configure" dialog (`widgets.config`, id `card-container`).
 *
 * @module @dsh-plugins/client-ui-card-container/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the shell.overlay SlotMap merge from ui-layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `widgets.config` SlotMap merge declared by the widget
// manager (the config panel lives in its "Configure" dialog).
import type {} from '@dsh-plugins/client-ui-widget-manager/client'
import { CardContainerWidget } from './CardContainerWidget.tsx'
import type { CardContainerInject } from './CardContainerWidget.tsx'
import { CardContainerSettings } from './CardContainerSettings.tsx'
import type { CardContainerSettingsInjected } from './CardContainerSettings.tsx'
import { CardContainerController, DOCK_REQUEST_EVENT, UNDOCK_REQUEST_EVENT } from './controller.ts'
import { BalanceCard, SessionMonitorCard, TokenCritCard, cardSpecOf, widgetLabelOf } from './cards.tsx'
import { en, zh } from './locales.ts'
import type { CardContainerKey } from './locales.ts'

export type { CardContainerInject, CardContainerWidgetProps, ColumnSetting } from './CardContainerWidget.tsx'
export type { CardContainerSettingsInjected } from './CardContainerSettings.tsx'
export {
  CardContainerController, DOCK_KEY, GROUPS_KEY, ACTIVE_GROUP_KEY, POS_KEY, SETTINGS_KEY,
  DOCK_REQUEST_EVENT, UNDOCK_REQUEST_EVENT, requestDock, requestUndock,
  readGroups, writeGroups, readActiveGroup, writeActiveGroup, DEFAULT_GROUP,
} from './controller.ts'
export type { ContainerSnapshot, ContainerGroup } from './controller.ts'
export { BalanceCard, SessionMonitorCard, TokenCritCard, widgetName, widgetLabelOf } from './cards.tsx'
// The standard card-view adapter contract: any widget package imports this
// type (plus the SlotMap merge pulled in by the `import type {}` above) to
// opt into providing its own compact card inside the container grid.
export type { WidgetCardProps, CardSpec, WidgetCardComponent } from './cards.tsx'
export type { CardContainerKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dictionary namespace owned by this plugin. */
    'card-container': CardContainerKey
  }
  interface SlotMap {
    /**
     * One widget's compact card view in the card container's grid — the
     * STANDARD ADAPTER CONTRACT for widgets that opt in (see `WidgetCardProps`
     * and the module doc in ./cards.tsx for the full integration guide). List
     * slot: each entry's `id` is the widget id; the container renders a
     * docked widget's card through
     * `renderSlot('widgets.card', {}, { only: widgetId, fallback })`.
     * Declared (and exclusively rendered) by the card-container widget;
     * entries register at the default priority 0, the container's built-in
     * fallback views sit at priority 10.
     *
     * The slot-level `inject` face gives every card a live view of the
     * container (`useContainer` hook over the controller snapshot) plus the
     * `dock` / `undock` verbs — a card can act on the container, e.g. an
     * "open floating view" affordance calls `undock(id)`.
     */
    'widgets.card': {
      kind: 'list'
      scope: 'root'
      inject: CardSlotInject
    }
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'card-container'

/** Slot-level inject face every `widgets.card` entry receives: the live
 *  container snapshot (`useContainer` hook over the controller) and the
 *  dock/undock verbs. A card can read `useContainer` to reflect container
 *  state and call `undock(id)` to restore the floating panel (e.g. an
 *  "open floating view" affordance). */
export interface CardSlotInject {
  hooks: {
    container: CardContainerController
  }
  /** Dock the given widget id (hide floating panel, show its card). */
  dock: (id: string) => void
  /** Undock the given widget id (restore the floating panel). */
  undock: (id: string) => void
}

/** Required services: the slot registry and the locale face. */
export const inject = ['slots', 'locale']

/** Client plugin body: the card container + its built-in card views + config panel. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'card-container: dictionaries')

  const t = ctx.locale.bind(NS)
  const controller = new CardContainerController(ctx)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'card-container',
    order: 20,
    locale: NS,
    inject: (): CardContainerInject => ({
      hooks: { container: controller },
      labelOf: (id) => widgetLabelOf(ctx, id, t),
      specOf: (id) => cardSpecOf(ctx, id),
      dock: (id) => { controller.dock(id) },
      undock: (id) => { controller.undock(id) },
      move: (from, to) => { controller.move(from, to) },
      dockTo: (id, groupId) => { controller.dockTo(id, groupId) },
      setActiveGroup: (id) => { controller.setActiveGroup(id) },
      addGroup: (name) => { controller.addGroup(name) },
      renameGroup: (id, name) => { controller.renameGroup(id, name) },
      removeGroup: (id) => { controller.removeGroup(id) },
    }),
    children: {
      'widgets.card': {
        kind: 'list',
        scope: 'root',
        inject: {
          hooks: { container: controller },
          dock: (id) => { controller.dock(id) },
          undock: (id) => { controller.undock(id) },
        } satisfies CardSlotInject,
      },
    },
  }, CardContainerWidget))

  // Quick-dock from floating panels: a widget's floating header dispatches
  // DOCK_REQUEST_EVENT (see requestDock) to dock itself into this container —
  // decoupled, so the container may be absent (the event is a no-op then).
  const onDockRequest = (event: Event): void => {
    const id = (event as CustomEvent<string>).detail
    if (typeof id === 'string' && id !== '') controller.dock(id)
  }
  // Undock requests come from the widget manager's "移出容器" action (and
  // programmatic callers) — restore the floating panel of a docked widget.
  const onUndockRequest = (event: Event): void => {
    const id = (event as CustomEvent<string>).detail
    if (typeof id === 'string' && id !== '') controller.undock(id)
  }
  try {
    window.addEventListener(DOCK_REQUEST_EVENT, onDockRequest)
    window.addEventListener(UNDOCK_REQUEST_EVENT, onUndockRequest)
  } catch { /* no window */ }
  ctx.effect(() => () => {
    try {
      window.removeEventListener(DOCK_REQUEST_EVENT, onDockRequest)
      window.removeEventListener(UNDOCK_REQUEST_EVENT, onUndockRequest)
    } catch { /* no window */ }
  }, 'card-container: dock/undock request listeners')

  // Built-in compact card views for the known widgets. Registered at priority
  // 10 so a widget package's own card (priority 0) shadows these when present.
  ctx.slots.inject('widgets.card', () => ctx.slots.register({
    name: 'widgets.card',
    id: 'token-crit',
    order: 10,
    priority: 10,
    locale: NS,
  }, TokenCritCard))
  ctx.slots.inject('widgets.card', () => ctx.slots.register({
    name: 'widgets.card',
    id: 'session-monitor',
    order: 20,
    priority: 10,
    locale: NS,
  }, SessionMonitorCard))
  ctx.slots.inject('widgets.card', () => ctx.slots.register({
    name: 'widgets.card',
    id: 'balance',
    order: 30,
    priority: 10,
    locale: NS,
  }, BalanceCard))

  // The config panel: registered only while the widget manager declares the
  // `widgets.config` slot, so installs without the manager simply skip it.
  ctx.slots.inject('widgets.config', () => ctx.slots.register({
    name: 'widgets.config',
    id: 'card-container',
    order: 0,
    inject: (): CardContainerSettingsInjected => ({ t }),
  }, CardContainerSettings))
}
