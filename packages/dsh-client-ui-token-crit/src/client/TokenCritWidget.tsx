/**
 * The token-usage crit meter widget: a floating, transparent, draggable and
 * resizable badge registered into the shell.overlay list. It reads the
 * current session's cumulative token usage from the `tokenUsage` projection
 * (input + output + cache read + cache write buckets) via the standard
 * `useSessions` prop, rolls the number, and fires MMO-style crit effects —
 * floating input/output damage numbers, particles, a combo counter, edge
 * flash and an optional sound — whenever usage grows. All tuning lives in a
 * small hover-revealed settings panel.
 *
 * Rendering split (hybrid):
 *  - the badge text (number/label), drag/resize handles and the settings
 *    panel stay in DOM/CSS — crisp text, theming variables, accessibility;
 *  - the transient effects (floating numbers, tags, burst particles, ambient
 *    embers, combo pop) are drawn imperatively on a <canvas> overlay by the
 *    TokenCritFx engine, fully outside React's render cycle;
 *  - the number roll writes the badge text directly via a ref (textContent)
 *    instead of re-rendering the component every frame.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { TokenCritFx, fmt } from './TokenCritFx'
import css from './TokenCritWidget.module.css'

/** Cumulative token-usage projection value (from the token-meter). */
interface TokenUsage {
  uncachedInputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** Pointer-drag state. */
interface DragState {
  mode: 'move' | 'resize'
  pointerId: number
  startX: number
  startY: number
  originLeft: number
  originTop: number
  startScale: number
}

function compact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n))
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function selectUsage(s: any): TokenUsage | undefined {
  const cid = s.current
  const entry = cid ? s.byId[cid] : undefined
  return entry && entry.projectionValues ? entry.projectionValues.tokenUsage : undefined
}

function loadPos(): { x: number; y: number } | null {
  try {
    const s = window.localStorage.getItem('dsh.tcrit.pos')
    return s ? JSON.parse(s) : null
  } catch {
    return null
  }
}

function loadScale(): number {
  try {
    const v = parseFloat(window.localStorage.getItem('dsh.tcrit.scale') ?? '')
    return Number.isFinite(v) ? clamp(v, 0.6, 2.5) : 1
  } catch {
    return 1
  }
}

/** Keep the widget's top-left inside the viewport (with a small margin). */
function clampToViewport(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const m = 6
  return {
    x: Math.round(clamp(x, m, Math.max(m, window.innerWidth - w - m))),
    y: Math.round(clamp(y, m, Math.max(m, window.innerHeight - h - m))),
  }
}

/**
 * Position the settings panel: attach it to the widget (aligned to its left,
 * just below it), then clamp both axes to the viewport using the panel's own
 * width/height so it never overflows the screen edge.
 */
function computePanelPos(rect: DOMRect, panelW: number, panelH: number): { x: number; y: number } {
  const m = 8
  return {
    x: Math.round(clamp(Math.round(rect.left), m, Math.max(m, window.innerWidth - panelW - m))),
    y: Math.round(clamp(Math.round(rect.bottom + 10), m, Math.max(m, window.innerHeight - panelH - m))),
  }
}

/** Every panel option, persisted to localStorage as one JSON blob. */
interface WidgetSettings {
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
}

const DEFAULT_SETTINGS: WidgetSettings = {
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
}

