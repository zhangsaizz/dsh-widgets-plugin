# @dsh-plugins/client-ui-session-monitor

English | [中文](README.zh.md)

A floating session-monitor dashboard widget (web plugin). It registers a
draggable, collapsible, zoomable panel in `shell.overlay` that lists the live
sessions with their status (running / idle / round-done), proactively notifies
you when a session finishes a round, and lets you jump straight to any listed
session. A small **host half** listens to the session event feed for `turn/end`
reasons and serves them over a same-origin route, so notifications can tell
"finished normally" apart from **errored / aborted / blocked / token-limit**
rounds. Without the host half the widget still works (base notification kinds).

## Preview

![Session monitor preview: live session list, round-done toasts (status-colored), collapsed capsule](../../docs/previews/session-monitor-widget.png)

## Features

- **Live session list**: projects the standard `useSessions` session-list store
  (no Host RPC, no polling — the runtime pushes session summaries and
  `running`-status updates reactively). Running sessions are pinned on top with
  a pulsing green dot; each row shows the session title, its workspace-derived
  display title, current-session badge, pending-interaction state and a
  relative last-update time. A **configurable time window** (default 1 hour)
  keeps only sessions active within the window — running sessions always show,
  and a muted line reports how many older sessions were hidden. **Subagent
  sessions are filtered out by default** (the config panel can re-enable
  listing and notifying them), but a parent row shows a compact **子×N** badge
  while it has N subagents running. Each row also shows a **后×N** badge — how
  many tasks that session currently has executing in the background (mirrored
  from `session/jobs`; only running/stopping tasks count, settled ones don't).
  When a session is not in a turn itself but still has subagents or background
  jobs executing, its status reads **子代理执行中** (subagents working, violet)
  or **后台执行中** (bg jobs running, cyan) instead of 空闲 — such rows rank
  with the running ones and are never hidden by the time window; the "Running
  only" switch stays strictly `running`.
- **Round-completion notifications**: watches `running` true→false edges (one
  edge = one finished round, goal rounds included), and pops a toast
  `「title」已完成一轮` with **跳转** (jump) and **知道了** (dismiss) actions.
  Sessions finishing at the same time stack as separate toasts (newest first,
  auto mode caps the stack at 5 and drops the oldest). Two dismissal modes:
  **auto** (auto-dismiss after N seconds) and **confirm** (the toast stays
  until you acknowledge it — a session's newer round replaces its older toast,
  and unconfirmed toasts are never pushed out by new arrivals; a tall stack
  scrolls). Optional chime sound. **Toasts are color-coded by state**: amber
  ✓ for a normal finished round, blue ✋ "Needs your attention" when a session
  stops waiting for your input/confirmation, violet ⇄ for a finished subagent
  (when subagents are shown), and — with the host half mounted — red ✕ for an
  **error**, grey ■ for an **abort**, orange ⚠ for a **blocked** turn and ⇥ for
  a **token-limit** stop. With **browser notification** enabled, a system
  notification is also sent (same per-state titles), permission is requested
  when you turn it on; clicking the notification jumps to the session and
  dismisses the matching in-page toasts (that round is acknowledged — the
  page toast's own buttons would be redundant); same-session notifications
  replace instead of stacking.
  same-session notifications replace instead of stacking.
- **Jump to session**: clicking any row — or a toast's 跳转 button — switches
  the app to that session immediately (`ctx.sessions.open`).
- **Done marks**: sessions that finished a round while the widget was open get
  a "本轮完成" badge in the list until visited (opened, or cleared via the
  footer button).
- **Configurable**: the widget-manager "Configure" dialog toggles notifications
  on/off, dismissal mode + seconds, sound, **browser notifications** (with
  permission status), whether to notify for the current session, whether to
  show subagent sessions (off by default), running-only listing, the recent
  **time window** (all / 15 min … 24 h) and done marks; while "Running only"
  is on the time-window control is visually dimmed with a hint that it applies
  once that switch is off (its value is still pre-configurable); all settings
  and the panel position persist to `localStorage`.

## Structure

```
src/index.ts                  # Host half: turn/end reason tracking + status route
src/client/index.ts           # Browser apply + inject
src/client/SessionMonitorWidget.tsx
src/client/SessionMonitorWidget.module.css
src/client/SessionSettings.tsx
src/client/SessionSettings.module.css
src/client/settings.ts        # Shared settings / position persistence + chime
src/client/locales.ts         # Dictionary namespace `session-monitor` (zh/en)
lib/index.js                  # Host build artifact (ESM)
lib/client.js                 # Browser build artifact (ModuleLoader CJS bundle)
```

## Build

The root `scripts/build.mjs` builds with esbuild; this package's
"Session-monitor client bundle" section produces `lib/client.js`, and the
host-half entry (`src/index.ts`) is built into `lib/index.js`:

```bash
pnpm install
pnpm build   # equivalent to `node scripts/build.mjs` from the repo root
```

## Mounting

One plugin row mounts both halves: the host half (loaded via the package root,
listens to the session event feed and serves `/_dsh/session-monitor/status` on
web profiles) and the browser half (loaded through `exports["./client"]`, which
renders the dashboard in `shell.overlay` and polls the status route every few
seconds). The reason-aware notification kinds need the host half; without it
the browser falls back to its base kinds (done / interaction / subagent) — a
web profile restart is required for the host half to be picked up.

## Usage

No configuration is needed after mounting:

1. **Watch** — the panel lists the live (non-subagent) sessions; running
   sessions sit on top with a pulsing dot, the header shows the running count,
   and each row carries a **后×N** badge with its background-task count.
2. **Jump** — click any row to switch the app to that session.
3. **Shrink / zoom** — click the **—** button in the header to collapse the
   panel into a compact pill (tap the pill to expand it again); drag the
   bottom-right corner handle to zoom the panel from 0.6× to 1.6×. Both the
   position and the zoom persist.
4. **Notifications** — when a session finishes a round, a toast appears
   (auto-dismiss or confirm-required per the settings). Click **跳转** to jump,
   **知道了** to dismiss.
5. **Configure** — open Web settings → Widgets → Session monitor → **Configure**
   to tune notifications (on/off, dismissal, seconds, sound, current-session
   scope), whether to show subagent sessions (off by default), and the list
   (running-only, done marks).
