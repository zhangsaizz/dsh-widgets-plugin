/**
 * Shared persistence helpers for the session monitor widget: validated
 * settings (localStorage JSON blob), panel position, and the notification
 * chime. Both the widget and its config panel import from here so they read
 * and write the same keys. Config changes are announced through a window
 * CustomEvent so the mounted widget updates live without polling.
 *
 * @module @dsh-plugins/client-ui-session-monitor/client/settings
 */

/** Every user-tunable option of the session monitor. */
export interface MonitorSettings {
  /** Show a toast when a session finishes a round. */
  notify: boolean
  /** How a toast goes away: 'auto' after a few seconds, or only on 确认/知道了. */
  notifyMode: 'auto' | 'confirm'
  /** Seconds before an auto-mode toast dismisses itself. */
  autoDismissSec: number
  /** Play a short chime when a toast appears. */
  sound: boolean
  /** Also send a browser/system notification on round completion (needs permission). */
  browserNotify: boolean
  /** List only running sessions in the dashboard. */
  runningOnly: boolean
  /**
   * Keep only sessions active within this many minutes (0 = keep all).
   * Running sessions are always shown regardless of the window.
   */
  timeWindowMin: number
  /** Mark sessions that finished a round with a "本轮完成" badge until visited. */
  showDone: boolean
  /** Also notify when the current session finishes its round. */
  notifyCurrent: boolean
  /** Show (and notify about) subagent sessions in the dashboard; off filters them out. */
  showSubagents: boolean
}

/** Factory defaults — the config panel's "重置设置" target. */
export const DEFAULT_SETTINGS: MonitorSettings = {
  notify: true,
  notifyMode: 'auto',
  autoDismissSec: 8,
  sound: false,
  browserNotify: false,
  runningOnly: false,
  timeWindowMin: 60,
  showDone: true,
  notifyCurrent: true,
  showSubagents: false,
}

/** localStorage key holding the whole settings blob. */
export const SETTINGS_KEY = 'dsh.smon.settings'
/** localStorage key holding the free panel position. */
export const POS_KEY = 'dsh.smon.pos'
/** localStorage key holding the panel zoom scale. */
export const SCALE_KEY = 'dsh.smon.scale'
/** Window event dispatched by saveSettings so mounted widgets re-read live. */
export const SETTINGS_CHANGED_EVENT = 'dsh.smon.settings-changed'

function clampInt(value: unknown, lo: number, hi: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(hi, Math.max(lo, Math.round(value)))
    : fallback
}

/** Read persisted settings, validating types and clamping ranges. */
export function loadSettings(): MonitorSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const s: any = JSON.parse(raw)
    if (!s || typeof s !== 'object') return { ...DEFAULT_SETTINGS }
    return {
      notify: typeof s.notify === 'boolean' ? s.notify : DEFAULT_SETTINGS.notify,
      notifyMode: s.notifyMode === 'confirm' ? 'confirm' : 'auto',
      autoDismissSec: clampInt(s.autoDismissSec, 2, 60, DEFAULT_SETTINGS.autoDismissSec),
      sound: typeof s.sound === 'boolean' ? s.sound : DEFAULT_SETTINGS.sound,
      browserNotify: typeof s.browserNotify === 'boolean' ? s.browserNotify : DEFAULT_SETTINGS.browserNotify,
      runningOnly: typeof s.runningOnly === 'boolean' ? s.runningOnly : DEFAULT_SETTINGS.runningOnly,
      timeWindowMin: clampInt(s.timeWindowMin, 0, 1440, DEFAULT_SETTINGS.timeWindowMin),
      showDone: typeof s.showDone === 'boolean' ? s.showDone : DEFAULT_SETTINGS.showDone,
      notifyCurrent: typeof s.notifyCurrent === 'boolean' ? s.notifyCurrent : DEFAULT_SETTINGS.notifyCurrent,
      showSubagents: typeof s.showSubagents === 'boolean' ? s.showSubagents : DEFAULT_SETTINGS.showSubagents,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Persist a full settings blob and announce the change to the widget. */
export function saveSettings(settings: MonitorSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch { /* storage unavailable */ }
  try {
    window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT))
  } catch { /* events unavailable */ }
}

