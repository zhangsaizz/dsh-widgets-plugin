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
 *  - `toolColors`    — the per-category command-card text accent colours
 *                      (see `DEFAULT_TOOL_COLORS`; the settings panel lets the
 *                      user pick each one, applied as `--rf-tool-*` CSS vars).
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

import type { ToolCategory } from './classify.ts'
import { TOOL_CATEGORIES } from './classify.ts'

/** localStorage key for the settings object. */
export const SETTINGS_KEY = 'dsh.rnglow.settings'

/** Valid values for each knob. */
export const OPACITY_OPTIONS = [0.4, 0.7, 1.0] as const
export const SPEED_OPTIONS = [0.5, 1, 1.5] as const

/** Per-category command-card accent colours (the `--rf-tool-*` palette). */
export type ToolColors = Record<ToolCategory, string>

/** A valid `#rrggbb` hex colour (the `<input type="color">` value format). */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/**
 * Default command-accent palette — matches the shipped `:root` values in
 * `ToolAccent.css` (which is the pre-JS paint + the documented look; this is
 * the JS source of truth once the plugin mounts). One colour per hue family,
 * warm set green/yellow/orange/brown, cool set blue→cyan→indigo→violet→
 * lavender, red reserved for "ask", neutral grey for "other".
 */
export const DEFAULT_TOOL_COLORS: ToolColors = {
  shell: '#22c55e',  /* green   */
  read: '#3b82f6',   /* blue    */
  search: '#06b6d4', /* cyan    */
  write: '#eab308',  /* yellow  */
  edit: '#ea580c',   /* orange  */
  code: '#8b5cf6',   /* violet  */
  web: '#d946ef',    /* fuchsia */
  ask: '#ef4444',    /* red     */
  plan: '#4f46e5',   /* indigo  */
  memory: '#b45309', /* brown   */
  think: '#c084fc',  /* lavender/purple */
  other: '#9ca3af',  /* grey    */
}

/** Validate a persisted colour, falling back to the default on any bad value. */
function loadToolColors(raw: unknown): ToolColors {
  const source: Partial<Record<ToolCategory, unknown>> = (raw && typeof raw === 'object')
    ? raw as Partial<Record<ToolCategory, unknown>>
    : {}
  const out: ToolColors = { ...DEFAULT_TOOL_COLORS }
  for (const cat of TOOL_CATEGORIES) {
    const v = source[cat]
    if (typeof v === 'string' && HEX_COLOR.test(v)) out[cat] = v
  }
  return out
}

/** The persisted settings shape. */
export interface RainbowFlowSettings {
  /** Overall effect opacity (multiplier on every drawn alpha). */
  opacity: number
  /** Token-rate sensitivity multiplier (1 = the 5s↔1s default breathing span). */
  speed: number
  /** Whether the thinking/tool cool-shift palette is applied. */
  mood: boolean
  /** Per-category command-card text accent colours. */
  toolColors: ToolColors
}

/** Defaults — match the effect's original hardcoded behaviour. */
export const DEFAULT_SETTINGS: RainbowFlowSettings = {
  opacity: 1,
  speed: 1,
  mood: true,
  toolColors: { ...DEFAULT_TOOL_COLORS },
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
    toolColors: loadToolColors(s.toolColors),
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
