/**
 * TokenCritFx — imperative canvas effects layer for the token-crit widget.
 *
 * Everything that was previously a DOM node with a CSS keyframe animation
 * (floating damage numbers, crit tags, burst particles, ambient embers and
 * the combo pop) now lives on a single <canvas> that overlays the badge.
 * The canvas keeps the badge text crisp in DOM/CSS, decouples the effects
 * from React's render cycle (no per-frame setState) and makes the effects
 * cheap to scale up. Drawing coordinates are badge-relative: the canvas is
 * centered on the badge and the badge's layout size (w/h) is pushed in via
 * `setBadgeSize` whenever it changes, so the effects track the badge even
 * while its width changes during a number roll.
 */

/** Public payload for one floating damage number. */
export interface FxFloat {
  kind: 'in' | 'out'
  delta: number
  hue: number
  size: number
  big: boolean
  /** Localized tag text (IN/OUT/CRIT!) or null when disabled. */
  tag: string | null
}

interface FloatState {
  kind: 'in' | 'out'
  /** Big crit — larger glyph, tighter tilt, hotter core color. */
  big: boolean
  x: number
  y: number
  /** Thrown arc as a quadratic bezier (relative to x/y): the float curves
   *  outward toward a random end point, bulging through a control point, so
   *  each number flies off in its own lobbed direction. */
  endX: number
  endY: number
  ctrlX: number
  ctrlY: number
  /** Live bezier target (recomputed every frame). */
  tx: number
  ty: number
  /** Soft repulsion offsets so floats avoid fully overlapping each other. */
  ox: number
  oy: number
  /** Random tilt in radians; big crits stay closer to upright. */
  tilt: number
  text: string
  tag: string | null
  hue: number
  size: number
  tagSize: number
  age: number
  life: number
}

interface ParticleState {
  x: number
  y: number
  vx: number
  vy: number
  hue: number
  size: number
  age: number
  life: number
}

interface EmberState {
  /** 0..1 fraction of the badge width. */
  px: number
  /** 0..1 fraction of the badge height. */
  py: number
  size: number
  hue: number
  dx: number
  dy: number
  /** Full float-cycle duration in seconds. */
  dur: number
  /** 0..1 phase offset so embers don't move in lockstep. */
  phase: number
}

interface ComboState {
  text: string
  born: number
  until: number
}

/**
 * Logical canvas size in CSS pixels. Intentionally larger than the badge so
 * rising floats/tags stay visible above it (the canvas is centered on the
 * badge, so it extends equally in every direction).
 */
// Logical canvas size (CSS px). NOTE: must match the .fxcanvas 340×220 rule
// in TokenCritWidget.module.css — keep the two in sync.
const CANVAS_W = 340
const CANVAS_H = 220

/** Burst particles travel for this many seconds (matches the old 0.9s CSS). */
const BURST_LIFE = 0.9
/** Floats live for this many seconds (matches the old 1.6s CSS). */
const FLOAT_LIFE = 1.6
/** Combo text stays up for 1.6s (matches the old combo window). */
const COMBO_LIFE = 1600
/** Ambient brightness breathing period for the digits (ms). */
const AMBIENT_PERIOD = 3200

/** Tunable neon-flicker / glitch parameters (driven by the settings panel). */
interface NeonFxConfig {
  flickerOn: boolean
  flickerMin: number
  flickerMax: number
  dipMin: number
  dipMax: number
  glitchOn: boolean
  glitchChance: number
  glitchMaxBursts: number
  glitchRatio: number
}

