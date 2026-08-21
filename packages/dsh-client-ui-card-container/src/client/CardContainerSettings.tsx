/**
 * Configuration panel for the card container widget, registered into the
 * widget manager's "Configure" dialog (`widgets.config`, id `card-container`).
 * Self-contained: it reads/writes the same localStorage keys as the widget
 * (via ./controller.ts) and announces changes so a mounted container re-reads
 * them live. Localized through the injected `t` seat.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  ACTIVE_GROUP_KEY, GROUPS_KEY, POS_KEY, SETTINGS_CHANGED_EVENT, SETTINGS_KEY,
  loadColumns, readActiveGroup, readGroups, saveColumns, writeGroups,
} from './controller.ts'
import type { ColumnSetting } from './controller.ts'
import css from './CardContainerSettings.module.css'

/** Injected face: just the locale seat. */
export interface CardContainerSettingsInjected {
  t: TranslateNS<'card-container'>
}

/** One settings row: label + optional hint + control. */
function Row(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <span className={css.label}>{props.label}</span>
        {props.hint ? <span className={css.hint}>{props.hint}</span> : null}
      </div>
      <div className={css.control}>{props.children}</div>
    </div>
  )
}

export function CardContainerSettings({ t }: CardContainerSettingsInjected) {
  const [columns, setColumns] = useState<ColumnSetting>(loadColumns)

  function updateColumns(next: ColumnSetting): void {
    setColumns(next)
    saveColumns(next)
    try {
      window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT))
    } catch { /* events */ }
  }

  function clearDocked(): void {
    // Clear the ACTIVE group's docked list (the controller releases the
    // shadows on the change event).
    try {
      const groups = readGroups()
      const active = readActiveGroup(groups)
      const group = groups[active]
      if (group) group.docked = []
      writeGroups(groups)
      window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT))
    } catch { /* storage / events */ }
  }

  /** Reset the whole container (position + groups + settings) — the mounted
   *  widget re-reads everything on the change event. */
  function resetAll(): void {
    try {
      window.localStorage.removeItem(POS_KEY)
      window.localStorage.removeItem(GROUPS_KEY)
      window.localStorage.removeItem(ACTIVE_GROUP_KEY)
      window.localStorage.removeItem(SETTINGS_KEY)
      window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT))
    } catch { /* storage / events */ }
    setColumns('auto')
  }

  return (
    <div className={css.panel}>
      <Row label={t('columnsLabel')}>
        <select
          value={columns}
          onChange={(e) => updateColumns(e.target.value as ColumnSetting)}
        >
          <option value="auto">{t('columnsAuto')}</option>
          <option value="2">{t('columns2')}</option>
          <option value="3">{t('columns3')}</option>
          <option value="4">{t('columns4')}</option>
        </select>
      </Row>
      <div className={css.actions}>
        <button className={css.resetBtn} onClick={clearDocked}>{t('resetDocked')}</button>
        <button className={css.resetBtn} onClick={resetAll}>{t('resetAll')}</button>
      </div>
    </div>
  )
}
