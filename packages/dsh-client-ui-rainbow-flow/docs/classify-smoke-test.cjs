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
  for (const c of ['shell', 'read', 'search', 'write', 'edit', 'code', 'web', 'ask', 'plan', 'task', 'memory', 'think', 'other']) {
    assert.ok(TOOL_CATEGORIES.includes(c), `category ${c} is present`)
  }
  ok('13 categories present')
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
    // 0.1.7 read-family tool: a `\b` anchor would miss the underscore join.
    ['read_image', 'read'],
    ['cordis_package_inspect', 'read'],
    ['grep', 'search'],
    ['glob', 'search'],
    ['web_search', 'search'],
    ['write', 'write'],
    ['write_file', 'write'],
    ['apply_patch', 'edit'],
    ['edit_file', 'edit'],
    // 0.1.7 edit-family name (underscore-joined `replace`).
    ['str_replace_editor', 'edit'],
    ['run_code', 'code'],
    ['web_fetch', 'web'],
    ['ask_user_question', 'ask'],
    ['exit_plan_mode', 'ask'],
    ['plan', 'plan'],
    // Task objects: todo / goals / reminders / team tasks / background jobs /
    // workflow runners all share the `task` category (none may fall to `other`).
    ['task', 'task'],
    ['todo_write', 'task'],
    ['create_goal', 'task'],
    ['get_goal', 'task'],
    ['update_goal', 'task'],
    ['schedule_create', 'task'],
    ['schedule_update', 'task'],
    ['team_task_create', 'task'],
    ['job_list', 'task'],
    ['job_output', 'task'],
    ['job_kill', 'task'],
    ['workflow', 'task'],
    ['ralph', 'task'],
    // Plan mode is join-aware too (`plan_step`, `planning`), while
    // `exit_plan_mode` stays with ask (rule order).
    ['plan', 'plan'],
    ['plan_step', 'plan'],
    ['planning', 'plan'],
    ['exit_plan_mode', 'ask'],
    // The session-inspection family shares the search colour.
    ['session_search', 'search'],
    ['session_event_search', 'search'],
    ['session_trace', 'search'],
    ['session_event_trace', 'search'],
    ['session_event_read', 'search'],
    ['think', 'think'],
    ['remember_something', 'memory'],
  ]
  for (const [name, expected] of cases) {
    assert.strictEqual(classifyTool(name), expected, `${name} -> ${expected}`)
  }
  ok(`${cases.length} tool names classified`)
}

// ── deliberately neutral names stay `other` ───────────────────────
// These are documented as by-design neutral (agent/team messaging, run-control
// verbs, standalone cards). Asserting them stops a future regex edit from
// silently pulling them into a colour category.
{
  console.log('deliberately neutral')
  const neutral = [
    'subagent', 'spawn_teammate', 'wait_agent', 'send_message', 'interrupt_agent',
    'list_agents', 'list_subagent_models', 'load_workspace_dependencies',
    'cordis_run', 'cordis_stop', 'cordis_undefine', 'cordis_define',
    'present', 'skill', 'lsp',
  ]
  for (const name of neutral) {
    assert.strictEqual(classifyTool(name), 'other', `${name} stays neutral`)
  }
  ok(`${neutral.length} neutral names stay other`)
}

// ── unknown / empty fall back to other (no crash) ─────────────────
{
  console.log('unknown fallback')
  assert.strictEqual(classifyTool('some_unknown_tool'), 'other', 'unknown -> other')
  assert.strictEqual(classifyTool(''), 'other', 'empty -> other')
  ok('unknown names fall back to other')
}

console.log(`\n${passed} assertion groups passed`)
