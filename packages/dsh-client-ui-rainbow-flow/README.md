# @dsh-plugins/client-ui-rainbow-flow

English | [中文](README.zh.md)

A pure-UI web plugin that wraps the composer input in a soft **breathing
rainbow halo** while the session runs: the input card becomes a translucent
liquid-glass panel, a soft rainbow glow around it pulses like a breath —
inhale, exhale — with the breathing rhythm driven by the live output-token
rate, plus an on/off toggle in the composer tool row, a configurable effect
panel, and a matching liquid-glass beautification of the composer's primary
send/stop button with dynamic effects.

## Preview

![Rainbow flow preview: breathing halo around the composer input](../../docs/previews/rainbow-flow.png)

## Features

- **The whole input box is see-through glass**: while the rainbow toggle is
  on, the composer card itself becomes a **translucent glass panel** — the
  shipped solid dark background is replaced with a **subtle white glass
  gradient** (gentle two-stop: a faint light falling through the pane) and a
  `::before` **light-frost layer** (5px blur + strong saturation) that lets
  what is behind the card (the page, floating widgets, the chat area) show
  through **clearly and vividly** — the translucency does the work, and the
  saturation boost makes the backdrop colours glow through the pane. Thin 1px reflections
  on the **top and bottom edges** (brighter top, softer bottom) catch the
  light and make the glass edge read — restrained, no large highlight arc.
  On the dark theme the faint white glass keeps the card a shade brighter
  than the background so the glass reads, while the light frost keeps it
  see-through; on the light theme the glass deepens to a higher-contrast pane
  and the button icon flips dark so it stays legible — the glass material is
  theme-aware (`--rf-glass-*` tokens, dark and light palettes). The input box
  reads as a sheet of glass with **no visible rim or border** — the only edge
  decoration is the breathing halo itself. (The frosted layer lives
  on the card's
  `::before` pseudo-element, not on the card itself, because a card-level
  `backdrop-filter` would become the containing block of the composer's
  fixed-position Tooltip bubbles and throw them off-screen — `::before` is a
  sibling of those contents, so popups stay put.) Turning the toggle off
  restores the shipped opaque card untouched. The effect follows the card's
  height automatically (an absolutely-positioned layer inside the card, no
  height measurement).
- **Breathing rhythm follows the token rate**: a 500 ms sampler reads the
  streaming `partial` content and estimates the output-token rate (~2 chars
  per token, EMA-smoothed); the breathing period maps 5 s (slow) ↔ 1 s (fast)
  — a calm, restful breath at rest, a quick eager pulse at peak throughput.
  Fast generation makes the halo breathe faster; thinking / tool gaps glide
  back to a slow drift. Rhythm changes are eased: a rAF loop exponentially
  approaches the sampled target frequency and integrates the breathing phase
  continuously (no `animation-duration` swaps), so fast↔slow transitions
  accelerate and decelerate smoothly without the breath jumping. Only the
  halo layers' opacity is written per frame (compositor-friendly
  — the static box-shadow layers are rasterized once), so nothing
  re-rasterizes.
- **The breathing halo**: the rainbow edge is a **soft glow hugging the
  card's rounded corners** — **sixteen directional box-shadows, one pure
  rainbow hue per direction** (22.5° apart, a full colour wheel: red → orange
  → yellow → green → cyan → blue → violet → pink, with an intermediate hue
  between each). A plain stacked shadow would blend every hue over the whole
  edge into one muddy mix; giving each layer a small directional offset
  distributes the hues around the card, and with a small offset + wide blur
  every hue overlaps its neighbours on both sides — a smooth continuous
  rainbow gradient with no visible banding. Box-shadow lives
  OUTSIDE the element, so the card interior stays
  completely clean (the input itself is never tinted), and it **follows
  `border-radius`**, so the glow curves around the card's corners (a
  mask-carved ring can't — linear-gradient masks are straight-edged and
  square the corners). Every shadow uses **spread 0**: a positive spread
  carves an opaque core from the edge, which paints a hard bright line where
  the shadow starts — the visible "inner outline". With spread 0 the blur
  owns the whole falloff, so the peak sits on the edge and fades in **both
  directions**; soft **inner (inset) glows** complete the effect so the
  rainbow reads as **light the card itself emits**, not a ring stuck on its
  edge. The glow layers are aligned **exactly onto the card's edge** (the
  outer flow layer hangs 5px beyond the card; the glow layers pull back that
  same 5px and use the card's own corner radius) — the shadow peak sits on
  the edge itself, so the halo hugs the card and the glass edge visibly
  glows. The colours are drawn with **`mix-blend-mode: screen`** (additive):
  on a dark page a semi-transparent colour over near-black collapses into a
  dark smudge, but screen-blended it stays luminous and vivid. It breathes by
  **pulsing its opacity (0.18 ↔ 0.38) on a sine wave** — a deliberate
  pure-intensity breath: scaling the glow would drift its edges off the
  unscaled card and re-open an inner outline at the peak, so the layers stay
  pinned to the card edge and the 2.1× brightness swing reads as the light
  expanding with each breath. On top of the breathing, the whole rainbow's
  hue slowly **flows around the wheel** (48s per full rotation via a CSS
  `hue-rotate` animation): the eight colours keep their directions but every
  hue drifts to the next — red→orange→yellow→…→pink→red — a gentle living
  motion with no geometry moving (the glow stays pinned to the card edge);
  `prefers-reduced-motion` freezes the flow. The `--rf-palette` hues feed
  the shadow colours; the palette is shared with the toggle dot and the send
  button.
