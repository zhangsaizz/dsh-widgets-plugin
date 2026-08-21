/**
 * Rainbow flow components, browser half.
 *
 * Three `conversation.input` entries share one module-level toggle store:
 *
 *  - `RainbowFlowToggle` — a small rainbow-dot button at the left end of the
 *    composer tool row; clicking enables/disables the effect. A live status
 *    dot turns green while the current session runs.
 *  - `RainbowFlowGlow` — the decorative halo around the composer card. It
 *    renders only while the session runs AND the toggle is on. Two stacked
 *    box-shadow layers (warm rainbow + cool blue/violet), screen-blended so
 *    the colours stay luminous on a dark page, whose
 *    opacity pulses on a sine wave (pure intensity breathing — no transform,
 *    so the glow stays pinned to the card edge and never exposes an inner
 *    outline), and the breathing rhythm follows
 *    the estimated output-token rate sampled from the streaming `partial`
 *    content — faster generation → faster breathing; thinking / tool gaps
 *    glide back to a slow, calm breath. The breathing frequency is
 *    integrated in a rAF loop while the frequency itself eases exponentially
 *    toward the sampled target, so fast↔slow transitions accelerate/
 *    decelerate smoothly and the phase never jumps (a plain
 *    `animation-duration` swap would snap the animation's current time and
 *    visibly jump). Per frame, only opacity is written on the
 *    two static shadow layers (compositor-friendly — nothing re-rasterizes;
 *    the slow CSS hue-rotate flow is the only thing that re-rasterizes, and
 *    it is a 48s drift, not per-frame JS work).
 *    The thinking cool-tint is a cross-fade: the eased mood factor moves
 *    opacity from the warm layer to the cool layer, pure opacity animation.
 *    Box-shadow lives OUTSIDE the element and follows its border-radius —
 *    the card interior stays completely clean and the glow hugs the card's
 *    rounded corners. The loop is gated on visibility — it runs only while
 *    the halo is actually rendered, so an idle composer schedules no rAF
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
import { CHARS_PER_TOKEN, SAMPLE_MS, easeSpeed, rateToDuration } from './rate'
import {
  getSettings,
  subscribeSettings,
} from './settings'

/** Breathing envelope of the halo: the sine wave runs 0..1 and maps to
 *  opacity between `BREATH_OPACITY_BASE` (peak-in) and `BASE + AMPLITUDE`
 *  (peak-out) — multiplied by the user's opacity setting. Breathing is
 *  PURELY an intensity pulse — deliberately NO transform/scale: scaling the
 *  glow layers would move their edges off the card (the card itself does not
 *  scale), which re-opens the inner-outline gap at the peak of each breath.
 *  Keeping the layers pinned to the card edge means the shadow peak stays on
 *  the edge at every phase; the stronger brightness swing (0.18..0.38, a 2.1×
 *  contrast) reads as the light expanding with each breath without any
 *  geometry moving. The halo is screen-blended box-shadow (soft, rounded,
 *  outside the card), so the base sits wide: the vivid shadow colours × this
 *  breathing opacity land the visible intensity around 0.12..0.28 — clearly
 *  colourful but soft, while the glass panel itself never flashes. */
const BREATH_OPACITY_BASE = 0.18
const BREATH_OPACITY_AMPLITUDE = 0.20

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

/** The breathing rainbow halo around the composer card. Two stacked
 *  screen-blended box-shadow layers (a warm rainbow layer + a cool blue/
 *  violet layer), living outside the card and following its border-radius,
 *  whose opacity pulses on a sine
 *  wave (pure intensity — no transform, so the layers stay pinned to the
 *  card edge and never expose an inner outline); the breathing frequency
 *  follows
 *  the live output-token rate (same 5s↔1s mapping the old flow used for
 *  rotation). Motion is written imperatively on the layers each frame
 *  (opacity only — compositor-friendly, the static shadow
 *  layers are rasterized once), and the frequency eases exponentially toward
 *  the sampled target so fast↔slow transitions glide instead of snapping
 *  phase. The thinking cool-tint is a cross-fade: the eased mood factor moves
 *  opacity from the warm layer to the cool layer — pure opacity animation,
 *  nothing re-rasterizes (see the module header). */
