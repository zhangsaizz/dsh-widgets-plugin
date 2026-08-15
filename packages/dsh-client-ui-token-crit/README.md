# @dsh-plugins/client-ui-token-crit

English | [中文](README.zh.md)

A floating token-usage "crit damage" meter widget (web plugin). Pure UI: it
registers a draggable, resizable, collapsible transparent widget in
`shell.overlay` that shows the current session's cumulative token usage in
real time and triggers game-style crit animations as usage grows.

## Features

- **Real-time cumulative usage**: reads the `tokenUsage` session projection
  (input + cached read + cached write + output) through the standard
  `useSessions` prop — no Host RPC, no polling (the projection push frames are
  reactive).
- **Crit animations**: on growth — screen shake + flash + floating `+N` damage
  numbers split by input/output, particle bursts, combo counter; large deltas
  trigger a red `暴击!` / `CRIT!`, edge glow, optional sound effects.
- **Ambient particles**: ember particles slowly rising over a transparent
  background (count and color adjustable).
- **Configurable**: the ⚙ settings panel adjusts language (zh/en), number
  format / font size, label, combo, particles, crit threshold / ratio, sound,
  edge glow in real time; position and zoom persist to `localStorage`.

## Structure

```
src/index.ts                  # Host empty apply (pure UI plugin)
src/client/index.ts           # Browser apply + inject
src/client/TokenCritWidget.tsx
src/client/TokenCritWidget.module.css
lib/index.js                  # Host build artifact (static)
lib/client.js                 # Browser build artifact (ModuleLoader CJS bundle)
```

## Build

The root `scripts/build.mjs` builds with esbuild; this package's
"Token-crit client bundle" section produces `lib/client.js`:

```bash
pnpm install
pnpm build   # equivalent to `node scripts/build.mjs` from the repo root
```

## Mounting

This is a pure client-side surface plugin: once it (together with the
dependencies declared in its `dsh.client`) is added to the deployed web plugin
table / host `cordis.yml`, the browser loads `lib/client.js` through
`exports["./client"]` and renders the widget in `shell.overlay`.

## Usage

No configuration is needed after mounting — open any session to see the widget:

1. **Watch usage** — open a session; the transparent widget shows the session's
   cumulative token usage (input / cached read / cached write / output) in real
   time, with crit animations and `+N` damage numbers as usage grows.
2. **Reshape it** — drag the header to move, drag a corner to resize, click the
   collapse button to shrink it to a compact pill.
3. **Open settings** — click the ⚙ on the widget to adjust language (zh/en),
   number format / font size, label, combo, particle count and color, crit
   threshold / ratio, sound, edge glow in real time; position and zoom are
   persisted to `localStorage` automatically and survive a page reload.
4. **Hide it** — the settings panel can hide the widget; re-enable it later via
   the host's web plugin table.
