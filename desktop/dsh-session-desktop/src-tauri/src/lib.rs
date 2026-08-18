//! Desktop floating session monitor — Tauri 2 shell.
//!
//! The shell owns the window chrome only: a frameless, transparent,
//! always-on-top window that first loads the local `start.html` retry page
//! (`tauri://localhost`), which waits for the local Harness web service
//! (127.0.0.1:3080) and then redirects into the plugin-served widget page
//! (`/_dsh/session-monitor/widget`). That page polls the plugin's JSON routes
//! (`/_dsh/session-monitor/sessions` + `/status`) and drives this shell
//! through the global `__TAURI__` API (drag / pin / hide / open-in-browser).
//!
//! The two custom commands are:
//! - `open_in_browser` — hands a URL to the system default browser, used by
//!   the widget page when the user clicks a session row (the Harness web app
//!   has no URL-level session deep link yet, so it opens the app root). The
//!   widget window itself never navigates away.
//! - `set_tray_unread` — the widget page reports its inbox unread count; the
//!   tray tooltip and a menu status item mirror it, so the user sees "3 items
//!   need attention" without opening the widget window.

use tauri::{Manager, Wry};

/// Tray handles the `set_tray_unread` command updates (the menu status item
/// must outlive the setup closure, so it lives in managed state).
struct TrayState {
    unread_item: tauri::menu::MenuItem<Wry>,
}

/// Open a URL in the system default browser (used by the widget page's
/// "jump to session" action).
#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_in_browser, set_tray_unread])
        .setup(|app| {
            // Tray: left-click (or the menu item) brings the hidden widget
            // back; the first menu item mirrors the inbox unread count (the
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
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
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
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
