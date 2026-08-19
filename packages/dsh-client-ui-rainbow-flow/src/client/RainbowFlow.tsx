/**
 * Rainbow flow components, browser half.
 *
 * Two `conversation.input.left` entries share one module-level toggle store:
 *
 *  - `RainbowFlowToggle` — a small rainbow-dot button at the left end of the
 *    composer tool row; clicking enables/disables the effect. A live status
 *    dot turns green while the current session runs.
 *  - `RainbowFlowGlow` — the decorative ring + soft halo carved around the
 *    composer card. It renders only while the session runs AND the toggle is
 *    on. Its rotation speed follows the estimated output-token rate sampled
 *    from the streaming `partial` content: faster generation → faster spin;
 *    thinking / tool gaps glide back to a slow drift. Only the crisp ring
 *    rotates — the blurred halo stays static (an ambient tint, painted once,
 *    so no per-frame blur recompute). The ring angle is integrated in a rAF
 *    loop while the angular velocity eases exponentially toward the sampled
 *    target, so fast↔slow transitions accelerate/decelerate smoothly and the
 *    rainbow never jumps phase (a plain `animation-duration` swap would snap
 *    the animation's current time and visibly jump). The loop is gated on
 *    visibility — it runs only while the ring is actually rendered, so an
 *    idle composer schedules no rAF callback at all.
 *
 * Both entries read the owner share `InputZone` (point-in-time snapshots
 * re-rendered on store change), so no subscription is needed for the running
 * bit. The toggle store uses `useSyncExternalStore` so the two entries stay
 * in sync without a Host round-trip.
 *
 * @module @dsh-plugins/client-ui-rainbow-flow/client
 */

import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import React from 'react'
import styles from './RainbowFlow.module.css'
import { CHARS_PER_TOKEN, SAMPLE_MS, easeSpeed, rateToSpeed } from './rate'

/** Owner/standard props of a `conversation.input.left` entry (InputZone share
 *  plus the framework session kit). */
type RainbowFlowProps = PropsRuntime<'conversation.input.left'>

/** localStorage key for the on/off toggle (defaults to on). */
const STORAGE_KEY = 'dsh.rnglow.enabled'

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
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

function getSnapshot(): boolean {
  return enabled
}

/** The toggle switch with a live running indicator. */
export function RainbowFlowToggle({ session }: RainbowFlowProps): React.JSX.Element {
  const on = React.useSyncExternalStore(subscribe, getSnapshot)
  const running = !!session && session.running
  const label = (on ? '关闭彩虹流光' : '开启彩虹流光') + (running ? '（运行中）' : '（空闲）')
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

/** The rainbow ring + halo around the composer card, speed-driven by the
 *  live output-token rate. The ring angle is integrated in a rAF loop while
 *  the angular velocity eases exponentially toward the sampled target, so
 *  speed changes glide smoothly instead of stepping or jumping phase. */
export function RainbowFlowGlow({ session }: RainbowFlowProps): React.JSX.Element | null {
  const on = React.useSyncExternalStore(subscribe, getSnapshot)
  const running = !!session && session.running

  // Keep the latest snapshot readable from the rAF loop below.
  const sessionRef = React.useRef(session)
  sessionRef.current = session

  // Written imperatively each frame (--rf-angle on the ring only); React
  // never touches it. The glow is static and needs no ref.
  const ringRef = React.useRef<HTMLDivElement | null>(null)

  // Motion state lives in refs so it survives the effect re-runs that gate
  // the loop on visibility (toggle / running flips): the ring resumes at its
  // previous angle and speed seamlessly instead of restarting from zero.
  const emaRef = React.useRef(0)
  const angleRef = React.useRef(0)
  const speedRef = React.useRef(0)
  const targetSpeedRef = React.useRef(0)

  // Drive the rotation only while the ring is actually rendered: when the
  // toggle is off or the session is idle the effect body returns early and
  // no rAF callback is ever scheduled, so an idle composer costs nothing.
  React.useEffect(() => {
    if (!on || !running) return

    // Reduced motion: leave the ring static. The query is re-evaluated on
    // every frame and a change listener restarts the loop, so toggling the
    // OS setting mid-session behaves like the old CSS @media kill switch.
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

    // Sampler state is effect-local on purpose: re-seeding on every loop
    // start avoids a stale dt (long hidden gap) wrongly decaying the EMA.
    let lastLen = -1
    let lastTick = 0
    let lastFrame = 0
    let lastDeg = ''
    let raf = 0

    // Sample the streaming output length and update the EMA rate -> target
    // angular velocity (deg/s = 360 / rotation period).
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
      targetSpeedRef.current = rateToSpeed(ema)
    }

    const frame = (now: number): void => {
      if (reducedQuery.matches) return // stop scheduling while reduced motion is on
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

      // Ease the actual speed toward the sampled target (frame-rate
      // independent exponential approach), then integrate the angle: the
      // ring accelerates/decelerates smoothly and never jumps phase.
      let speed = easeSpeed(speedRef.current, targetSpeedRef.current, dt)
      if (Math.abs(speed) < 0.25) speed = 0
      speedRef.current = speed
      angleRef.current = (angleRef.current + speed * dt) % 360

      // Round the angle and skip the style write when nothing changed.
      const deg = `${angleRef.current.toFixed(1)}deg`
      if (deg !== lastDeg) {
        lastDeg = deg
        if (ringRef.current) ringRef.current.style.setProperty('--rf-angle', deg)
      }
    }

    // Live-adapt to the OS setting: stop while reduced, resume on change.
    const onReducedChange = (): void => {
      if (!reducedQuery.matches) raf = window.requestAnimationFrame(frame)
    }
    reducedQuery.addEventListener('change', onReducedChange)

    if (!reducedQuery.matches) raf = window.requestAnimationFrame(frame)
    return () => {
      window.cancelAnimationFrame(raf)
      reducedQuery.removeEventListener('change', onReducedChange)
    }
  }, [on, running])

  if (!on || !running) return null

  return (
    <div className={styles.flow}>
      <div className={styles.glow} />
      <div ref={ringRef} className={styles.ring} />
    </div>
  )
}
