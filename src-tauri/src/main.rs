mod clipboard;
mod credentials;
mod daemon;
mod history;
mod profile;
mod pty;
mod settings;
mod socket;

use clipboard::ClipboardSource;
use credentials::{check_credentials as credentials_configured, save_credentials as persist_credentials};
use credentials::CredentialsStatus;
use daemon::DaemonProcess;
use history::HistoryStore;
use profile::{load_initial_profile as fetch_initial_profile, InitialProfile};
use pty::{PtyCreated, PtyManager};
use settings::{AccountInfo, SyncSettings};
use tauri::{Manager, State};

#[tauri::command]
fn create_pty(
    manager: State<'_, PtyManager>,
    app: tauri::AppHandle,
) -> Result<PtyCreated, String> {
    manager.create(app)
}

#[tauri::command]
fn write_to_pty(manager: State<'_, PtyManager>, id: String, data: String) -> Result<(), String> {
    manager.write(&id, &data)
}

#[tauri::command]
fn resize_pty(
    manager: State<'_, PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(&id, cols, rows)
}

#[tauri::command]
fn close_pty(manager: State<'_, PtyManager>, id: String) -> Result<(), String> {
    manager.close(&id)
}

#[tauri::command]
fn read_clipboard_text(source: String) -> Result<String, String> {
    clipboard::read_text(ClipboardSource::from_str(&source)?)
}

#[tauri::command]
fn write_clipboard_text(source: String, text: String) -> Result<(), String> {
    clipboard::write_text(ClipboardSource::from_str(&source)?, &text)
}

#[tauri::command]
fn add_history_entry(
    history: State<'_, HistoryStore>,
    command: String,
    cwd: String,
    exit_code: i64,
) -> Result<(), String> {
    history.add_entry(&command, &cwd, exit_code)
}

#[tauri::command]
fn get_history_suggestion(
    history: State<'_, HistoryStore>,
    prefix: String,
    cwd: String,
) -> Result<Option<String>, String> {
    history.suggestion(&prefix, &cwd)
}

#[tauri::command]
fn get_history_suggestions_filtered(
    history: State<'_, HistoryStore>,
    prefix: String,
    cwd: String,
    limit: i64,
) -> Result<Vec<String>, String> {
    history.filtered_suggestions(&prefix, &cwd, limit)
}

#[tauri::command]
fn check_credentials() -> CredentialsStatus {
    credentials_configured()
}

#[tauri::command]
async fn save_credentials(
    api_url: String,
    email: String,
    password: String,
) -> Result<(), String> {
    persist_credentials(api_url, email, password).await
}

#[tauri::command]
async fn load_initial_profile() -> InitialProfile {
    fetch_initial_profile().await
}

#[tauri::command]
async fn get_account_info() -> AccountInfo {
    settings::get_account_info().await
}

#[tauri::command]
fn logout() -> Result<(), String> {
    settings::logout()
}

#[tauri::command]
async fn get_sync_settings() -> SyncSettings {
    settings::get_sync_settings().await
}

#[tauri::command]
async fn update_sync_setting(key: String, value: bool) -> Result<(), String> {
    settings::update_sync_setting(key, value).await
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(PtyManager::new())
        .manage(HistoryStore::new().expect("failed to initialize ShellForge history"))
        .manage(DaemonProcess::new())
        .setup(|app| {
            let handle = app.handle().clone();
            socket::spawn_socket_listener(handle);

            if let Ok(resource_path) = app.path().resolve(
                "binaries/shellforge-daemon",
                tauri::path::BaseDirectory::Resource,
            ) {
                if let Ok(child) = std::process::Command::new(resource_path).spawn() {
                    app.state::<DaemonProcess>().set_child(child);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_pty,
            write_to_pty,
            resize_pty,
            close_pty,
            read_clipboard_text,
            write_clipboard_text,
            add_history_entry,
            get_history_suggestion,
            get_history_suggestions_filtered,
            check_credentials,
            save_credentials,
            load_initial_profile,
            pty::rebuild_bash_init,
            get_account_info,
            logout,
            get_sync_settings,
            update_sync_setting
        ])
        .run(tauri::generate_context!())
        .expect("failed to run ShellForge");
}
