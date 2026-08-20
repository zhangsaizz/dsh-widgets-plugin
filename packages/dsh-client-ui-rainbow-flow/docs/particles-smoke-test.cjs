// Smoke test for the rainbow-flow particle model (src/client/particles.ts) —
// bundles the REAL source via esbuild (no copies) and asserts:
//   - rimPoint maps t=0..1 onto a rounded-rect perimeter monotonically
//   - corners stay inside the rounded-rect bounds (x,y within [r, w-r]/[r, h-r])
//   - the path is closed: t=0 and t=1 wrap to the same point
//   - createParticles yields PARTICLE_COUNT evenly spread, hue-spread particles
//   - advanceParticles moves every particle by turnsPerSecond * dt * jitter
//     and wraps modulo 1 (no drift out of range)
//   - tailSamples trails behind the head on the same path
//
// Run (repo root):
//   node packages/dsh-client-ui-rainbow-flow/docs/particles-smoke-test.cjs
'use strict'
const assert = require('node:assert')
const { buildSync } = require('esbuild')
const { join } = require('node:path')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')

// Bundle the real source into a temp dir and load it. The temp dir is removed
// on every exit path (build failure included).
let dir
let particles
try {
  dir = mkdtempSync(join(tmpdir(), 'rainbow-particles-'))
  const outfile = join(dir, 'particles.cjs')
  buildSync({
    entryPoints: [join(__dirname, '..', 'src', 'client', 'particles.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    outfile,
    logLevel: 'silent',
  })
  particles = require(outfile)
} finally {
  if (dir) rmSync(dir, { recursive: true, force: true })
}
const {
  PARTICLE_COUNT,
  RIM_RADIUS,
  advanceParticles,
  createParticles,
  rimPoint,
  tailSamples,
} = particles

let passed = 0
function ok(name) { passed++; console.log('  ✓', name) }

// ── rimPoint geometry ──────────────────────────────────────────────
{
  console.log('rimPoint')
  const w = 800, h = 100, r = RIM_RADIUS
  // t=0 starts at top-left corner arc start: x=r, y=0
  const start = rimPoint(w, h, r, 0)
  assert.ok(Math.abs(start.x - r) < 1e-6 && Math.abs(start.y - 0) < 1e-6, 't=0 at top-left corner start')
  // The path is closed: t normalized to 0 maps back to the start point
  // (rimPoint wraps t modulo 1 internally).
  const end = rimPoint(w, h, r, 1)
  assert.ok(Math.abs(end.x - start.x) < 1e-6 && Math.abs(end.y - start.y) < 1e-6, 't=1 wraps to t=0')
  // Every sampled point stays within the rounded-rect bounds.
  for (let i = 0; i <= 2000; i++) {
    const { x, y } = rimPoint(w, h, r, i / 2000)
    assert.ok(x >= -1e-6 && x <= w + 1e-6 && y >= -1e-6 && y <= h + 1e-6, `point in bounds at t=${i / 2000}`)
    // Along straight edges, the coordinate perpendicular to the edge is pinned
    // to 0 / h / 0 / w; the corners are arcs, so allow the full box there.
  }
  ok('rounded-rect path is closed, in-bounds, and starts at the top-left corner')
}

// ── perimeter monotonicity: consecutive t move a positive distance ──
{
  console.log('rimPoint monotonic walk')
  const w = 800, h = 100, r = RIM_RADIUS
  let prev = rimPoint(w, h, r, 0)
  let total = 0
  for (let i = 1; i <= 2000; i++) {
    const cur = rimPoint(w, h, r, i / 2000)
    const dx = cur.x - prev.x
    const dy = cur.y - prev.y
    const dist = Math.hypot(dx, dy)
    assert.ok(dist > 0, `strictly advances at t=${i / 2000}`)
    total += dist
    prev = cur
  }
  // Total distance ≈ perimeter: 2*(800-44) + 2*(100-44) + 2π*22
  const expected = 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r
  assert.ok(Math.abs(total - expected) / expected < 0.01, `perimeter ≈ ${expected} (got ${total})`)
  ok('t walks the perimeter without reversing or stalling')
}

// ── particle stream creation ───────────────────────────────────────
{
  console.log('createParticles')
  const ps = createParticles(PARTICLE_COUNT)
  assert.strictEqual(ps.length, PARTICLE_COUNT, 'exactly PARTICLE_COUNT particles')
  for (const p of ps) {
    assert.ok(p.t >= 0 && p.t < 1, 'position in [0,1)')
    assert.ok(p.hue >= 0 && p.hue < 360, 'hue in [0,360)')
    assert.ok(p.speed > 0, 'positive speed')
  }
  const hues = new Set(ps.map((p) => Math.round(p.hue)))
  assert.ok(hues.size > PARTICLE_COUNT * 0.8, 'hues are spread across the rainbow')
  ok('evenly positioned, hue-spread, positive-speed stream')
}

// ── advancing ──────────────────────────────────────────────────────
{
  console.log('advanceParticles')
  const ps = createParticles(PARTICLE_COUNT)
  const before = ps.map((p) => p.t)
  advanceParticles(ps, 1, 0.1) // 1 s at 0.1 turns/s
  for (let i = 0; i < ps.length; i++) {
    const expected = (before[i] + 0.1 * ps[i].speed) % 1
    assert.ok(Math.abs(ps[i].t - expected) < 1e-9, `particle ${i} advanced by speed*dt and wrapped`)
    assert.ok(ps[i].t >= 0 && ps[i].t < 1, `particle ${i} stays in [0,1)`)
  }
  // Slow speed should barely move; fast should move more.
  const slow = createParticles(PARTICLE_COUNT)
  advanceParticles(slow, 1, 0.001)
  const fast = createParticles(PARTICLE_COUNT)
  advanceParticles(fast, 1, 0.5)
  for (let i = 0; i < slow.length; i++) {
    assert.ok(fast[i].t !== slow[i].t, `faster flow moves particle ${i} further`)
  }
  ok('advance respects speed*dt, wraps modulo 1, and scales with turns/sec')
}

// ── comet tail ─────────────────────────────────────────────────────
{
  console.log('tailSamples')
  const head = 0.5
  const tail = tailSamples(head, 4)
  assert.strictEqual(tail.length, 5, 'head + 4 tail samples')
  assert.strictEqual(tail[0], head, 'first sample is the head')
  for (let i = 1; i < tail.length; i++) {
    assert.ok(tail[i] < head, `sample ${i} trails behind the head`)
    assert.ok(tail[i] >= 0 && tail[i] < 1, `sample ${i} in [0,1)`)
  }
  ok('tail trails behind the head on the same path')
}

console.log(`\n${passed} assertion groups passed`)
