# @dsh-plugins/client-ui-balance

English | [中文](README.zh.md)

Floating balance dashboard, browser half. One `register` call contributes the `BalanceWidget` into the frame-wide `shell.overlay` list (id `balance`), seats the view-settings store, and injects the `BalanceController` as a bound `useBalance` hook plus a manual `refresh` verb.

The widget is a `position: fixed` panel that can be dragged and snap-docked to any viewport corner (within a 56px threshold), zoomed between 75% and 150% through the header controls, and collapsed to a compact pill. Zoom scale, dock corner, free position, and collapsed state persist to `localStorage` under `dsh.balance.view`.

A single `BalanceController` (the object layer) follows the current session via `ctx.sessions`, re-reads the current model selection, and queries `ctx.remote.balance`. It refreshes on the fixed 30-second interval, immediately on session switch, and — when `ctx.modelDirectories` is present — promptly on model switch. The Host-computed `trend`/​`delta` drive the up/down arrow and color, and the amount tweens between observations (the "dynamic rolling" effect).

The widget defaults to the **current account** (the session's provider) and can switch to a **multi-account view** via the header toggle (`▦`), listing every configured provider's balance from the `balance/list` Remote — each row with its vendor label, amount, currency, and trend. The view mode persists with the other settings.

The plugin also registers a **Balance providers** page in Web Settings (`settings.section` id `balance`): it lists the user-managed bindings from the `balance` settings section and lets you add (provider route + vendor type + credential reference + optional base URL) or remove them. The Host applies the section live, so a binding added here takes effect on the next refresh without a restart.

## Model Experience

None, as the dashboard renders Host-provided balance data only; it appends nothing to the session log, the model context, or telemetry.

#### KV Cache effect

None; the widget only writes its own view-settings key in `localStorage`.

## Known Limitations and Deferred Work

- **Fixed refresh interval** — the 30-second refresh is a constant, not a settings or composition field.
- **Fixed endpoints** — the vendor base URLs come from `balance-vendors`; the dashboard cannot override them.
- **Viewport-relative docking** — snap detection uses `window` bounds, which matches the full-frame overlay but not a future docked/inset app frame.
