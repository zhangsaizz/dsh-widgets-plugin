/**
 * Widget manager settings page (`settings.section`, id `widgets`): the
 * project widget list with per-widget Add / Disable controls and a
 * "Configure" dialog.
 *
 * The list is a live projection of the `shell.overlay` ledger (through the
 * controller's `useWidgets` hook): a widget is "installed" when its plugin
 * holds an overlay entry, "enabled" when that entry is the cell winner, and
 * "disabled" when a manager shadow hides it. Widgets that contributed a panel
 * into the manager-declared `widgets.config` child slot get a "Configure"
 * button; clicking it opens a dialog that renders the widget's own config
 * component (`renderSlot('widgets.config', {}, { only: widgetId })`).
 */

import { useEffect, useRef, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WidgetRow } from './controller.ts'
import type { WidgetManagerLocaleKey } from './locales.ts'
import css from './WidgetManagerSettings.module.css'

/** Injected business face: the live widget list source and the toggle verb. */
export interface WidgetManagerSettingsInjected {
  hooks: {
    /** Live projection of the widget rows (bound as the `useWidgets` hook). */
    widgets: HostObservable<readonly WidgetRow[]>
  }
  /** Toggle one widget: enable when disabled, disable when enabled. */
  toggle: (id: string) => void
}

/** Full composed props for the page (runtime + locale + child-slot render + inject shares). */
export type WidgetManagerSettingsProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'widgets'>
  & PropsRenderSlots<'widgets.config'>
  & InjectFace<WidgetManagerSettingsInjected>

/** The widget manager settings page. */
export function WidgetManagerSettings({ t, useWidgets, toggle, renderSlot }: WidgetManagerSettingsProps) {
  const rows = useWidgets(snapshot => snapshot)
  const [openConfig, setOpenConfig] = useState<string | null>(null)
  const configRow = openConfig === null ? undefined : rows.find(row => row.id === openConfig)
  const modalRef = useRef<HTMLDivElement | null>(null)

  // Move focus into the dialog on open so keyboard users land inside it
  // (it is aria-modal; focus should not stay on the page behind it).
  useEffect(() => {
    if (openConfig !== null) modalRef.current?.focus()
  }, [openConfig])

  // Close the dialog when its widget loses the config contribution or gets
  // disabled/unregistered while open (otherwise the body would go empty).
  useEffect(() => {
    if (openConfig !== null && (configRow === undefined || !configRow.hasConfig || !configRow.enabled)) {
      setOpenConfig(null)
    }
  }, [openConfig, configRow])

  // ESC closes the dialog.
  useEffect(() => {
    if (openConfig === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenConfig(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [openConfig])

  return (
    <div className={css.page}>
      <h2 className={css.title}>{t('pageTitle')}</h2>
      <p className={css.subtitle}>{t('pageSubtitle')}</p>
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
              <span className={css[statusView(row).cls]}>{t(statusView(row).key)}</span>
              {row.enabled && row.hasConfig && (
                <button type="button" className={css.configure} onClick={() => { setOpenConfig(row.id) }}>
                  {t('configure')}
                </button>
              )}
              {row.registered
                ? (
                  <button
                    type="button"
                    className={row.enabled ? css.disable : css.enable}
                    onClick={() => { toggle(row.id) }}
                  >
                    {t(row.enabled ? 'close' : 'add')}
                  </button>
                )
                : (
                  <button type="button" className={css.add} disabled title={t('notInstalledHint')}>
                    {t('add')}
                  </button>
                )}
            </div>
          </li>
        ))}
      </ul>
      {openConfig !== null && (
        <div className={css.modalOverlay} onClick={() => { setOpenConfig(null) }}>
          <div className={css.modalMask} />
          <div
            className={css.modal}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            ref={modalRef}
            aria-label={configRow?.nameKey === undefined ? openConfig : t(configRow.nameKey)}
            onClick={(event) => { event.stopPropagation() }}
          >
            <div className={css.modalHeader}>
              <span className={css.modalTitle}>
                {configRow?.nameKey === undefined ? openConfig : t(configRow.nameKey)}
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
    </div>
  )
}

/** One row's status badge: its style key and its localized copy key. A single
 *  projection avoids two parallel functions drifting apart when the status
 *  vocabulary grows. */
function statusView(row: WidgetRow): { cls: 'enabled' | 'disabled' | 'notInstalled'; key: WidgetManagerLocaleKey } {
  if (!row.registered) return { cls: 'notInstalled', key: 'notInstalled' }
  return row.enabled ? { cls: 'enabled', key: 'enabled' } : { cls: 'disabled', key: 'disabled' }
}
