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
 * wins. Common deepseek-harness tool names (`bash`, `read`, `read_image`,
 * `write`, `edit`, `str_replace_editor`, `web_search`, `todo_write`,
 * `create_goal`, `job_list`, `workflow`, `ask_user_question`, …) are all
 * covered; any name that matches nothing falls back to `other`. Kept free of
 * imports so a smoke test (see `docs/classify-smoke-test.cjs`) can bundle it
 * standalone.
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
  | 'task'
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
  'task',
  'memory',
  'think',
  'other',
]

/**
 * Ordered [regex, category] rules. The first match wins, so list the most
 * specific signals first and let the generic fallbacks trail.
 *
 * Boundaries: `\b` cannot anchor a harness name like `read_image` /
 * `todo_write` / `create_goal`, because `_` is a word character — there is no
 * word boundary between `read` and `_image`. The families that 0.1.7 actually
 * collides on (read / plan / edit) therefore use the join-aware form `(_|$)` /
 * `(^|_)token(_|$)` so a prefixed or suffixed wire name still lands on its
 * family (`read_image`, `todo_write`, the goal tools, `schedule_*`,
 * `str_replace_editor`). The remaining `\b` anchors are left as-is on purpose:
 * they are exact-name tokens, and widening them would re-map unrelated names —
 * `run_code` would become shell instead of code (the shell rule runs first),
 * `wait_agent` → ask, `list_subagent_models` → search,
 * `load_workspace_dependencies` → read.
 */
const RULES: ReadonlyArray<readonly [RegExp, ToolCategory]> = [
  // Shell / terminal execution.
  [/^(bash|pwsh|zsh|sh|cmd|powershell)$/i, 'shell'],
  [/shell|terminal|run_command|run_shell|run_bash|run_terminal|^exec\b|^run\b/i, 'shell'],

  // Human-in-the-loop / approval.
  [/ask_user|^ask\b|question|human|confirm|consent|approval|approve|exit_plan_mode|^request\b|^wait\b/i, 'ask'],

  // Reasoning (a `think` tool is the same thinking mode as the "Think" row).
  [/^think\b/i, 'think'],

  // Task objects. Everything the UI presents as *a task* — the todo list
  // (`todo_write`), goals (`create_goal` / `get_goal` / `update_goal`), reminders
  // (`schedule_*`), team tasks (`team_task_*`), background jobs (`job_list` /
  // `job_output` / `job_kill`) and the workflow runners (`workflow`, `ralph`) —
  // shares one category, so no task row falls back to the neutral "Tool" colour.
  // Matches `todo_write` / `create_goal` / `job_list`, which a `\b` anchor misses.
  [/(^|_)(todo|task|goal|schedule|job|workflow|ralph)(_|$)/i, 'task'],

  // Planning / plan mode. Join-aware like read/edit, so `plan_step` / `planning`
  // land here instead of the neutral fallback; the task objects above keep their
  // own category (and `exit_plan_mode` is claimed by the ask rule, which is
  // earlier).
  [/(^|_)(plan|step)(_|$)|plann/i, 'plan'],

  // Search / discovery. The session-inspection family (`session_*`: search /
  // trace / read of session events) shares this colour: splitting
  // `session_search` from `session_trace` / `session_event_read` would make one
  // family read as two.
  [/web_search|search|grep|glob|^find\b|^list\b|^dir\b|^query\b|ripgrep|^rg\b|^pattern\b|^lookup\b|^session(_|$)/i, 'search'],

  // Web / network.
  [/web_fetch|^fetch\b|^curl\b|^http|^browser\b|navigate|open_url|^web\b|^get_url\b/i, 'web'],

  // Read. `^read(_|$)` also catches 0.1.7's `read_image` (a read-family row in
  // the harness's own taxonomy: `TOOL_VARIANTS.read_image === "read"`).
  [/^read(_|$)|read_file|file_read|^cat\b|^less\b|^head\b|^tail\b|^view\b|^load\b|^open\b|inspect/i, 'read'],

  // Write.
  [/^write\b|write_file|file_write|^create\b|^append\b|^save\b|^upload\b/i, 'write'],

  // Edit / mutate. The join-aware form catches 0.1.7's `str_replace_editor`
  // (underscore-joined `replace`) without loosening the other families.
  [/apply_patch|patch|(^|_)(edit|replace|modify|update|insert|delete)(_|$)|edit_file|mutat/i, 'edit'],

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
  task: { zh: '任务', en: 'Task' },
  memory: { zh: '记忆', en: 'Memory' },
  think: { zh: '思考', en: 'Think' },
  other: { zh: '命令', en: 'Tool' },
}