- **Mood-aware palette**: while the model is thinking or running a tool (no
  new output), the halo **cools toward blue/violet**; while it streams output
  it warms back to the full rainbow. The transition is a **cross-fade**
  between two pre-built glow layers (warm rainbow + cool blue/violet) driven
  by an eased mood factor — pure opacity animation, nothing re-rasterizes —
  and the effect reads as "working" vs "streaming" at a glance.
- **Reduced motion**: with `prefers-reduced-motion`, the halo renders as a
  single static mid-breath frame (visible but not animating) instead of
  disappearing.
- **Configurable**: the widget manager lists the rainbow flow like any other
  widget — **Enable/Disable** toggles the effect (bidirectionally synced with
  the toolbar dot), and **Configure** opens a panel to adjust the overall
  opacity (40/70/100%), token-rate speed sensitivity (0.5×/1×/1.5×), the
  thinking cool-shift palette on/off, the **latest-action rainbow sweep**
  on/off, and the **command text colours** — its section header carries the
  master **colour command cards by category** toggle, and below it a
  per-category swatch for each command class (shell, read, search, write,
  edit, code, web, ask, plan, memory, think, other), each row showing the
  web-native tool name (bash, read_file, apply_patch, …) beside the harness's
  own command-card icon, both tinted live by that row's colour, plus a
  per-row reset; when the master toggle is off the palette dims to a holding
  state (colours saved, not applied) —
  persisted to `localStorage` (`dsh.rnglow.settings`) and applied live to the
  mounted effect and the coloured command cards. **Reset to defaults** restores
  the shipped look including the command colours. (The old "cloud wisps" knob
  went away with the particle-flow effect: the halo is one continuous glow,
  so there is no wisp count to configure.)
- **Battery-friendly**: the animation loop pauses while the composer is
  scrolled out of view (`IntersectionObserver`), and a steady state writes
  nothing per frame (only the compositor-friendly opacity/transform move
  during a breath).
- **On/off toggle**: a small glass dot button at the left end of the
  composer tool row (the `conversation.input.left` seat), matching the
  liquid-glass language (translucent gradient + blur + top highlight). The
  dot greys out when off; a status dot in its corner turns green while the
  session runs. The state persists to `localStorage` (`dsh.rnglow.enabled`,
  default on).
- **Send/stop button beautification**: the composer's primary action button
  (idle = send arrow, running = stop square) is shipped chrome, not a slot,
  so a `conversation.input.right` entry mirrors its effective state onto the
  composer card (`data-rf-send`) and a plain global stylesheet
  (`SendButton.css`) dresses the button up as **liquid glass**: a translucent
  pane (soft white gradient + backdrop blur + top specular highlight) with
  the softened rainbow glowing through it, a gentle **breathing glow** while
  idle with a draft, and while the session runs a **rotating rainbow +
  expanding radar pulse ring**. It shares the same on/off toggle (off =
  shipped look untouched), skips disabled buttons (empty draft), and freezes
  under `prefers-reduced-motion`. The selector anchors on the stable
  `[data-composer-card]` attribute plus the `_primary` CSS-module suffix, so
  it survives harness upgrades.
