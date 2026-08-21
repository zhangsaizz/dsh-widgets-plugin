// Smoke test for the rainbow-flow tool-command classifier
// (src/client/classify.ts) — bundles the REAL source via esbuild (no copies)
// and asserts the heuristic category mapping the command-card colour accents
// rely on. First matching rule wins, so every wire tool name lands on a
// stable category and anything unknown falls back to `other`.
//
// Run (repo root):
//   node packages/dsh-client-ui-rainbow-flow/docs/classify-smoke-test.cjs
'use strict'
const assert = require('node:assert')
const { buildSync } = require('esbuild')
const { join } = require('node:path')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')

let dir
let classify
try {
  dir = mkdtempSync(join(tmpdir(), 'rainbow-classify-'))
  const outfile = join(dir, 'classify.cjs')
  buildSync({
    entryPoints: [join(__dirname, '..', 'src', 'client', 'classify.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    outfile,
    logLevel: 'silent',
  })
  classify = require(outfile)
} finally {
  if (dir) rmSync(dir, { recursive: true, force: true })
}
const { classifyTool, TOOL_CATEGORIES } = classify

let passed = 0
function ok(name) { passed++; console.log('  ✓', name) }

// ── category set is complete & starts with shell ──────────────────
{
  console.log('category set')
  assert.strictEqual(TOOL_CATEGORIES[0], 'shell', 'shell is first (palette order)')
  for (const c of ['shell', 'read', 'search', 'write', 'edit', 'code', 'web', 'ask', 'plan', 'memory', 'think', 'other']) {
    assert.ok(TOOL_CATEGORIES.includes(c), `category ${c} is present`)
  }
  ok('12 categories present')
}

// ── real wire tool names -> expected category ─────────────────────
{
  console.log('tool-name -> category')
  const cases = [
    ['bash', 'shell'],
    ['pwsh', 'shell'],
    ['zsh', 'shell'],
    ['read', 'read'],
    ['read_file', 'read'],
    ['cordis_package_inspect', 'read'],
    ['grep', 'search'],
    ['glob', 'search'],
    ['web_search', 'search'],
    ['write', 'write'],
    ['write_file', 'write'],
    ['apply_patch', 'edit'],
    ['edit_file', 'edit'],
    ['run_code', 'code'],
    ['web_fetch', 'web'],
    ['ask_user_question', 'ask'],
    ['exit_plan_mode', 'ask'],
    ['plan', 'plan'],
    ['task', 'plan'],
    ['think', 'think'],
    ['remember_something', 'memory'],
  ]
  for (const [name, expected] of cases) {
    assert.strictEqual(classifyTool(name), expected, `${name} -> ${expected}`)
  }
  ok(`${cases.length} tool names classified`)
}

// ── unknown / empty fall back to other (no crash) ─────────────────
{
  console.log('unknown fallback')
  assert.strictEqual(classifyTool('some_unknown_tool'), 'other', 'unknown -> other')
  assert.strictEqual(classifyTool(''), 'other', 'empty -> other')
  ok('unknown names fall back to other')
}

console.log(`\n${passed} assertion groups passed`)
