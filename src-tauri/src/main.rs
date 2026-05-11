mod clipboard;
mod history;
mod pty;
mod socket;

use clipboard::ClipboardSource;
use history::HistoryStore;
use pty::{PtyCreated, PtyManager};
use tauri::State;

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

fn main() {
    tauri::Builder::default()
        .manage(PtyManager::new())
        .manage(HistoryStore::new().expect("failed to initialize ShellForge history"))
        .setup(|_app| {
            socket::spawn_socket_listener();
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
            get_history_suggestions_filtered
        ])
        .run(tauri::generate_context!())
        .expect("failed to run ShellForge");
}
