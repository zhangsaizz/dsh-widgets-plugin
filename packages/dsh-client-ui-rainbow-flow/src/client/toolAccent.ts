/**
 * Tool-command colour-accent tagging (browser half).
 *
 * The rainbow-flow plugin colours the transcript's tool-call rows by what each
 * tool does. The rows are shipped chrome rendered by the harness, so this
 * module does not re-render them — it decorates the live DOM:
 *
 *  1. It reads each row's stable attribute: `data-tool="<name>"` on the generic
 *     ToolRow (what most tools render), `data-variant="bash"` on the
 *     purpose-built shell card (that card renders itself and carries NO
 *     `data-tool`), or `data-variant="think"` on a reasoning row.
 *  2. It classifies the tool name with {@link classifyTool} into a category
 *     (a reasoning row always lands on `think`, and the shell card — which
 *     exposes no tool name — lands on `shell`).
 *
 * Slash-command cards are NOT targets: the command row is a separate harness
 * component (`GenericCommandCard`, `data-variant="others"`, no `data-tool`), so
 * it keeps the shipped look.
 *  3. It stamps the category back onto the same element as
 *     `data-rf-tool-cat="<category>"` plus a native `title` tooltip (the
 *     bilingual category label). `ToolAccent.css` then paints the row's left
 *     edge and its related text in the category colour — the colour itself is
 *     the `--rf-tool-<category>` variable, which this module also writes onto
 *     the document root from the settings store so the user's per-category
 *     picks (the settings panel's "command text colours" section) take effect
 *     live.
 *  4. It stamps each **folded parent line** — the process-group seat and the
 *     whole-Turn control — with the category of the newest row it hides
 *     (`data-rf-group-cat` / `data-rf-turn-cat` + an inline `--rf-tool-accent`),
 *     so a collapsed turn's visible line is tinted by the same colour as the
 *     commands behind it. Those lines are not rows, so they never inherit the row
 *     rules (no title gradient, no text fill) and cannot be mistaken for one.
 *  5. It also moves the **rainbow sweep** onto that fold line
 *     (`data-rf-latest-fold`) while the newest action is folded away — the fold
 *     line is then what the user sees, so the effect follows it instead of
 *     disappearing entirely.
 *
 * The whole colouring is switched by `settings.commandColor`: when off, the
 * module stops stamping and clears `data-rf-tool-cat` / `title` from every
 * already-decorated row so cards revert to the shipped look. The latest-action
 * rainbow sweep (see the sweep CSS) is independent — it marks with
 * `data-rf-latest` the LATEST action row (a tool row, or a Think row) and
 * clears it once a 正文 reply (the assistant's plain-text answer) appears after
 * it, so the effect follows the most recent action (including instant tools like
 * read/edit) until the model writes its answer. Whether a 正文 reply follows is
 * detected from the flow-item structure only (no `textContent` over-matching),
 * and the state is recomputed deterministically from the live DOM on every
 * change. Only the header text is swept — never the output body, so it works
 * whether or not colouring is on.
 *
 * 0.1.7+ shape (unchanged in 0.2.0, which is why every hook below still holds —
 * what the two older assumptions missed): rows now live inside a
 * **process group** — `[data-step-process]` → `[data-step-process-body]` →
 * `[data-step-process-content][data-chat-flow]` — whose members are the
 * tool/Think rows, while the 正文 reply is emitted as a flow item AFTER the
 * whole group at the OUTER `[data-chat-flow]` list level. The reply search
 * therefore climbs the nested `[data-chat-flow]` containers instead of stopping
 * at the row's own flow item, and rows hidden by the process-disclosure policy
 * (`hidden="until-found"` on the collapsed group body / on a member wrapper)
 * are skipped when picking the latest row — a marker on a hidden row sweeps
 * nothing.
 *
 * A single `MutationObserver` keeps the tags current without touching React:
 * it watches for added/dropped rows (childList — handles both added `Element`s
 * and added `DocumentFragment`s, so an inserted batch is covered), for a
 * `data-tool` / `data-variant` change on an existing row, and for the
 * `hidden` attribute the process disclosure toggles (all attributes, filtered).
 * It only writes `data-rf-tool-cat` / `title` / `data-rf-latest`, which are NOT
 * in the observed filter — so the observer never re-triggers itself. Each added
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

/** Attribute the harness sets on a generic tool-card root (stable). The
 *  purpose-built shell card is the exception: it carries `data-variant`
 *  instead (see {@link BASH_VARIANT}). */
