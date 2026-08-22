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
import {
  IconApiOutline14,
  IconBrowseOutline16,
  IconChecklistOutline14,
  IconCodeOutline16,
  IconDataOutline16,
  IconEditOutline16,
  IconGlobeOutline14,
  IconListPenOutline16,
  IconQuestionOutline14,
  IconSearchOutline16,
  IconSparkle16,
  IconThinkOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
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

/** Per-category icon shown in the colour grid. Reuses the harness's official
 *  `ic_ds_*` glyph set (`@deepseek-ai/dsh-client-ui-primitives`) — the very
 *  icons the web chat's command cards use — so the panel reads like the rest
 *  of the UI. Every glyph draws with `fill="currentColor"`, so each icon is
 *  tinted by its row's configured colour (a live link between the glyph and
 *  the command class it stands for). */
const TOOL_ICON: Readonly<Record<ToolCategory, (size: number) => ReactNode>> = {
  shell: (size) => <IconApiOutline14 size={size} />,
  read: (size) => <IconBrowseOutline16 size={size} />,
  search: (size) => <IconSearchOutline16 size={size} />,
  write: (size) => <IconListPenOutline16 size={size} />,
  edit: (size) => <IconEditOutline16 size={size} />,
  code: (size) => <IconCodeOutline16 size={size} />,
  web: (size) => <IconGlobeOutline14 size={size} />,
  ask: (size) => <IconQuestionOutline14 size={size} />,
  plan: (size) => <IconChecklistOutline14 size={size} />,
  memory: (size) => <IconDataOutline16 size={size} />,
  think: (size) => <IconThinkOutline14 size={size} />,
  other: (size) => <IconSparkle16 size={size} />,
}

/** Bilingual category name for a colour row (resolved from the document lang). */
function categoryLabel(category: ToolCategory): string {
  const lang = (document.documentElement.lang || '').toLowerCase()
  return lang.startsWith('zh') ? CATEGORY_LABELS[category].zh : CATEGORY_LABELS[category].en
}

/** Representative web tool name per category — the token the harness's
 *  command card shows (`data-tool` / `node.name`) for the most representative
 *  tool in each class, so the panel reads like the web chat. The row colours
 *  the WHOLE category; the name is just the exemplar. Kept independent of the
 *  document language so it always matches the web UI. */
const CATEGORY_TOOL_NAME: Readonly<Record<ToolCategory, string>> = {
  shell: 'bash',
  read: 'read_file',
  search: 'web_search',
  write: 'write_file',
  edit: 'apply_patch',
  code: 'run_code',
  web: 'web_fetch',
  ask: 'ask_user_question',
  plan: 'plan',
  memory: 'remember',
  think: 'think',
  other: 'command',
}

/** Web-native command label: the representative tool name (matches the web
 *  command card's `node.name`), independent of the document language. */
function commandName(category: ToolCategory): string {
  return CATEGORY_TOOL_NAME[category]
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
            aria-label={t('moodLabel')}
          />
          <span>{settings.mood ? t('on') : t('off')}</span>
        </label>
      </Row>
      <Row label={t('commandSweepLabel')} hint={t('commandSweepHint')}>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={settings.commandSweep}
            onChange={(e) => update({ commandSweep: e.target.checked })}
            aria-label={t('commandSweepLabel')}
          />
          <span>{settings.commandSweep ? t('on') : t('off')}</span>
        </label>
      </Row>
      <div className={styles.colorSection}>
        <div className={styles.colorHeader}>
          <div className={styles.colorHeaderRow}>
            <span className={styles.label}>{t('toolColorsLabel')}</span>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={settings.commandColor}
                onChange={(e) => update({ commandColor: e.target.checked })}
                title={t('commandColorLabel')}
                aria-label={t('commandColorLabel')}
              />
              <span>{settings.commandColor ? t('on') : t('off')}</span>
            </label>
          </div>
          <span className={styles.hint}>{t('toolColorsHint')}</span>
        </div>
        <div className={`${styles.colorGrid}${settings.commandColor ? '' : ` ${styles.colorGridOff}`}`}>
          {TOOL_CATEGORIES.map((cat) => (
            <div key={cat} className={styles.colorItem}>
              <span className={styles.colorItemText} style={{ color: settings.toolColors[cat] }}>
                <span className={styles.colorItemIcon} aria-hidden="true">
                  {TOOL_ICON[cat](16)}
                </span>
                <span className={styles.colorItemLabel} title={commandName(cat)}>{commandName(cat)}</span>
              </span>
              <input
                type="color"
                className={styles.colorInput}
                value={settings.toolColors[cat]}
                onChange={(e) => update({ toolColors: { ...settings.toolColors, [cat]: e.target.value } })}
                disabled={!settings.commandColor}
                title={categoryLabel(cat)}
                aria-label={categoryLabel(cat)}
              />
              <button
                type="button"
                className={styles.colorResetBtn}
                onClick={() => update({ toolColors: { ...settings.toolColors, [cat]: DEFAULT_TOOL_COLORS[cat] } })}
                disabled={!settings.commandColor}
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
