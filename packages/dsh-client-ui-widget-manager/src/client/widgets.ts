/**
 * Static catalog of the project widgets the manager page lists. Each entry
 * names the `shell.overlay` registration id of a widget and its localized
 * copy keys (the dictionaries live in ./locales.ts, namespace `widgets`).
 * Widgets not present in this catalog but registered into the overlay are
 * listed generically so the page always mirrors the live ledger.
 *
 * @module @dsh-plugins/client-ui-widget-manager/client/widgets
 */

import type { WidgetManagerLocaleKey } from './locales.ts'

/** One widget the manager knows how to present. */
export interface WidgetDescriptor {
  /** The `shell.overlay` list id the widget registers with. */
  id: string
  /** The npm package that ships the widget. */
  packageName: string
  /** Composition row id used when MOUNTING the plugin (`cordis.yml` / the
   *  bundle's `cordis.patch.yml`). Most widgets mount under a different id
   *  than their overlay id (e.g. `ui-token-crit` vs `token-crit`); defaults
   *  to `id` when omitted. Drives the install-guide dialog's mount snippet. */
  installRowId?: string
  /** Locale key of the widget's display name. */
  nameKey: WidgetManagerLocaleKey
  /** Locale key of the widget's one-line description. */
  descriptionKey: WidgetManagerLocaleKey
  /** Non-overlay widgets (e.g. the rainbow-flow input decor) that only ship a
   *  config panel: they appear in the list with a "Configure" action but no
   *  Add/Disable toggle (the overlay-shadow mechanism does not apply to them).
   *  Defaults to false (a normal overlay widget). */
  configOnly?: boolean
}

/** Every widget this project ships, in display order. */
export const WIDGET_CATALOG: readonly WidgetDescriptor[] = [
  {
    id: 'balance',
    packageName: '@dsh-plugins/balance',
    nameKey: 'balanceName',
    descriptionKey: 'balanceDescription',
  },
  {
    id: 'token-crit',
    packageName: '@dsh-plugins/client-ui-token-crit',
    // The bundle mounts this widget under `ui-token-crit` (overlay id `token-crit`).
    installRowId: 'ui-token-crit',
    nameKey: 'tokenCritName',
    descriptionKey: 'tokenCritDescription',
  },
  {
    id: 'session-monitor',
    packageName: '@dsh-plugins/client-ui-session-monitor',
    installRowId: 'ui-session-monitor',
    nameKey: 'sessionMonitorName',
    descriptionKey: 'sessionMonitorDescription',
  },
  {
    id: 'card-container',
    packageName: '@dsh-plugins/client-ui-card-container',
    installRowId: 'ui-card-container',
    nameKey: 'cardContainerName',
    descriptionKey: 'cardContainerDescription',
  },
  {
    // The rainbow-flow input decor is not an overlay widget: it registers
    // into `conversation.input.left`/`.right` and a `widgets.config` panel.
    // The manager lists it so the panel is reachable, with no Add/Disable
    // toggle (the overlay-shadow disable mechanism does not apply).
    id: 'rainbow-flow',
    packageName: '@dsh-plugins/client-ui-rainbow-flow',
    installRowId: 'ui-rainbow-flow',
    nameKey: 'rainbowFlowName',
    descriptionKey: 'rainbowFlowDescription',
    configOnly: true,
  },
]