/** Read the free panel position (top-left), or null for the default corner. */
export function loadPos(): { x: number; y: number } | null {
  try {
    const raw = window.localStorage.getItem(POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (p && typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y }
    return null
  } catch {
    return null
  }
}

/** Persist the free panel position. */
export function savePos(pos: { x: number; y: number } | null): void {
  try {
    if (pos === null) window.localStorage.removeItem(POS_KEY)
    else window.localStorage.setItem(POS_KEY, JSON.stringify(pos))
  } catch { /* storage unavailable */ }
}

/** Minimum / maximum panel zoom scale (drag the bottom-right handle). */
export const MIN_SCALE = 0.6
export const MAX_SCALE = 1.6

/** Read the persisted zoom scale, clamped and validated. */
export function loadScale(): number {
  try {
    const v = parseFloat(window.localStorage.getItem(SCALE_KEY) ?? '')
    if (Number.isFinite(v)) return Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))
    return 1
  } catch {
    return 1
  }
}

/** Persist the zoom scale. */
export function saveScale(scale: number): void {
  try {
    if (scale === 1) window.localStorage.removeItem(SCALE_KEY)
    else window.localStorage.setItem(SCALE_KEY, String(scale))
  } catch { /* storage unavailable */ }
}

/**
 * Per-session "last observed activity" timestamps, persisted so the recent
 * window filter survives a page reload. The host list's `updatedAt` only
 * reflects creation / the latest human prompt, so it would hide sessions whose
 * agent ran recently without a new prompt — the widget records the moment it
 * sees a session start or finish a round and uses the newer of the two.
 */
export const LAST_ACTIVE_KEY = 'dsh.smon.activity'
/** Entries older than this are useless for every selectable window and get pruned. */
const LAST_ACTIVE_TTL_MS = 25 * 60 * 60_000

/** Read the persisted session-id → last-activity-ms map (pruned on read). */
export function loadLastActive(): Record<string, number> {
  const out: Record<string, number> = {}
  try {
    const raw = window.localStorage.getItem(LAST_ACTIVE_KEY)
    if (!raw) return out
    const parsed: any = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return out
    const cutoff = Date.now() - LAST_ACTIVE_TTL_MS
    for (const [id, ts] of Object.entries(parsed)) {
      if (typeof ts === 'number' && Number.isFinite(ts) && ts >= cutoff) out[id] = ts
    }
    return out
  } catch {
    return out
  }
}

/** Persist the session-id → last-activity-ms map, pruning entries past the TTL. */
export function saveLastActive(map: Record<string, number>): void {
  try {
    const cutoff = Date.now() - LAST_ACTIVE_TTL_MS
    const pruned: Record<string, number> = {}
    for (const [id, ts] of Object.entries(map)) {
      if (ts >= cutoff) pruned[id] = ts
    }
    window.localStorage.setItem(LAST_ACTIVE_KEY, JSON.stringify(pruned))
  } catch { /* storage unavailable */ }
}

/** Keep a fixed element fully inside the viewport with a small margin. */
export function clampToViewport(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const m = 6
  return {
    x: Math.round(Math.min(Math.max(x, m), Math.max(m, window.innerWidth - w - m))),
    y: Math.round(Math.min(Math.max(y, m), Math.max(m, window.innerHeight - h - m))),
  }
}

/** Short two-tone notification chime via WebAudio (fails silently). */
export function playChime(): void {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AC) return
    const actx: AudioContext = new AC()
    const t = actx.currentTime
    const gain = actx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.14, t + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    gain.connect(actx.destination)
    for (const [freq, at] of [[660, t], [880, t + 0.12]] as const) {
      const osc = actx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, at)
      osc.connect(gain)
      osc.start(at)
      osc.stop(at + 0.22)
    }
    window.setTimeout(() => { void actx.close().catch(() => undefined) }, 600)
  } catch { /* audio unavailable */ }
}
