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
  /** Locale key of the widget's display name. */
  nameKey: keyof WidgetManagerLocaleKey
  /** Locale key of the widget's one-line description. */
  descriptionKey: keyof WidgetManagerLocaleKey
}

/** Every widget this project ships, in display order. */
export const WIDGET_CATALOG: readonly WidgetDescriptor[] = [
  {
    id: 'balance',
    packageName: '@dsh-plugins/client-ui-balance',
    nameKey: 'balanceName',
    descriptionKey: 'balanceDescription',
  },
  {
    id: 'token-crit',
    packageName: '@dsh-plugins/client-ui-token-crit',
    nameKey: 'tokenCritName',
    descriptionKey: 'tokenCritDescription',
  },
]

/** The overlay ids the catalog knows about (used to tag manager shadows). */
export const CATALOG_IDS: ReadonlySet<string> = new Set(WIDGET_CATALOG.map((entry) => entry.id))