const TOOL_ATTR = 'data-tool'
/** Attribute the harness sets on the reasoning ("Think") row root and on the
 *  purpose-built shell card root. */
const VARIANT_ATTR = 'data-variant'
/** The reasoning-row variant value. */
const THINK_VARIANT = 'think'
/** The shell-card variant value. The harness's shell card renders itself
 *  (its own card component rather than the generic ToolRow) and sets
 *  `data-variant="bash"` — with no `data-tool` — so it needs its own selector
 *  entry; without it every bash card would stay uncoloured. The literal is
 *  emitted by exactly one component in the shipped client, so the entry cannot
 *  match anything else. */
const BASH_VARIANT = 'bash'
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
 *  carry `data-tool`), the shell card (it carries `data-variant="bash"` but no
 *  `data-tool`), and the assistant's reasoning "Think" rows (they carry
 *  `data-variant="think"`). */
const ROW_SELECTOR = `[${TOOL_ATTR}], [${VARIANT_ATTR}="${THINK_VARIANT}"], [${VARIANT_ATTR}="${BASH_VARIANT}"]`

/** A transcript flow-list container. 0.1.5 shipped one flat list; 0.1.7 nests
 *  the action rows inside a process group whose content element
 *  (`[data-step-process-content]`) is itself a flow list, so the containers
 *  form a chain: group content → outer chat column. */
const FLOW_LEVEL_SELECTOR = '[data-chat-flow]'

/** Attribute the harness sets on a flow item (its chat-node kind). */
const FLOW_KIND_ATTR = 'data-chat-flow-kind'

/** The flow kind of the harness's whole-Turn control line ("worked for 12s") —
 *  a status line, never a 正文 reply. It is one of the lines this module tints
 *  and sweeps, so counting its text as an answer would retire the sweep the
 *  moment that line happens to follow the newest action. */
const TURN_PROCESS_KIND = 'turn-process'

/** Attribute the harness sets on a process-group seat (0.1.7). */
const GROUP_KEY_ATTR = 'data-chat-group-key'

/** Attribute this module stamps on a process-group seat with the category of
 *  its NEWEST child row, so the folded header line can be tinted while those
 *  rows are hidden. */
const GROUP_CAT_ATTR = 'data-rf-group-cat'

/** Attribute this module stamps on a whole-Turn control button with the
 *  category of that turn's newest child row (the other folded parent line). */
const TURN_CAT_ATTR = 'data-rf-turn-cat'

/** Attribute the harness sets on a flow item / group seat: the Turn it belongs
 *  to (a number, as a string). */
const TURN_ATTR = 'data-chat-turn'

/** Attribute the harness sets on the whole-Turn control button: the Turn it
 *  folds (a number, as a string — the same value as {@link TURN_ATTR}). */
const TURN_PROCESS_ATTR = 'data-turn-process'

/** Attribute this module stamps on the folded parent line that HIDES the
 *  newest action, so the rainbow sweep follows the latest command even while
 *  its rows are collapsed. Distinct from {@link LATEST_ATTR}, whose host is a
 *  row: the row sweep targets the row's title/leading/summary classes, which do
 *  not exist on a fold line (and whose transparent text fill must never land on
 *  one). */
export const FOLD_LATEST_ATTR = 'data-rf-latest-fold'

/** Bilingual category label, resolved from the document language. */
function labelFor(category: ToolCategory): string {
  const lang = (document.documentElement.lang || '').toLowerCase()
  return lang.startsWith('zh') ? CATEGORY_LABELS[category].zh : CATEGORY_LABELS[category].en
}

/** Classify + stamp one row. Idempotent — re-stamping the same values writes
 *  nothing (and neither attribute is observed, so no loop). A reasoning
 *  ("Think") row carries `data-variant="think"` (it has no `data-tool`), so it
 *  always lands on the `think` category; the shell card carries only
 *  `data-variant="bash"`, so it lands on `shell` (there is no tool name to
 *  classify); every other row is a tool call keyed by its `data-tool` name. */
function applyTo(element: Element): void {
  const variant = element.getAttribute(VARIANT_ATTR)
  const tool = element.getAttribute(TOOL_ATTR)
  const category: ToolCategory = variant === THINK_VARIANT
    ? 'think'
    : tool === null && variant === BASH_VARIANT
      ? 'shell'
      : classifyTool(tool ?? '')
  element.setAttribute(CAT_ATTR, category)
  element.setAttribute('title', labelFor(category))
}

