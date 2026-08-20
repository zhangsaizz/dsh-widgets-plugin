/**
 * Particle-flow motion model for the rainbow edge (pure: no DOM, no React).
 *
 * Replaces the rotating conic ring with a stream of colored light particles
 * flowing along the composer card's rounded-rect glass rim. This module owns
 * only the geometry and the particle state — the render loop (rAF + canvas)
 * lives in the React component and calls back into these pure helpers.
 *
 * Geometry: the card is a rounded rectangle (width w, height h, corner
 * radius r). A particle's position on the rim is a single scalar `t` in
 * [0, 1) that walks the perimeter: top edge → top-right arc → right edge →
 * bottom-right arc → bottom edge → bottom-left arc → left edge → top-left
 * arc. `rimPoint(w, h, r, t)` maps that scalar back to an (x, y) in the
 * card's local coordinate space.
 *
 * Flow: every particle advances `t` at a shared angular velocity (turns per
 * second) with a small per-particle speed offset for organic variation. Each
 * particle carries a hue offset so the stream reads as a rainbow; a comet
 * tail is drawn by sampling a few points behind the head on the same path.
 *
 * @module @dsh-plugins/client-ui-rainbow-flow/client/particles
 */

/** Corner radius of the rim path (px) — must match the CSS glass rim. */
export const RIM_RADIUS = 22

/** Number of cloud wisps in the stream — each wisp is a soft, puffy cloud
 *  drifting along the rim (not a thin continuous line). */
export const PARTICLE_COUNT = 6

/** Comet tail length (number of fade samples behind the head). */
export const TAIL_LENGTH = 4

/** Per-particle speed variation: each particle flows at 1 ± this fraction. */
export const SPEED_JITTER = 0.18

/** One particle: its position on the rim and its identity (hue + speed). */
export interface RimParticle {
  /** Position on the rim path, in [0, 1). */
  t: number
  /** Hue offset (deg) — spreads the stream across the rainbow. */
  hue: number
  /** Speed factor, around 1 (see SPEED_JITTER). */
  speed: number
}

/** Distance along the rim of a rounded rect with corners cut at radius r. */
function perimeter(w: number, h: number, r: number): number {
  const straightW = Math.max(0, w - 2 * r)
  const straightH = Math.max(0, h - 2 * r)
  return 2 * straightW + 2 * straightH + 2 * Math.PI * r
}

/**
 * Map a rim scalar `t` in [0, 1) to an (x, y) point on the rounded-rect
 * path, starting at the top-left corner and walking clockwise. Pure and
 * frame-rate independent — the render loop only ever advances `t`.
 */
export function rimPoint(
  w: number,
  h: number,
  r: number,
  t: number,
): { x: number; y: number } {
  const straightW = Math.max(0, w - 2 * r)
  const straightH = Math.max(0, h - 2 * r)
  const cornerArc = (Math.PI / 2) * r
  let d = ((t % 1) + 1) % 1 * perimeter(w, h, r)

  // Top edge, left → right.
  if (d < straightW) return { x: r + d, y: 0 }
  d -= straightW
  // Top-right arc.
  if (d < cornerArc) {
    const a = d / r
    return { x: w - r + Math.sin(a) * r, y: r - Math.cos(a) * r }
  }
  d -= cornerArc
  // Right edge, top → bottom.
  if (d < straightH) return { x: w, y: r + d }
  d -= straightH
  // Bottom-right arc.
  if (d < cornerArc) {
    const a = d / r
    return { x: w - r + Math.cos(a) * r, y: h - r + Math.sin(a) * r }
  }
  d -= cornerArc
  // Bottom edge, right → left.
  if (d < straightW) return { x: w - r - d, y: h }
  d -= straightW
  // Bottom-left arc.
  if (d < cornerArc) {
    const a = d / r
    return { x: r - Math.sin(a) * r, y: h - r + Math.cos(a) * r }
  }
  d -= cornerArc
  // Left edge, bottom → top.
  if (d < straightH) return { x: 0, y: h - r - d }
  d -= straightH
  // Top-left arc.
  const a = d / r
  return { x: r - Math.cos(a) * r, y: r - Math.sin(a) * r }
}

/** Create a fresh particle stream: `count` wisps evenly spaced around the
 *  rim, each with a rainbow hue and a small speed jitter. `seed` offsets the
 *  hue so restarts don't snap colors. */
export function createParticles(count: number, seed = 0): RimParticle[] {
  const particles: RimParticle[] = []
  for (let i = 0; i < count; i++) {
    particles.push({
      t: i / count,
      hue: (seed + i * (360 / count)) % 360,
      speed: 1 + (i % 2 === 0 ? 1 : -1) * SPEED_JITTER * ((i % 5) / 5 + 0.2),
    })
  }
  return particles
}

/** Advance every particle by `dt` seconds at `turnsPerSecond` (the eased
 *  target from the token-rate model), honoring each particle's speed jitter.
 *  Mutates and returns the array. */
export function advanceParticles(
  particles: RimParticle[],
  dt: number,
  turnsPerSecond: number,
): RimParticle[] {
  for (const p of particles) {
    p.t = (p.t + turnsPerSecond * p.speed * dt) % 1
  }
  return particles
}

/** Map a particle stream position to a tail of rim samples behind it.
 *  Returns [head, ...tail] points in [0, 1) — used to draw the comet. */
export function tailSamples(headT: number, length: number, spacing = 0.012): number[] {
  const samples: number[] = []
  for (let i = 0; i <= length; i++) {
    samples.push(((headT - i * spacing) % 1 + 1) % 1)
  }
  return samples
}
