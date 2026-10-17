/**
 * Widget manager as a tab on the harness **Plugins** page (`plugins.tab`,
 * id `widgets`).
 *
 * Harness 0.2.1 adds the root `plugins.tab` slot: any plugin can contribute a
 * page tab next to the official **Installed** tab, and its owner props expose
 * `openPackage(name)` (switch to Installed and open a bundle page) and
 * `install()` (confirmed install). This tab is the ONLY management surface for
 * this project's widgets — the Settings page it used to share the list with is
 * gone, so it owns everything: the live widget list (through the controller's
 * `useWidgets` hook), enable/disable (a shadow entry wins the cell instead of
 * unmounting anything), the "Configure" dialog, the install guide, and the
 * bundle deep link.
 *
 * The list is a live projection of the `shell.overlay` ledger: a widget is
 * "installed" when its plugin holds an overlay entry, "enabled" when that
 * entry is the cell winner, and "disabled" when a manager shadow hides it.
 * Widgets that contributed a panel into the `widgets.config` child slot this
 * registration declares get a "Configure" button; clicking it opens a dialog
 * that renders the widget's own config component
 * (`renderSlot('widgets.config', {}, { only: widgetId })`).
 *
 * The install guide only shows the steps that apply to the hosting shell
 * (./environment.ts): the profile name and the restart procedure differ between
 * the Web app and the official Electron desktop.
 *
 * @module @dsh-plugins/client-ui-widget-manager/client/PluginsTab
 */

