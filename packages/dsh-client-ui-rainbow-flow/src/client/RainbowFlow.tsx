/**
 * Rainbow flow components, browser half.
 *
 * Three `conversation.input` entries share one module-level toggle store:
 *
 *  - `RainbowFlowToggle` — a small rainbow-dot button at the left end of the
 *    composer tool row; clicking enables/disables the effect. A live status
 *    dot turns green while the current session runs.
 *  - `RainbowFlowGlow` — the decorative ring + soft halo carved around the
 *    composer card, plus a liquid-glass rim (frosted band + specular top
 *    highlight) that carries the ring like light inside glass. It renders
 *    only while the session runs AND the toggle is on. Its rotation speed
 *    follows the estimated output-token rate sampled from the streaming
 *    `partial` content: faster generation → faster spin; thinking / tool gaps
 *    glide back to a slow drift. Only the crisp ring rotates — the blurred
 *    halo, the glass rim and the specular highlight stay static (ambient
 *    tint + material, painted once, so no per-frame blur recompute). The
 *    ring angle is integrated in a rAF loop while the angular velocity eases
 *    exponentially toward the sampled target, so fast↔slow transitions
 *    accelerate/decelerate smoothly and the rainbow never jumps phase (a
 *    plain `animation-duration` swap would snap the animation's current time
 *    and visibly jump). The loop is gated on visibility — it runs only while
 *    the ring is actually rendered, so an idle composer schedules no rAF
 *    callback at all.
 *  - `RainbowFlowSend` — the send/stop button beautification probe (see its
 *    own doc block below).
 *
 * All entries read the owner share `InputZone` (point-in-time snapshots
 * re-rendered on store change), so no subscription is needed for the running
 * bit. The toggle store uses `useSyncExternalStore` so the entries stay in
 * sync without a Host round-trip.
 *
 * @module @dsh-plugins/client-ui-rainbow-flow/client
 */

import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import React from 'react'
import styles from './RainbowFlow.module.css'
import {
  RIM_RADIUS,
  advanceParticles,
  createParticles,
  rimPoint,
} from './particles'
import { CHARS_PER_TOKEN, SAMPLE_MS, easeSpeed, rateToDuration } from './rate'
import {
  getSettings,
  subscribeSettings,
} from './settings'

/**
 * Inset of the particle path from the flow layer's edge (px). The flow layer
 * hangs 5px beyond the composer card (inset: -5px); there is no glass rim band
 * anymore, so the particles run exactly along the card's edge (5px inside the
 * flow's outer boundary).
 */
const RIM_INSET = 5

/** Hue shift (deg) applied to the clouds while the model is thinking or
 *  running a tool (no new output): +120° turns the rainbow cool (toward
 *  blue/violet) as a subtle "working" mood; it eases back to 0 (full
 *  rainbow) while output streams. */
const COOL_SHIFT = 120

/** Precomputed HSLA fill styles per hue (0-359), one palette for the soft
 *  cloud glow pass and one for the brighter cloud body pass. Built once at
 *  module load and reused every frame — no per-frame string interpolation.
 *  The alpha is applied via `ctx.globalAlpha` per sample, so the styles here
 *  carry only saturation/lightness. */
const GLOW_STYLES: string[] = []
const CORE_STYLES: string[] = []
for (let h = 0; h < 360; h++) {
  GLOW_STYLES.push(`hsla(${h}, 88%, 70%, 1)`)
  CORE_STYLES.push(`hsla(${h}, 92%, 66%, 1)`)
}

/** Owner/standard props of a `conversation.input.left` entry (InputZone share
 *  plus the framework session kit). */
type RainbowFlowProps = PropsRuntime<'conversation.input.left'>

/** Owner/standard props of a `conversation.input.right` entry — the same
 *  InputZone owner share as `.left` (session + live input snapshots). */
type RainbowFlowRightProps = PropsRuntime<'conversation.input.right'>

/** Locale seat injected into the toggle registration (the
 *  `conversation.input.left` slot carries no locale of its own). */
