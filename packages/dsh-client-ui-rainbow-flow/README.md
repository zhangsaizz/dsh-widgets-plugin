# @dsh-plugins/client-ui-rainbow-flow

English | [中文](README.zh.md)

A pure-UI web plugin that wraps the composer input in a soft flowing rainbow
while the session runs: the input card becomes a translucent liquid-glass
panel with wisps of rainbow cloud drifting like puffs along its borderless
edge, with the drift speed driven by the live output-token rate, plus an
on/off toggle in the composer tool row, a configurable effect panel, and a
matching liquid-glass beautification of the composer's primary send/stop
button with dynamic effects.

## Preview

![Rainbow flow preview: ring + halo around the composer input](../../docs/previews/rainbow-flow.png)

## Features

- **The whole input box is transparent liquid glass**: while the rainbow
  toggle is on, the composer card itself becomes a **translucent frosted-glass
  panel** — the shipped solid dark background is replaced with a **soft white
  glass gradient** plus a `::before` **light-frost layer** (14px blur) that
  lets what is behind the card (the page, floating widgets, the chat area)
  show through clearly — translucent, not a milky wall. On the dark theme the
  white glass keeps the card a shade brighter than the background so the
  glass reads, while the light frost keeps it see-through; on the light theme
  the glass deepens to a higher-contrast pane and the button icon flips dark
  so it stays legible — the glass material is theme-aware (`--rf-glass-*`
  tokens, dark and light palettes). The input box reads as a sheet of liquid
  glass with **no visible rim or border** — the only edge decoration is the
  flowing rainbow ribbon itself. (The frosted layer lives
  on the card's
  `::before` pseudo-element, not on the card itself, because a card-level
  `backdrop-filter` would become the containing block of the composer's
  fixed-position Tooltip bubbles and throw them off-screen — `::before` is a
  sibling of those contents, so popups stay put.) Turning the toggle off
  restores the shipped opaque card untouched. The effect follows the card's
  height automatically (an absolutely-positioned layer inside the card, no
  height measurement).
- **Speed follows the token rate**: a 500 ms sampler reads the streaming
  `partial` content and estimates the output-token rate (~2 chars per token,
  EMA-smoothed); the rotation period maps 5 s (slow) ↔ 1 s (fast) — a calmer
  range than before, so the rainbow drifts at rest and never whips at peak
  throughput. Fast generation spins the rainbow; thinking / tool gaps glide
  back to a slow drift. Speed changes are eased: a rAF loop exponentially
  approaches the sampled target angular velocity and integrates the flow
  continuously (no `animation-duration` swaps), so fast↔slow transitions
  accelerate and decelerate smoothly without the particles jumping. The
  blurred halo stays static (ambient tint, painted once, so no per-frame
  blur recompute).
- **Cloud-wisp edge**: the rainbow edge is a **series of soft, puffy wisps
  of cloud drifting along the card's edge** — 6 cloud wisps, each a thick,
  rounded puff of light (a wide low-alpha glow underneath a gentle core,
  with a sine envelope so each wisp is bright at its center and fades to
  nothing at both ends). Gaps between the wisps keep them reading as separate
  drifting clouds, not a continuous line; colors melt gently through each
  wisp (`particles.ts`: a pure, testable geometry + motion model). Token rate
  drives how fast the clouds drift.
- **Mood-aware palette**: while the model is thinking or running a tool (no
  new output), the clouds **cool toward blue/violet** (+120° hue shift); while
  it streams output they warm back to the full rainbow. The shift eases
  smoothly so the palette glides with the model's rhythm — the effect reads
  as "working" vs "streaming" at a glance.
- **Reduced motion**: with `prefers-reduced-motion`, the clouds render as a
  single static frame (visible but not animated) instead of disappearing.
- **Configurable**: the widget manager lists the rainbow flow like any other
  widget — **Enable/Disable** toggles the effect (bidirectionally synced with
  the toolbar dot), and **Configure** opens a panel to adjust the cloud wisps
  count (4/6/8/10), overall opacity (40/70/100%), token-rate speed
  sensitivity (0.5×/1×/1.5×) and the thinking cool-shift palette on/off —
  persisted to `localStorage` (`dsh.rnglow.settings`) and applied live.
- **Battery-friendly**: the animation loop pauses while the composer is
  scrolled out of view (`IntersectionObserver`), and the colour palettes are
  precomputed once so no per-frame string work happens.
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
- **Graceful degradation**: browsers without `mask-composite` support hide
  the mask-carved halo (it would otherwise paint as a solid translucent pane
  over the input) and fall back to a soft multi-color `box-shadow` glow;
  browsers without `backdrop-filter` still get the translucent white glass
  (the frosted blur is an enhancement).
  `prefers-reduced-motion` renders the clouds as a static frame.

## Structure

```
src/index.ts                      # Host empty apply (pure UI plugin)
src/client/index.ts               # browser apply + inject (four entries incl. config panel)
src/client/RainbowFlow.tsx        # toggle + glow (canvas clouds) + send/stop probe
src/client/SettingsPanel.tsx      # widget-manager configuration panel (widgets.config)
src/client/SettingsPanel.module.css # config panel styles
src/client/settings.ts            # settings store (wisps/opacity/speed/mood, localStorage)
src/client/locales.ts             # `rainbow-flow` dictionary namespace (zh / en)
src/client/particles.ts           # pure cloud geometry/motion model (rounded-rect rim)
src/client/rate.ts                # pure motion model (token rate -> speed, easing)
src/client/RainbowFlow.module.css # glass panel/halo/toggle/probe styles
src/client/SendButton.css         # global send/stop button beautification (plain CSS)
docs/speed-smoke-test.cjs         # motion-model smoke test (esbuild-bundled source)
docs/particles-smoke-test.cjs     # particle geometry/motion smoke test
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

1. **Watch it flow** — open any session and send a message; while the model
   runs, the input card becomes a liquid-glass panel with wisps of rainbow
   cloud drifting like puffs along its edge. The faster the output tokens
   stream, the faster the clouds drift.
2. **Toggle** — click the glass dot at the left end of the tool row to turn
   the effect off/on (persisted across reloads). The dot's corner status turns
   green while the session runs.
3. **Send button** — with a draft typed, the primary send button wears a
   liquid-glass pane with the rainbow glowing through and a breathing glow;
   while the session runs it becomes a rotating rainbow stop button with an
   expanding pulse ring. Turn the toggle off to restore the shipped look.
4. **Reduced motion** — with `prefers-reduced-motion`, the clouds render as a
   static frame (visible but not drifting), and the send/stop button
   animations freeze.
