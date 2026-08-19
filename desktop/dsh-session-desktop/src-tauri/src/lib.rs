//! Desktop floating session monitor — Tauri 2 shell.
//!
//! The shell owns the window chrome only: a frameless, transparent,
//! always-on-top window that first loads the local `start.html` retry page
//! (`tauri://localhost`), which waits for the local Harness web service
//! (127.0.0.1:3080) and then redirects into the plugin-served widget page
//! (`/_dsh/session-monitor/widget`). That page polls the plugin's JSON routes
//! (`/_dsh/session-monitor/sessions` + `/notifications`) and drives this shell
//! through the global `__TAURI__` API (drag / pin / hide / open-in-browser).
//!
//! The window boots HIDDEN (start-to-tray): the tray icon is the primary
//! entry point, and the widget page starts its polls paused, keeping only a
//! slow `/notifications` poll alive so the tray badge stays fresh. Show/hide
//! transitions emit `smon-window-shown` / `smon-window-hidden` events so the
//! page pauses its heavy polls while the window is hidden.
//!
//! The two custom commands are:
//! - `open_in_browser` — hands a loopback URL to the system default browser,
//!   used by the widget page when the user clicks a session row and no open
//!   Harness web tab consumed the jump (the Harness web app has no URL-level
//!   session deep link yet, so it opens the app root). Non-loopback URLs are
//!   refused: the command is callable from any page on 127.0.0.1, so a
//!   compromised or malicious local page must not hand arbitrary URLs to the
//!   default browser. The widget window itself never navigates away.
//! - `set_tray_unread` — the widget page reports its inbox unread count; the
//!   tray tooltip and a menu status item mirror it, so the user sees "3 items
//!   need attention" without opening the widget window.
//!
//! Remote launch: the shell registers a `dsh-smon://` URL protocol under
//! HKCU on every start (no installer needed). The web widget's "desktop
//! monitoring" switch navigates a hidden iframe to `dsh-smon://show`, which
//! makes Windows launch this exe — a fresh process shows the widget window
//! immediately (deep-link first launch), an already-running one is woken by
//! the single-instance plugin which brings the window forward. Registration is
//! idempotent and re-points to the current exe path on every run, so a moved
//! or updated binary self-heals on next launch.

use tauri::{Emitter, Manager, Wry};

/// `dsh-smon://` URL protocol: the web widget launches / shows this app
/// through it. Also checked in argv so the FIRST process of a deep-link
/// launch (single-instance callbacks only fire for later instances) shows the
/// window instead of booting to the tray.
const PROTOCOL_PREFIX: &str = "dsh-smon://";

/// Whether this process was launched by the OS through the `dsh-smon://`
/// protocol (Windows puts the URL on the command line: `app.exe "dsh-smon://…"`).
fn launched_via_protocol() -> bool {
    std::env::args().any(|arg| arg.starts_with(PROTOCOL_PREFIX))
}

/// Register the `dsh-smon://` URL protocol under HKCU (per-user, no admin):
/// `HKCU\Software\Classes\dsh-smon` → URL Protocol + DefaultIcon + the
/// shell open command pointing at the current exe with `%1` for the URL.
/// Written on every start via `reg.exe` (no extra crate), idempotent, and
/// re-points to `std::env::current_exe()` so a moved/updated binary
/// self-heals. Windows only — the desktop shell targets Windows.
#[cfg(windows)]
fn register_protocol() {
    use std::process::Command;

    let exe = match std::env::current_exe() {
        Ok(path) => path.to_string_lossy().to_string(),
        Err(_) => return,
    };
    // The open-command value must quote both the exe and the `%1` placeholder:
    // `"C:\…\app.exe" "%1"` — reg.exe stores it verbatim.
    let open_command = format!("\"{exe}\" \"%1\"");
    let icon_value = format!("\"{exe}\"");
    let runs = [
        // Key, value-name (None = default), value-data.
        ("HKCU\\Software\\Classes\\dsh-smon", Some("/ve"), "URL:DSH Session Monitor"),
        ("HKCU\\Software\\Classes\\dsh-smon", Some("/v"), "URL Protocol"),
        ("HKCU\\Software\\Classes\\dsh-smon\\DefaultIcon", Some("/ve"), icon_value.as_str()),
        ("HKCU\\Software\\Classes\\dsh-smon\\shell\\open\\command", Some("/ve"), open_command.as_str()),
    ];
    for (key, value_switch, data) in runs {
        // `reg add <key> <value-switch> /d <data> /f` — a failure (reg.exe
        // missing, restricted policy) is non-fatal: the shell still works, the
        // web launch just has nothing to open.
        let mut cmd = Command::new("reg");
        cmd.arg("add").arg(key);
        if let Some(sw) = value_switch {
            cmd.arg(sw);
        }
        cmd.arg("/d").arg(data).arg("/f");
        let _ = cmd.status();
    }
}

