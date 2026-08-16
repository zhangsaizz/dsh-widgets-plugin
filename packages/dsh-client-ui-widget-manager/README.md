# @dsh-plugins/client-ui-widget-manager

English | [中文](README.zh.md)

A web settings page plugin: adds a "Widgets" page to the web settings that
lists this project's widgets and lets you **Add (enable)** or **Close
(disable)** each one at runtime.

## Preview

![Widget manager settings page: widget list with Add / Disable / Configure](../../docs/previews/widget-manager-settings.png)

## Features

- **Widget list**: the page live-projects the `shell.overlay` registration
  ledger and, combined with a built-in catalog, shows each widget's state —
  Enabled / Disabled / Not installed (with package name and description).
- **Add (enable)**: removes the hide on a widget; it reappears on the page
  immediately.
- **Close (disable)**: registers a shadow entry with the same list `id` at a
  lower priority (-1) in `shell.overlay` so the shadow wins the cell
  (ui-slots shadowing) and the widget stops rendering — the plugin is NOT
  unmounted and its code is untouched; disabling is fully reversible.
- **Configure dialog**: widgets that carry configuration (e.g. the balance
  dashboard's provider bindings) show a **Configure** button on their row;
  clicking it opens a separate dialog. The config content is contributed by
  the widget's own package into the manager-declared `widgets.config` child
  slot (keyed by the widget id) — no settings-menu page involved. The button
  is hidden while the widget is disabled.
- **Persistent state**: the disabled set is kept in browser `localStorage`
  and survives a reload; if a widget mounts after this manager, the overlay
  subscription shadows it the moment its entry appears.
- **Live ledger**: any overlay entry outside the catalog is listed generically
  too, so the page always mirrors reality.

## Structure

```
src/index.ts                  # Host empty apply (pure UI plugin)
src/client/index.ts           # Browser apply + inject (registers settings.section)
src/client/controller.ts      # Runtime toggling: shadow registration / ledger projection / localStorage
src/client/widgets.ts         # Static catalog of the project widgets
src/client/locales.ts         # Dictionary namespace `widgets` (zh/en)
src/client/WidgetManagerSettings.tsx
src/client/WidgetManagerSettings.module.css
lib/index.js                  # Host build artifact (static)
lib/client.js                 # Browser build artifact (ModuleLoader CJS bundle)
```

## Build

The root `scripts/build.mjs` builds with esbuild; this package's
"Widget-manager" section produces `lib/index.js` (host stub) and
`lib/client.js` (ModuleLoader CJS + inlined CSS):

```bash
pnpm install
pnpm build   # equivalent to `node scripts/build.mjs` from the repo root
```

## Mounting

A pure client-side surface plugin: once it (together with the dependencies
declared in its `dsh.client`) is added to the deployed web plugin table / host
`cordis.yml`, the browser loads `lib/client.js` through
`exports["./client"]` and the "Widgets" page appears in the web settings.
Installing `@dsh-plugins/dsh-widgets-plugin` (once published:
`dsh plugin --profile <name> add @dsh-plugins/dsh-widgets-plugin`) mounts this
page together with every widget; for local development you can `link:` the
bundle directory from this repo (see "安装" in the root README).

## Usage

1. Open Web settings → "Widgets".
2. Each widget shows its current state: **Enabled** (on the page),
   **Disabled** (hidden by this page), **Not installed** (package not
   mounted — no action available); configurable widgets are marked
   "Configurable" and show a **Configure** button.
3. Click **Configure** to open the widget's own config dialog (e.g. the
   balance dashboard's provider bindings); click **Disable** to remove a
   widget from the page (its Configure button disappears), click **Add** to
   mount it back.
4. State is kept in this browser and survives a reload; the manager's shadow
   entries are cascaded away when its plugin fiber unloads.
