fn main() {
    // Declare the app's own commands so tauri-build autogenerates their ACL
    // permissions (`allow-open-in-browser` / `deny-open-in-browser`). Without
    // an app manifest, custom commands are only allowed from local origins —
    // the widget page runs on http://127.0.0.1:3080, so the permission must
    // exist and be referenced from the capability.
    let app_manifest = tauri_build::AppManifest::new().commands(&["open_in_browser"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app_manifest))
        .expect("failed to run tauri-build");
}
