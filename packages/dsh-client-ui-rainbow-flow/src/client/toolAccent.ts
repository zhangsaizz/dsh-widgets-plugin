/**
 * Tool-command colour-accent tagging (browser half).
 *
 * The rainbow-flow plugin colours the transcript's command rows by what each
 * tool does. The rows are shipped chrome rendered by the harness (the ToolRow
 * command cards and the assistant's "Think" reasoning rows), so this module
 * does not re-render them — it decorates the live DOM:
 *
 *  1. It reads each row's stable `data-tool="<name>"` attribute (a tool call)
 *     or `data-variant="think"` (a reasoning row).
 *  2. It classifies the tool name with {@link classifyTool} into a category
 *     (a reasoning row always lands on `think`).
 *  3. It stamps the category back onto the same element as
 *     `data-rf-tool-cat="<category>"` plus a native `title` tooltip (the
 *     bilingual category label). `ToolAccent.css` then paints the row's left
 *     edge and its related text in the category colour.
 *
 * A single `MutationObserver` keeps the tags current without touching React:
 * it watches for added/dropped rows (childList — handles both added `Element`s
 * and added `DocumentFragment`s, so an inserted batch is covered) and for a
 * `data-tool` / `data-variant` change on an existing row (attributes,
 * filtered). It only writes `data-rf-tool-cat` / `title`, which are NOT in the
 * observed filter — so the observer never re-triggers itself. Each added
 * subtree is scanned once (no whole-document rescan), so cost scales with the
 * rows actually inserted.
 *
 * The tags are pure decoration and are removed with the DOM node. The module
 * runs in the plugin's activate scope and returns a disposer for the fiber.
 *
 * @module @dsh-plugins/client-ui-rainbow-flow/client/toolAccent
 */

import { CATEGORY_LABELS, classifyTool } from './classify.ts'
import type { ToolCategory } from './classify.ts'

/** Attribute the harness sets on every tool-card root (stable). */
const TOOL_ATTR = 'data-tool'
/** Attribute the harness sets on the reasoning ("Think") row root. */
const VARIANT_ATTR = 'data-variant'
/** The reasoning-row variant value. */
const THINK_VARIANT = 'think'
/** Attribute this module stamps with the classified category. */
const CAT_ATTR = 'data-rf-tool-cat'

/** Root selector for every row this decorator colours: tool-call cards (they
 *  carry `data-tool`) plus the assistant's reasoning "Think" rows (they carry
 *  `data-variant="think"` but no `data-tool`). */
const ROW_SELECTOR = `[${TOOL_ATTR}], [${VARIANT_ATTR}="${THINK_VARIANT}"]`

/** Bilingual category label, resolved from the document language. */
function labelFor(category: ToolCategory): string {
  const lang = (document.documentElement.lang || '').toLowerCase()
  return lang.startsWith('zh') ? CATEGORY_LABELS[category].zh : CATEGORY_LABELS[category].en
}

/** Classify + stamp one row. Idempotent — re-stamping the same values writes
 *  nothing (and neither attribute is observed, so no loop). A reasoning
 *  ("Think") row carries `data-variant="think"` (it has no `data-tool`), so it
 *  always lands on the `think` category; every other row is a tool call keyed
 *  by its `data-tool` name. */
function applyTo(element: Element): void {
  const category: ToolCategory = element.getAttribute(VARIANT_ATTR) === THINK_VARIANT
    ? 'think'
    : classifyTool(element.getAttribute(TOOL_ATTR) ?? '')
  element.setAttribute(CAT_ATTR, category)
  element.setAttribute('title', labelFor(category))
}

/** Tag every decorated row in a subtree (used for the initial mount and for
 *  each newly added node). */
function scan(root: ParentNode): void {
  for (const el of root.querySelectorAll(ROW_SELECTOR)) applyTo(el)
}

/**
 * Activate the tool-command colour tagger.
 * @returns a disposer that stops the observer.
 */
export function mountToolAccent(): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    // Nothing to decorate (or too old to observe) — a no-op.
    return () => { /* dispose: nothing to tear down */ }
  }

  const root = document.body ?? document.documentElement

  // Tag whatever is already rendered.
  scan(root)

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        // Only `data-tool` / `data-variant` are observed; if one flipped,
        // re-classify the row. `applyTo` writes neither observed attribute,
        // so this cannot recurse.
        if (mutation.attributeName === TOOL_ATTR || mutation.attributeName === VARIANT_ATTR) {
          applyTo(mutation.target as Element)
        }
      } else {
        // childList: an inserted batch may arrive as individual Elements OR as
        // a single DocumentFragment — scan whichever was added (both are
        // queryable) so a whole window of results is covered in one pass.
        for (const node of mutation.addedNodes) {
          if (node instanceof Element || node instanceof DocumentFragment) scan(node)
        }
      }
    }
  })

  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [TOOL_ATTR, VARIANT_ATTR],
  })

  return () => { observer.disconnect() }
}
