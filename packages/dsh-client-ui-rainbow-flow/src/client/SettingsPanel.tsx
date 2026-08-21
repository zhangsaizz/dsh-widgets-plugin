/**
 * Configuration panel for the rainbow flow, registered into the widget
 * manager's "Configure" dialog (`widgets.config`, id `rainbow-flow`).
 *
 * Self-contained: reads/writes the same settings store as the glow
 * (`./settings.ts`), so changes apply live to a mounted effect without a
 * reload. Knobs:
 *  - opacity      — overall effect opacity.
 *  - speed        — token-rate sensitivity (breathing rhythm follows output rate).
 *  - mood         — thinking/tool cool-shift palette.
 *  - commandColor — whether command cards are coloured by category.
 *  - commandSweep — whether a running command's text is swept by a rainbow.
 *  - toolColors   — per-category command-card text accent colours (a swatch
 *                   per command class, each with a per-row reset).
 * Localized through the injected `t` seat (`rainbow-flow` namespace).
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './SettingsPanel.module.css'
import {
  DEFAULT_TOOL_COLORS,
  OPACITY_OPTIONS,
  SPEED_OPTIONS,
  loadSettings,
  saveSettings,
  type RainbowFlowSettings,
} from './settings'
import { CATEGORY_LABELS, TOOL_CATEGORIES } from './classify'
import type { ToolCategory } from './classify'

/** Injected face: the locale seat of the `rainbow-flow` namespace. */
export interface RainbowFlowSettingsInjected {
  t: TranslateNS<'rainbow-flow'>
}

/** Bilingual category name for a colour row (resolved from the document lang). */
function categoryLabel(category: ToolCategory): string {
  const lang = (document.documentElement.lang || '').toLowerCase()
  return lang.startsWith('zh') ? CATEGORY_LABELS[category].zh : CATEGORY_LABELS[category].en
}

/** One settings row: label + optional hint + control. */
function Row(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.label}>{props.label}</span>
        {props.hint ? <span className={styles.hint}>{props.hint}</span> : null}
      </div>
      <div className={styles.control}>{props.children}</div>
    </div>
  )
}

export function RainbowFlowSettings({ t }: RainbowFlowSettingsInjected): React.JSX.Element {
  const [settings, setSettings] = useState<RainbowFlowSettings>(loadSettings)

  function update(patch: Partial<RainbowFlowSettings>): void {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }

  function reset(): void {
    const next: RainbowFlowSettings = {
      opacity: 1,
      speed: 1,
      mood: true,
      commandColor: true,
      commandSweep: true,
      toolColors: { ...DEFAULT_TOOL_COLORS },
    }
    setSettings(next)
    saveSettings(next)
  }

  return (
    <div className={styles.panel}>
      <Row label={t('opacityLabel')} hint={t('opacityHint')}>
        <select
          className={styles.select}
          value={settings.opacity}
          onChange={(e) => update({ opacity: Number(e.target.value) })}
        >
          {OPACITY_OPTIONS.map((o) => <option key={o} value={o}>{Math.round(o * 100)}{t('percent')}</option>)}
        </select>
      </Row>
      <Row label={t('speedLabel')} hint={t('speedHint')}>
        <select
          className={styles.select}
          value={settings.speed}
          onChange={(e) => update({ speed: Number(e.target.value) })}
        >
          {SPEED_OPTIONS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </Row>
      <Row label={t('moodLabel')} hint={t('moodHint')}>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={settings.mood}
            onChange={(e) => update({ mood: e.target.checked })}
          />
          <span>{settings.mood ? t('on') : t('off')}</span>
        </label>
      </Row>
      <Row label={t('commandColorLabel')} hint={t('commandColorHint')}>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={settings.commandColor}
            onChange={(e) => update({ commandColor: e.target.checked })}
          />
          <span>{settings.commandColor ? t('on') : t('off')}</span>
        </label>
      </Row>
      <Row label={t('commandSweepLabel')} hint={t('commandSweepHint')}>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={settings.commandSweep}
            onChange={(e) => update({ commandSweep: e.target.checked })}
          />
          <span>{settings.commandSweep ? t('on') : t('off')}</span>
        </label>
      </Row>
      <div className={styles.colorSection}>
        <div className={styles.colorHeader}>
          <span className={styles.label}>{t('toolColorsLabel')}</span>
          <span className={styles.hint}>{t('toolColorsHint')}</span>
        </div>
        <div className={styles.colorGrid}>
          {TOOL_CATEGORIES.map((cat) => (
            <div key={cat} className={styles.colorItem}>
              <span className={styles.colorItemLabel}>{categoryLabel(cat)}</span>
              <input
                type="color"
                className={styles.colorInput}
                value={settings.toolColors[cat]}
                onChange={(e) => update({ toolColors: { ...settings.toolColors, [cat]: e.target.value } })}
                title={categoryLabel(cat)}
                aria-label={categoryLabel(cat)}
              />
              <button
                type="button"
                className={styles.colorResetBtn}
                onClick={() => update({ toolColors: { ...settings.toolColors, [cat]: DEFAULT_TOOL_COLORS[cat] } })}
                title={t('colorReset')}
                aria-label={`${t('colorReset')} — ${categoryLabel(cat)}`}
              >
                ↺
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.actions}>
        <button className={styles.resetBtn} onClick={reset}>{t('reset')}</button>
      </div>
    </div>
  )
}
