/**
 * Rainbow-flow settings (browser half): the configurable knobs for the
 * breathing-glow effect, persisted to localStorage and shared with the
 * `widgets.config` settings panel through a module-level store +
 * `useSyncExternalStore`.
 *
 * Unlike the on/off toggle (a single boolean in `dsh.rnglow.enabled`), the
 * settings are a small object under `dsh.rnglow.settings`:
 *
 *  - `opacity`       — overall effect opacity (0.4 / 0.7 / 1.0).
 *  - `speed`         — token-rate sensitivity (0.5× slow / 1× default / 1.5× fast).
 *  - `mood`          — whether the thinking/tool "cool shift" palette is on.
 *
 * (The old `wisps` knob — cloud wisp count around the rim — was removed
 * together with the particle-flow effect: the halo is one continuous glow,
 * so there is no wisp count to configure. Persisted settings containing the
 * stale key are ignored.)
 *
 * The glow and the settings panel both subscribe; writes are announced so a
 * mounted effect re-reads them live without a reload.
 *
 * @module @dsh-plugins/client-ui-rainbow-flow/client/settings
 */

/** localStorage key for the settings object. */
export const SETTINGS_KEY = 'dsh.rnglow.settings'

/** Valid values for each knob. */
export const OPACITY_OPTIONS = [0.4, 0.7, 1.0] as const
export const SPEED_OPTIONS = [0.5, 1, 1.5] as const

/** The persisted settings shape. */
export interface RainbowFlowSettings {
  /** Overall effect opacity (multiplier on every drawn alpha). */
  opacity: number
  /** Token-rate sensitivity multiplier (1 = the 5s↔1s default breathing span). */
  speed: number
  /** Whether the thinking/tool cool-shift palette is applied. */
  mood: boolean
}

/** Defaults — match the effect's original hardcoded behaviour. */
export const DEFAULT_SETTINGS: RainbowFlowSettings = {
  opacity: 1,
  speed: 1,
  mood: true,
}

/** Read persisted settings, falling back to defaults on any malformed value. */
export function loadSettings(): RainbowFlowSettings {
  const s: Partial<RainbowFlowSettings> = {}
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (raw) Object.assign(s, JSON.parse(raw))
  } catch { /* storage unavailable: keep defaults */ }
  return {
    opacity: (OPACITY_OPTIONS as readonly number[]).includes(s.opacity as number)
      ? s.opacity as number
      : DEFAULT_SETTINGS.opacity,
    speed: (SPEED_OPTIONS as readonly number[]).includes(s.speed as number)
      ? s.speed as number
      : DEFAULT_SETTINGS.speed,
    mood: typeof s.mood === 'boolean' ? s.mood : DEFAULT_SETTINGS.mood,
  }
}

/** Module-level settings store (localStorage-backed, uSES-compatible). */
let settings: RainbowFlowSettings = loadSettings()
const listeners = new Set<() => void>()

/** Persist + announce a settings change. */
export function saveSettings(next: RainbowFlowSettings): void {
  settings = next
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  for (const l of listeners) l()
}

/** Subscribe to settings changes (returns an unsubscribe). */
export function subscribeSettings(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** uSES snapshot: the current settings object. */
export function getSettings(): RainbowFlowSettings {
  return settings
}
