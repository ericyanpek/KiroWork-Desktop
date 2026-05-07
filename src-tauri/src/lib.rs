mod acp_client;
mod auth_manager;
mod commands;
mod error;
mod file_activity;
mod kiro_discovery;
mod session_store;
mod workspace_scanner;
mod workspace_watcher;

use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new("kiro_cowork_desktop_lib=debug,warn")
    });
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(commands::acp_state())
        .manage(commands::cancel_state())
        .invoke_handler(tauri::generate_handler![
            commands::acp_connect,
            commands::acp_disconnect,
            commands::acp_status,
            commands::session_new,
            commands::session_prompt,
            commands::session_cancel,
            commands::set_model,
            commands::set_mode,
            commands::get_session_title,
            commands::list_persisted_sessions,
            commands::delete_session,
            commands::load_session,
            commands::scan_workspace,
            commands::watch_workspace,
            commands::unwatch_workspace,
            commands::read_file_bytes,
            auth_manager::check_auth,
            auth_manager::trigger_login,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
