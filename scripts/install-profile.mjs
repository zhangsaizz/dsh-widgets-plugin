#!/usr/bin/env node
/**
 * Install the widgets bundle into a dsh profile with one command:
 *
 *   pnpm install:profile <profile> [--cli <dsh-cli>] [--mode link|npm] [--dry-run]
 *
 * `link` (default) points the profile straight at this checkout — the bundle
 * directory `bundles/dsh-widgets-plugin` plus the six `packages/*` plugin
 * packages whose patch rows the bundle inserts. The six extra `link:` installs
 * are what keeps the profile from resolving a second copy of `@deepseek-ai/*`
 * out of the checkout's own `node_modules` (see AGENTS.md, desktop section).
 *
 * `npm` installs the published bundle by name instead; pnpm then pulls the six
 * packages from the registry, so no per-package install is needed.
 *
 * The repo root is NOT installable: it is the private workspace root
 * `dsh-widgets-plugin` and declares no `dsh.bundle`, so `dsh plugin add .`
 * only prints "declares no dsh.bundle — installed as a plain dependency" and
 * mounts nothing. This script refuses that argument and says so.
 *
 * A tarball (`pnpm -r pack`) is not an offline delivery format either: `pnpm`
 * rewrites the bundle's `workspace:*` dependencies to exact versions, and the
 * install side still fetches `@dsh-plugins/*@<version>` from the registry.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE_DIR = 'bundles/dsh-widgets-plugin'
const BUNDLE_NAME = '@dsh-plugins/dsh-widgets-plugin'
const PLUGIN_DIRS = [
  'packages/dsh-balance',
  'packages/dsh-client-ui-token-crit',
  'packages/dsh-client-ui-session-monitor',
  'packages/dsh-client-ui-card-container',
  'packages/dsh-client-ui-rainbow-flow',
  'packages/dsh-client-ui-widget-manager',
]
// The browser bundles only load inside a shell that carries the 0.2.0 seed
// module table; an older `dsh` (the npm global 0.1.5 is still around) fails
// later with "Failed to load plugins".
const MIN_DSH_VERSION = '0.2.0-rc.2'
// Mirrors the harness' own profile-name rule (app.asar `resolveProfileDir`).
const PROFILE_NAME = /^[A-Za-z0-9_.-]+$/

const USAGE = `用法: pnpm install:profile <profile> [选项]

把本仓库的 widgets bundle 装进一个 dsh profile（默认 link: 直连本仓库）。

选项:
  --mode link|npm   安装形态。link（默认）= 本仓库 7 个目录以 link: 依赖装进
                    profile（改代码即生效）；npm = 装已发布的
                    ${BUNDLE_NAME}，其 6 个依赖由 pnpm 从 registry 拉取。
  --cli <path>      dsh CLI。默认取 $DSH_CLI，否则 PATH 里的 dsh / dsh.cmd。
                    官方桌面端用它自带的那份：
                    "<桌面端>/resources/runtime/cli/bin/dsh.cmd"
  --dry-run         只打印将执行的命令，不检查 CLI、不落地。
  -h, --help        显示本帮助。

例:
  pnpm install:profile web
  pnpm install:profile desktop --cli "D:/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd"
  pnpm install:profile web --mode npm

装完（bundle 层属于启动时组合）要重启宿主：Web 端重启 \`dsh web\`，官方桌面端
完全退出后重开；用 \`dsh <profile> --dump-config\` 确认出现
"# == ${BUNDLE_NAME}" 层。`

function fail(message) {
  console.error(`install-profile: ${message}`)
  process.exit(1)
}

function warn(message) {
  console.error(`install-profile: 警告——${message}`)
}

function parseArgs(argv) {
  const options = {
    profile: undefined,
    cli: process.env.DSH_CLI ?? (process.platform === 'win32' ? 'dsh.cmd' : 'dsh'),
    mode: 'link',
    dryRun: false,
    help: false,
  }
  const value = (index, flag) => {
    const next = argv[index]
    if (next === undefined || next.startsWith('--')) fail(`${flag} 需要一个值`)
    return next
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--cli') options.cli = value((index += 1), '--cli')
    else if (arg === '--mode') options.mode = value((index += 1), '--mode')
    else if (arg.startsWith('-')) fail(`未知选项 ${arg}`)
    else if (options.profile === undefined) options.profile = arg
    else fail(`多余的参数 ${arg}（profile 只能给一个）`)
  }
  return options
}

// One CLI call per line; `shell: true` is what lets Windows execute a `.cmd`
// wrapper, and streamed stdio keeps a sandboxed pipe out of the picture.
function quote(value) {
  if (process.platform !== 'win32') return `'${value.replace(/'/g, `'\\''`)}'`
  // cmd.exe needs quoting for whitespace and for its own metacharacters. `(`/`)`
  // matter even without a space: an unquoted `…\dshcli(x)\dsh.cmd` fails to run.
  return /[\s"^&|<>()%!]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function command(cli, args) {
  return [cli, ...args].map(quote).join(' ')
}

function run(line, dryRun) {
  console.log(`$ ${line}`)
  if (dryRun) return 0
  const result = spawnSync(line, { shell: true, stdio: 'inherit' })
  if (result.error !== undefined) {
    console.error(`install-profile: 无法执行 ${line}: ${result.error.message}`)
    return 1
  }
  if (result.signal !== null) {
    // Ctrl+C on a long pnpm install must not look like "the install failed".
    console.error(`install-profile: 被信号 ${result.signal} 中断`)
    process.exit(130)
  }
  return result.status ?? 1
}

// Quotes never neutralize cmd.exe's `%VAR%` expansion (it expands inside double
// quotes too), and `%%` only escapes in batch files — in `cmd /c` it renders a
// literal `%`. So a `%…%` pair in an argument would be silently rewritten; the
// only honest option is to refuse it.
function checkNoExpansion(value, what) {
  if (process.platform === 'win32' && /%[^%]*%/.test(value)) {
    fail(`${what}含 %…% 形式：cmd 会把它展开成环境变量（引号挡不住），请改名后重试 —— ${value}`)
  }
}

function compareVersions(left, right) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(value)
    if (match === null) return undefined
    return {
      numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
      prerelease: match[4] === undefined ? undefined : match[4].split('.'),
    }
  }
  const a = parse(left)
  const b = parse(right)
  if (a === undefined || b === undefined) return undefined
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] < b.numbers[index] ? -1 : 1
  }
  if (a.prerelease === undefined && b.prerelease === undefined) return 0
  if (a.prerelease === undefined) return 1
  if (b.prerelease === undefined) return -1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const x = a.prerelease[index]
    const y = b.prerelease[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xNumber = /^\d+$/.test(x)
    const yNumber = /^\d+$/.test(y)
    if (xNumber && yNumber) return Number(x) < Number(y) ? -1 : 1
    if (xNumber !== yNumber) return xNumber ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

// `dsh --version` is captured through a temp file rather than a pipe: piped
// child stdio is unavailable under the DSH file sandbox, redirection is not.
function probeVersion(cli) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-install-profile-'))
  const file = join(dir, 'version.txt')
  const result = spawnSync(`${command(cli, ['--version'])} > ${quote(file)} 2>&1`, {
    shell: true,
    stdio: 'ignore',
  })
  let output = ''
  try {
    output = readFileSync(file, 'utf8')
  } catch {}
  rmSync(dir, { recursive: true, force: true })
  const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(output)
  return {
    ran: result.status === 0,
    version: match === null ? undefined : match[1],
    output: output.trim().split('\n')[0] ?? '',
  }
}

function isNear(left, right) {
  if (left === right) return true
  if (Math.abs(left.length - right.length) > 1) return false
  const [long, short] = left.length >= right.length ? [left, right] : [right, left]
  let index = 0
  while (index < short.length && long[index] === short[index]) index += 1
  const tail = short.slice(index)
  return long.slice(index + 1) === tail || long.slice(index) === tail
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  console.log(USAGE)
  process.exit(0)
}

if (options.profile === undefined) fail(`缺少 profile 名\n\n${USAGE}`)
if (!['link', 'npm'].includes(options.mode)) fail(`--mode 只能是 link 或 npm，收到 ${options.mode}`)

// The trap this script exists for: the repo root is a private workspace root,
// not a package — installing it prints "declares no dsh.bundle" and mounts
// nothing. Catch the path-looking argument before it reaches the CLI. A plain
// directory that merely shares the profile name (say `scripts`) is a legal
// profile name and must still reach the CLI, so only a real path is rejected.
const looksLikePath =
  options.profile.includes('/') ||
  options.profile.includes('\\') ||
  (existsSync(options.profile) && existsSync(join(options.profile, 'package.json')))
if (looksLikePath) {
  fail(
    `"${options.profile}" 看起来是路径而不是 profile 名。\n` +
      '  仓库根目录不是可安装包（它是 private 的 workspace 根，没有 dsh.bundle）；\n' +
      `  可安装的 bundle 是 ${BUNDLE_DIR}。本脚本就是替你装 bundle + 6 个插件包：\n` +
      '  pnpm install:profile <profile>',
  )
}
if (!PROFILE_NAME.test(options.profile) || ['.', '..', 'node_modules'].includes(options.profile)) {
  fail(`profile 名不合法：${options.profile}（只允许字母数字与 . _ -，且不能是 . / .. / node_modules）`)
}
checkNoExpansion(options.profile, 'profile 名')
checkNoExpansion(options.cli, '--cli 路径')

const manifestOf = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
const bundleManifest = manifestOf(join(root, BUNDLE_DIR))
if (bundleManifest.dsh?.bundle?.patch === undefined) {
  fail(`${BUNDLE_DIR}/package.json 没有声明 dsh.bundle.patch，这不是可安装的 bundle`)
}
const bundleName = bundleManifest.name ?? BUNDLE_NAME

// The dsh home the read-back below uses has to be the one the CLI writes, so
// an empty DSH_HOME falls back to ~/.dsh instead of resolving to cwd.
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', options.profile)
const profilesDir = join(dshHome, 'profiles')
const existing = existsSync(profilesDir)
  ? readdirSync(profilesDir).filter((name) => !name.startsWith('.') && name !== 'node_modules')
  : []
if (!existsSync(profileDir)) {
  const lower = options.profile.toLowerCase()
  const near = existing.find((name) => name.toLowerCase() === lower || isNear(name.toLowerCase(), lower))
  console.log(
    `install-profile: profile "${options.profile}" 不存在，将新建` +
      (existing.length === 0 ? '' : `（现有：${existing.join('、')}）`),
  )
  if (near !== undefined) {
    console.log(`install-profile: 提示——已有 profile "${near}" 与它很接近，是想装进 ${near} 吗？`)
  }
}

if (options.mode === 'link') {
  for (const dir of PLUGIN_DIRS) {
    if (!existsSync(join(root, dir, 'package.json'))) fail(`缺少插件包 ${dir}`)
    checkNoExpansion(join(root, dir), dir)
  }
  checkNoExpansion(join(root, BUNDLE_DIR), BUNDLE_DIR)
  // The bundle's patch rows and its dependencies must cover exactly the
  // packages linked below: adding a widget to the bundle but not here would
  // silently skip it and re-introduce the duplicate-`@deepseek-ai/*` failure
  // this script exists to prevent.
  const linked = PLUGIN_DIRS.map((dir) => manifestOf(join(root, dir)).name)
  const declared = Object.keys(bundleManifest.dependencies ?? {})
  const notLinked = declared.filter((name) => !linked.includes(name))
  const notDeclared = linked.filter((name) => !declared.includes(name))
  if (notLinked.length > 0 || notDeclared.length > 0) {
    fail(
      '本仓库的 bundle 依赖与 packages/* 对不上，先同步两边再装：\n' +
        (notLinked.length > 0 ? `  bundle 声明了但 PLUGIN_DIRS 未列：${notLinked.join('、')}\n` : '') +
        (notDeclared.length > 0 ? `  PLUGIN_DIRS 列了但 bundle 未声明：${notDeclared.join('、')}\n` : ''),
    )
  }
  // `lib/` is gitignored: a checkout that only ran `pnpm install` has no
  // loadable artifacts, and an interrupted `pnpm build` can leave a client
  // bundle older than its source. Both make the mounted rows fail to import,
  // so warn — the manifest written below stays valid once `pnpm build` runs.
  const missing = []
  const stale = []
  for (const dir of PLUGIN_DIRS) {
    for (const [output, source] of [
      ['lib/index.js', 'src/index.ts'],
      ['lib/client.js', 'src/client/index.ts'],
    ]) {
      const outputPath = join(root, dir, output)
      if (!existsSync(outputPath)) {
        missing.push(`${dir}/${output}`)
      } else if (
        existsSync(join(root, dir, source)) &&
        statSync(outputPath).mtimeMs < statSync(join(root, dir, source)).mtimeMs
      ) {
        stale.push(`${dir}/${output}`)
      }
    }
  }
  if (missing.length > 0) {
    const shown = missing.slice(0, 3).join('、')
    warn(
      `缺 ${missing.length} 个构建产物（lib/ 是 gitignore 的）：${shown}${missing.length > 3 ? ' …' : ''}\n` +
        '  先跑 `pnpm build`，否则挂载的插件行会因找不到 lib/ 而加载失败。',
    )
  }
  if (stale.length > 0) {
    const shown = stale.slice(0, 3).join('、')
    warn(
      `${stale.length} 个构建产物比源码旧：${shown}${stale.length > 3 ? ' …' : ''}\n` +
        '  跑一次完整的 `pnpm build`（client 阶段别中断），否则浏览器半加载的是旧 bundle。',
    )
  }
}

const targets =
  options.mode === 'npm'
    ? [bundleName]
    : [join(root, BUNDLE_DIR), ...PLUGIN_DIRS.map((dir) => join(root, dir))].map((dir) =>
        dir.replace(/\\/g, '/'),
      )

console.log(`install-profile: ${options.mode} 模式 → profile "${options.profile}"`)
console.log(`install-profile: CLI = ${options.cli}`)
if (!options.dryRun) {
  const probe = probeVersion(options.cli)
  if (!probe.ran) {
    console.error(
      `install-profile: 注意——${options.cli} 无法执行（--version 非 0）` +
        (probe.output === '' ? '' : `：${probe.output}`) +
        '，下一步会失败；用 --cli 指向可用的 dsh（官方桌面端自带\n' +
        '  "<桌面端>/resources/runtime/cli/bin/dsh.cmd"）。',
    )
  } else if (probe.version === undefined) {
    console.error(`install-profile: 注意——无法从 --version 输出识别版本，跳过版本下限检查`)
  } else {
    const order = compareVersions(probe.version, MIN_DSH_VERSION)
    if (order !== undefined && order < 0) {
      fail(
        `CLI 版本 ${probe.version} 低于 ${MIN_DSH_VERSION}：旧壳的种子模块表里没有\n` +
          '  dsh-client-store，浏览器半会以 "Failed to load plugins / missed the module table"\n' +
          '  挂在 pending。用 --cli 指向 ≥ ' +
          `${MIN_DSH_VERSION} 的 dsh（或升级后重试）。`,
      )
    }
  }
}

for (const target of targets) {
  const status = run(command(options.cli, ['plugin', '--profile', options.profile, 'add', target]), options.dryRun)
  if (status !== 0) {
    fail(
      `${target} 安装失败（退出码 ${status}）。\n` +
        '  重跑同一条命令是幂等的（已装好的依赖会被跳过），可安全重试。',
    )
  }
}

if (options.dryRun) {
  console.log('install-profile: --dry-run，未改动 profile')
  process.exit(0)
}

// Read back the profile the CLI wrote: both layers are required, a dependency
// without the bundle entry (or the other way round) mounts nothing. A missing
// manifest means the read-back cannot vouch for anything — that is a failure,
// not a success with a footnote.
const manifestPath = join(profileDir, 'package.json')
if (!existsSync(manifestPath)) {
  fail(
    `装完了但找不到 ${manifestPath}，无法回读校验。\n` +
      `  脚本按 DSH_HOME=${dshHome} 解析，若 CLI 用的是别的 home（不同用户/服务），` +
      '请设对 DSH_HOME 再重跑。',
  )
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const bundles = manifest.dsh?.profile?.bundles ?? []
const dependencies = manifest.dependencies ?? {}
const layered = bundles.includes(bundleName)
const installed = dependencies[bundleName] !== undefined
console.log(`install-profile: ${manifestPath}`)
console.log(`  dsh.profile.bundles 含 ${bundleName}: ${layered ? '是' : '否'}`)
console.log(`  dependencies 含 ${bundleName}: ${installed ? '是' : '否'}`)
if (!layered || !installed) {
  fail(
    '两层缺一都不挂载——把上面缺失的那层补上（bundles 层见 AGENTS.md\n' +
      '  「本地调试安装」第 2 条：依赖已存在时 CLI 会跳过 bundles 追加）。',
  )
}

console.log('')
console.log('install-profile: 完成。bundle 层是启动时组合，请重启宿主后生效：')
console.log(`  Web 端    : 重启 dsh web，然后验收 dsh ${options.profile} --dump-config`)
if (options.profile === 'desktop') {
  console.log('  官方桌面端: 完全退出应用（含托盘）再重开；重启后')
  console.log('              /_dsh/session-monitor/status 与 /_dsh/balance/settings 应返回 200')
}
