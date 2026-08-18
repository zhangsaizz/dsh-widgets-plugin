// Smoke test for NotificationStore (the desktop inbox core) — runs against a
// standalone esbuild bundle of src/desktop-notifications.ts so it exercises
// the REAL code, not a copy.
//
// Run (repo root, after `pnpm build` or with the module bundled via esbuild):
//   $env:NODE_PATH = '<pkg>/node_modules'; $env:STORE_BUNDLE = '<bundle.cjs>'
//   node packages/dsh-client-ui-session-monitor/docs/store-smoke-test.cjs
'use strict'
const assert = require('node:assert')
const { NotificationStore, NOTIFY_KINDS } = require(process.env.STORE_BUNDLE)

let passed = 0
function ok(name) { passed++; console.log('  ✓', name) }

function freshStore() { return new NotificationStore() }

// Recent timestamps so the 7-day retention archive never prunes test records.
const NOW = Date.now()
const t = (deltaMs) => NOW - deltaMs

// ── push / idempotency ──────────────────────────────────────────────
{
  console.log('push + idempotency')
  const s = freshStore()
  const n1 = s.push('done', 's1', '会话A', { round: 1, at: t(5000) })
  assert.ok(n1 && n1.id === 's1:done:1', 'id from (sessionId,kind,round)')
  const n2 = s.push('done', 's1', '会话A', { round: 1, at: t(4000) })
  assert.strictEqual(n2.id, n1.id, 'same round → same id')
  assert.strictEqual(s.snapshot().notes.length, 1, 'no duplicate record')
  // Newer round creates a separate record
  s.push('done', 's1', '会话A', { round: 2, at: t(3000) })
  assert.strictEqual(s.snapshot().notes.length, 2, 'round 2 is a new record')
  ok('round-keyed ids, dedupe by id, distinct rounds coexist')
}

// ── pushInteraction (relay path) ────────────────────────────────────
{
  console.log('pushInteraction open/close cycle')
  const s = freshStore()
  const a = s.pushInteraction('s1', 'question', '会话A', t(5000))
  const b = s.pushInteraction('s1', 'question', '会话A', t(4000)) // still open → no-op
  assert.strictEqual(b.id, a.id, 'open record reused while pending')
  assert.strictEqual(s.snapshot().notes.length, 1)
  s.resolve('s1', 'question')
  const c = s.pushInteraction('s1', 'question', '会话A', t(2000)) // closed → fresh
  assert.notStrictEqual(c.id, a.id, 'closed→open creates a fresh record')
  assert.strictEqual(s.snapshot().notes.length, 2)
  ok('single open slot per (session,kind), reopen after resolve')
}

// ── ack semantics ───────────────────────────────────────────────────
{
  console.log('ack by id / sessionId / all')
  const s = freshStore()
  s.push('approval', 's1', 'A', { at: t(5000) })
  s.push('error', 's1', 'A', { at: t(4000) })
  s.push('done', 's2', 'B', { at: t(3000) })
  assert.strictEqual(s.ack({ ids: ['s1:approval:e' + t(5000)] }), 1)
  assert.strictEqual(s.ack({ ids: ['s1:approval:e' + t(5000)] }), 0, 're-ack counts 0')
  assert.strictEqual(s.ack({ sessionId: 's1' }), 1, 'session-scoped ack hits the remaining s1 record')
  assert.strictEqual(s.ack({ all: true }), 1)
  assert.strictEqual(s.snapshot().unread, 0)
  ok('id/session/all ack, idempotent, unread reaches 0')
}

// ── resolve ─────────────────────────────────────────────────────────
{
  console.log('resolve latest open record')
  const s = freshStore()
  s.push('approval', 's1', 'A', { at: t(5000) })
  s.push('approval', 's1', 'A', { at: t(4000) })
  s.resolve('s1', 'approval')
  const notes = s.snapshot().notes
  assert.strictEqual(notes[1].resolved, true, 'latest record resolved')
  assert.strictEqual(notes[0].resolved, undefined, 'older record untouched')
  assert.strictEqual(s.snapshot().unread, 1, 'resolved does not count as unread')
  ok('resolve marks only the latest open record')
}

// ── persistence round-trip ──────────────────────────────────────────
{
  console.log('toJSON → load round-trip (validation + dedupe)')
  const s = freshStore()
  s.push('question', 's1', 'Q1', { at: t(5000) })
  s.push('done', 's1', 'Q1', { round: 3, at: t(4000) })
  s.ack({ all: true })
  const wire = s.toJSON()
  const s2 = freshStore()
  // Corrupt the payload: unknown kind + duplicate id + junk types must be dropped.
  const corrupt = [
    ...wire.notes,
    { id: 'x:bad:1', sessionId: 'x', kind: 'not-a-kind', title: 'bad', at: t(1000) },
    { id: wire.notes[0].id, sessionId: 'dup', kind: 'done', title: 'dup', at: t(900) },
    { id: 42, sessionId: 'junk', kind: 'done', title: '', at: 'nope' },
  ]
  s2.load(wire.seq, corrupt)
  const loaded = s2.snapshot()
  assert.strictEqual(loaded.notes.length, wire.notes.length, 'unknown kind / duplicate id / junk dropped')
  assert.strictEqual(loaded.unread, 0, 'acked state survived')
  assert.strictEqual(loaded.notes[0].kind, 'question')
  assert.strictEqual(loaded.notes[1].round, 3)
  ok('validation on load, ack state persists')
}

// ── retention archive (acked/resolved older than 7 days are dropped) ─
{
  console.log('retention archive')
  const s = freshStore()
  s.push('done', 's1', 'A', { at: t(5000) })
  s.push('done', 's2', 'B', { at: Date.now() - 8 * 24 * 60 * 60 * 1000 }) // 8 days old
  s.ack({ all: true })
  const notes = s.snapshot().notes
  assert.strictEqual(notes.length, 1, 'acked record past retention archived')
  assert.strictEqual(notes[0].sessionId, 's1')
  ok('7-day archive for acked/resolved, unacked never time-pruned')
}

// ── cap ─────────────────────────────────────────────────────────────
{
  console.log('cap 200')
  const s = freshStore()
  for (let i = 0; i < 210; i++) s.push('done', 's' + i, 'T', { at: t(i) })
  assert.strictEqual(s.snapshot().notes.length, 200, 'oldest dropped beyond cap')
  ok('ring buffer cap')
}

// ── kind vocabulary ─────────────────────────────────────────────────
{
  console.log('NOTIFY_KINDS')
  const expected = ['approval','question','plan-review','error','blocked','max-tokens','subagent','done','aborted','interrupted','title','new-session']
  for (const k of expected) assert.ok(NOTIFY_KINDS.has(k), 'kind in set: ' + k)
  ok('all 12 kinds known')
}

console.log(`\n${passed} assertion groups passed`)