/** Is this element actually rendered? 0.1.7's process disclosure hides the
 *  collapsed group body (`hidden="until-found"` on `[data-step-process-body]`)
 *  and individual process members (the member wrapper gets the same attribute),
 *  so `querySelectorAll` still returns rows the user cannot see; a rainbow
 *  marker on one of those can never show. */
function isVisible(el: Element): boolean {
  return el.closest('[hidden]') === null
}

/** Tag every decorated row in a subtree (used for the initial mount and for
 *  each newly added node). The node itself is checked too: React swaps a row's
 *  COMPONENT inside its persistent wrapper when a call changes phase (e.g. the
 *  file-mutation "preparing" row → the started diff row), so the added node can
 *  be the row root itself — `querySelectorAll` only looks at descendants and
 *  would leave that row unstamped forever. */
function scan(root: ParentNode): void {
  if (root instanceof Element && root.matches(ROW_SELECTOR)) applyTo(root)
  for (const el of root.querySelectorAll(ROW_SELECTOR)) applyTo(el)
}

/** Write (or clear) an attribute only when the value actually changes: these run
 *  once per animation frame while a turn streams, and re-writing an identical
 *  attribute would re-run style matching for nothing (the fold rules and the
 *  sweep both match on these attributes). */
function setAttrIfChanged(element: Element, attr: string, value: string | null): void {
  if (value === null) {
    element.removeAttribute(attr)
    return
  }
  if (element.getAttribute(attr) !== value) element.setAttribute(attr, value)
}

/**
 * Write (or clear) the folded parent line's accent: the `data-rf-*` CSS hook
 * plus the inline `--rf-tool-accent` the stylesheet reads. A `null` category
 * removes both — which is how the tint disappears when `settings.commandColor`
 * is switched off.
 * @param element - the fold line (group seat / whole-Turn control button).
 * @param attr - the hook attribute for that kind of line.
 * @param category - the category to paint, or null to clear.
 */
function applyFoldAccent(element: Element, attr: string, category: string | null): void {
  const style = (element as HTMLElement).style
  if (category === null) {
    setAttrIfChanged(element, attr, null)
    style.removeProperty('--rf-tool-accent')
    return
  }
  setAttrIfChanged(element, attr, category)
  const accent = `var(--rf-tool-${category})`
  // Only write when it actually changes: this runs once per frame while the
  // turn streams, and rewriting an identical inline style would invalidate the
  // element's style for nothing.
  if (style.getPropertyValue('--rf-tool-accent') !== accent) style.setProperty('--rf-tool-accent', accent)
}

/**
 * Tag both kinds of **folded parent line** with the category of the newest row
 * they hide, so a collapsed turn still shows what colour its commands are.
 *
 * The harness folds a turn's rows behind two lines: the **process-group seat**
 * (`[data-chat-group-key]`, whose header carries `data-process-activity` and the
 * "loaded a file, searched the code" summary) and the **whole-Turn control**
 * (`[data-turn-process]`, "worked for 12s" — the line that stays visible once
 * the seat itself is hidden for a settled turn). Neither is a row, so neither
 * can be reached by the row rules. The newest child's category is the honest
 * choice: it is the same "latest action" the rainbow sweep follows.
 *
 * The accent is written BOTH as a `data-rf-*` hook and as an inline
 * `--rf-tool-accent` on the line, so the per-category colours the user picked
 * (`--rf-tool-*`) apply without duplicating the palette in CSS.
 * @param root - the observed root (the mount's transcript root).
 */