export interface RainbowFlowToggleInjected {
  t: TranslateNS<'rainbow-flow'>
}

/** localStorage key for the on/off toggle (defaults to on). */
const STORAGE_KEY = 'dsh.rnglow.enabled'

/** Window events bridging the widget-manager toggle to this store:
 *  - `dsh.rnglow.manager-toggle` (detail: boolean) — the manager page asks us
 *    to enable/disable; we apply it to the same store as the toolbar dot.
 *  - `dsh.rnglow.enabled-change` (detail: boolean) — announced whenever the
 *    store flips, so the manager page can mirror the live state. */
export const MANAGER_TOGGLE_EVENT = 'dsh.rnglow.manager-toggle'
export const ENABLED_CHANGE_EVENT = 'dsh.rnglow.enabled-change'

/** Module-level toggle store shared by the two entries (localStorage-backed). */
let enabled = true
try {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored !== null) enabled = stored === '1'
} catch { /* storage unavailable: keep the in-memory default */ }

const listeners = new Set<() => void>()

function setEnabled(next: boolean): void {
  if (enabled === next) return
  enabled = next
  try { window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch { /* ignore */ }
  for (const l of listeners) l()
  try { window.dispatchEvent(new CustomEvent(ENABLED_CHANGE_EVENT, { detail: next })) } catch { /* ignore */ }
}

/** Subscribe the manager bridge: apply `dsh.rnglow.manager-toggle` events to
 *  the store. Returns a disposer for the fiber (called from the plugin apply). */
export function mountManagerBridge(): () => void {
  const onToggle = (event: Event): void => {
    const detail = (event as CustomEvent<boolean>).detail
    if (typeof detail === 'boolean') setEnabled(detail)
  }
  window.addEventListener(MANAGER_TOGGLE_EVENT, onToggle)
  return () => { window.removeEventListener(MANAGER_TOGGLE_EVENT, onToggle) }
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

function getSnapshot(): boolean {
  return enabled
}

/** The toggle switch with a live running indicator. */
export function RainbowFlowToggle({ session, t }: RainbowFlowProps & RainbowFlowToggleInjected): React.JSX.Element {
  const on = React.useSyncExternalStore(subscribe, getSnapshot)
  const running = !!session && session.running
  const label = (on ? t('toggleOn') : t('toggleOff')) + (running ? `（${t('running')}）` : `（${t('idle')}）`)
  return (
    <button
      type="button"
      className={styles.toggle
        + (on ? ` ${styles.toggleOn}` : ` ${styles.toggleOff}`)
        + (running ? ` ${styles.toggleRunning}` : '')}
      onClick={() => setEnabled(!on)}
      title={label}
      aria-label={label}
      aria-pressed={on}
    >
      <span className={styles.dot} />
      <span className={styles.status} />
    </button>
  )
}

/** The rainbow edge — a stream of colored light particles flowing along the
 *  composer card's glass rim, speed-driven by the live output-token rate.
 *  The particles are drawn on a canvas that covers the card's glass rim band;
 *  their position on the rounded-rect path is a scalar advanced each frame by
 *  the eased turns-per-second target, so speed changes glide smoothly instead
 *  of stepping or jumping phase. */
export function RainbowFlowGlow({ session }: RainbowFlowProps): React.JSX.Element | null {
  const on = React.useSyncExternalStore(subscribe, getSnapshot)
  const running = !!session && session.running
  // Settings (wisps / opacity / speed / mood) — re-read live on change.
  const settings = React.useSyncExternalStore(subscribeSettings, getSettings)

  // Keep the latest snapshot readable from the rAF loop below.
  const sessionRef = React.useRef(session)
  sessionRef.current = session

  // The canvas is written imperatively each frame; React never touches it.
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)

  // Motion state lives in refs so it survives the effect re-runs that gate
  // the loop on visibility (toggle / running flips): the stream resumes at
  // its previous particle positions and speed seamlessly.
  const emaRef = React.useRef(0)
  const speedRef = React.useRef(0)
  const targetSpeedRef = React.useRef(0)
  const particlesRef = React.useRef(createParticles(settings.wisps))
  // Settings mirrored into refs so the rAF loop reads them without re-render.
  const settingsRef = React.useRef(settings)
  settingsRef.current = settings
  // Mood-driven hue shift (deg): eased toward 0 while the model streams
  // output (full rainbow) and toward the cool shift while it thinks or runs
  // a tool (no new output).
  const moodShiftRef = React.useRef(0)
  const moodTargetRef = React.useRef(0)

  // Drive the particle flow only while the canvas is actually rendered: when
  // the toggle is off or the session is idle the effect body returns early
  // and no rAF callback is ever scheduled, so an idle composer costs nothing.
  React.useEffect(() => {
    if (!on || !running) return

    // Reduced motion: leave the stream static (no rAF, no draw). The query is
    // re-evaluated on every frame and a change listener restarts the loop.
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

    // Sampler state is effect-local on purpose: re-seeding on every loop
    // start avoids a stale dt (long hidden gap) wrongly decaying the EMA.
    let lastLen = -1
    let lastTick = 0
    let lastFrame = 0
    let raf = 0

    // Sample the streaming output length and update the EMA rate -> target
    // turns per second (1 / rotation period: faster output -> faster flow).
    const sample = (now: number): void => {
      const partial = sessionRef.current?.partial ?? null
      let len = 0
      if (partial && Array.isArray(partial.blocks)) {
        for (const b of partial.blocks) {
          if (b && typeof b.text === 'string') len += b.text.length
        }
      }
      if (lastLen < 0) { lastLen = len; lastTick = now; return }
      const dt = (now - lastTick) / 1000
      const dlen = len - lastLen
      lastLen = len
      lastTick = now
      let ema = emaRef.current
      if (dt <= 0 || dlen <= 0) {
        // No new output (thinking / tool gap): glide back toward slow.
        ema *= 0.7
        if (ema < 0.05) ema = 0
      } else {
        const tps = (dlen / dt) / CHARS_PER_TOKEN
        ema = ema === 0 ? tps : ema * 0.7 + tps * 0.3
      }
      emaRef.current = ema
      // Particle flow speed: turns per second = 1 / rotation period, scaled
      // by the user's speed sensitivity setting.
      targetSpeedRef.current = (1 / rateToDuration(ema)) * settingsRef.current.speed
    }

    const draw = (): void => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Size the backing store to the CSS size × device pixel ratio. The
      // canvas covers the whole flow layer; the rim path is drawn inside it
      // at RIM_RADIUS so the particles run along the glass band's center.
      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(cssH * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)

      const w = cssW
      const h = cssH
      const r = RIM_RADIUS
      // The path is inset by RIM_INSET so the particles run along the glass
      // rim's centerline; rimPoint returns local coords, so offset the draw.
      const pw = Math.max(0, w - 2 * RIM_INSET)
      const ph = Math.max(0, h - 2 * RIM_INSET)
      // Cloud rendering: each particle is one SOFT, PUFFY cloud drifting along
      // the rim — a thick, rounded puff (wide low-alpha glow + gentle core)
      // with a nearly-flat envelope. The edge reads as ONE CONTINUOUS flowing
      // cloud band, never as separated particles:
      //  - the wisp span is 1.8× the spacing (heavy overlap), so neighbouring
      //    wisps merge — no visible gap anywhere along the rim;
      //  - the envelope stays ≥ 0.7 (0.7 + 0.3·sin): brightness barely
      //    undulates, so no dark seams read between wisps.
      // Density comes from the count, continuity from overlap + flat envelope.
      const WISP_SPAN = 1.8 / Math.max(1, particlesRef.current.length)
      // Dense sampling: SEGMENTS is sized so the sample spacing (~0.3% of the
      // perimeter ≈ 5px) is well below the cloud dot diameter (glow up to
      // 16px, core ≥ 8px) — the dots always overlap into a continuous ribbon,
      // even while flowing, so no "separated particles" flash between samples.
      const SEGMENTS = 96
      // Mood-driven hue shift: when the model is thinking or running a tool
      // (no new output), the clouds cool toward blue/violet; while it streams
      // output they warm back to the full rainbow. `moodShiftRef` is eased
      // each frame so the transition glides instead of snapping. Disabled when
      // the user turns the mood knob off.
      const shift = settingsRef.current.mood ? moodShiftRef.current : 0
      const opacity = settingsRef.current.opacity

      for (const p of particlesRef.current) {
        // The wisp's front edge is at p.t; walk backward over its span.
        for (let j = 0; j <= SEGMENTS; j++) {
          const u = j / SEGMENTS // 0 = rear end, 1 = front end
          // Nearly-flat envelope: 0.85 ± 0.15 — brightness stays high and
          // almost constant along the rim (core alpha ≥ 0.27, glow ≥ 0.16).
          // With 1.8× wisp overlap every point is covered by multiple wisps,
          // so the flowing edge never reads as separated particles; only a
          // very gentle undulation hints at the cloud wisps.
          const env = 0.85 + 0.15 * Math.sin(u * Math.PI)
          const t = (p.t - WISP_SPAN * (1 - u) + 1) % 1
          const pt = rimPoint(pw, ph, r, t)
          const x = pt.x + RIM_INSET
          const y = pt.y + RIM_INSET
          const hue = (p.hue + u * 20 + shift) % 360 // gentle hue drift inside the wisp
          // Pass 1 — wide cloud glow: big, faint, puffy.
          ctx.beginPath()
          ctx.arc(x, y, 4 + 4 * env, 0, Math.PI * 2)
          ctx.fillStyle = GLOW_STYLES[Math.round(hue)]
          ctx.globalAlpha = (0.05 + 0.13 * env) * opacity
          ctx.fill()
          // Pass 2 — cloud body: medium, soft. Radius floor 4px keeps the core
          // diameter (≥8px) above the ~5px sample spacing at every envelope
          // value, so flowing samples never leave a visible gap between them.
          ctx.beginPath()
          ctx.arc(x, y, 4 + 1.5 * env, 0, Math.PI * 2)
          ctx.fillStyle = CORE_STYLES[Math.round(hue)]
          ctx.globalAlpha = (0.10 + 0.20 * env) * opacity
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }

    const frame = (now: number): void => {
      raf = window.requestAnimationFrame(frame)
      if (lastFrame === 0) {
        // First frame: seed the sampler, nothing to animate yet.
        lastFrame = now
        sample(now)
        return
      }
      const dt = Math.min(0.1, (now - lastFrame) / 1000)
      lastFrame = now
      if (now - lastTick >= SAMPLE_MS) sample(now)

      // Mood: cool toward blue/violet while the model is thinking or running
      // a tool (no new output), warm back to the full rainbow while it
      // streams output. `runningCalls` marks tool execution; a live EMA means
      // output is flowing. Eased so the palette glides, not snaps.
      const snap = sessionRef.current
      const toolWorking = !!snap && Array.isArray(snap.runningCalls) && snap.runningCalls.length > 0
      const outputting = emaRef.current > 0.05
      moodTargetRef.current = toolWorking || !outputting ? COOL_SHIFT : 0
      moodShiftRef.current = easeSpeed(moodShiftRef.current, moodTargetRef.current, dt)

      // Rebuild the stream when the wisp-count setting changes. The new wisps
      // start evenly spaced (positions reset) — a brief re-layout of the cloud
      // positions is expected and acceptable for a rare setting change; the
      // existing eased speed carries over so the flow direction is preserved.
      if (particlesRef.current.length !== settingsRef.current.wisps) {
        particlesRef.current = createParticles(settingsRef.current.wisps)
      }

      // Ease the actual turns-per-second toward the sampled target
      // (frame-rate independent exponential approach), then advance the
      // particle stream — the flow accelerates/decelerates smoothly and the
      // particles never jump position.
      let tps = easeSpeed(speedRef.current, targetSpeedRef.current, dt)
      if (Math.abs(tps) < 0.003) tps = 0
      speedRef.current = tps
      advanceParticles(particlesRef.current, dt, tps)

      draw()
    }

    // Reduced motion: render ONE static frame of the clouds (particles at
    // their current positions, not advancing) so the effect stays visible
    // without animating — then stop scheduling. A change listener resumes the
    // live loop when the OS setting flips back.
    const paintStatic = (): void => { draw() }
    const onReducedChange = (): void => {
      if (reducedQuery.matches) {
        window.cancelAnimationFrame(raf)
        paintStatic()
      } else {
        raf = window.requestAnimationFrame(frame)
      }
    }
    reducedQuery.addEventListener('change', onReducedChange)

    // Pause the rAF loop while the composer is scrolled out of view (the flow
    // layer is inside the card, so observing it is enough) — saves battery on
    // long pages where the composer scrolls off.
    let visible = true
    const observer = typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entries) => {
        const next = entries[0]?.isIntersecting ?? true
        if (next === visible) return
        visible = next
        if (next) {
          if (!reducedQuery.matches) raf = window.requestAnimationFrame(frame)
        } else {
          window.cancelAnimationFrame(raf)
        }
      })
    if (observer && canvasRef.current) observer.observe(canvasRef.current)

    if (reducedQuery.matches) paintStatic()
    else raf = window.requestAnimationFrame(frame)
    return () => {
      window.cancelAnimationFrame(raf)
      reducedQuery.removeEventListener('change', onReducedChange)
      observer?.disconnect()
    }
  }, [on, running])

  if (!on || !running) return null

  return (
    <div className={styles.flow}>
      <div className={styles.glow} />
      <canvas ref={canvasRef} className={styles.ring} />
    </div>
  )
}

