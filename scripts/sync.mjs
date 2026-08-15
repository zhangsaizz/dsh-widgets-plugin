#!/usr/bin/env node
/**
 * Sync the standalone balance plugin project from the deepseek-harness source:
 * copies each package's src and built lib (typert artifacts and the client
 * bundle included), then rewrites the harness-scoped package names
 * (@deepseek-ai/dsh-balance* and @deepseek-ai/dsh-client-ui-balance) to the
 * standalone @dsh-plugins/* scope. Run after pulling newer harness code.
 */
import { cpSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// The harness checkout lives beside this project (F:\deepseek-harness); the
// balance sources sit under its plugins/balance/packages/* tree. Override the
// location with the HARNESS_DIR environment variable if it is elsewhere.
const harness = process.env.HARNESS_DIR ?? join(root, '..', 'deepseek-harness')

const sources = [
  ['plugins/balance/packages/dsh-balance', 'packages/dsh-balance'],
  ['plugins/balance/packages/dsh-balance-vendors', 'packages/dsh-balance-vendors'],
  ['plugins/balance/packages/dsh-client-ui-balance', 'packages/dsh-client-ui-balance'],
]

/**
 * Rewrite harness-scoped package names to the standalone @dsh-plugins scope.
 * `@deepseek-ai/dsh-balance` also covers the `-vendors` suffix, so both rules
 * together map every balance package; other @deepseek-ai/* peers are untouched.
 */
function rewriteScope(text) {
  return text
    .replace(/@deepseek-ai\/dsh-balance/g, '@dsh-plugins/balance')
    .replace(/@deepseek-ai\/dsh-client-ui-balance/g, '@dsh-plugins/client-ui-balance')
}

/** Collect text artifacts (TS source and built JS / .d.ts / sourcemaps) under a directory. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|map)$/.test(name)) out.push(p)
  }
  return out
}

for (const [from, to] of sources) {
  const src = join(harness, from, 'src')
  const lib = join(harness, from, 'lib')
  const target = join(root, to)
  rmSync(join(target, 'src'), { recursive: true, force: true })
  rmSync(join(target, 'lib'), { recursive: true, force: true })
  cpSync(src, join(target, 'src'), { recursive: true })
  cpSync(lib, join(target, 'lib'), { recursive: true })
  // Both the TS source and the built artifacts (typert metadata, compiled
  // imports, bundle ids) can carry the harness scope, so rewrite them all.
  for (const dir of ['src', 'lib']) {
    for (const file of walk(join(target, dir))) {
      const text = readFileSync(file, 'utf8')
      const next = rewriteScope(text)
      if (next !== text) writeFileSync(file, next, 'utf8')
    }
  }
  console.log('synced', from, '->', to)
}
