/**
 * Balance configuration as the harness **Plugins page** renders it.
 *
 * Harness 0.1.7 ships an official plugin manager whose bundle detail page opens
 * a configuration page for each row a bundle declares, through the keyed slot
 * `plugins.row.config` (key: `<bundle package name>#<row id>`). Registering here
 * is what puts a **Configure** control on our bundle's `balance` row, so the
 * provider panel is reachable from where users now manage installed plugins —
 * not only from the widgets manager's dialog.
 *
 * The page asks for two views: `summary` (the row's one-liner, also the fallback
 * when a row has no description) and `page` (the form with its own save
 * control). The page also offers `form`, the host-owned values plus `mutate` for
 * a generic settings form; this panel deliberately ignores it and keeps its own
 * persistence — the plugin's same-origin `/_dsh/balance/settings` route, which is
 * where the credential redaction and the revision guard live. The slot contract
 * types `form` as optional for exactly this reason, and the page draws the title
 * and crumb around what we render.
 *
 * The registration KEY names our bundle package and the row id our bundle's patch
 * declares (`bundles/dsh-widgets-plugin/cordis.patch.yml`). A mount outside that
 * bundle (a profile patch inserting `@dsh-plugins/balance` directly, say) is not
 * listed as a bundle there at all, so it simply gets no page entry.
 *
 * @module @dsh-plugins/balance/client/RowConfig
 */

import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { BalanceSettings } from './BalanceSettings.tsx'
import type { BalanceSettingsInjected } from './BalanceSettings.tsx'

/** Package name of the bundle that publishes this plugin's row (see cordis.patch.yml). */
export const WIDGETS_BUNDLE = '@dsh-plugins/dsh-widgets-plugin'
/** Row id the bundle's patch declares for this plugin (also its settings namespace). */
export const BALANCE_ROW_ID = 'balance'
/** `plugins.row.config` key for this plugin's page: `<bundle>#<row id>`. */
export const BALANCE_ROW_CONFIG_KEY = `${WIDGETS_BUNDLE}#${BALANCE_ROW_ID}`

/**
 * Render the balance row's configuration on the Plugins page.
 * @param props - page view request plus the injected locale seat.
 * @returns the one-line summary, or the provider panel as the page body.
 */
export function BalanceRowConfig({ view, t }: PluginConfigViewProps & BalanceSettingsInjected) {
  if (view === 'summary') return <>{t('rowConfigSummary')}</>
  return <BalanceSettings t={t} />
}
