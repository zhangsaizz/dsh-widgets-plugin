#!/usr/bin/env node
/**
 * Rebuild the runtime artifacts after editing src:
 *   - balance host bundle        src/index.ts            -> lib/index.js (esm)
 *   - balance-vendors host bundle src/index.ts            -> lib/index.js (esm)
 *   - client-ui-balance bundle   src/client/index.ts      -> lib/client.js (ModuleLoader CJS)
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Resolve esbuild's platform-independent CLI entry and run it through node,
// so the script works on any platform (no hardcoded win32 binary path).
const require = createRequire(import.meta.url)
const esbuildCli = require.resolve('esbuild/bin/esbuild')
const EXTERNAL = ['@deepseek-ai/*', '@dsh-plugins/*', 'zod', 'react', 'react/*']

function run(pkg, args) {
  execFileSync(process.execPath, [esbuildCli, ...args], { cwd: join(root, pkg), stdio: 'inherit' })
}

// Host bundles (ESM, packages external).
for (const pkg of ['packages/dsh-balance', 'packages/dsh-balance-vendors']) {
  run(pkg, [
    'src/index.ts',
    '--bundle', '--format=esm', '--platform=node', '--target=es2022',
    ...EXTERNAL.flatMap((e) => ['--external:' + e]),
    '--outfile=lib/index.js', '--log-level=warning',
  ])
  console.log('built ' + pkg + '/lib/index.js')
}

// Client bundle: CJS + inlined CSS, wrapped in the ModuleLoader factory shape.
{
  const pkg = 'packages/dsh-client-ui-balance'
  run(pkg, [
    'src/client/index.ts',
    '--bundle', '--format=cjs', '--platform=browser', '--target=es2022',
    '--jsx=automatic',
    '--loader:.css=local-css',
    ...EXTERNAL.flatMap((e) => ['--external:' + e]),
    '--outfile=lib/client.cjs', '--log-level=warning',
  ])
  const code = readFileSync(join(root, pkg, 'lib/client.cjs'), 'utf8')
  const css = readFileSync(join(root, pkg, 'lib/client.css'), 'utf8')
  const banner = 'window.__ModuleLoader__.load({\n\tid: "@dsh-plugins/client-ui-balance",\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n'
  const cssInject = `\n\t\tif (typeof document !== "undefined") {\n\t\t\tvar __balanceStyleId = "@dsh-plugins/client-ui-balance/styles";\n\t\t\tif (!document.querySelector("style[data-plugin-css=" + JSON.stringify(__balanceStyleId) + "]")) {\n\t\t\t\tvar __balanceStyleTag = document.createElement("style");\n\t\t\t\t__balanceStyleTag.dataset.plugin = "@dsh-plugins/client-ui-balance";\n\t\t\t\t__balanceStyleTag.dataset.pluginCss = __balanceStyleId;\n\t\t\t\t__balanceStyleTag.textContent = ${JSON.stringify(css)};\n\t\t\t\tdocument.head.appendChild(__balanceStyleTag);\n\t\t\t}\n\t\t}\n`
  const footer = '\n\t\treturn module.exports;\n\t}\n});\n'
  writeFileSync(join(root, pkg, 'lib/client.js'), banner + code + cssInject + footer)
  rmSync(join(root, pkg, 'lib/client.cjs'))
  rmSync(join(root, pkg, 'lib/client.css'))
  console.log('built ' + pkg + '/lib/client.js')
}

// Token-crit client bundle: CJS + inlined CSS, wrapped in the ModuleLoader factory shape.
{
  const pkg = 'packages/dsh-client-ui-token-crit'
  run(pkg, [
    'src/client/index.ts',
    '--bundle', '--format=cjs', '--platform=browser', '--target=es2022',
    '--jsx=automatic',
    '--loader:.css=local-css',
    ...EXTERNAL.flatMap((e) => ['--external:' + e]),
    '--outfile=lib/client.cjs', '--log-level=warning',
  ])
  const code = readFileSync(join(root, pkg, 'lib/client.cjs'), 'utf8')
  const css = readFileSync(join(root, pkg, 'lib/client.css'), 'utf8')
  const banner = 'window.__ModuleLoader__.load({\n\tid: "@dsh-plugins/client-ui-token-crit",\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n'
  const cssInject = `\n\t\tif (typeof document !== "undefined") {\n\t\t\tvar __tcritStyleId = "@dsh-plugins/client-ui-token-crit/styles";\n\t\t\tif (!document.querySelector("style[data-plugin-css=" + JSON.stringify(__tcritStyleId) + "]")) {\n\t\t\t\tvar __tcritStyleTag = document.createElement("style");\n\t\t\t\t__tcritStyleTag.dataset.plugin = "@dsh-plugins/client-ui-token-crit";\n\t\t\t\t__tcritStyleTag.dataset.pluginCss = __tcritStyleId;\n\t\t\t\t__tcritStyleTag.textContent = ${JSON.stringify(css)};\n\t\t\t\tdocument.head.appendChild(__tcritStyleTag);\n\t\t\t}\n\t\t}\n`
  const footer = '\n\t\treturn module.exports;\n\t}\n});\n'
  writeFileSync(join(root, pkg, 'lib/client.js'), banner + code + cssInject + footer)
  rmSync(join(root, pkg, 'lib/client.cjs'))
  rmSync(join(root, pkg, 'lib/client.css'))
  console.log('built ' + pkg + '/lib/client.js')
}

// Balance client bundle: mounts the generated balance Remote (zod inlined).
{
  const pkg = 'packages/dsh-balance'
  run(pkg, [
    'src/client/index.ts',
    '--bundle', '--format=cjs', '--platform=browser', '--target=es2022',
    '--outfile=lib/client.cjs', '--log-level=warning',
  ])
  const code = readFileSync(join(root, pkg, 'lib/client.cjs'), 'utf8')
  const banner = 'window.__ModuleLoader__.load({\n\tid: "@dsh-plugins/balance",\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n'
  const footer = '\n\t\treturn module.exports;\n\t}\n});\n'
  writeFileSync(join(root, pkg, 'lib/client.js'), banner + code + footer)
  rmSync(join(root, pkg, 'lib/client.cjs'))
  console.log('built ' + pkg + '/lib/client.js')
}
