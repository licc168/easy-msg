fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "session_status",
            "add_account",
            "remove_account",
            "open_platform",
            "confirm_login",
            "probe_login",
            "sync_platform",
            "load_thread",
            "send_message",
        ]),
    ))
    .expect("failed to run tauri-build");
}