const DEFAULT_NEON_FX: NeonFxConfig = {
  flickerOn: true,
  flickerMin: 1400,
  flickerMax: 4200,
  dipMin: 0.45,
  dipMax: 0.72,
  glitchOn: true,
  glitchChance: 0.06,
  glitchMaxBursts: 2,
  glitchRatio: 0.55,
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Thousands-separated integer formatting, shared with the widget. */
export function fmt(n: number): string {
  const v = Math.round(Number(n) || 0)
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function hueRange(color: string): [number, number] {
  if (color === 'cyan') return [180, 210]
  if (color === 'purple') return [260, 290]
  if (color === 'multi') return [0, 360]
  return [28, 62]
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/** Fraction of the visual bounds used for repulsion: shrunk so floats may
 *  graze each other's glow/edges without visibly "pushing" — only the core
 *  glyph boxes are kept apart (mild overlap is acceptable). */
const REPEL_SHRINK = 0.55

/** Approx monospace half-width of a float's widest line (number or tag). */
function floatHalfW(f: FloatState): number {
  const numW = 0.62 * f.size * f.text.length
  const tagW = f.tag ? 0.62 * f.tagSize * f.tag.length : 0
  return (Math.max(numW, tagW) / 2) * REPEL_SHRINK
}

/** Approx half-height of a float's vertical span (number + tag gap + tag). */
function floatHalfH(f: FloatState): number {
  return (0.7 * f.size + 6 + 0.7 * (f.tagSize || 0)) * REPEL_SHRINK
}

// Upright, not italic: canvas shears italic glyphs, which softens small text
// (see the drawFloats comment) — the combo pop uses the same family.
const MONO = `900 20px ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace`

export class TokenCritFx {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private raf = 0
  private last = 0
  private running = false
  private visible = false
  /** Collapsed-dot state: the rAF loop is fully stopped (hide/show toggles it). */
  private paused = false
  /** Last brightness written to the badge filter, to skip identical writes. */
  private lastBrightness = -1

  /** Display resolution factors: device pixel ratio × widget scale. */
  private dpr = 1
  private anchorScale = 1
  private resolutionDirty = false

  /** Badge layout size (untransformed CSS px), pushed by the widget. */
  private badgeW = 0
  private badgeH = 0

  private floats: FloatState[] = []
  private particles: ParticleState[] = []
  private embers: EmberState[] = []
  private combo: ComboState | null = null
  /** While set, embers render brighter (replaces the old `.boost` CSS). */
  private boostUntil = 0
  /** Light-background mode: deeper, saturated colors with normal compositing
   *  (the pale neon palette and 'lighter' blending vanish on white). */
  private light = false
  /** Badge number + label elements driven by the neon flicker. */
  private numEl: HTMLElement | null = null
  private labelEl: HTMLElement | null = null
  /** Ambient brightness phase for the digits. */
  private ambT = 0
  /** Neon-flicker state machine (a failing neon tube). */
  private flickerNextAt = 1200
  private flickerPhase = -1
  private flickerSteps: { b: number; dur: number }[] = []
  private flickerStepAt = 0
  /** Random-character glitch burst on the digits during flicker. */
  private glitchActive = false
  private glitchRealText = ''
  private glitchEndAt = 0
  private glitchBursts = 0
  /** Current flicker/glitch tuning from the settings panel. */
  private neonFx: NeonFxConfig = { ...DEFAULT_NEON_FX }

  /** Start the rAF loop and bind to the given canvas. */
  attach(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      // No 2d context (extreme configs / unsupported canvas): degrade to a
      // silent no-op rather than crashing or leaving the loop drawing nothing.
      this.canvas = null
      this.ctx = null
      return
    }
    this.canvas = canvas
    this.ctx = ctx
    this.dpr = clamp(window.devicePixelRatio || 1, 1, 3)
    this.applyResolution()
    this.visible = true
    this.paused = false
    if (!this.running) {
      this.running = true
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  /**
   * Track the widget's own scale. The anchor is CSS-transformed by it, so the
   * canvas backing store must grow to `CSS size × dpr × scale` — otherwise the
   * browser samples the bitmap at a non-1:1 ratio and the text turns blurry.
   */
  setResolution(scale: number): void {
    const s = clamp(scale, 0.6, 2.5)
    if (s === this.anchorScale) return
    this.anchorScale = s
    // Apply inside the rAF loop (not here) so the resize-drag never paints a
    // blank frame: setting canvas.width clears the bitmap synchronously.
    this.resolutionDirty = true
  }

  private applyResolution(): void {
    if (!this.canvas) return
    this.canvas.width = Math.max(1, Math.round(CANVAS_W * this.dpr * this.anchorScale))
    this.canvas.height = Math.max(1, Math.round(CANVAS_H * this.dpr * this.anchorScale))
  }

  /** Stop the loop and release the canvas (widget unmount). */
  detach(): void {
    this.running = false
    this.visible = false
    this.paused = false
    cancelAnimationFrame(this.raf)
    this.canvas = null
    this.ctx = null
    // Drop every transient collection: the engine may be re-attached later
    // (StrictMode double-mount / widget re-registration) and must not paint
    // residue from a previous life.
    this.floats = []
    this.particles = []
    this.embers = []
    this.combo = null
    this.numEl = null
    this.labelEl = null
    this.lastBrightness = -1
    this.glitchActive = false
  }

  /** Resume drawing after expanding from the collapsed dot. */
  show(): void {
    this.visible = true
    this.paused = false
    this.last = performance.now()
    if (this.running) this.raf = requestAnimationFrame(this.frame)
  }

  /** Stop drawing and clear the canvas (collapsed dot mode). The rAF loop is
   *  paused entirely — an empty 60fps callback would waste battery/CPU while
   *  the widget sits as a dot. */
  hide(): void {
    this.visible = false
    this.paused = true
    cancelAnimationFrame(this.raf)
    this.clear()
  }

  /** Track badge layout size changes so effects stay badge-relative. */
  setBadgeSize(w: number, h: number): void {
    this.badgeW = w
    this.badgeH = h
  }

  /**
   * Attach (or detach with null) the badge number and label elements so the
   * engine can drive the neon flicker on them. Re-attach on badge remounts.
   */
  attachNeon(numEl: HTMLElement | null, labelEl: HTMLElement | null): void {
    this.numEl = numEl
    this.labelEl = labelEl
    // A remount replaces the element: cancel any in-flight glitch so the new
    // element isn't restored with a stale text snapshot, and reset the cached
    // brightness so the fresh element receives the current filter value.
    this.glitchActive = false
    this.lastBrightness = -1
  }

  /** Switch to (or off) the light-background palette. */
  setLight(on: boolean): void {
    this.light = on
  }

  /** Apply the neon-flicker / glitch tuning from the settings panel. */
  setNeonFx(cfg: NeonFxConfig): void {
    this.neonFx = { ...cfg }
  }

  /** (Re)generate the ambient embers for the given count/color. */
  setAmbient(count: number, color: string): void {
    this.embers = []
    if (count <= 0) return
    const r = hueRange(color)
    for (let i = 0; i < count; i++) {
      this.embers.push({
        px: rand(0.1, 0.9),
        py: rand(0.35, 0.9),
        size: rand(1.5, 4),
        hue: Math.round(r[0] + Math.random() * (r[1] - r[0])),
        dx: rand(-16, 16),
        dy: -rand(26, 54),
        dur: rand(2.6, 5),
        phase: Math.random(),
      })
    }
  }

  /** Spawn one floating damage number (+ its tag). Each is "thrown" along a
   *  random quadratic-bezier arc: the end point is a random sideways-up toss
   *  and the control point bulges outward, so trajectories curve in different
   *  directions instead of rising straight up. The spawn spot is retried a few
   *  times to avoid dropping the new float on top of an existing one. */
  spawnFloat(f: FxFloat): void {
    const xFrac = f.kind === 'in' ? 0.38 : 0.62
    const endX = rand(-60, 60)
    const endY = -rand(30, 55)
    const cand: FloatState = {
      kind: f.kind,
      big: f.big,
      x: 0,
      y: 0,
      endX,
      endY,
      // The arc comes from a strong SIDEWAYS bulge (control point 2–3× the
      // horizontal throw), while the vertical control stays near the end point
      // so the float rises monotonically — a curveball toss, never falling
      // back down toward the badge.
      ctrlX: endX * rand(2, 3),
      ctrlY: endY * rand(1, 1.15),
      // Random tilt ±9° (big crits ±4° so the hero number reads solid).
      tilt: (Math.random() * 2 - 1) * ((f.big ? 4 : 9) * Math.PI) / 180,
      text: '+' + fmt(f.delta),
      tag: f.tag,
      hue: f.hue,
      // Integer font size — fractional sizes rasterize glyphs blurry on canvas.
      size: Math.round(f.size),
      tagSize: f.big ? 13 : 11,
      age: 0,
      life: rand(FLOAT_LIFE - 0.3, FLOAT_LIFE + 0.3),
      tx: 0,
      ty: 0,
      ox: 0,
      oy: 0,
    }
    const baseX = this.badgeX(xFrac)
    const baseY = this.badgeY(0.42)
    for (let attempt = 0; attempt < 6; attempt++) {
      cand.x = baseX + Math.round(rand(-14, 14))
      cand.y = baseY + Math.round(rand(-6, 6))
      if (!this.overlapsAnyFloat(cand)) break
    }
    // Seed the bezier targets with the landing point. tx/ty are otherwise 0
    // until the first animation tick, which would make overlapsAnyFloat treat
    // a just-spawned float as sitting at (0,0) — two floats spawned in the
    // SAME frame (input+output growing together) would then pass the overlap
    // check and stack on the same spot.
    cand.tx = cand.x
    cand.ty = cand.y
    this.floats.push(cand)
    if (this.floats.length > 24) this.floats.splice(0, this.floats.length - 24)
  }

  /** True when the candidate's spawn box overlaps any existing float. */
  private overlapsAnyFloat(cand: FloatState): boolean {
    const cw = floatHalfW(cand)
    const ch = floatHalfH(cand)
    for (const other of this.floats) {
      const ox = cw + floatHalfW(other) - Math.abs((other.tx + other.ox) - cand.x)
      const oy = ch + floatHalfH(other) - Math.abs((other.ty + other.oy) - cand.y)
      if (ox > 0 && oy > 0) return true
    }
    return false
  }

  /** Spawn a radial particle burst from the badge center. */
  spawnBurst(hue: number, big: boolean): void {
    const n = big ? 18 : 11 + Math.floor(Math.random() * 6)
    const cx = CANVAS_W / 2
    const cy = CANVAS_H / 2
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n + Math.random() * 0.7
      const dist = rand(20, big ? 60 : 44)
      this.particles.push({
        x: cx,
        y: cy,
        vx: (Math.cos(angle) * dist) / BURST_LIFE,
        // Slight upward bias so the burst sprays away from the badge
        // instead of snowing over the number.
        vy: (Math.sin(angle) * dist) / BURST_LIFE - 12,
        hue: hue + Math.round(rand(-15, 15)),
        size: rand(2, big ? 6 : 5),
        age: 0,
        life: BURST_LIFE,
      })
    }
    if (this.particles.length > 160) this.particles.splice(0, this.particles.length - 160)
  }

  /** Show (or refresh) the combo pop above the badge. */
  setCombo(text: string): void {
    const now = performance.now()
    this.combo = { text, born: now, until: now + COMBO_LIFE }
  }

  /** Brighten the embers for ~0.9s (old `.boost .ambient` effect). */
  setBoost(on: boolean): void {
    this.boostUntil = on ? performance.now() + 900 : 0
  }

  private badgeX(frac: number): number {
    return (CANVAS_W - this.badgeW) / 2 + this.badgeW * frac
  }

  private badgeY(frac: number): number {
    return (CANVAS_H - this.badgeH) / 2 + this.badgeH * frac
  }

  private clear(): void {
    const ctx = this.ctx
    if (!ctx || !this.canvas) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    // Backing store size (CSS size × dpr), not the logical size.
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.restore()
  }

  private frame = (now: number): void => {
    if (!this.running) return
    if (this.paused) {
      // hide() cancelled the loop — never reschedule here (a queued callback
      // racing the cancel would otherwise keep the loop alive forever).
      return
    }
    if (document.hidden) {
      // Hidden tab: skip work, keep the loop alive so it resumes on return.
      this.raf = requestAnimationFrame(this.frame)
      return
    }
    const dt = clamp((now - this.last) / 1000, 0, 0.05)
    this.last = now
    this.updateNeonFlicker(dt)
    if (this.resolutionDirty) {
      this.resolutionDirty = false
      this.applyResolution()
    }
    if (this.visible) this.render(dt, now)
    this.raf = requestAnimationFrame(this.frame)
  }

  private render(dt: number, now: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const res = this.dpr * this.anchorScale
    ctx.setTransform(res, 0, 0, res, 0, 0)
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    this.drawEmbers(now)
    this.drawParticles(dt)
    this.drawFloats(dt)
    this.drawCombo(now)
  }

  /**
   * Cyberpunk neon flicker on the badge number (+ label): mostly steady with
   * a subtle breathing hum, and every 1.4–4.2s a random episode of quick
   * brightness dips and stutters — like a failing neon tube. Driven from the
   * rAF loop because the badge key-remounts on every usage growth, which would
   * restart a CSS animation before it can flicker.
   */
  private updateNeonFlicker(dt: number): void {
    const el = this.numEl
    if (!el && !this.labelEl) return
    this.ambT = (this.ambT + dt * 1000) % AMBIENT_PERIOD
    const now = performance.now()
    // Continuous subtle hum — but only while the flicker effect is enabled;
    // with flicker 'off' the digits stay perfectly steady at 1.0.
    let b = this.neonFx.flickerOn
      ? 1 + 0.04 * Math.sin((this.ambT / AMBIENT_PERIOD) * Math.PI * 2)
      : 1
    if (this.flickerPhase >= 0) {
      // Mid-episode: step through the dim/stutter pattern.
      if (now >= this.flickerStepAt) {
        this.flickerPhase++
        if (this.flickerPhase >= this.flickerSteps.length) {
          this.flickerPhase = -1
          this.flickerNextAt = now + rand(this.neonFx.flickerMin, this.neonFx.flickerMax)
        } else {
          this.flickerStepAt = now + this.flickerSteps[this.flickerPhase].dur
        }
      }
      if (this.flickerPhase >= 0) {
        b *= this.flickerSteps[this.flickerPhase].b
      }
    } else if (this.neonFx.flickerOn && now >= this.flickerNextAt) {
      // Start a random flicker episode: 1–4 dips with stuttery recoveries.
      const n = 1 + Math.floor(Math.random() * 4)
      this.flickerSteps = []
      for (let i = 0; i < n; i++) {
        this.flickerSteps.push({ b: rand(this.neonFx.dipMin, this.neonFx.dipMax), dur: 45 + Math.random() * 120 })
        this.flickerSteps.push({ b: 1, dur: 30 + Math.random() * 90 })
      }
      this.flickerSteps.push({ b: 1, dur: 250 })
      this.flickerPhase = 0
      this.flickerStepAt = now + this.flickerSteps[0].dur
      this.glitchBursts = 0
    }
    // Quantize to two decimals and only write when the value actually changed:
    // the hum is ±0.04 around 1.0, so an unquantized write would touch the DOM
    // style every frame for the whole session.
    const brightness = Number(b.toFixed(2))
    if (brightness !== this.lastBrightness) {
      this.lastBrightness = brightness
      const filter = 'brightness(' + brightness + ')'
      if (el) el.style.filter = filter
      if (this.labelEl) this.labelEl.style.filter = filter
    }

    // Random-character glitch bursts while the digits are flickering: rare
    // and PARTIAL — only some digit positions corrupt (per the panel tuning).
    if (!el) return
    if (this.glitchActive) {
      if (now >= this.glitchEndAt) {
        el.textContent = this.glitchRealText
        this.glitchActive = false
      }
    } else if (
      this.neonFx.glitchOn &&
      this.flickerPhase >= 0 &&
      this.glitchBursts < this.neonFx.glitchMaxBursts &&
      Math.random() < this.neonFx.glitchChance
    ) {
      this.glitchBursts++
      this.glitchRealText = el.textContent ?? ''
      el.textContent = this.glitchText(this.glitchRealText)
      this.glitchEndAt = now + 50 + Math.random() * 70
      this.glitchActive = true
    }
  }

  /**
   * Partially corrupt digits: keep punctuation and the leading digit (so the
   * magnitude stays recognizable), and swap only a configurable fraction of
   * the remaining positions — with SYMBOLS only, so it reads as corruption,
   * never as the value actually changing.
   */
  private glitchText(real: string): string {
    const pool = '#$%&@*+=/\\|?!'
    let out = ''
    for (let i = 0; i < real.length; i++) {
      const ch = real[i]
      if (ch === ',' || ch === '.' || ch === ' ') {
        out += ch
      } else if (i === 0 || Math.random() >= this.neonFx.glitchRatio) {
        out += ch
      } else {
        out += pool[Math.floor(Math.random() * pool.length)]
      }
    }
    return out
  }

  private drawEmbers(now: number): void {
    const ctx = this.ctx
    if (!ctx || this.embers.length === 0) return
    ctx.save()
    // 'lighter' blending adds light — invisible on pale backgrounds, so light
    // mode uses normal compositing with deeper colors.
    ctx.globalCompositeOperation = this.light ? 'source-over' : 'lighter'
    const boost = now < this.boostUntil
    const boostAlpha = boost ? (this.light ? 1.35 : 1.9) : 1
    // Dimmer/cooler than the IN floats so embers never read as float ghosts.
    const light = this.light ? (boost ? 45 : 38) : (boost ? 68 : 55)
    for (const e of this.embers) {
      const t = (((now / 1000) + e.phase * e.dur) % e.dur) / e.dur
      // Alpha envelope: 0 → .7 (25%) → .35 (60%) → 0.
      let alpha: number
      if (t < 0.25) alpha = (t / 0.25) * 0.7
      else if (t < 0.6) alpha = 0.7 - ((t - 0.25) / 0.35) * 0.35
      else alpha = 0.35 * (1 - (t - 0.6) / 0.4)
      if (alpha <= 0.01) continue
      const scale = easeOutQuad(t)
      const x = this.badgeX(e.px) + e.dx * scale
      const y = this.badgeY(e.py) + e.dy * scale
      ctx.globalAlpha = Math.min(1, alpha * boostAlpha)
      ctx.fillStyle = `hsl(${e.hue},100%,${light}%)`
      ctx.shadowColor = this.light
        ? `hsla(${e.hue},100%,30%,.7)`
        : `hsla(${e.hue},100%,60%,.85)`
      ctx.shadowBlur = 4
      ctx.beginPath()
      ctx.arc(x, y, Math.max(0.3, (e.size / 2) * scale), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  private drawParticles(dt: number): void {
    const ctx = this.ctx
    if (!ctx || this.particles.length === 0) return
    ctx.save()
    ctx.globalCompositeOperation = this.light ? 'source-over' : 'lighter'
    const arr = this.particles
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i]
      p.age += dt
      if (p.age >= p.life) {
        arr.splice(i, 1)
        continue
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      const k = 1 - p.age / p.life // 1 → 0
      ctx.globalAlpha = k
      ctx.fillStyle = `hsl(${p.hue},100%,${this.light ? 45 : 60}%)`
      ctx.shadowColor = this.light
        ? `hsla(${p.hue},100%,35%,.6)`
        : `hsla(${p.hue},100%,55%,.9)`
      ctx.shadowBlur = 6
      ctx.beginPath()
      ctx.arc(p.x, p.y, Math.max(0.3, (p.size / 2) * (0.2 + 0.8 * k)), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  private drawFloats(dt: number): void {
    const ctx = this.ctx
    if (!ctx || this.floats.length === 0) return
    const arr = this.floats

    // Phase A — advance age, recompute the bezier target, decay repulsion.
    for (let i = arr.length - 1; i >= 0; i--) {
      const f = arr[i]
      f.age += dt
      if (f.age >= f.life) {
        arr.splice(i, 1)
        continue
      }
      const k = f.age / f.life
      const inv = 1 - k
      // Quadratic-bezier throw: bulge through the control point toward the
      // random end point; alpha/scale stay progress-based.
      f.tx = Math.round(f.x + 2 * inv * k * f.ctrlX + k * k * f.endX)
      f.ty = Math.round(f.y + 2 * inv * k * f.ctrlY + k * k * f.endY)
      // Slow decay so accumulated separation persists while floats are close.
      f.ox *= 0.92
      f.oy *= 0.92
    }

    // Phase B — soft repulsion: push overlapping floats apart along their
    // center line, heavier (bigger) floats moving less. Offsets are capped so
    // when space genuinely runs out they may still touch.
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i]
        const ahw = floatHalfW(a)
        const ahh = floatHalfH(a)
        const ax = a.tx + a.ox
        const ay = a.ty + a.oy
        for (let j = i + 1; j < arr.length; j++) {
          const b = arr[j]
          const bx = b.tx + b.ox
          const by = b.ty + b.oy
          const dx = bx - ax
          const dy = by - ay
          const ox = ahw + floatHalfW(b) - Math.abs(dx)
          const oy = ahh + floatHalfH(b) - Math.abs(dy)
          if (ox <= 0 || oy <= 0) continue
          const dist = Math.hypot(dx, dy)
          const nx = dist > 0.01 ? dx / dist : (i % 2 ? 1 : -1)
          const ny = dist > 0.01 ? dy / dist : 0
          // Displacement is split inversely by size: the smaller float yields.
          const wa = 1 / a.size
          const wb = 1 / b.size
          const push = Math.min(5, Math.min(ox, oy) / 2)
          const sa = push * (wb / (wa + wb))
          const sb = push * (wa / (wa + wb))
          a.ox -= nx * sa
          a.oy -= ny * sa
          b.ox += nx * sb
          b.oy += ny * sb
        }
      }
    }
    for (const f of arr) {
      const m = Math.hypot(f.ox, f.oy)
      if (m > 55) {
        f.ox *= 55 / m
        f.oy *= 55 / m
      }
      // Don't let repulsion push a float down over the badge number.
      const floor = f.y + 20 - f.ty
      if (f.oy > floor) f.oy = floor
    }

    // Phase C — draw at target + accumulated offset.
    for (const f of arr) {
      const k = f.age / f.life
      const x = Math.round(f.tx + f.ox)
      const y = Math.round(f.ty + f.oy)
      // Pop in quickly (overshoot to 1.25), settle back to EXACTLY 1.0 so the
      // glyphs rasterize crisp for the rest of the float's life; only shrink
      // during the fade-out tail. The 1.25 → 1.0 step eases over 0.12–0.22
      // instead of jumping (a hard cut visibly snaps the number back).
      let scale: number
      if (k < 0.12) scale = 0.3 + (k / 0.12) * 0.95 // 0.3 → 1.25
      else if (k < 0.22) scale = 1 + 0.25 * (1 - (k - 0.12) / 0.10) // 1.25 → 1.0
      else if (k < 0.7) scale = 1
      else scale = 1 - ((k - 0.7) / 0.3) * 0.15 // → 0.85
      // Fade starts at 70% of life (was 80%) so dense streams of floats thin
      // out earlier instead of piling up at the top of their travel.
      const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3
      // Cyberpunk neon: cyan input, magenta output, near-white-hot crit core
      // so the big number clearly outranks the OUT family. Light mode drops
      // the lightness so the saturated hues read on pale backgrounds.
      const light = f.kind === 'in'
        ? (this.light ? 52 : 70)
        : f.big
          ? (this.light ? 64 : 94)
          : (this.light ? 48 : 68)

      ctx.save()
      ctx.translate(x, y)
      if (scale !== 1) ctx.scale(scale, scale)
      ctx.rotate(f.tilt)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // No synthetic italic: canvas shears italic glyphs, which softens small
      // text noticeably. Bold upright keeps the strokes crisp.
      ctx.font = `900 ${f.size}px ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace`
      this.drawGlowText(ctx, f.text, f.hue, light, alpha, f.size)
      ctx.restore()

      if (f.tag) {
        // The tag follows the number's horizontal offset and the same vertical
        // repulsion, keeping the pair aligned.
        const tagY = Math.round(this.badgeY(0.06) + (f.ty - f.y) + f.oy)
        ctx.save()
        ctx.translate(x, tagY)
        if (scale !== 1) ctx.scale(scale, scale)
        ctx.rotate(f.tilt)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = `900 ${f.tagSize}px ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace`
        this.drawGlowText(ctx, f.tag, f.hue, light, alpha, f.tagSize)
        ctx.restore()
      }
    }
  }

  /**
   * Cyberpunk text rendering: a soft halo pass, then a chromatic-aberration
   * RGB split — magenta fringe on the left, cyan fringe on the right, bright
   * core on top. The core glyph is drawn last and crisp, so the fringes read
   * as holographic color fringing, not blur. The blur is proportional to the
   * glyph size so a small tag never drowns in its own halo.
   */
  private drawGlowText(
    ctx: CanvasRenderingContext2D,
    text: string,
    hue: number,
    light: number,
    alpha: number,
    size: number,
  ): void {
    const fringe = Math.max(1, Math.round(size * 0.09))
    const rim = Math.max(1, Math.round(size * 0.06))
    // Dark rim first: four offset copies outline the glyph so it stays
    // readable when burst particles or embers cross behind it (works on both
    // dark and light backgrounds).
    ctx.shadowBlur = 0
    ctx.shadowColor = 'transparent'
    ctx.globalAlpha = alpha * 0.7
    ctx.fillStyle = 'rgba(8, 8, 12, 0.65)'
    ctx.fillText(text, -rim, 0)
    ctx.fillText(text, rim, 0)
    ctx.fillText(text, 0, -rim)
    ctx.fillText(text, 0, rim)
    // Halo pass (kept below the fringes' alpha so the chroma split reads
    // sharper than the bloom). Light mode uses a deeper glow that still
    // separates the glyph from the pale page.
    ctx.shadowColor = this.light
      ? `hsla(${hue},100%,38%,.55)`
      : `hsla(${hue},100%,60%,.7)`
    ctx.shadowBlur = Math.max(2, Math.min(5, size * 0.2))
    ctx.globalAlpha = alpha * 0.8
    ctx.fillStyle = `hsl(${hue},100%,${Math.min(96, light + 8)}%)`
    ctx.fillText(text, 0, 0)
    // Chromatic-aberration fringes (deeper in light mode).
    ctx.shadowBlur = 0
    ctx.shadowColor = 'transparent'
    ctx.globalAlpha = alpha * 0.5
    ctx.fillStyle = this.light ? 'hsl(315,100%,40%)' : 'hsl(310,100%,62%)'
    ctx.fillText(text, -fringe, 0)
    ctx.fillStyle = this.light ? 'hsl(190,100%,36%)' : 'hsl(185,100%,60%)'
    ctx.fillText(text, fringe, 0)
    // Bright crisp core.
    ctx.globalAlpha = alpha
    ctx.fillStyle = `hsl(${hue},100%,${light}%)`
    ctx.fillText(text, 0, 0)
  }

  private drawCombo(now: number): void {
    const c = this.combo
    if (!c) return
    if (now > c.until) {
      this.combo = null
      return
    }
    const ctx = this.ctx
    if (!ctx) return
    const k = (now - c.born) / 1000
    const scale = 1 + 0.45 * Math.exp(-5 * k)
    ctx.save()
    ctx.translate(Math.round(CANVAS_W / 2), Math.round(this.badgeY(0) - 24))
    ctx.scale(scale, scale)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = MONO
    // Cyan HUD combo, matching the cyberpunk palette (deeper on light bg).
    this.drawGlowText(ctx, c.text, 195, this.light ? 45 : 70, 1, 20)
    ctx.restore()
  }
}
