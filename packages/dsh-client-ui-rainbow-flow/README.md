# @dsh-plugins/client-ui-rainbow-flow

English | [中文](README.zh.md)

A pure-UI web plugin that wraps the composer input in a flowing rainbow while
the session runs: a carved rainbow ring + soft halo around the input card,
with the rotation speed driven by the live output-token rate, plus an on/off
toggle in the composer tool row.

## Preview

![Rainbow flow preview: ring + halo around the composer input](../../docs/previews/rainbow-flow.png)

## Features

- **Rainbow flow around the input**: while the current session is running, a
  flowing rainbow ring (2px) + blurred halo (6px) glides around the composer
  card. Both layers are mask-carved rings — the interior stays fully
  transparent, so the input is never covered. The effect fades in/out with
  the running state and follows the card's height automatically (it is an
  absolutely-positioned layer inside the card, no height measurement).
- **Speed follows the token rate**: a 500 ms sampler reads the streaming
  `partial` content and estimates the output-token rate (~2 chars per token,
  EMA-smoothed); the rotation period maps 3.2 s (slow) ↔ 0.45 s (fast). Fast
  generation spins the rainbow; thinking / tool gaps glide back to a slow
  drift. Speed changes are eased: a rAF loop exponentially approaches the
  sampled target angular velocity and integrates the ring angle continuously
  (no `animation-duration` swaps), so fast↔slow transitions accelerate and
  decelerate smoothly without the rainbow jumping phase. Only the crisp ring
  rotates — the blurred halo stays static (an ambient tint, painted once, so
  no per-frame blur recompute).
- **On/off toggle**: a small rainbow-dot button at the left end of the
  composer tool row (the `conversation.input.left` seat). The dot greys out
  when off; a status dot in its corner turns green while the session runs.
  The state persists to `localStorage` (`dsh.rnglow.enabled`, default on).
- **Graceful degradation**: browsers without `mask-composite` support fall
  back to a soft multi-color `box-shadow` glow — nothing ever covers the
  input; `prefers-reduced-motion` stops the animation.

## Structure

```
src/index.ts                      # Host empty apply (pure UI plugin)
src/client/index.ts               # browser apply + inject (two input.left entries)
src/client/RainbowFlow.tsx        # toggle + glow components, shared toggle store
src/client/rate.ts                # pure motion model (token rate -> speed, easing)
src/client/RainbowFlow.module.css # carved ring/halo/toggle styles
docs/speed-smoke-test.cjs         # motion-model smoke test (esbuild-bundled source)
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
into `conversation.input.left`, so it appears in every session's composer.
For development, `link:` the bundle from this repo (see the root README
"安装").

## Usage

No configuration needed after mounting:

1. **Watch it flow** — open any session and send a message; while the model
   runs, the rainbow ring + halo wraps the input card. The faster the output
   tokens stream, the faster the rainbow spins.
2. **Toggle** — click the rainbow dot at the left end of the tool row to turn
   the effect off/on (persisted across reloads). The dot's corner status turns
   green while the session runs.
3. **Reduced motion** — with `prefers-reduced-motion`, the ring stops
   spinning (static rainbow) while the effect stays visible.