/**
 * Send/stop button beautification, browser half.
 *
 * The composer's primary action button (idle = send arrow, running = stop
 * square) is shipped chrome inside `conversation.composer.bar` — it is not a
 * slot, so it cannot be replaced or wrapped. Instead this entry mounts a
 * zero-size invisible probe inside the same composer card
 * (`conversation.input.right`, the trailing row) and mirrors the button's
 * effective state onto the card element as `data-rf-send`:
 *
 *  - `off`  — the rainbow toggle is disabled → no decoration (attribute
 *    removed, shipped look untouched).
 *  - `send` — idle with a draft: rainbow conic fill + breathing glow.
 *  - `stop` — session running (not a continuable subagent, matching the
 *    InputBar `primaryStops` rule): rotating rainbow + expanding pulse ring.
 *
 * The global CSS in `SendButton.css` selects the button through the stable
 * `[data-composer-card]` attribute plus the `_primary` CSS-module suffix (the
 * hash prefix changes between harness builds, the local name does not), so
 * the decoration survives harness upgrades and stays off when the button is
 * disabled (empty draft). `prefers-reduced-motion` freezes the animations.
 *
 * @module @dsh-plugins/client-ui-rainbow-flow/client
 */
export function RainbowFlowSend({ session }: RainbowFlowRightProps): React.JSX.Element {
  const on = React.useSyncExternalStore(subscribe, getSnapshot)
  const running = !!session && session.running
  // Mirrors InputBar's `primaryStops = running && subagent === null`: the
  // primary button turns into a stop control only for the parent session.
  const stops = running && !session?.subagent
  const state = on ? (stops ? 'stop' : 'send') : 'off'

  // The probe lives in the composer card's trailing row, so `closest` walks
  // straight up to the `[data-composer-card]` element carrying the button.
  const probeRef = React.useRef<HTMLSpanElement | null>(null)

  React.useLayoutEffect(() => {
    const card = probeRef.current?.closest('[data-composer-card]')
    if (!(card instanceof HTMLElement)) return
    if (state === 'off') card.removeAttribute('data-rf-send')
    else card.setAttribute('data-rf-send', state)
    return () => { card.removeAttribute('data-rf-send') }
  }, [state])

  return <span ref={probeRef} className={styles.sendProbe} aria-hidden="true" />
}
