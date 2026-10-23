fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "session_status",
                "open_platform",
                "confirm_login",
                "sync_platform",
                "load_thread",
                "send_message",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}
