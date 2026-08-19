/**
 * Rainbow-flow motion model (pure: no DOM, no React).
 *
 * Maps the estimated output-token rate to the ring's target angular velocity
 * and defines the exponential easing used to approach it smoothly. Kept free
 * of imports so the smoke test can bundle it standalone (see
 * docs/speed-smoke-test.cjs).
 *
 * @module @dsh-plugins/client-ui-rainbow-flow/client/rate
 */

/** ~2 chars per token for mixed CN/EN output — a rough live-rate estimator. */
export const CHARS_PER_TOKEN = 2

/** Sample cadence of the output-rate estimator (ms). */
export const SAMPLE_MS = 500

/** Time constant of the angular-velocity easing (s): how quickly the ring
 *  accelerates/decelerates toward the sampled target speed. Larger = smoother
 *  but more laggy; 0.5 s keeps fast↔slow transitions visibly fluid while
 *  staying responsive to the token stream. */
export const SPEED_EASE_TAU = 0.5

/** Map an estimated output-token rate (tokens/sec) to the ring rotation
 *  period: faster streaming -> shorter duration (spins faster). */
export function rateToDuration(tps: number): number {
  return Math.min(3.2, Math.max(0.45, 3.2 - tps * 0.05))
}

/** Target angular velocity (deg/s) for a token rate: 360 / rotation period. */
export function rateToSpeed(tps: number): number {
  return 360 / rateToDuration(tps)
}

/** One easing step toward `target` over `dt` seconds.
 *
 *  The factor `1 - exp(-dt / SPEED_EASE_TAU)` makes the approach frame-rate
 *  independent: after n steps of dt the remaining gap is (exp(-dt/τ))^n =
 *  exp(-t/τ) of the original — the same trajectory at any animation frame
 *  rate (see docs/speed-smoke-test.cjs). */
export function easeSpeed(current: number, target: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / SPEED_EASE_TAU))
}
