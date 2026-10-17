/**
 * Persisted token-crit settings shared by the floating badge and the shell
 * bottom status bar.
 *
 * The badge owns the settings panel; the bottom bar (harness 0.2.1
 * `shell.bottom` slot) is a separate React root, so both halves must agree on
 * the storage key, the validated shape and the change notification. The badge
 * writes the blob whenever a panel option changes and dispatches
 * {@link TOKEN_CRIT_SETTINGS_CHANGED}; the bar re-reads it and also listens for
 * cross-tab `storage` events. Reading never throws: corrupt or absent storage
 * falls back to the factory defaults.
 *
 * @module @dsh-plugins/client-ui-token-crit/client/settings
 */

/** localStorage key holding the one JSON settings blob. */
export const TOKEN_CRIT_SETTINGS_KEY = 'dsh.tcrit.settings'
/** Window event the badge fires after persisting a settings change. */
export const TOKEN_CRIT_SETTINGS_CHANGED = 'dsh.tcrit.settings-change'

/** Every panel option, persisted to localStorage as one JSON blob. */
export interface WidgetSettings {
  critAbs: number
  critRatio: number
  lang: string
  showTags: boolean
  soundOn: boolean
  edgeOn: boolean
  ambientOn: boolean
  ambientCount: number
  particleColor: string
  numSize: number
  numFormat: string
  comboOn: boolean
  /** Background adaptation: auto-detect, or force light/dark. */
  themeMode: 'auto' | 'light' | 'dark'
  /** Neon flicker intensity: off / low / med / high. */
  flickerLevel: 'off' | 'low' | 'med' | 'high'
  /** Glitch (random chars) intensity: off / low / med / high. */
  glitchLevel: 'off' | 'low' | 'med' | 'high'
  /** Show the root-scope shell bottom frame with the current session's usage. */
  bottomBar: boolean
}

/** Factory defaults for every panel option. */
export const DEFAULT_SETTINGS: WidgetSettings = {
  critAbs: 4000,
  critRatio: 0.12,
  lang: 'zh',
  showTags: true,
  soundOn: false,
  edgeOn: true,
  ambientOn: true,
  ambientCount: 7,
  particleColor: 'cyan',
  numSize: 14,
  numFormat: 'full',
  comboOn: true,
  themeMode: 'auto',
  flickerLevel: 'med',
  glitchLevel: 'med',
  bottomBar: false,
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Read persisted settings, validating types and clamping ranges.
 * @returns the validated settings, or the factory defaults on missing/corrupt storage.
 */
export function loadSettings(): WidgetSettings {
  try {
    const raw = window.localStorage.getItem(TOKEN_CRIT_SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const s: any = JSON.parse(raw)
    if (!s || typeof s !== 'object') return DEFAULT_SETTINGS
    const out: WidgetSettings = { ...DEFAULT_SETTINGS }
    if (typeof s.critAbs === 'number') out.critAbs = clamp(Math.round(s.critAbs), 500, 20000)
    if (typeof s.critRatio === 'number') out.critRatio = clamp(s.critRatio, 0.02, 0.3)
    if (s.lang === 'zh' || s.lang === 'en') out.lang = s.lang
    if (typeof s.showTags === 'boolean') out.showTags = s.showTags
    if (typeof s.soundOn === 'boolean') out.soundOn = s.soundOn
    if (typeof s.edgeOn === 'boolean') out.edgeOn = s.edgeOn
    if (typeof s.ambientOn === 'boolean') out.ambientOn = s.ambientOn
    if (typeof s.ambientCount === 'number') out.ambientCount = clamp(Math.round(s.ambientCount), 3, 16)
    if (['gold', 'cyan', 'purple', 'multi'].includes(s.particleColor)) out.particleColor = s.particleColor
    if (typeof s.numSize === 'number') out.numSize = clamp(Math.round(s.numSize), 10, 22)
    if (s.numFormat === 'full' || s.numFormat === 'compact') out.numFormat = s.numFormat
    if (typeof s.comboOn === 'boolean') out.comboOn = s.comboOn
    if (s.themeMode === 'auto' || s.themeMode === 'light' || s.themeMode === 'dark') out.themeMode = s.themeMode
    if (s.flickerLevel === 'off' || s.flickerLevel === 'low' || s.flickerLevel === 'med' || s.flickerLevel === 'high') out.flickerLevel = s.flickerLevel
    if (s.glitchLevel === 'off' || s.glitchLevel === 'low' || s.glitchLevel === 'med' || s.glitchLevel === 'high') out.glitchLevel = s.glitchLevel
    if (typeof s.bottomBar === 'boolean') out.bottomBar = s.bottomBar
    return out
  } catch {
    return DEFAULT_SETTINGS
  }
}
