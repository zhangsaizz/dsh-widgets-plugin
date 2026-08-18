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
  while it has N subagents running (all descendants, nested ones included).
  Each row also shows a **后×N** badge — how
  many tasks that session currently has executing in the background (mirrored
  from `session/jobs`; only running/stopping tasks count, settled ones don't).
  When a session is not in a turn itself but still has subagents or background
  jobs executing, its status reads **子代理执行中** (subagents working, violet)
  or **后台执行中** (bg jobs running, cyan) instead of 空闲 — such rows rank
  with the running ones and are never hidden by the time window; the "Busy
  only" filter keeps running AND busy rows, hiding only genuinely idle ones.
  When such a row also carries a
  **本轮完成** mark, the busy label wins the status text (the dot keeps the
  done color); the header and collapsed-pill counts include these busy
  sessions ("N 个忙碌中").
- **Round-completion notifications**: watches `running` true→false edges (one
  edge = one finished round, goal rounds included), and pops a toast
  `「title」已完成第 N 轮` with **跳转** (jump) and **知道了** (dismiss)
  actions — the toast states which round just finished (with the host half
  mounted it is the cumulative round count; otherwise the rounds observed
  while the widget is open).
  Sessions finishing at the same time stack as separate toasts (newest first,
  auto mode caps the stack at 5 and drops the oldest). Two dismissal modes:
  **auto** (auto-dismiss after N seconds) and **confirm** (the toast stays
  until you acknowledge it — a session's newer round replaces its older toast,
  and unconfirmed toasts are never pushed out by new arrivals; a tall stack
  scrolls). Optional chime sound (also only while you are away, like system
  notifications). **Toasts are color-coded by state**: amber
  ✓ for a normal finished round, blue ❓ "Needs your input" when a session stops
  to ask you a question (`question`), orange ⏳ "Approval needed" when it waits
  for your approval (`approval`), violet 📋 "Plan review" when it waits for
  plan review (`plan-review`), violet ⇄ for a finished subagent
  (when subagents are shown), and — with the host half mounted — red ✕ for an
  **error**, grey ■ for an **abort**, orange ⚠ for a **blocked** turn and ⇥ for
  a **token-limit** stop. **Mid-turn pauses notify immediately**: an approval
  request, a question, or plan review happen while the session is still in its
  turn (`running` does not flip), so the widget watches `pendingInteraction`
  appearance and pops the matching toast right away (待审核 / 需要你处理 /
  计划待评审) instead of waiting for the round to end. With **browser
  notification** enabled, a system
  notification is also sent (same per-state titles), permission is requested
  when you turn it on; clicking the notification jumps to the session and
  dismisses the matching in-page toasts (that round is acknowledged — the
  page toast's own buttons would be redundant); same-session notifications
  replace instead of stacking. The system notification is only sent while you
  are away from the page (tab hidden, window minimized, or unfocused) — while
  you are looking at it, the in-page toast is enough, so no OS-level popup
  fires. **Auto-cleanup on return**: when the browser window regains focus or
  the tab becomes visible again — whether or not a system notification was
  delivered — the current session's completion notices reset: any live system
  notification is closed, and its "本轮完成" badge and in-page toast are
  cleared (you are back looking at that session, so the notices are stale;
  other sessions' completions are left alone, they still await your
  attention). Rounds that finish while the page is fully CLOSED cannot notify — a
  browser limitation (no JS runs when the page is gone); the system
  notification only covers "page open but the user switched away". **Cross-tab
  sync**: when the same session is open in several tabs,
  dismissing a toast (知道了), jumping/opening the session, or clearing the
  done marks in one tab mirrors to the others (BroadcastChannel), and setting
  changes propagate across tabs too; when a session is disposed/archived, its
  pending and already-shown reminders are dropped automatically.
- **Jump to session**: clicking any row — or a toast's 跳转 button — switches
  the app to that session immediately (`ctx.sessions.open`).
- **Unread inbox badge**: the header and the collapsed pill show how many
  notifications still need attention (polled every 5 s from `/notifications`;
  the red badge hides at 0). Clicking it jumps to the newest unread session.
  Read state is shared with the desktop widget through the Host, so handling
  items on the desktop clears the web badge too.
- **Done marks**: sessions that finished a round while the widget was open get
  a "本轮完成" badge in the list until visited (opening the session — via the
  app's own sidebar or a widget row — clears the badge and its reminders; or
  use the footer button). The badges persist to localStorage, so a reload
  keeps them (toasts and pending alerts stay in-memory and clear on reload).
- **Configurable**: the widget-manager "Configure" dialog toggles notifications
  on/off, dismissal mode + seconds, sound, **browser notifications** (with
  permission status), whether to notify for the current session (off by
  default — you are already looking at it; rounds waiting for your
  input/confirmation still notify; if you switch to another tab or
  window, or the page is hidden / unfocused, the current session's finished
  round still notifies — the in-page toast waits for you and a system
  notification reaches you on the OS level when enabled (system notifications
  fire only while you are away from the page)), whether to
  show subagent sessions (off by default), busy-only listing, the recent
  **time window** (all / 15 min … 24 h) and done marks; while "Busy only"
  is on the time-window control is visually dimmed with a hint that it applies
  once that switch is off (its value is still pre-configurable); all settings
  and the panel position persist to `localStorage`.

## Desktop widget (notification inbox)

The host half also serves a **standalone widget page**
(`/_dsh/session-monitor/widget`, framework-free self-contained HTML) used by
the desktop shell (`desktop/dsh-session-desktop`, a Tauri window) and usable as
a plain browser tab. Its main view is a **session notification inbox** rather
than a session list:

- **Durable to-dos**: session events (approval / question / plan review /
  error / blocked / token limit / round done / subagent done / aborted /
  interrupted, plus optional title change and new-session) are folded into
  notification records **on the Host** (`src/desktop-notifications.ts`:
  idempotent, capped at 200, acked/resolved records archived after 7 days,
  persisted into the harness settings document). Toasts tell you something
  "happened"; the inbox keeps what you "haven't handled yet" across window
  hides and restarts.
- **Prioritized**: P0 needs your action (approval / question / plan review /
  error / blocked / token limit) → P1 worth a glance (round done / subagent /
  aborted / interrupted) → P2 info feed (off by default). An **unread badge**
  sits in the header and on the tab.
- **Ackable**: 处理 jumps to the session (auto-acking by default) or 忽略
  acks one; 全部已读 clears everything. Acked / resolved records (e.g. an
  approval that was decided) collapse into a "已读 (N)" group. `ackOnJump`
  (auto-read after handle) and `autoAckOnOpen` (auto-read all on open) are
  shared with the web side through the Host store.
- **Blind spot closed (host-detected)**: `question` / `plan-review` never hit
  the session log, but they are always entered through a model tool call — the
  Host watches the `tool/call` → `tool/result` edges of `ask_user_question` and
  `exit_plan_mode` and sees these "waiting for you" items itself (**visible in
  pure-desktop use with no open web tab**). The web client half's relay
  (`dsh.smon.relay` window event → `/_dsh/session-monitor/events`) remains as
  an idempotent backup.
- **Sessions tab**: the original session list is kept unchanged as the
  secondary view (running-first, time window, subagent filtering, …).
- **Desktop shell ergonomics** (the `desktop/dsh-session-desktop` Tauri app):
  the widget boots **to the tray** (the window starts hidden — the tray icon
  is the entry point), a **tray left-click toggles** the window (menu: show /
  unread count / quit), and the tray tooltip mirrors the inbox unread count.
  While the window is hidden the page pauses its heavy polls and keeps only a
  slow `/notifications` poll so the tray badge stays fresh. The window
  position/size are remembered across runs, and launching the exe again just
  brings the existing window back (single instance).
- **Widget page UI**: unread items can be grouped **by session** (footer
  toggle, persisted), both tabs have a **search box** (title / session id /
  kind), the header has a **manual refresh** button, and the footers show a
  live **connection / last-sync** status line. Before the first fetch the
  lists show a loading placeholder (a retrying hint once the banner is up);
  on mouse devices the inbox row actions reveal on hover; toasts animate out.

## Structure

```
src/index.ts                  # Host half: turn/end reason tracking + inbox + routes
src/desktop-snapshot.ts       # Desktop session snapshot folding (/sessions route)
src/desktop-settings.ts       # Shared settings namespace + schema (/settings route)
src/desktop-notifications.ts  # Notification inbox store (/notifications, ack, events routes)
src/widget-page.html          # Standalone widget page (inbox + sessions tab, inlined into the host bundle)
src/client/index.ts           # Browser apply + inject (settings mirror / jump consume / relay)
src/client/SessionMonitorWidget.tsx
src/client/SessionMonitorWidget.module.css
src/client/SessionSettings.tsx
src/client/SessionSettings.module.css
src/client/settings.ts        # Shared settings / position persistence + chime
src/client/locales.ts         # Dictionary namespace `session-monitor` (zh/en)
docs/                         # Inbox redesign doc + interactive prototype
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

Installing `@dsh-plugins/dsh-widgets-plugin` (once published:
`dsh plugin --profile <name> add @dsh-plugins/dsh-widgets-plugin`) mounts this
dashboard together with every widget in one layer; for local development you
can `link:` the bundle directory from this repo (see "安装" in the root
README).

## Usage

No configuration is needed after mounting:

1. **Watch** — the panel lists the live (non-subagent) sessions; running
   sessions sit on top with a pulsing dot, the header and collapsed pill show
   the busy count (running plus sessions with subagents/background jobs
   executing), and each row carries a **后×N** badge with its background-task
   count.
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
   (busy-only, done marks).