- **Command cards coloured by type**: each model **tool call (command) card**
  in the transcript is **heuristically classified by its tool name** into a
  category — **shell, read, search, write, edit, code, web, ask, plan,
  memory** — each with its **own colour**: the card gets a **coloured left
  edge**, and its **related text is coloured by category too** — the **row
  title** (e.g. Bash/Read/Write) drawn as a **theme-aware gradient**
  (`background-clip: text`, category colour → brightness), the **leading
  icon** in the category colour, the **summary line** in a soft category
  tint (kept readable as secondary text), and the **file name / path of
  read/write/edit tools** (a clickable link) in a solid category colour (so the
  link's underline is preserved) — hover the card for the category name. The
  assistant's **"Think" reasoning row** (the model's reasoning block
  — `data-variant="think"`, not a tool card) is coloured the **same way**, in
  the `think` lavender category. It reads the card's stable
  `data-tool="<name>"` attribute (shipped by
  the harness ToolRow), a `MutationObserver` writes the category back as
  `data-rf-tool-cat`, and `ToolAccent.css` paints it — **no re-render, no
  changes to the product's DOM**, so it survives harness upgrades (the text is
  matched on the CSS-module local-name suffix `_title`/`_leading`/`_summary`,
  the same trick `SendButton.css` uses with `_primary`; the title falls back to
  a solid category colour where `background-clip: text` or `color-mix` is
  unsupported); an unknown tool falls back to the neutral "Tool" colour.
  **The colours are user-customisable per category** in the config panel (see
  Configurable; written to `--rf-tool-*` variables and applied live).
  **The latest action's title/summary is swept by a rainbow (not its body)**:
  the newest row in the transcript — a tool command card or a **"Think"**
  reasoning row — has its title / summary / file name painted with a **flowing
  rainbow gradient** (`background-clip: text`) that sweeps across each
  character; the output **body is deliberately not targeted**. It **follows the
  latest action and persists** there (instant commands like read/edit still show
  it — it's not gated on `running`), until a **正文 reply appears after it**
  (detected precisely from the flow-item structure, so the composer isn't
  mistaken for it) — then it clears. Recomputed deterministically from the DOM,
  pure CSS with no DOM re-render, freezes to a static rainbow under
  `prefers-reduced-motion`, and can be turned off via the config panel's
  **latest-action rainbow sweep** switch. The command colouring is itself
  controlled by the **colour command cards by category** switch (on by default;
  turning it off reverts the cards to the shipped look), and both are
  independent of the composer-glow toggle.
- **Graceful degradation**: browsers without `backdrop-filter` still get the
  translucent white glass (the frosted blur is an enhancement); browsers
  without `mix-blend-mode: screen` fall back to normally-blended shadows
  (dimmer but intact — still never tinting the input). `prefers-reduced-
  motion` renders the halo as a static frame.

## Structure

```
src/index.ts                      # Host empty apply (pure UI plugin)
src/client/index.ts               # browser apply + inject (four entries incl. config panel)
src/client/RainbowFlow.tsx        # toggle + breathing glow + send/stop probe
src/client/SettingsPanel.tsx      # widget-manager configuration panel (widgets.config)
src/client/SettingsPanel.module.css # config panel styles
src/client/settings.ts            # settings store (opacity/speed/mood, localStorage)
src/client/locales.ts             # `rainbow-flow` dictionary namespace (zh / en)
src/client/rate.ts                # pure motion model (token rate -> breathing freq, easing)
src/client/classify.ts            # pure tool-name -> category classification (heuristic + bilingual labels)
src/client/toolAccent.ts          # tags transcript command cards with a category (MutationObserver)
src/client/ToolAccent.css         # command-card colour accents by category (plain CSS)
src/client/RainbowFlow.module.css # glass panel/halo/toggle/probe styles
src/client/SendButton.css         # global send/stop button beautification (plain CSS)
docs/speed-smoke-test.cjs         # motion-model smoke test (esbuild-bundled source)
docs/classify-smoke-test.cjs      # command-classifier smoke test (esbuild-bundled source)
lib/index.js                      # host build output (static)
lib/client.js                     # browser bundle (ModuleLoader CJS + inlined CSS)
```

## Build

The root `scripts/build.mjs` builds this package's client bundle (Vite
library mode, the official deepseek-harness web toolchain) into
`lib/client.js`:

```bash
pnpm install
pnpm build   # equivalent to node scripts/build.mjs
```

## Mount

This is a pure-client surface plugin: add it (with its `dsh.client`
dependencies) to the deployment's web plugin table / host `cordis.yml`, and
the browser loads `lib/client.js` through `exports["./client"]`. It registers
into `conversation.input.left` and `conversation.input.right`, so it appears
in every session's composer. For development, `link:` the bundle from this
repo (see the root README "安装").

## Usage

No configuration needed after mounting:

1. **Watch it breathe** — open any session and send a message; while the
   model runs, the input card becomes a liquid-glass panel with a soft
   rainbow halo that breathes around it. The faster the output tokens
   stream, the faster it breathes.
2. **Toggle** — click the glass dot at the left end of the tool row to turn
   the effect off/on (persisted across reloads). The dot's corner status turns
   green while the session runs.
3. **Send button** — with a draft typed, the primary send button wears a
   liquid-glass pane with the rainbow glowing through and a breathing glow;
   while the session runs it becomes a rotating rainbow stop button with an
   expanding pulse ring. Turn the toggle off to restore the shipped look.
4. **Reduced motion** — with `prefers-reduced-motion`, the halo renders as a
   static frame (visible but not breathing), and the send/stop button
   animations freeze.
5. **Command-card colours** — in the transcript, each tool/command card lights
   up with a different-coloured left edge by category (requires the rainbow
   flow plugin mounted); hover a card to see its category. In the config
   panel's **command text colours** you can pick a custom colour per command
   class and the already-coloured cards recolor live. While a command is
   **running**, its text is swept by a flowing rainbow over each character,
   reverting when it finishes.
