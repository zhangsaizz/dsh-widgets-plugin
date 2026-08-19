// Smoke test for the rainbow-flow motion model (src/client/rate.ts) — bundles
// the REAL source via esbuild (no copies) and asserts the properties the glow
// animation relies on:
//   - rateToDuration / rateToSpeed clamping bounds + monotonicity
//   - easeSpeed frame-rate independence (float-exact, not approximate)
//   - easeSpeed monotonic approach without overshoot
//
// Run (repo root):
//   node packages/dsh-client-ui-rainbow-flow/docs/speed-smoke-test.cjs
'use strict'
const assert = require('node:assert')
const { buildSync } = require('esbuild')
const { join } = require('node:path')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')

// Bundle the real source into a temp dir and load it. The temp dir is removed
// on every exit path (build failure included).
let dir
let rate
try {
  dir = mkdtempSync(join(tmpdir(), 'rainbow-rate-'))
  const outfile = join(dir, 'rate.cjs')
  buildSync({
    entryPoints: [join(__dirname, '..', 'src', 'client', 'rate.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    outfile,
    logLevel: 'silent',
  })
  rate = require(outfile)
} finally {
  if (dir) rmSync(dir, { recursive: true, force: true })
}
const { rateToDuration, rateToSpeed, easeSpeed, SPEED_EASE_TAU } = rate

let passed = 0
function ok(name) { passed++; console.log('  ✓', name) }

// ── rate -> period / speed mapping ─────────────────────────────────
{
  console.log('rateToDuration / rateToSpeed')
  assert.strictEqual(rateToDuration(0), 3.2, 'idle -> slowest period')
  assert.strictEqual(rateToDuration(1e9), 0.45, 'very fast -> fastest period')
  assert.ok(rateToDuration(0) > rateToDuration(50), 'period decreases with tps')
  assert.ok(rateToDuration(50) > rateToDuration(500), 'period decreases (high end)')
  assert.strictEqual(rateToSpeed(0), 360 / 3.2, 'idle speed = 112.5 deg/s')
  assert.strictEqual(rateToSpeed(1e9), 360 / 0.45, 'fast speed = 800 deg/s')
  assert.ok(rateToSpeed(0) < rateToSpeed(50) && rateToSpeed(50) < rateToSpeed(500), 'speed increases with tps')
  ok('clamping bounds 3.2s..0.45s, monotonic rate -> speed')
}

// ── frame-rate independence (float-exact) ──────────────────────────
// (exp(-dt/τ))^n = exp(-n·dt/τ) = exp(-t/τ) — the same trajectory at any
// frame rate. Use an exact step count (not a time-accumulated loop, whose
// float drift would add/subtract a step and fake a mismatch).
{
  console.log('easeSpeed frame-rate independence')
  const start = 112.5
  const target = 800
  const total = 1 // 1 s of simulated animation
  const exact = start + (target - start) * (1 - Math.exp(-total / SPEED_EASE_TAU))
  for (const dt of [1 / 240, 1 / 120, 1 / 60, 1 / 30, 1 / 10, 1 / 4, 0.5]) {
    const steps = Math.round(total / dt)
    let s = start
    for (let i = 0; i < steps; i++) s = easeSpeed(s, target, dt)
    assert.ok(Math.abs(s - exact) < 1e-9,
      `dt=${dt}s -> ${s} should equal ${exact} (float-exact)`)
  }
  ok('any dt converges to the same exp(-t/τ) trajectory (float-exact)')
}

// ── monotonic approach, no overshoot ───────────────────────────────
{
  console.log('easeSpeed approach')
  for (const [s, target, dt] of [[100, 800, 1 / 60], [800, 100, 1 / 60], [0, 500, 0.2], [500, 0, 0.2]]) {
    const next = easeSpeed(s, target, dt)
    assert.ok(next > Math.min(s, target) && next < Math.max(s, target),
      `(${s}->${target}, dt=${dt}) stays strictly between`)
  }
  let s = 100
  const target = 800
  let prevGap = Math.abs(s - target)
  for (let i = 0; i < 60; i++) {
    s = easeSpeed(s, target, 1 / 60)
    const gap = Math.abs(s - target)
    assert.ok(gap < prevGap, `gap shrinks monotonically at step ${i}`)
    prevGap = gap
  }
  ok('strictly between s and target, gap shrinks monotonically')
}

console.log(`\n${passed} assertion groups passed`)
