# @dsh-plugins/dsh-widgets-plugin

[中文](README.zh.md) | English

An installable **bundle** for the DeepSeek Harness widgets collection: one
`cordis.patch.yml` insertion layer that mounts all widget plugins at once —
the balance dashboard (`@dsh-plugins/balance`), the token-crit widget
(`@dsh-plugins/client-ui-token-crit`), the session monitor dashboard
(`@dsh-plugins/client-ui-session-monitor`) and the widgets manager settings
page (`@dsh-plugins/client-ui-widget-manager`).

## Installation (published, recommended)

Once published to npm, install it into the target profile with the official
`dsh plugin` command — it forwards to pnpm inside the profile directory,
installs the dependencies and appends this bundle to `dsh.profile.bundles`:

```sh
dsh plugin --profile <name> add @dsh-plugins/dsh-widgets-plugin
```

Verify and start:

```sh
dsh --profile <name> --dump-config   # should show a "# == @dsh-plugins/dsh-widgets-plugin" layer
dsh --profile <name>
```

The published package ships the prebuilt `lib/` artifacts of every plugin, so
no build authorization is needed on the installing side.

## Installation (local development, link)

Install the bundle directory straight from this repo; pnpm links it as a
`link:` dependency (junction, no copy):

```sh
dsh plugin --profile <name> add <this-repo-path>/bundles/dsh-widgets-plugin
```

The first use initializes the profile (`@deepseek-ai/dsh-base` as its first
bundle). After changing code, run `pnpm build` at the repo root to refresh the
`lib/` artifacts, then restart `dsh web` (host-half changes) or reload the page
(browser-half changes).

> **`github:` installs are not supported**: a git install pulls source and runs
> no build, and the bundle's `workspace:*` dependencies cannot resolve outside a
> workspace. Distribute via npm publish or a `pnpm pack` tarball instead.

## Structure

- `cordis.patch.yml` — one insertion layer: `balance` → `ui-token-crit` →
  `ui-session-monitor` → `ui-widget-manager`, referencing the plugins by package
  name (provided by `dependencies`).
- `package.json` — `dsh.bundle.patch` points at that patch; `files` contains
  only `cordis.patch.yml`.

## Manual mounting

You can also skip the bundle and insert the plugin rows by hand into the
profile's `cordis.patch.yml` (or a `--patch` overlay) — see "安装（手动）" in
the root README and the per-package READMEs.

## License

MIT.