/** Read persisted settings, validating types and clamping ranges. */
function loadSettings(): WidgetSettings {
  try {
    const raw = window.localStorage.getItem('dsh.tcrit.settings')
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
    return out
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** Approximate relative luminance (0..1) of a hex/rgb() color string. */
function parseColorLuminance(color: string): number | null {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    const r = parseInt(h.slice(0, 2), 16) / 255
    const g = parseInt(h.slice(2, 4), 16) / 255
    const b = parseInt(h.slice(4, 6), 16) / 255
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const rgb = color.trim().match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
  if (rgb) {
    const r = Number(rgb[1]) / 255
    const g = Number(rgb[2]) / 255
    const b = Number(rgb[3]) / 255
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  return null
}

/**
 * Detect whether the widget sits on a light background. The host theme's
 * surface variables may live on an app container rather than <html>, so we
 * climb from the widget's anchor element through its ancestors: first any
 * theme surface variable, then the first real (non-transparent) background
 * color. Falls back to the OS color-scheme preference.
 */
function detectLightTheme(anchorEl: HTMLElement | null): boolean {
  try {
    let el: HTMLElement | null = anchorEl
    while (el) {
      const cs = getComputedStyle(el)
      for (const prop of ['--dsw-alias-bg-overlay', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-1']) {
        const lum = parseColorLuminance(cs.getPropertyValue(prop))
        if (lum !== null) return lum > 0.6
      }
      const bgLum = parseColorLuminance(cs.backgroundColor)
      if (bgLum !== null && bgLum > 0) return bgLum > 0.6
      el = el.parentElement
    }
  } catch { /* ignore */ }
  return window.matchMedia('(prefers-color-scheme: light)').matches
}

/** Map the panel's flicker level to engine timings. */
function flickerLevelConfig(level: string) {
  switch (level) {
    case 'off': return { flickerOn: false, flickerMin: 1, flickerMax: 1, dipMin: 1, dipMax: 1 }
    case 'low': return { flickerOn: true, flickerMin: 3000, flickerMax: 6000, dipMin: 0.55, dipMax: 0.75 }
    case 'high': return { flickerOn: true, flickerMin: 800, flickerMax: 2500, dipMin: 0.35, dipMax: 0.65 }
    default: return { flickerOn: true, flickerMin: 1400, flickerMax: 4200, dipMin: 0.45, dipMax: 0.72 }
  }
}

/** Map the panel's glitch level to engine probabilities. */
function glitchLevelConfig(level: string) {
  switch (level) {
    case 'off': return { glitchOn: false, glitchChance: 0, glitchMaxBursts: 0, glitchRatio: 0 }
    case 'low': return { glitchOn: true, glitchChance: 0.03, glitchMaxBursts: 1, glitchRatio: 0.35 }
    case 'high': return { glitchOn: true, glitchChance: 0.12, glitchMaxBursts: 3, glitchRatio: 0.75 }
    default: return { glitchOn: true, glitchChance: 0.06, glitchMaxBursts: 2, glitchRatio: 0.55 }
  }
}

export function TokenCritWidget(props: { useSessions: (sel: (s: any) => any) => any }) {
  const usage = props.useSessions(selectUsage)

  const input = usage
    ? (usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    : 0
  const output = usage ? (usage.outputTokens ?? 0) : 0
  const total = input + output

  const anchorRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const numRef = useRef<HTMLSpanElement | null>(null)
  const labelRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const fxRef = useRef<TokenCritFx | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const movedRef = useRef(false)
  const shownRef = useRef(0)
  const numFormatRef = useRef('full')
  const prevRef = useRef({ input: 0, output: 0, seen: false })
  const lastGrowthRef = useRef(0)
  const comboTimerRef = useRef<number | null>(null)
  const audioRef = useRef<any>(null)

  const [pos, setPos] = useState<{ x: number; y: number } | null>(loadPos)
  const [scale, setScale] = useState(loadScale)
  const [dragging, setDragging] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [dotText, setDotText] = useState('0')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null)
  const [critKey, setCritKey] = useState(0)
  const [combo, setCombo] = useState(0)
  const [edgeKey, setEdgeKey] = useState(0)

  // Settings load from localStorage once per mount (validated by loadSettings).
  const initial = useMemo(loadSettings, [])

  const [critAbs, setCritAbs] = useState(initial.critAbs)
  const [critRatio, setCritRatio] = useState(initial.critRatio)
  const [lang, setLang] = useState(initial.lang)
  const [showTags, setShowTags] = useState(initial.showTags)
  const [soundOn, setSoundOn] = useState(initial.soundOn)
  const [edgeOn, setEdgeOn] = useState(initial.edgeOn)
  const [ambientOn, setAmbientOn] = useState(initial.ambientOn)
  const [ambientCount, setAmbientCount] = useState(initial.ambientCount)
  const [particleColor, setParticleColor] = useState(initial.particleColor)
  const [numSize, setNumSize] = useState(initial.numSize)
  const [numFormat, setNumFormat] = useState(initial.numFormat)
  const [comboOn, setComboOn] = useState(initial.comboOn)
  const [themeMode, setThemeMode] = useState<'auto' | 'light' | 'dark'>(initial.themeMode)
  const [flickerLevel, setFlickerLevel] = useState<'off' | 'low' | 'med' | 'high'>(initial.flickerLevel)
  const [glitchLevel, setGlitchLevel] = useState<'off' | 'low' | 'med' | 'high'>(initial.glitchLevel)

  // Effective light-background mode: manual override, else auto-detect by
  // climbing the anchor's ancestor chain for the host theme's surfaces.
  // Initial detection falls back to prefers-color-scheme (the anchor ref is
  // not mounted yet); re-detect once the anchor exists after mount.
  const [detectedLight, setDetectedLight] = useState(() => detectLightTheme(null))
  useEffect(() => {
    setDetectedLight(detectLightTheme(anchorRef.current))
  }, [])
  const light = themeMode === 'light' ? true : themeMode === 'dark' ? false : detectedLight

  // Canvas effects engine lifecycle: attach to the overlay canvas, keep the
  // badge size cache in sync (the badge width changes while the number rolls).
  useEffect(() => {
    const fx = (fxRef.current ??= new TokenCritFx())
    const canvas = canvasRef.current
    if (!canvas) return
    fx.attach(canvas)
    const el = anchorRef.current
    let size = { w: 0, h: 0 }
    const measure = () => {
      if (!el) return
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w !== size.w || h !== size.h) {
        size = { w, h }
        fx.setBadgeSize(w, h)
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return () => fx.detach()
    const ro = new ResizeObserver(measure)
    if (el) ro.observe(el)
    return () => {
      ro.disconnect()
      fx.detach()
    }
  }, [])

  // Keep the canvas backing store matched to the widget scale, so the bitmap
  // is never sampled at a non-1:1 ratio (blurry canvas text).
  useEffect(() => {
    fxRef.current?.setResolution(scale)
  }, [scale])

  // Pause the effect layer while collapsed into the dot.
  useEffect(() => {
    const fx = fxRef.current
    if (!fx) return
    if (collapsed) fx.hide()
    else fx.show()
  }, [collapsed])

  // Drive the neon flicker: attach the number + label elements to the engine,
  // re-attaching whenever the badge remounts (every usage growth bumps the
  // badge key) and detaching while collapsed into the dot.
  useEffect(() => {
    const fx = fxRef.current
    if (!fx) return
    fx.attachNeon(collapsed ? null : numRef.current, collapsed ? null : labelRef.current)
    return () => fx.attachNeon(null, null)
  }, [collapsed, critKey])

  // Keep the engine's light/dark palette in sync with the theme.
  useEffect(() => {
    fxRef.current?.setLight(light)
  }, [light])

  // Push the neon flicker / glitch tuning to the engine.
  useEffect(() => {
    fxRef.current?.setNeonFx({ ...flickerLevelConfig(flickerLevel), ...glitchLevelConfig(glitchLevel) })
  }, [flickerLevel, glitchLevel])

  // The settings panel snaps to the widget: reposition it whenever the widget
  // moves/resizes while open, and clamp to the viewport using the panel's
  // real size (re-run after the panel mounts so its measured height applies).
  useEffect(() => {
    if (!settingsOpen) return
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    const w = panelRef.current?.offsetWidth ?? 264
    const h = panelRef.current?.offsetHeight ?? 320
    const next = computePanelPos(rect, w, h)
    setPanelPos((prev) => (prev && prev.x === next.x && prev.y === next.y ? prev : next))
  }, [settingsOpen, pos, scale, panelPos, window.innerWidth, window.innerHeight])

  // On expand, restore the badge number from the ref-tracked value.
  useEffect(() => {
    if (collapsed) return
    if (numRef.current) {
      numRef.current.textContent = numFormatRef.current === 'compact' ? compact(shownRef.current) : fmt(shownRef.current)
    }
  }, [collapsed])

  // Keep the format in sync and rewrite the badge text when it changes.
  useEffect(() => {
    numFormatRef.current = numFormat
    if (numRef.current) {
      numRef.current.textContent = numFormat === 'compact' ? compact(shownRef.current) : fmt(shownRef.current)
    }
  }, [numFormat])

  // (Re)seed the ambient embers on the canvas.
  useEffect(() => {
    const fx = fxRef.current
    if (!fx) return
    fx.setAmbient(ambientOn ? ambientCount : 0, particleColor)
  }, [ambientOn, ambientCount, particleColor])

  // Combo pop goes to the canvas too.
  useEffect(() => {
    const fx = fxRef.current
    if (!fx || !comboOn || combo < 2) return
    fx.setCombo(lang === 'zh' ? `×${combo} 连击` : `×${combo} COMBO`)
  }, [combo, comboOn, lang])

  useEffect(() => {
    try {
      window.localStorage.setItem('dsh.tcrit.pos', pos ? JSON.stringify(pos) : '')
    } catch { /* storage unavailable */ }
  }, [pos])

  // Pull a stored position back into the viewport if the window changed
  // since the last session, and re-clamp whenever the window resizes.
  useEffect(() => {
    if (!pos) return
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    const p = clampToViewport(pos.x, pos.y, rect.width, rect.height)
    if (p.x !== pos.x || p.y !== pos.y) setPos(p)
  }, [pos, window.innerWidth, window.innerHeight])

  useEffect(() => {
    try {
      window.localStorage.setItem('dsh.tcrit.scale', String(scale))
    } catch { /* storage unavailable */ }
  }, [scale])

  // Persist every panel option as one JSON blob (survives page reloads).
  useEffect(() => {
    try {
      window.localStorage.setItem('dsh.tcrit.settings', JSON.stringify({
        critAbs, critRatio, lang, showTags, soundOn, edgeOn, ambientOn,
        ambientCount, particleColor, numSize, numFormat, comboOn, themeMode,
        flickerLevel, glitchLevel,
      }))
    } catch { /* storage unavailable */ }
  }, [critAbs, critRatio, lang, showTags, soundOn, edgeOn, ambientOn, ambientCount, particleColor, numSize, numFormat, comboOn, themeMode, flickerLevel, glitchLevel])

  useEffect(() => () => {
    if (comboTimerRef.current !== null) clearTimeout(comboTimerRef.current)
  }, [])

  function playCritSound() {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!AC) return
      if (!audioRef.current) audioRef.current = new AC()
      const actx = audioRef.current
      const t = actx.currentTime
      const osc = actx.createOscillator()
      const gain = actx.createGain()
      osc.type = 'square'
      osc.frequency.setValueAtTime(520, t)
      osc.frequency.exponentialRampToValueAtTime(1180, t + 0.08)
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
      osc.connect(gain)
      gain.connect(actx.destination)
      osc.start(t)
      osc.stop(t + 0.22)
    } catch { /* audio unavailable */ }
  }

  function spawnPop(kind: 'in' | 'out', delta: number, forceBig = false) {
    const fx = fxRef.current
    if (!fx) return
    const big = forceBig || (kind === 'out' && (delta >= critAbs || delta >= total * critRatio))
    // Cyberpunk palette: input = cyan, output = magenta, big crit = hot pink.
    const hue = kind === 'out' ? (big ? 325 : 305) : 185
    const size = kind === 'out' ? (big ? 24 + Math.random() * 10 : 15 + Math.random() * 8) : 13 + Math.random() * 6
    const tag = big
      ? (lang === 'zh' ? '暴击!' : 'CRIT!')
      : showTags
        ? (lang === 'zh' ? (kind === 'in' ? '输入' : '输出') : (kind === 'in' ? 'IN' : 'OUT'))
        : null
    fx.spawnFloat({ kind, delta, hue, size, big, tag })
    fx.spawnBurst(hue, big)
    if (big) {
      if (edgeOn) setEdgeKey((k) => k + 1)
      if (soundOn) playCritSound()
    }
  }

  /**
   * Settings-panel demo trigger: replays a full crit sequence (big output
   * crit → input hit → combo pop) without touching the real counter. Respects
   * the sound / edge-glow / combo toggles.
   */
  function runTest() {
    const fx = fxRef.current
    if (!fx) return
    const now = Date.now()
    const last = lastGrowthRef.current
    // Chain into the real combo counter so the demo integrates with the widget.
    setCombo((c) => (now - last < 1600 ? c + 1 : 1))
    lastGrowthRef.current = now
    if (comboTimerRef.current !== null) clearTimeout(comboTimerRef.current)
    comboTimerRef.current = window.setTimeout(() => setCombo(0), 1600)
    fx.setBoost(true)
    spawnPop('out', 8888, true)
    window.setTimeout(() => {
      spawnPop('in', 3456)
      if (comboOn) fx.setCombo(lang === 'zh' ? '×2 连击' : '×2 COMBO')
    }, 550)
  }

  useEffect(() => {
    const prev = prevRef.current
    const seen = prev.seen
    const inputDelta = seen ? input - prev.input : 0
    const outputDelta = seen ? output - prev.output : 0
    prevRef.current = { input, output, seen: true }

    if (inputDelta > 0 || outputDelta > 0) {
      setCritKey((k) => k + 1)
      const now = Date.now()
      const last = lastGrowthRef.current
      setCombo((c) => (now - last < 1600 ? c + 1 : 1))
      lastGrowthRef.current = now
      if (comboTimerRef.current !== null) clearTimeout(comboTimerRef.current)
      comboTimerRef.current = window.setTimeout(() => setCombo(0), 1600)

      fxRef.current?.setBoost(true)
    }
    if (outputDelta > 0) spawnPop('out', outputDelta)
    if (inputDelta > 0) spawnPop('in', inputDelta)

    // Roll the displayed number; write straight to the span, no re-render.
    const from = shownRef.current
    if (total === from) return
    const start = performance.now()
    const duration = Math.min(620, 220 + Math.abs(total - from) * 0.06)
    let frame = 0
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const val = Math.round(from + (total - from) * eased)
      shownRef.current = val
      if (numRef.current) {
        numRef.current.textContent = numFormatRef.current === 'compact' ? compact(val) : fmt(val)
      }
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  function startDrag(e: ReactPointerEvent<HTMLDivElement>, mode: 'move' | 'resize') {
    if (e.button !== 0) return
    const target = e.currentTarget
    try { target.setPointerCapture(e.pointerId) } catch { /* unavailable in jsdom */ }
    const rect = anchorRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    dragRef.current = {
      mode,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      startScale: scale,
    }
    movedRef.current = false
    setDragging(true)
    e.preventDefault()
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d) return
    if (d.mode === 'move') {
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      if (Math.abs(dx) + Math.abs(dy) > 4) movedRef.current = true
      // Clamp so the (scaled) badge can't be dragged off the viewport.
      const rect = anchorRef.current?.getBoundingClientRect()
      const p = clampToViewport(
        d.originLeft + dx,
        d.originTop + dy,
        rect?.width ?? 0,
        rect?.height ?? 0,
      )
      setPos(p)
    } else {
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      setScale(clamp(d.startScale + (dx + dy) / 140, 0.6, 2.5))
    }
  }

  function endDrag() {
    const d = dragRef.current
    const wasTap = d?.mode === 'move' && !movedRef.current
    dragRef.current = null
    setDragging(false)
    if (wasTap && collapsed) setCollapsed(false)
  }

  function toggleSettings() {
    if (settingsOpen) {
      setSettingsOpen(false)
      setPanelPos(null)
      return
    }
    // Initial position: attached to the widget, clamped to the viewport with
    // an estimated height (the attach effect refines it once the panel lays out).
    const rect = anchorRef.current?.getBoundingClientRect() ?? null
    if (rect) setPanelPos(computePanelPos(rect, 264, 320))
    setSettingsOpen(true)
  }

  function doCollapse() {
    setSettingsOpen(false)
    setPanelPos(null)
    setDotText(compact(shownRef.current))
    setCollapsed(true)
  }

  function resetPlacement() {
    setPos(null)
    setScale(1)
    try {
      window.localStorage.removeItem('dsh.tcrit.pos')
      window.localStorage.removeItem('dsh.tcrit.scale')
    } catch { /* storage unavailable */ }
  }

  /** Restore every panel option to its factory default. */
  function resetSettings() {
    setCritAbs(DEFAULT_SETTINGS.critAbs)
    setCritRatio(DEFAULT_SETTINGS.critRatio)
    setLang(DEFAULT_SETTINGS.lang)
    setShowTags(DEFAULT_SETTINGS.showTags)
    setSoundOn(DEFAULT_SETTINGS.soundOn)
    setEdgeOn(DEFAULT_SETTINGS.edgeOn)
    setAmbientOn(DEFAULT_SETTINGS.ambientOn)
    setAmbientCount(DEFAULT_SETTINGS.ambientCount)
    setParticleColor(DEFAULT_SETTINGS.particleColor)
    setNumSize(DEFAULT_SETTINGS.numSize)
    setNumFormat(DEFAULT_SETTINGS.numFormat)
    setComboOn(DEFAULT_SETTINGS.comboOn)
    setThemeMode(DEFAULT_SETTINGS.themeMode)
    setFlickerLevel(DEFAULT_SETTINGS.flickerLevel)
    setGlitchLevel(DEFAULT_SETTINGS.glitchLevel)
    try {
      window.localStorage.removeItem('dsh.tcrit.settings')
    } catch { /* storage unavailable */ }
  }

  const anchorStyle: CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    pointerEvents: 'auto',
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    touchAction: 'none',
  }
  if (pos) {
    anchorStyle.left = pos.x
    anchorStyle.top = pos.y
  } else {
    anchorStyle.right = 18
    anchorStyle.bottom = 130
  }

  const breakdown = usage
    ? lang === 'zh'
      ? `总用量 ${fmt(total)} · 输入 ${fmt(input)} · 缓存读 ${fmt(usage.cacheReadTokens ?? 0)} · 缓存写 ${fmt(usage.cacheWriteTokens ?? 0)} · 输出 ${fmt(output)}`
      : `Total ${fmt(total)} · Input ${fmt(input)} · Cache read ${fmt(usage.cacheReadTokens ?? 0)} · Cache write ${fmt(usage.cacheWriteTokens ?? 0)} · Output ${fmt(output)}`
    : lang === 'zh'
      ? '尚未产生 token 用量'
      : 'No token usage yet'

  let main
  if (collapsed) {
    main = (
      <div
        key="dot"
        className={css.dot}
        title="点击展开 · 拖动移动"
        onPointerDown={(e) => startDrag(e, 'move')}
      >
        {dotText}
      </div>
    )
  } else {
    const badgeClass = [
      css.badge,
      dragging ? css.dragging : '',
      critKey > 0 ? css.burst : '',
    ].filter(Boolean).join(' ')
    main = (
      <div
        key={'b' + critKey}
        className={badgeClass}
        title="拖动移动 · 双击折叠 · 拖右下角缩放"
        onPointerDown={(e) => startDrag(e, 'move')}
        onDoubleClick={doCollapse}
      >
        <span
          ref={numRef}
          className={css.num}
          style={{ fontSize: numSize + 'px' }}
        >
          {numFormat === 'compact' ? compact(shownRef.current) : fmt(shownRef.current)}
        </span>
        <span ref={labelRef} className={css.label} style={{ fontSize: Math.round(numSize * 0.62) + 'px' }}>{lang === 'zh' ? '词元' : 'TOKENS'}</span>
        <div
          className={css.gear}
          title="设置"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggleSettings}
        >
          ⚙
        </div>
      </div>
    )
  }

  const anchor = (
    <div
      ref={anchorRef}
      className={[css.anchor, light ? css.light : ''].filter(Boolean).join(' ')}
      style={anchorStyle}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {main}
      {collapsed ? null : <div className={css.resize} onPointerDown={(e) => startDrag(e, 'resize')} />}
      <canvas ref={canvasRef} className={css.fxcanvas} aria-hidden="true" />
    </div>
  )

  return (
    <>
      {anchor}
      {settingsOpen && panelPos
        ? (
          <div ref={panelRef} className={css.panel} style={{ left: panelPos.x, top: panelPos.y }}>
            <div className={css.phead}>
              <span className={css.ptitle}>Token 挂件设置</span>
              <button className={css.pclose} onClick={() => { setSettingsOpen(false); setPanelPos(null) }}>✕</button>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>语言</span>
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>背景适配</span>
              <select value={themeMode} onChange={(e) => setThemeMode(e.target.value as any)}>
                <option value="auto">自动</option>
                <option value="dark">深色</option>
                <option value="light">浅色</option>
              </select>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>霓虹闪烁</span>
              <select value={flickerLevel} onChange={(e) => setFlickerLevel(e.target.value as any)}>
                <option value="off">关</option>
                <option value="low">低</option>
                <option value="med">中</option>
                <option value="high">高</option>
              </select>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>乱码故障</span>
              <select value={glitchLevel} onChange={(e) => setGlitchLevel(e.target.value as any)}>
                <option value="off">关</option>
                <option value="low">低</option>
                <option value="med">中</option>
                <option value="high">高</option>
              </select>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>数字格式</span>
              <select value={numFormat} onChange={(e) => setNumFormat(e.target.value)}>
                <option value="full">完整</option>
                <option value="compact">精简</option>
              </select>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>文字字号</span>
              <input type="range" min={10} max={22} step={1} value={numSize} onChange={(e) => setNumSize(Number(e.target.value) || 14)} />
              <span className={css.sval}>{numSize}px</span>
            </div>
            <div className={css.hint}>
              {lang === 'zh'
                ? '字号只改变文字大小；拖挂件右下角可整体缩放（含特效）。'
                : 'Font size affects text only; drag the corner to zoom the whole widget (effects included).'}
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>显示标签</span>
              <input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} />
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>连击</span>
              <input type="checkbox" checked={comboOn} onChange={(e) => setComboOn(e.target.checked)} />
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>常驻粒子</span>
              <input type="checkbox" checked={ambientOn} onChange={(e) => setAmbientOn(e.target.checked)} />
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>粒子数量</span>
              <input type="range" min={3} max={16} step={1} value={ambientCount} onChange={(e) => setAmbientCount(Number(e.target.value) || 7)} />
              <span className={css.sval}>{ambientCount}</span>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>粒子颜色</span>
              <select value={particleColor} onChange={(e) => setParticleColor(e.target.value)}>
                <option value="gold">金色</option>
                <option value="cyan">青蓝</option>
                <option value="purple">紫</option>
                <option value="multi">多彩</option>
              </select>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>暴击阈值</span>
              <input type="range" min={500} max={20000} step={500} value={critAbs} onChange={(e) => setCritAbs(Number(e.target.value) || 500)} />
              <span className={css.sval}>{fmt(critAbs)}</span>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>暴击比例</span>
              <input type="range" min={2} max={30} step={1} value={Math.round(critRatio * 100)} onChange={(e) => setCritRatio((Number(e.target.value) || 2) / 100)} />
              <span className={css.sval}>{Math.round(critRatio * 100)}%</span>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>暴击音效</span>
              <input type="checkbox" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} />
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>边缘泛光</span>
              <input type="checkbox" checked={edgeOn} onChange={(e) => setEdgeOn(e.target.checked)} />
            </div>
            <div className={css.srow} style={{ justifyContent: 'flex-start' }}>
              <button
                className={css.pbtn + ' ' + css.testbtn}
                title={lang === 'zh' ? '不改变计数，仅预览动效' : 'Plays the crit effects only — counter untouched'}
                onClick={runTest}
              >
                ⚡ {lang === 'zh' ? '测试特效' : 'Test FX'}
              </button>
            </div>
            <div className={css.srow} style={{ justifyContent: 'flex-start', gap: 10 }}>
              <button className={css.pbtn} onClick={resetPlacement}>重置位置/缩放</button>
              <button className={css.pbtn} onClick={resetSettings}>重置设置</button>
              <button className={css.pbtn} onClick={doCollapse}>折叠</button>
            </div>
          </div>
          )
        : null}
      {edgeKey > 0 && edgeOn ? <div key={'e' + edgeKey} className={css.edge} /> : null}
    </>
  )
}