/// Tray handles the `set_tray_unread` command updates (the menu status item
/// must outlive the setup closure, so it lives in managed state).
struct TrayState {
    unread_item: tauri::menu::MenuItem<Wry>,
}

/// Open a URL in the system default browser (used by the widget page's
/// "jump to session" fallback). Loopback only — see the module doc.
#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
    if !(url.starts_with("http://127.0.0.1") || url.starts_with("http://localhost")) {
        return Err("refusing to open non-loopback URL".to_string());
    }
    opener::open(&url).map_err(|error| error.to_string())
}

/// Mirror the widget inbox unread count into the tray (tooltip + a menu
/// status item). Called by the widget page whenever its unread count changes;
/// 0 clears the badge.
#[tauri::command]
fn set_tray_unread(app: tauri::AppHandle, count: u32) -> Result<(), String> {
    let tray = app
        .tray_by_id("session-monitor-tray")
        .ok_or("tray not found")?;
    let tooltip = if count > 0 {
        format!("会话监控 · {count} 条待处理")
    } else {
        "会话监控".to_string()
    };
    tray.set_tooltip(Some(tooltip)).map_err(|error| error.to_string())?;
    let state = app.state::<TrayState>();
    let label = if count > 0 {
        format!("待处理通知：{count}")
    } else {
        "待处理通知：无".to_string()
    };
    state
        .unread_item
        .set_text(label)
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Bring the widget window up and tell the page to resume its polls.
fn show_widget(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("smon-window-shown", ());
    }
}

/// Hide the widget window and tell the page to pause its polls.
fn hide_widget(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("smon-window-hidden", ());
        let _ = window.hide();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A deep-link first launch (web widget switch → `dsh-smon://show`) must
    // surface the window instead of booting to the tray; later launches are
    // funnelled through the single-instance callback below, which shows it.
    let via_protocol = launched_via_protocol();

    tauri::Builder::default()
        // A second launch (double-click the exe again, or the web widget's
        // `dsh-smon://show` deep link) just brings the existing instance's
        // widget back instead of forking a second tray.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_widget(app);
        }))
        // Persist the window position/size across runs. Only POSITION | SIZE
        // are saved — the window must stay boot-to-tray deterministic and not
        // restore a previous "visible" state.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![open_in_browser, set_tray_unread])
        .setup(move |app| {
            // Register the `dsh-smon://` URL protocol (web-side launch path);
            // idempotent, non-fatal on failure.
            #[cfg(windows)]
            register_protocol();
            // Tray: left-click toggles the widget (mirrors the in-widget ✕);
            // the first menu item mirrors the inbox unread count (the
            // `set_tray_unread` command rewrites its label); the menu also
            // offers a quit action (the close button in the widget only hides
            // the window — no docked taskbar entry).
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

            let unread = MenuItem::with_id(app, "unread", "待处理通知：无", false, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "显示挂件", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&unread, &show, &quit])?;
            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or("no default window icon configured")?;

            app.manage(TrayState { unread_item: unread });

            let _tray = TrayIconBuilder::with_id("session-monitor-tray")
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_widget(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                hide_widget(app);
                            } else {
                                show_widget(app);
                            }
                        }
                    }
                })
                .build(app)?;

            // Deep-link first launch: the web switch asked to show the
            // monitor, so surface the window right away (the page is still on
            // start.html probing for the web service; it redirects to the
            // widget page and starts its polls once visible).
            if via_protocol {
                show_widget(app.handle());
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // The window HIDES instead of closing, so the window-state plugin's
            // close-time save never fires — persist position/size on exit.
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                use tauri_plugin_window_state::AppHandleExt;
                let _ = app_handle.save_window_state(
                    tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::SIZE,
                );
            }
        });
}
