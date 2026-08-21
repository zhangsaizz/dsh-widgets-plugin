/**
 * Rainbow-flow motion model (pure: no DOM, no React).
 *
 * Maps the estimated output-token rate to the halo's breathing period and
 * defines the exponential easing used to approach it smoothly. Kept free
 * of imports so the smoke test can bundle it standalone (see
 * docs/speed-smoke-test.cjs).
 *
 * @module @dsh-plugins/client-ui-rainbow-flow/client/rate
 */

/** ~2 chars per token for mixed CN/EN output — a rough live-rate estimator. */
export const CHARS_PER_TOKEN = 2

/** Sample cadence of the output-rate estimator (ms). */
export const SAMPLE_MS = 500

/** Time constant of the breathing-frequency easing (s): how quickly the
 *  breath speeds up/slows down toward the sampled target frequency. Larger =
 *  smoother but more laggy; 0.8 s keeps fast↔slow transitions fluid and
 *  gentle while staying responsive to the token stream. */
export const SPEED_EASE_TAU = 0.8

/** Map an estimated output-token rate (tokens/sec) to the halo's breathing
 *  period in seconds: faster streaming -> shorter period (breathes faster).
 *  A 5s..1s span keeps the rainbow calm at rest and never makes it pant at
 *  peak throughput. */
export function rateToDuration(tps: number): number {
  return Math.min(5, Math.max(1, 5 - tps * 0.06))
}

/** Cycles per second as an angle: 360 / breathing period (deg/s). The
 *  breathing loop derives its frequency in Hz directly from `rateToDuration`
 *  (1 / period); this deg/s view is kept as the model's angular equivalent
 *  and covered by the motion-model smoke test. */
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