export function RainbowFlowGlow({ session }: RainbowFlowProps): React.JSX.Element | null {
  const on = React.useSyncExternalStore(subscribe, getSnapshot)
  const running = !!session && session.running
  // Settings (opacity / speed / mood) — re-read live on change.
  const settings = React.useSyncExternalStore(subscribeSettings, getSettings)

  // Keep the latest snapshot readable from the rAF loop below.
  const sessionRef = React.useRef(session)
  sessionRef.current = session

  // The two halo layers are written imperatively each frame; React never
  // touches them.
  const warmRef = React.useRef<HTMLDivElement | null>(null)
  const coolRef = React.useRef<HTMLDivElement | null>(null)

  // Motion state lives in refs so it survives the effect re-runs that gate
  // the loop on visibility (toggle / running flips): the breath resumes at
  // its previous phase and rhythm seamlessly.
  const emaRef = React.useRef(0)
  const hzRef = React.useRef(0)
  const targetHzRef = React.useRef(0)
  const phaseRef = React.useRef(0)
  // Settings mirrored into refs so the rAF loop reads them without re-render.
  const settingsRef = React.useRef(settings)
  settingsRef.current = settings
  // Mood factor 0..1 (0 = full rainbow, 1 = fully cool): eased toward 1
  // while the model thinks or runs a tool, back to 0 while it streams output.
  const moodFactorRef = React.useRef(0)
  const moodTargetRef = React.useRef(0)

  // Apply the current breathing envelope + mood cross-fade to both layers.
  // Shared by the live loop and the reduced-motion static frame. Only opacity
  // is written — no transform, so the glow layers stay pinned to the card
  // edge at every breath phase (scaling them would expose an inner outline
  // when the layer edges drift off the unscaled card).
  const applyFrame = (env: number, moodFactor: number): void => {
    const warm = warmRef.current
    const cool = coolRef.current
    if (!warm || !cool) return
    const breath = settingsRef.current.opacity * (BREATH_OPACITY_BASE + BREATH_OPACITY_AMPLITUDE * env)
    const warmOpacity = breath * (1 - moodFactor)
    const coolOpacity = breath * moodFactor
    warm.style.opacity = String(warmOpacity)
    cool.style.opacity = String(coolOpacity)
  }

  // Drive the breathing only while the halo is actually rendered: when the
  // toggle is off or the session is idle the effect body returns early and
  // no rAF callback is ever scheduled, so an idle composer costs nothing.
  React.useEffect(() => {
    if (!on || !running) return

    // Reduced motion: leave the halo static (no rAF, no writes). The query is
    // re-evaluated on every frame and a change listener restarts the loop.
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

    // Sampler state is effect-local on purpose: re-seeding on every loop
    // start avoids a stale dt (long hidden gap) wrongly decaying the EMA.
    let lastLen = -1
    let lastTick = 0
    let lastFrame = 0
    let raf = 0

    // Sample the streaming output length and update the EMA rate -> target
    // breathing frequency in Hz (1 / period: faster output -> faster breath).
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
      // Breathing frequency: 1 / breath period (the old flow's 5s..1s span,
      // calm at rest, quick while streaming), scaled by the speed sensitivity.
      targetHzRef.current = (1 / rateToDuration(ema)) * settingsRef.current.speed
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
      // output is flowing. Eased so the cross-fade glides, not snaps.
      const snap = sessionRef.current
      const toolWorking = !!snap && Array.isArray(snap.runningCalls) && snap.runningCalls.length > 0
      const outputting = emaRef.current > 0.05
      moodTargetRef.current = toolWorking || !outputting ? 1 : 0
      moodFactorRef.current = easeSpeed(moodFactorRef.current, moodTargetRef.current, dt)

      // Ease the actual breathing frequency toward the sampled target
      // (frame-rate independent exponential approach), then integrate the
      // phase — the breath accelerates/decelerates smoothly and never jumps.
      let hz = easeSpeed(hzRef.current, targetHzRef.current, dt)
      if (Math.abs(hz) < 0.003) hz = 0
      hzRef.current = hz
      phaseRef.current += hz * Math.PI * 2 * dt

      // Apply the breathing envelope + mood cross-fade. Only opacity is
      // written (compositor-friendly) — the static box-shadow layers are
      // rasterized once; the slow CSS hue-rotate flow is the only per-frame
      // re-rasterization, and it is browser-driven, not JS work.
      const env = 0.5 + 0.5 * Math.sin(phaseRef.current)
      applyFrame(env, settingsRef.current.mood ? moodFactorRef.current : 0)
    }

    // Reduced motion: render ONE static mid-breath frame of the halo (halo at
    // its resting opacity, mood at its current eased value) so the
    // effect stays visible without animating — then stop scheduling. A change
    // listener resumes the live loop when the OS setting flips back.
    const paintStatic = (): void => {
      applyFrame(0.5, settingsRef.current.mood ? moodFactorRef.current : 0)
    }
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
    if (observer && warmRef.current) observer.observe(warmRef.current)

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
      <div ref={warmRef} className={styles.glow} />
      <div ref={coolRef} className={styles.glowCool} />
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