import { useEffect, useRef, useState } from 'react'
import type { PluginTabProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {
  HostObservable,
  InjectFace,
  PropsLocale,
  PropsRenderSlots,
  PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { WidgetRow } from './controller.ts'
import { requestUndock } from './controller.ts'
import type { WidgetManagerLocaleKey } from './locales.ts'
import { detectEnvironment } from './environment.ts'
import css from './PluginsTab.module.css'

/** Bundle whose detail page the tab deep-links to (also the row owner). */
const WIDGETS_BUNDLE = '@dsh-plugins/dsh-widgets-plugin'

/** Injected business face: the live widget list source and the toggle verb. */
export interface WidgetsPluginsTabInjected {
  hooks: {
    /** Live projection of the widget rows (bound as the `useWidgets` hook). */
    widgets: HostObservable<readonly WidgetRow[]>
  }
  /** Toggle one widget: enable when disabled, disable when enabled. */
  toggle: (id: string) => void
}

/** Full composed props for the tab (runtime + locale + owner props + child-slot render + inject). */
export type WidgetsPluginsTabProps =
  PropsRuntime<'plugins.tab'>
  & PropsLocale<'widgets'>
  & PropsRenderSlots<'widgets.config'>
  & PluginTabProps
  & InjectFace<WidgetsPluginsTabInjected>

/** The Plugins-page widget tab. */
export function WidgetsPluginsTab({ t, useWidgets, toggle, openPackage, renderSlot }: WidgetsPluginsTabProps) {
  const rows = useWidgets(snapshot => snapshot)
  /** The install guide's profile name and restart procedure are per-shell; the
   *  tab only runs in a browser-style shell, so anything that is not the
   *  official desktop is served the Web variant. */
  const officialDesktop = detectEnvironment() === 'official-desktop'
  const [openConfig, setOpenConfig] = useState<string | null>(null)
  const [openInstall, setOpenInstall] = useState<string | null>(null)
  const configRow = openConfig === null ? undefined : rows.find(row => row.id === openConfig)
  const installRow = openInstall === null ? undefined : rows.find(row => row.id === openInstall)
  /** Dialog title of the CONFIGURE dialog. It reads the row defensively: the
   *  row can vanish in the very render where its widget unloads (the close
   *  effect below runs after the commit, not before it), and a title must not
   *  throw on the way out. Falls back to the raw widget id. */
  const configTitle = (configRow?.nameKey === undefined ? openConfig : t(configRow.nameKey)) ?? undefined
  const modalRef = useRef<HTMLDivElement | null>(null)
  const installModalRef = useRef<HTMLDivElement | null>(null)

  // Move focus into a dialog on open so keyboard users land inside it
  // (it is aria-modal; focus should not stay on the page behind it).
  useEffect(() => {
    if (openConfig !== null) modalRef.current?.focus()
  }, [openConfig])
  useEffect(() => {
    if (openInstall !== null) installModalRef.current?.focus()
  }, [openInstall])

  // Close the dialog when its widget loses the config contribution or gets
  // DISABLED / unregistered while open (otherwise the body would go empty).
  // Docking is NOT a disable: a docked widget keeps its config reachable.
  useEffect(() => {
    if (openConfig !== null && (configRow === undefined || !configRow.hasConfig || (!configRow.enabled && !configRow.docked))) {
      setOpenConfig(null)
    }
  }, [openConfig, configRow])

  // Close the install guide as soon as the widget actually mounts (or its row
  // disappears) — the guide's steps are moot the moment it becomes operable.
  useEffect(() => {
    if (openInstall !== null && (installRow === undefined || installRow.registered)) {
      setOpenInstall(null)
    }
  }, [openInstall, installRow])

  // ESC closes whichever dialog is open.
  useEffect(() => {
    if (openConfig === null && openInstall === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenConfig(null)
        setOpenInstall(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [openConfig, openInstall])

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
              {row.hasConfig && <span className={css.configNote}>{t('configNote')}</span>}
            </div>
            <div className={css.actions}>
              <span
                className={css[statusView(row).cls]}
                title={row.registered ? undefined : t('notInstalledHint')}
              >
                {t(statusView(row).key)}
              </span>
              {/* Configure stays reachable while DOCKED (a dock is not a
                  disable) — only a real disable/unregister hides it. */}
              {(row.enabled || row.docked) && row.hasConfig && (
                <button type="button" className={css.configure} onClick={() => { setOpenConfig(row.id) }}>
                  {t('configure')}
                </button>
              )}
              {row.registered
                ? (
                  <button
                    type="button"
                    className={row.docked ? css.enable : (row.enabled ? css.disable : css.enable)}
                    onClick={() => {
                      // A docked widget is hidden by the CARD CONTAINER, not
                      // disabled here — the action is "undock" (the container
                      // listens for the request and restores the floating
                      // panel), never a local re-enable.
                      if (row.docked) { requestUndock(row.id); return }
                      toggle(row.id)
                    }}
                  >
                    {row.docked ? t('undock') : t(row.enabled ? 'close' : 'add')}
                  </button>
                )
                : (
                  <button type="button" className={css.installGuide} onClick={() => { setOpenInstall(row.id) }}>
                    {t('installGuide')}
                  </button>
                )}
            </div>
          </li>
        ))}
      </ul>
      <p className={css.tabHint}>{t('pluginsTabHint')}</p>
      {openConfig !== null && (
        <div className={css.modalOverlay} onClick={() => { setOpenConfig(null) }}>
          <div className={css.modalMask} />
          <div
            className={css.modal}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            ref={modalRef}
            aria-label={configTitle}
            onClick={(event) => { event.stopPropagation() }}
          >
            <div className={css.modalHeader}>
              <span className={css.modalTitle}>
                {configTitle}
              </span>
              <button type="button" className={css.modalClose} aria-label={t('closeDialog')} onClick={() => { setOpenConfig(null) }}>
                ×
              </button>
            </div>
            <div className={css.modalBody}>
              {renderSlot('widgets.config', {}, { only: openConfig })}
            </div>
          </div>
        </div>
      )}
      {openInstall !== null && (
        <div className={css.modalOverlay} onClick={() => { setOpenInstall(null) }}>
          <div className={css.modalMask} />
          <div
            className={css.modal}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            ref={installModalRef}
            aria-label={t('installGuideTitle')}
            onClick={(event) => { event.stopPropagation() }}
          >
            <div className={css.modalHeader}>
              <span className={css.modalTitle}>
                {installRow?.nameKey === undefined ? openInstall : t(installRow.nameKey)} · {t('installGuideTitle')}
              </span>
              <button type="button" className={css.modalClose} aria-label={t('closeDialog')} onClick={() => { setOpenInstall(null) }}>
                ×
              </button>
            </div>
            <div className={css.modalBody}>
              {installRow !== undefined && installRow.packageName !== undefined && (
                <>
                  <p className={css.guideIntro}>{t('installGuideIntro')}</p>
                  <div className={css.guideStep}>
                    <span className={css.guideStepTitle}>{t('installStep1')}</span>
                    <p className={css.guideNote}>
                      {t(officialDesktop ? 'installStep1NoteDesktop' : 'installStep1NoteWeb')}
                    </p>
                    <code className={css.codeBlock}>{`dsh plugin --profile ${officialDesktop ? 'desktop' : '<name>'} add ${installRow.packageName}`}</code>
                  </div>
                  <div className={css.guideStep}>
                    <span className={css.guideStepTitle}>{t('installStep2')}</span>
                    <p className={css.guideNote}>{t('installStep2Note')}</p>
                    <pre className={css.codeBlock}>{`- insert:\n    - id: ${installRow.installRowId ?? installRow.id}\n      name: "${installRow.packageName}"`}</pre>
                    <p className={css.patchNote}>{t('installPatchNote')}</p>
                  </div>
                  <div className={css.guideStep}>
                    <span className={css.guideStepTitle}>{t('installStep3')}</span>
                    <p className={css.guideNote}>
                      {t(officialDesktop ? 'installStep3NoteDesktop' : 'installStep3NoteWeb')}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** One row's status badge: its style key and its localized copy key. A single
 *  projection avoids two parallel functions drifting apart when the status
 *  vocabulary grows. Docked wins over the generic disabled look — it IS
 *  hidden, but by the card container, and the row action is "undock". */
function statusView(row: WidgetRow): { cls: 'enabled' | 'disabled' | 'notInstalled' | 'docked'; key: WidgetManagerLocaleKey } {
  if (row.docked) return { cls: 'docked', key: 'docked' }
  if (!row.registered) return { cls: 'notInstalled', key: 'notInstalled' }
  return row.enabled ? { cls: 'enabled', key: 'enabled' } : { cls: 'disabled', key: 'disabled' }
}
