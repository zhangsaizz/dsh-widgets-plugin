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
 *     edge and its related text in the category colour — the colour itself is
 *     the `--rf-tool-<category>` variable, which this module also writes onto
 *     the document root from the settings store so the user's per-category
 *     picks (the settings panel's "command text colours" section) take effect
 *     live.
 *
 * The whole colouring is switched by `settings.commandColor`: when off, the
 * module stops stamping and clears `data-rf-tool-cat` / `title` from every
 * already-decorated row so cards revert to the shipped look. The latest-action
 * rainbow sweep (see the sweep CSS) is independent — it marks with
 * `data-rf-latest` the LATEST action row (tool command card `[data-tool]` /
 * Think row `[data-variant="think"]`) and clears it once a 正文 reply (the
 * assistant's plain-text answer) appears after it, so the effect follows the
 * most recent command/think (including instant tools like read/edit) until the
 * model writes its answer. Whether a 正文 reply follows is detected from the
 * flow-item structure only (no `textContent` over-matching), and the state is
 * recomputed deterministically from the live DOM on every change. Only the
 * header text is swept — never the output body, so it works whether or not
 * colouring is on.
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

import { CATEGORY_LABELS, classifyTool, TOOL_CATEGORIES } from './classify.ts'
import type { ToolCategory } from './classify.ts'
import { DEFAULT_TOOL_COLORS, getSettings, subscribeSettings } from './settings.ts'
import type { ToolColors } from './settings.ts'

/** Attribute the harness sets on every tool-card root (stable). */
const TOOL_ATTR = 'data-tool'
/** Attribute the harness sets on the reasoning ("Think") row root. */
const VARIANT_ATTR = 'data-variant'
/** The reasoning-row variant value. */
const THINK_VARIANT = 'think'
/** Attribute this module stamps with the classified category. */
const CAT_ATTR = 'data-rf-tool-cat'

/** Attribute stamped on the LATEST command card (the newest in document
 *  order), which the rainbow sweep CSS targets — the effect follows the most
 *  recent command rather than every card. */
export const LATEST_ATTR = 'data-rf-latest'

/** Document-root attribute that gates the command-card rainbow sweep CSS
 *  (`on` / `off`), so the effect can be switched from the config panel. */
export const SWEEP_GATE_ATTR = 'data-rf-sweep'

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

/** Apply the settings' per-category colours AND the command-card sweep gate
 *  onto the document root.
 *
 *  Colours — written as the `--rf-tool-<cat>` custom properties that
 *  `ToolAccent.css` reads; an inline variable on `<html>` overrides the
 *  stylesheet's `:root` default, so the user's picks take effect live without
 *  touching the shipped CSS. Only categories whose colour differs from the
 *  shipped palette are written; a default/reset category has its inline var
 *  REMOVED so the stylesheet `:root` value stays authoritative (editing
 *  `ToolAccent.css` keeps working, and resetting truly restores the shipped
 *  look).
 *
 *  Sweep gate — `data-rf-sweep='on'|'off'` on `<html>` mirrors
 *  `settings.commandSweep`, so the latest-action rainbow sweep CSS can be
 *  switched off from the config panel. The sweep selector keys off the
 *  `data-rf-latest` marker (the newest command/think row), NOT the category
 *  stamp, so it works independently of `commandColor`. */
function applyToolAccentSettings(): void {
  const root = document.documentElement
  const s = getSettings()
  const colors: ToolColors = s.toolColors
  for (const cat of TOOL_CATEGORIES) {
    const v = colors[cat]
    if (v === DEFAULT_TOOL_COLORS[cat]) root.style.removeProperty(`--rf-tool-${cat}`)
    else root.style.setProperty(`--rf-tool-${cat}`, v)
  }
  root.setAttribute(SWEEP_GATE_ATTR, s.commandSweep ? 'on' : 'off')
}

/**
 * Activate the tool-command colour tagger.
 * @returns a disposer that stops the observer.
 */
export function mountToolAccent(): () => void {
  if (typeof document === 'undefined') return () => { /* dispose: no-op */ }

  const root = document.body ?? document.documentElement
  const html = document.documentElement

  // Live gate: whether category colouring is applied (stamping) right now, so
  // the MutationObserver can refuse to stamp while the user has it switched off.
  let colorOn = true
  let applied = false

  /** Remove the category stamp + tooltip from every decorated row — used when
   *  the user turns command colouring OFF, so already-coloured cards revert to
   *  the shipped look immediately. */
  function clearAllStamps(): void {
    for (const el of root.querySelectorAll(`[${CAT_ATTR}]`)) {
      el.removeAttribute(CAT_ATTR)
      el.removeAttribute('title')
    }
  }

  /** Is the latest action superseded by a 正文 reply? Two reliable cases:
   *  (a) a non-action text block immediately AFTER the row inside its message — a
   *      Think row and its reply are siblings; (b) the row's own flow item
   *      (`data-chat-flow-kind`) is followed by the reply flow item — a tool call
   *      sits in its own `tool-call` flow item and the reply is the next
   *      `assistant-step` item. Only flow-item siblings are inspected for (b), so
   *      the composer / scroll chrome (not a flow item) can never mismatch. */
  function isSuperseded(latest: Element): boolean {
    // (a) immediate non-action text sibling (a Think row + its reply).
    let sib = latest.nextElementSibling
    while (sib) {
      if (sib.matches(ROW_SELECTOR) || sib.querySelector(ROW_SELECTOR)) return false
      if ((sib.textContent || '').trim()) return true
      sib = sib.nextElementSibling
    }
    // (b) walk up to the row's flow item; then inspect FOLLOWING flow-item
    //     siblings only.
    let node: Element = latest
    let parent = latest.parentElement
    let guard = 0
    while (parent && guard < 12) {
      let s = node.nextElementSibling
      while (s) {
        if (s.hasAttribute('data-chat-flow-kind')) {
          // A following flow item that holds a newer action → the newer action is
          // the latest instead (nothing to supersede here).
          if (s.matches(ROW_SELECTOR) || s.querySelector(ROW_SELECTOR)) return false
          // A following flow item with visible text = the 正文 reply.
          if ((s.textContent || '').trim()) return true
        }
        s = s.nextElementSibling
      }
      if (node.hasAttribute('data-chat-flow-kind')) break
      node = parent
      parent = parent.parentElement
      guard++
    }
    return false
  }

  /** Mark the LATEST action row (the newest `[data-tool]`/`[data-variant="think"]`
   *  row in document order) with `data-rf-latest` unless it is superseded by a
   *  正文 reply — so a fast command like read/edit stays highlighted until the
   *  model writes its text answer. Recomputed deterministically from the DOM each
   *  time (no sticky state); only the header is swept, never the output body. */
  function setLatest(): void {
    const rows = root.querySelectorAll(ROW_SELECTOR)
    const latest = rows.length > 0 ? rows[rows.length - 1] : null
    const superseded = !!latest && isSuperseded(latest)
    for (const el of rows) {
      if (el === latest && !superseded) el.setAttribute(LATEST_ATTR, 'on')
      else el.removeAttribute(LATEST_ATTR)
    }
  }

  /** Apply the user's colours + the sweep gate, then (re)stamp or clear the
   *  command rows to match `settings.commandColor`, and keep the latest-card
   *  marker current (deterministic from the current DOM). */
  function sync(): void {
    const s = getSettings()
    // Colour vars + sweep gate are written regardless of colouring — the vars
    // are harmless with no stamped card, and the sweep is independent of it.
    applyToolAccentSettings()
    const next = s.commandColor
    if (!applied || next !== colorOn) {
      if (next) scan(root)
      else clearAllStamps()
      colorOn = next
    }
    setLatest()
    applied = true
  }

  // Apply the user's colours + gate, and keep them live regardless of whether
  // observation is available — the overrides affect already-stamped rows too.
  sync()
  const unsubscribeSettings = subscribeSettings(sync)

  if (typeof MutationObserver === 'undefined') {
    // Nothing to decorate (or too old to observe) — colour overrides still
    // applied and tracked, so dispose just unsubscribes.
    return () => { unsubscribeSettings() }
  }

  // Recompute the latest marker once per animation frame after any DOM change,
  // so it tracks live streaming exactly like a fresh render (no sticky state).
  let rafPending = false
  const scheduleLatest = (): void => {
    if (rafPending) return
    rafPending = true
    window.requestAnimationFrame(() => {
      rafPending = false
      setLatest()
    })
  }

  const observer = new MutationObserver((mutations) => {
    let changed = false
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        // Only `data-tool` / `data-variant` are observed; if one flipped,
        // re-classify the row. `applyTo` writes neither observed attribute,
        // so this cannot recurse. Skipped entirely while colouring is off.
        if (!colorOn) continue
        if (mutation.attributeName === TOOL_ATTR || mutation.attributeName === VARIANT_ATTR) {
          applyTo(mutation.target as Element)
        }
        changed = true
      } else {
        // childList: an inserted batch may arrive as individual Elements OR as
        // a single DocumentFragment — scan whichever was added (both are
        // queryable) so a whole window of results is covered in one pass.
        changed = true
        for (const node of mutation.addedNodes) {
          if (colorOn && (node instanceof Element || node instanceof DocumentFragment)) scan(node)
        }
      }
    }
    if (changed) scheduleLatest()
  })

  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [TOOL_ATTR, VARIANT_ATTR],
  })

  return () => {
    observer.disconnect()
    unsubscribeSettings()
  }
}