function applyFoldAccents(root: ParentNode): void {
  // One pass over the rows collects both mappings; document order means the last
  // stamped row wins, i.e. the newest action of that seat / turn.
  const bySeat = new Map<Element, string>()
  const byTurn = new Map<string, string>()
  for (const row of root.querySelectorAll(ROW_SELECTOR)) {
    const category = row.getAttribute(CAT_ATTR)
    if (category === null) continue
    const seat = row.closest(`[${GROUP_KEY_ATTR}]`)
    if (seat !== null) bySeat.set(seat, category)
    const turn = row.closest(`[${TURN_ATTR}]`)?.getAttribute(TURN_ATTR)
    if (turn !== null && turn !== undefined) byTurn.set(turn, category)
  }
  for (const seat of root.querySelectorAll(`[${GROUP_KEY_ATTR}]`)) {
    applyFoldAccent(seat, GROUP_CAT_ATTR, bySeat.get(seat) ?? null)
  }
  // The whole-Turn line is keyed by the Turn number the harness puts on both the
  // control button and every flow item of that turn.
  for (const button of root.querySelectorAll(`[${TURN_PROCESS_ATTR}]`)) {
    const turn = button.getAttribute(TURN_PROCESS_ATTR)
    applyFoldAccent(button, TURN_CAT_ATTR, turn === null ? null : byTurn.get(turn) ?? null)
  }
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

  // Live gate: whether category colouring is applied (stamping) right now, so
  // the MutationObserver can refuse to stamp while the user has it switched off.
  let colorOn = true
  let applied = false
  /** Set by the disposer so a queued animation frame cannot write after the
   *  fiber is gone. */
  let disposed = false

  /** Remove one element's decoration: the category stamp and its tooltip. Used
   *  when the user turns colouring off (on every row) and when an observed
   *  attribute change makes an element STOP being a row. */
  function clearStamp(element: Element): void {
    element.removeAttribute(CAT_ATTR)
    element.removeAttribute('title')
  }

  /** Remove the category stamp + tooltip from every decorated row — used when
   *  the user turns command colouring OFF, so already-coloured cards revert to
   *  the shipped look immediately. */
  function clearAllStamps(): void {
    for (const el of root.querySelectorAll(`[${CAT_ATTR}]`)) clearStamp(el)
  }

  /** Remove every trace of the decoration — the disposer's job, so switching the
   *  widget off (or any fiber teardown) leaves the shipped DOM as it was found:
   *  no category stamps or tooltips, no sweep markers, no fold accents, no sweep
   *  gate and no inline palette overrides. */
  function teardown(): void {
    clearAllStamps()
    for (const el of root.querySelectorAll(`[${GROUP_CAT_ATTR}], [${TURN_CAT_ATTR}]`)) {
      el.removeAttribute(GROUP_CAT_ATTR)
      el.removeAttribute(TURN_CAT_ATTR)
      ;(el as HTMLElement).style.removeProperty('--rf-tool-accent')
    }
    for (const el of root.querySelectorAll(`[${LATEST_ATTR}], [${FOLD_LATEST_ATTR}]`)) {
      el.removeAttribute(LATEST_ATTR)
      el.removeAttribute(FOLD_LATEST_ATTR)
    }
    const html = document.documentElement
    html.removeAttribute(SWEEP_GATE_ATTR)
    for (const cat of TOOL_CATEGORIES) html.style.removeProperty(`--rf-tool-${cat}`)
  }

  /** Is the latest action superseded by a 正文 reply? Three reliable cases:
   *  (a) a following flow item that is a sibling of the row itself — some
   *      shapes put the reply at that level (a Think row and its reply as
   *      siblings); (b) the row's own flow item (`data-chat-flow-kind`) is
   *      followed by the reply flow item;
   *  (c) 0.1.7+ (0.2.0 unchanged) — the row sits inside a process group, so the
   *      reply lives one or more flow-list levels OUT, after the whole group. The
   *      search
   *      therefore scans the following flow items at every `[data-chat-flow]`
   *      level, innermost first, and ascends. Only flow items are inspected (a
   *      container only counts when it is a flow item or a group seat), so the
   *      composer / scroll chrome — and a row's own card body — can never
   *      mismatch. */
  function isSuperseded(latest: Element): boolean {
    /** Is this following flow item a 正文 reply? Visible text counts, except for
     *  the harness's own whole-Turn control line (`turn-process`, the
     *  `[data-turn-process]` status line this module also tints and sweeps): that
     *  is not an answer, so a control line that happens to follow the newest
     *  action must not retire the sweep. Turn-ending items (turn-error /
     *  compaction / turn-tail) DO count — the round is over, the sweep should
     *  clear. */
    const isReply = (s: Element): boolean => s.getAttribute(FLOW_KIND_ATTR) !== TURN_PROCESS_KIND
      && isVisible(s) && (s.textContent || '').trim() !== ''
    // (a) a following FLOW ITEM that is a sibling of the row itself (some
    //     shapes put the reply at this level). Only flow items count — a row's
    //     own card chrome is a sibling too and is NOT a reply: the shell card
    //     (`[data-variant="bash"]`) renders its expanded terminal/IO output as
    //     `bodyWrap`, a sibling of the row root, whose text would otherwise
    //     retire the sweep on any expanded shell card.
    let sib = latest.nextElementSibling
    while (sib) {
      if (sib.hasAttribute(FLOW_KIND_ATTR) || sib.hasAttribute(GROUP_KEY_ATTR)) {
        if (sib.matches(ROW_SELECTOR) || sib.querySelector(ROW_SELECTOR)) return false
        if (isReply(sib)) return true
      }
      sib = sib.nextElementSibling
    }
    // (b)+(c) climb the nested flow lists: at each level, look at the FOLLOWING
    //         flow items, then move up to the enclosing flow list. If the shape
    //         ever loses its list container, fall back to the row's own flow
    //         item's parent so the reply sibling is still seen.
    let node: Element = latest
    let level = latest.closest(FLOW_LEVEL_SELECTOR)
      ?? latest.closest(`[${FLOW_KIND_ATTR}]`)?.parentElement
      ?? null
    while (level) {
      // The direct child of this level that contains the row (structure guard:
      // if the chain does not line up, stop rather than scan the wrong level).
      let owner: Element | null = node
      while (owner !== null && owner.parentElement !== level) owner = owner.parentElement
      if (owner === null) break
      let s = owner.nextElementSibling
      while (s) {
        if (s.hasAttribute(FLOW_KIND_ATTR) || s.hasAttribute(GROUP_KEY_ATTR)) {
          // A following flow item that holds a newer action → the newer action is
          // the latest instead (nothing to supersede here).
          if (s.matches(ROW_SELECTOR) || s.querySelector(ROW_SELECTOR)) return false
          // A following flow item with visible text = the 正文 reply (see isReply:
          // the whole-Turn control line does not count).
          if (isReply(s)) return true
        }
        s = s.nextElementSibling
      }
      node = level
      level = level.parentElement?.closest(FLOW_LEVEL_SELECTOR) ?? null
    }
    return false
  }

  /** Mark the LATEST visible action row (the newest {@link ROW_SELECTOR} row in
   *  document order that the disclosure policy has not hidden) with
   *  `data-rf-latest` unless it is superseded by a 正文 reply — so a fast command
   *  like read/edit stays highlighted until the model writes its text answer.
   *  Recomputed deterministically from the DOM each time (no sticky state); only
   *  the header is swept, never the output body. */
  function setLatest(): void {
    const rows = Array.from(root.querySelectorAll(ROW_SELECTOR))
    // The transcript appends new actions chronologically, so the LAST matching
    // row in document order is the newest action. That is a deliberate coupling
    // to this DOM shape: if the chat view ever virtualizes or reorders the
    // list, "last in document order" would no longer mean "newest" and this
    // should be driven from a stable sequence instead. Rows hidden by the
    // process disclosure are skipped — marking one would sweep nothing.
    let latest: Element | null = null
    let latestIndex = -1
    for (let i = rows.length - 1; i >= 0; i--) {
      if (isVisible(rows[i])) {
        latest = rows[i]
        latestIndex = i
        break
      }
    }
    // A hidden row AFTER the newest visible one means a newer action is folded
    // away: the visible row is not the latest action, so do not sweep it.
    const foldedNewer = latest !== null && latestIndex < rows.length - 1
    const superseded = latest === null || foldedNewer || isSuperseded(latest)
    for (const el of rows) {
      setAttrIfChanged(el, LATEST_ATTR, el === latest && !superseded ? 'on' : null)
    }
    // An element can STOP being a row (an observed `data-tool`/`data-variant`
    // change), and then it is no longer in `rows` — clear any marker it kept so
    // no stale row keeps animating the sweep.
    for (const el of root.querySelectorAll(`[${LATEST_ATTR}]`)) {
      if (!el.matches(ROW_SELECTOR)) el.removeAttribute(LATEST_ATTR)
    }
    setFoldLatest(rows)
  }

  /** Move the sweep onto the folded parent line when the newest action is hidden
   *  behind it. The row marker above deliberately stops when the newest row is
   *  folded away (marking an older visible row would claim it is the latest); the
   *  fold line is what the user actually sees instead, so the sweep follows it —
   *  the group seat while that seat is visible, otherwise the whole-Turn control
   *  button (a settled turn hides the seat entirely). It obeys the same 正文
   *  rule as the row marker: once the reply that follows the folded action
   *  appears, the line stops sweeping. */
  function setFoldLatest(rows: readonly Element[]): void {
    const newest = rows.length > 0 ? rows[rows.length - 1] : null
    /** The line that hides the newest action, or null when nothing should sweep. */
    let host: Element | null = null
    // Only the folded-away case: a visible newest row is the row marker's job.
    if (newest !== null && !isVisible(newest)) {
      // The SAME retirement rule as the row marker: a 正文 reply that follows the
      // folded action closes the round, so the fold line must stop sweeping too.
      // Without this gate the effect kept running after the command finished and
      // the answer had already landed (the folded line is the only thing a
      // collapsed turn shows, so the marker was plainly visible).
      const superseded = isSuperseded(newest)
      const seat = superseded ? null : newest.closest(`[${GROUP_KEY_ATTR}]`)
      if (seat !== null && isVisible(seat)) {
        host = seat
      } else if (!superseded) {
        const turn = newest.closest(`[${TURN_ATTR}]`)?.getAttribute(TURN_ATTR)
        if (turn !== null && turn !== undefined) {
          for (const button of root.querySelectorAll(`[${TURN_PROCESS_ATTR}]`)) {
            if (button.getAttribute(TURN_PROCESS_ATTR) === turn && isVisible(button)) {
              host = button
              break
            }
          }
        }
      }
    }
    // Move the marker only when the host changed, so a steady state writes nothing.
    for (const el of root.querySelectorAll(`[${FOLD_LATEST_ATTR}]`)) {
      if (el !== host) el.removeAttribute(FOLD_LATEST_ATTR)
    }
    if (host !== null) setAttrIfChanged(host, FOLD_LATEST_ATTR, 'on')
  }

  /** Recompute everything derived from the current DOM: the rainbow sweep's
   *  `data-rf-latest` marker and the folded group-header accents. Runs on mount,
   *  on every settings change, and once per frame after DOM mutations. */
  function recompute(): void {
    setLatest()
    applyFoldAccents(root)
  }

  /** Apply the user's colours + the sweep gate, then (re)stamp or clear the
   *  command rows to match `settings.commandColor`, and keep the latest-card
   *  marker + group-header accents current (deterministic from the current
   *  DOM). */
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
    recompute()
    applied = true
  }

  // Apply the user's colours + gate, and keep them live regardless of whether
  // observation is available — the overrides affect already-stamped rows too.
  sync()
  const unsubscribeSettings = subscribeSettings(sync)

  if (typeof MutationObserver === 'undefined') {
    // Nothing to decorate (or too old to observe) — colour overrides still
    // applied and tracked, so dispose unsubscribes and takes them back out.
    return () => {
      teardown()
      unsubscribeSettings()
    }
  }

  // Recompute the latest marker once per animation frame after any DOM change,
  // so it tracks live streaming exactly like a fresh render (no sticky state).
  let rafPending = false
  let rafId = 0
  const scheduleLatest = (): void => {
    if (rafPending) return
    rafPending = true
    if (typeof window.requestAnimationFrame !== 'function') {
      // No frame scheduler (ancient browser / a DOM shim): stay correct by
      // recomputing synchronously instead of dropping the update.
      rafPending = false
      recompute()
      return
    }
    rafId = window.requestAnimationFrame(() => {
      rafPending = false
      rafId = 0
      if (!disposed) recompute()
    })
  }

  const observer = new MutationObserver((mutations) => {
    let changed = false
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        // `data-tool` / `data-variant` flipped → re-classify the row, or drop the
        // decoration when the element no longer qualifies as one (a command card
        // that momentarily carried `data-tool`, a Think row whose variant
        // changed). `applyTo`/`clearStamp` write neither observed attribute, so
        // this cannot recurse. The row is only re-classified while colouring is
        // on, but the markers are recomputed either way — the sweep is
        // independent of `commandColor`.
        if (colorOn && (mutation.attributeName === TOOL_ATTR || mutation.attributeName === VARIANT_ATTR)) {
          const target = mutation.target
          if (target instanceof Element) {
            if (target.matches(ROW_SELECTOR)) applyTo(target)
            else clearStamp(target)
          }
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
    // `hidden` is how the process disclosure shows/hides a group body or member
    // in 0.1.7: expanding a folded group must re-pick the latest visible row.
    attributeFilter: [TOOL_ATTR, VARIANT_ATTR, 'hidden'],
  })

  return () => {
    disposed = true
    if (rafId !== 0) window.cancelAnimationFrame(rafId)
    observer.disconnect()
    unsubscribeSettings()
    teardown()
  }
}
