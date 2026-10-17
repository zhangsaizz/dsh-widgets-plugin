/**
 * Card container configuration as the harness **Plugins page** renders it.
 *
 * The 0.2.1 plugin manager opens a configuration page for each row a bundle
 * declares, through the keyed slot `plugins.row.config` (key:
 * `<bundle package name>#<row id>`). Registering here puts a **Configure**
 * control on our bundle's `ui-card-container` row, so the container options are
 * reachable from the page where plugins are managed — not only from the widgets
 * manager's dialog.
 *
 * The page asks for two views: `summary` (the row's one-liner) and `page` (the
 * form with its own persistence). The panel keeps its existing localStorage
 * store + change-event broadcast (see ./CardContainerSettings.tsx), so the same
 * component serves both surfaces.
 *
 * @module @dsh-plugins/client-ui-card-container/client/RowConfig
 */

import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { CardContainerSettings } from './CardContainerSettings.tsx'
import type { CardContainerSettingsInjected } from './CardContainerSettings.tsx'

/** Package name of the bundle that publishes this plugin's row (see cordis.patch.yml). */
export const WIDGETS_BUNDLE = '@dsh-plugins/dsh-widgets-plugin'
/** Row id the bundle's patch declares for this plugin. */
export const CARD_CONTAINER_ROW_ID = 'ui-card-container'
/** `plugins.row.config` key for this plugin's page: `<bundle>#<row id>`. */
export const CARD_CONTAINER_ROW_CONFIG_KEY = `${WIDGETS_BUNDLE}#${CARD_CONTAINER_ROW_ID}`

/**
 * Render the card container row's configuration on the Plugins page.
 * @param props - page view request plus the injected locale seat.
 * @returns the one-line summary, or the container panel as the page body.
 */
export function CardContainerRowConfig({ view, t }: PluginConfigViewProps & CardContainerSettingsInjected) {
  if (view === 'summary') return <>{t('rowConfigSummary')}</>
  return <CardContainerSettings t={t} />
}
