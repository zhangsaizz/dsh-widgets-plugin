/**
 * Widget manager as a tab on the harness **Plugins** page.
 *
 * Harness 0.2.1 adds the root `plugins.tab` slot: any plugin can contribute a
 * page tab next to the official **Installed** tab, and its owner props expose
 * `openPackage(name)` (switch to Installed and open a bundle page) and
 * `install()` (confirmed install). This tab lists THIS project's widgets with
 * the same live projection and enable/disable semantics as the settings page,
 * so the official plugin surface can reach them without hunting through
 * Settings.
 *
 * The tab deliberately does NOT declare the `widgets.config` child slot: the
 * settings page already declares it, and a slot has exactly one declarer.
 * Per-widget configuration therefore stays on the settings page and on the
 * bundle rows' Configure controls; the intro copy points there.
 *
 * @module @dsh-plugins/client-ui-widget-manager/client/PluginsTab
 */

import type { PluginTabProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WidgetRow } from './controller.ts'
import { requestUndock } from './controller.ts'
import type { WidgetManagerLocaleKey } from './locales.ts'
import css from './WidgetManagerSettings.module.css'

/** Bundle whose detail page the tab deep-links to (also the row owner). */
const WIDGETS_BUNDLE = '@dsh-plugins/dsh-widgets-plugin'

/** Injected business face: the same live widget list + toggle verb as the page. */
export interface WidgetsPluginsTabInjected {
  hooks: {
    /** Live projection of the widget rows (bound as the `useWidgets` hook). */
    widgets: HostObservable<readonly WidgetRow[]>
  }
  /** Toggle one widget: enable when disabled, disable when enabled. */
  toggle: (id: string) => void
}

/** Full composed props for the tab (runtime + locale + owner props + inject). */
export type WidgetsPluginsTabProps =
  PropsRuntime<'plugins.tab'>
  & PropsLocale<'widgets'>
  & PluginTabProps
  & InjectFace<WidgetsPluginsTabInjected>

/** The Plugins-page widget tab. */
export function WidgetsPluginsTab({ t, useWidgets, toggle, openPackage }: WidgetsPluginsTabProps) {
  const rows = useWidgets(snapshot => snapshot)
  return (
    <div className={css.page}>
      <div className={css.tabToolbar}>
        <p className={css.subtitle}>{t('pluginsTabIntro')}</p>
        <button type="button" className={css.configure} onClick={() => { openPackage(WIDGETS_BUNDLE) }}>
          {t('openBundlePage')}
        </button>
      </div>
      <ul className={css.list}>
        {rows.map(row => (
          <li key={row.id} className={css.row}>
            <div className={css.main}>
              <span className={css.name}>{row.nameKey === undefined ? row.id : t(row.nameKey)}</span>
              <span className={css.package}>{row.packageName ?? t('unknownPackage')}</span>
              {row.descriptionKey !== undefined && <span className={css.desc}>{t(row.descriptionKey)}</span>}
            </div>
            <div className={css.actions}>
              <span
                className={css[statusView(row).cls]}
                title={row.registered ? undefined : t('notInstalledHint')}
              >
                {t(statusView(row).key)}
              </span>
              {row.registered
                ? (
                  <button
                    type="button"
                    className={row.docked ? css.enable : (row.enabled ? css.disable : css.enable)}
                    onClick={() => {
                      // A docked widget is hidden by the card container, not
                      // disabled here — the action is "undock".
                      if (row.docked) { requestUndock(row.id); return }
                      toggle(row.id)
                    }}
                  >
                    {row.docked ? t('undock') : t(row.enabled ? 'close' : 'add')}
                  </button>
                )
                : (
                  <button type="button" className={css.installGuide} onClick={() => { openPackage(WIDGETS_BUNDLE) }}>
                    {t('installGuide')}
                  </button>
                )}
            </div>
          </li>
        ))}
      </ul>
      <p className={css.tabHint}>{t('pluginsTabHint')}</p>
    </div>
  )
}

/** One row's status badge: its style key and its localized copy key (same
 *  projection as the settings page, kept local so the two surfaces cannot
 *  drift into different status vocabularies). */
function statusView(row: WidgetRow): { cls: 'enabled' | 'disabled' | 'notInstalled' | 'docked'; key: WidgetManagerLocaleKey } {
  if (row.docked) return { cls: 'docked', key: 'docked' }
  if (!row.registered) return { cls: 'notInstalled', key: 'notInstalled' }
  return row.enabled ? { cls: 'enabled', key: 'enabled' } : { cls: 'disabled', key: 'disabled' }
}
