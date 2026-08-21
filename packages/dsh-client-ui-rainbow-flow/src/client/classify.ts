/**
 * Tool-command classification (pure: no DOM, no React).
 *
 * The chat transcript renders each model tool call as a card whose root
 * element carries a stable `data-tool="<name>"` attribute. This module maps
 * an arbitrary wire tool name to a coarse display category, so the rainbow
 * flow can tint each command card by what it does (shell, read, write, edit,
 * search, web, code, ask, plan, memory) instead of treating every tool the
 * same.
 *
 * The mapping is heuristic and ordered — the first rule whose regex matches
 * wins. Common deepseek-harness tool names (`bash`, `read`, `write`,
 * `apply_patch`, `web_search`, `ask_user_question`, …) are all covered; any
 * name that matches nothing falls back to `other`. Kept free of imports so a
 * smoke test (see the `rate.ts` precedent) can bundle it standalone.
 *
 * @module @dsh-plugins/client-ui-rainbow-flow/client/classify
 */

/** Display categories for a running command card. */
export type ToolCategory =
  | 'shell'
  | 'read'
  | 'search'
  | 'write'
  | 'edit'
  | 'code'
  | 'web'
  | 'ask'
  | 'plan'
  | 'memory'
  | 'think'
  | 'other'

/** All categories, in display order (drives the palette + any legend). */
export const TOOL_CATEGORIES: readonly ToolCategory[] = [
  'shell',
  'read',
  'search',
  'write',
  'edit',
  'code',
  'web',
  'ask',
  'plan',
  'memory',
  'think',
  'other',
]

/**
 * Ordered [regex, category] rules. The first match wins, so list the most
 * specific signals first and let the generic fallbacks trail. Word-boundary
 * pairs (`\b`) make a bare token match ("read", "cat"), while underscore
 * joins match only when the whole token is present ("read_file").
 */
const RULES: ReadonlyArray<readonly [RegExp, ToolCategory]> = [
  // Shell / terminal execution.
  [/^(bash|pwsh|zsh|sh|cmd|powershell)$/i, 'shell'],
  [/shell|terminal|run_command|run_shell|run_bash|run_terminal|^exec\b|^run\b/i, 'shell'],

  // Human-in-the-loop / approval.
  [/ask_user|^ask\b|question|human|confirm|consent|approval|approve|exit_plan_mode|^request\b|^wait\b/i, 'ask'],

  // Reasoning (a `think` tool is the same thinking mode as the "Think" row).
  [/^think\b/i, 'think'],

  // Planning / todo.
  [/^plan\b|plann|^todo\b|^task\b|^goal\b|^step\b|plan_review/i, 'plan'],

  // Search / discovery.
  [/web_search|search|grep|glob|^find\b|^list\b|^dir\b|^query\b|ripgrep|^rg\b|^pattern\b|^lookup\b/i, 'search'],

  // Web / network.
  [/web_fetch|^fetch\b|^curl\b|^http|^browser\b|navigate|open_url|^web\b|^get_url\b/i, 'web'],

  // Read.
  [/^read\b|read_file|file_read|^cat\b|^less\b|^head\b|^tail\b|^view\b|^load\b|^open\b|inspect/i, 'read'],

  // Write.
  [/^write\b|write_file|file_write|^create\b|^append\b|^save\b|^upload\b/i, 'write'],

  // Edit / mutate.
  [/apply_patch|patch|^edit\b|edit_file|^modify\b|^replace\b|^update\b|^insert\b|^delete\b|mutat/i, 'edit'],

  // Code execution.
  [/run_code|exec_code|^code\b|^python\b|^node\b|^javascript\b|^typescript\b|^evaluate\b|^eval\b|^deno\b|^bun\b/i, 'code'],

  // Memory / notes.
  [/memor|remember|^note\b|^recall\b|summar/i, 'memory'],
]

/**
 * Classify a wire tool name into its display category.
 * @param name - the tool name carried by the call (data-tool attribute value).
 * @returns the matching category, or `other` for an unrecognised name.
 */
export function classifyTool(name: string): ToolCategory {
  for (const [re, category] of RULES) {
    if (re.test(name)) return category
  }
  return 'other'
}

/** Bilingual display label per category (used for the hover tooltip). */
export const CATEGORY_LABELS: Readonly<Record<ToolCategory, { zh: string; en: string }>> = {
  shell: { zh: '命令 / 终端', en: 'Shell' },
  read: { zh: '读取', en: 'Read' },
  search: { zh: '搜索', en: 'Search' },
  write: { zh: '写入', en: 'Write' },
  edit: { zh: '编辑', en: 'Edit' },
  code: { zh: '代码', en: 'Code' },
  web: { zh: '网络', en: 'Web' },
  ask: { zh: '询问', en: 'Ask' },
  plan: { zh: '规划', en: 'Plan' },
  memory: { zh: '记忆', en: 'Memory' },
  think: { zh: '思考', en: 'Think' },
  other: { zh: '命令', en: 'Tool' },
}
