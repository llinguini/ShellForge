use futures_util::StreamExt;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::net::UnixStream;
use tokio::sync::RwLock;
use tokio_tungstenite::tungstenite::http::Request;
use tokio_tungstenite::tungstenite::Message;

const SOCKET_PATH: &str = "/tmp/shellforge.sock";
const HISTORY_BATCH_SIZE: usize = 500;
const HISTORY_SYNC_INTERVAL: Duration = Duration::from_secs(30);
const WS_RECONNECT_BACKOFF: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DaemonConfig {
    api_url: String,
    access_token: String,
    refresh_token: String,
    device_token: String,
}

#[derive(Serialize)]
struct RefreshRequest<'a> {
    refresh_token: &'a str,
}

#[derive(Deserialize)]
struct RefreshResponse {
    access_token: String,
    refresh_token: String,
}

#[derive(Clone, Deserialize, Default)]
#[allow(dead_code)] // flags reserved for future sync tasks; sync_history is read today
struct SyncSettings {
    sync_history: bool,
    sync_theme: bool,
    sync_aliases: bool,
    sync_commands: bool,
    sync_tabs: bool,
}

#[derive(Deserialize)]
struct ProfileResponse {
    sync_settings: SyncSettings,
}

#[derive(Serialize)]
struct HistoryEntryPayload {
    command: String,
    cwd: String,
    exit_code: Option<i64>,
    duration_ms: i64,
    executed_at: String,
}

#[derive(Serialize)]
struct HistorySyncBody {
    entries: Vec<HistoryEntryPayload>,
}

struct UnsyncedEntry {
    id: i64,
    command: String,
    cwd: String,
    exit_code: Option<i64>,
    ran_at: String,
}

#[tokio::main]
async fn main() {
    let config_path = daemon_config_path();
    let config = match load_config(&config_path) {
        Some(config) => config,
        None => {
            eprintln!("ShellForge daemon: no credentials, running in offline mode");
            wait_for_shutdown().await;
            return;
        }
    };

    let config = Arc::new(RwLock::new(config));
    let mut offline = false;

    if let Err(error) = refresh_tokens(&config_path, &config).await {
        eprintln!(
            "ShellForge daemon: token refresh failed ({error}), running in offline mode"
        );
        offline = true;
    }

    if offline {
        wait_for_shutdown().await;
        return;
    }

    let (api_url, access_token, device_token) = {
        let current = config.read().await;
        (
            current.api_url.clone(),
            current.access_token.clone(),
            current.device_token.clone(),
        )
    };

    let sync_settings = Arc::new(RwLock::new(SyncSettings::default()));
    match fetch_sync_settings(&api_url, &access_token).await {
        Ok(settings) => {
            *sync_settings.write().await = settings;
        }
        Err(error) => {
            eprintln!(
                "ShellForge daemon: could not load sync settings ({error}), using defaults"
            );
        }
    }

    let sync_settings_ws = Arc::clone(&sync_settings);
    let sync_settings_history = Arc::clone(&sync_settings);

    tokio::select! {
        _ = wait_for_shutdown() => {}
        _ = run_websocket_loop(api_url.clone(), device_token.clone(), sync_settings_ws) => {}
        _ = run_history_sync_loop(api_url, device_token, sync_settings_history) => {}
    }
}

async fn wait_for_shutdown() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};

        let mut terminate =
            signal(SignalKind::terminate()).expect("failed to install SIGTERM handler");
        let mut interrupt =
            signal(SignalKind::interrupt()).expect("failed to install SIGINT handler");

        tokio::select! {
            _ = terminate.recv() => {}
            _ = interrupt.recv() => {}
            _ = tokio::signal::ctrl_c() => {}
        }
    }

    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

fn shellforge_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".shellforge")
}

fn daemon_config_path() -> PathBuf {
    shellforge_dir().join("daemon.json")
}

fn history_db_path() -> PathBuf {
    shellforge_dir().join("history.db")
}

fn load_config(path: &PathBuf) -> Option<DaemonConfig> {
    let raw = std::fs::read_to_string(path).ok()?;
    let config: DaemonConfig = serde_json::from_str(&raw).ok()?;
    if config.api_url.trim().is_empty()
        || config.access_token.trim().is_empty()
        || config.refresh_token.trim().is_empty()
        || config.device_token.trim().is_empty()
    {
        return None;
    }
    Some(config)
}

fn save_config(path: &PathBuf, config: &DaemonConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create config directory: {error}"))?;
    }

    let payload = serde_json::to_string_pretty(config)
        .map_err(|error| format!("failed to serialize daemon config: {error}"))?;
    std::fs::write(path, payload)
        .map_err(|error| format!("failed to write daemon config: {error}"))?;
    Ok(())
}

async fn refresh_tokens(
    path: &PathBuf,
    config: &Arc<RwLock<DaemonConfig>>,
) -> Result<(), String> {
    let (api_url, refresh_token) = {
        let current = config.read().await;
        (current.api_url.clone(), current.refresh_token.clone())
    };

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/v1/auth/refresh", api_url.trim_end_matches('/')))
        .json(&RefreshRequest {
            refresh_token: &refresh_token,
        })
        .send()
        .await
        .map_err(|error| format!("refresh request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("refresh returned status {}", response.status()));
    }

    let body: RefreshResponse = response
        .json()
        .await
        .map_err(|error| format!("invalid refresh response: {error}"))?;

    {
        let mut current = config.write().await;
        current.access_token = body.access_token;
        current.refresh_token = body.refresh_token;
        save_config(path, &current)?;
    }

    Ok(())
}

async fn fetch_sync_settings(api_url: &str, access_token: &str) -> Result<SyncSettings, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/v1/profile", api_url.trim_end_matches('/')))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| format!("profile request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("profile returned status {}", response.status()));
    }

    let body: ProfileResponse = response
        .json()
        .await
        .map_err(|error| format!("invalid profile response: {error}"))?;

    Ok(body.sync_settings)
}

fn api_to_ws_url(api_url: &str) -> String {
    let ws_base = if api_url.starts_with("https://") {
        api_url.replacen("https://", "wss://", 1)
    } else if api_url.starts_with("http://") {
        api_url.replacen("http://", "ws://", 1)
    } else {
        api_url.to_string()
    };

    format!("{}/v1/ws", ws_base.trim_end_matches('/'))
}

async fn run_websocket_loop(
    api_url: String,
    device_token: String,
    sync_settings: Arc<RwLock<SyncSettings>>,
) {
    loop {
        match connect_and_forward_ws(&api_url, &device_token, Arc::clone(&sync_settings)).await {
            Ok(()) => {}
            Err(error) => {
                eprintln!("ShellForge daemon: websocket disconnected ({error})");
            }
        }

        tokio::time::sleep(WS_RECONNECT_BACKOFF).await;
    }
}

async fn connect_and_forward_ws(
    api_url: &str,
    device_token: &str,
    sync_settings: Arc<RwLock<SyncSettings>>,
) -> Result<(), String> {
    let ws_url = api_to_ws_url(api_url);

    let request = Request::builder()
        .uri(&ws_url)
        .header("X-Device-Token", device_token)
        .header(
            "Host",
            ws_url
                .trim_start_matches("wss://")
                .trim_start_matches("ws://")
                .split('/')
                .next()
                .unwrap_or("localhost"),
        )
        .header("Upgrade", "websocket")
        .header("Connection", "Upgrade")
        .header(
            "Sec-WebSocket-Key",
            tokio_tungstenite::tungstenite::handshake::client::generate_key(),
        )
        .header("Sec-WebSocket-Version", "13")
        .body(())
        .map_err(|error| format!("invalid websocket request: {error}"))?;

    let (mut socket, response) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|error| format!("websocket connect failed: {error}"))?;

    println!(
        "ShellForge daemon: websocket connected (status {})",
        response.status()
    );

    while let Some(message) = socket.next().await {
        let message = message.map_err(|error| format!("websocket read failed: {error}"))?;
        if let Message::Text(text) = message {
            apply_sync_settings_from_message(&text, &sync_settings).await;
            forward_to_unix_socket(text.as_bytes()).await;
        }
    }

    Ok(())
}

async fn apply_sync_settings_from_message(
    text: &str,
    sync_settings: &Arc<RwLock<SyncSettings>>,
) {
    let Ok(msg) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };

    if msg.get("type").and_then(|value| value.as_str()) != Some("sync.settings_updated") {
        return;
    }

    let Some(payload) = msg.get("payload") else {
        return;
    };

    if let Ok(new_settings) = serde_json::from_value::<SyncSettings>(payload.clone()) {
        *sync_settings.write().await = new_settings;
        println!("ShellForge daemon: sync settings updated");
    }
}

async fn forward_to_unix_socket(payload: &[u8]) {
    let Ok(mut stream) = UnixStream::connect(SOCKET_PATH).await else {
        return;
    };

    let _ = stream.write_all(payload).await;
}

async fn run_history_sync_loop(
    api_url: String,
    device_token: String,
    sync_settings: Arc<RwLock<SyncSettings>>,
) {
    let mut interval = tokio::time::interval(HISTORY_SYNC_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        interval.tick().await;
        if !sync_settings.read().await.sync_history {
            continue;
        }

        if let Err(error) = sync_history_batch(&api_url, &device_token).await {
            eprintln!("ShellForge daemon: history sync skipped ({error})");
        }
    }
}

async fn sync_history_batch(api_url: &str, device_token: &str) -> Result<(), String> {
    if api_url.trim().is_empty() {
        return Ok(());
    }

    let entries = read_unsynced_entries()?;
    if entries.is_empty() {
        return Ok(());
    }

    let payload_entries: Vec<HistoryEntryPayload> = entries
        .iter()
        .map(|entry| HistoryEntryPayload {
            command: entry.command.clone(),
            cwd: entry.cwd.clone(),
            exit_code: entry.exit_code,
            duration_ms: 0,
            executed_at: format_executed_at(&entry.ran_at),
        })
        .collect();
    let ids: Vec<i64> = entries.iter().map(|entry| entry.id).collect();

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/v1/history", api_url.trim_end_matches('/')))
        .header("X-Device-Token", device_token)
        .json(&HistorySyncBody {
            entries: payload_entries,
        })
        .send()
        .await
        .map_err(|error| format!("history request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("history sync returned status {}", response.status()));
    }

    mark_entries_synced(&ids)?;
    Ok(())
}

fn format_executed_at(ran_at: &str) -> String {
    if let Ok(secs) = ran_at.parse::<i64>() {
        return chrono::DateTime::from_timestamp(secs, 0)
            .map(|value| value.to_rfc3339())
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    }

    ran_at.to_string()
}

fn read_unsynced_entries() -> Result<Vec<UnsyncedEntry>, String> {
    let path = history_db_path();
    if !path.exists() {
        return Ok(Vec::new());
    }

    let connection = Connection::open(path)
        .map_err(|error| format!("failed to open history database: {error}"))?;

    let mut statement = connection
        .prepare(
            r#"
            SELECT id, command, cwd, exit_code, ran_at
            FROM history
            WHERE synced = 0
            ORDER BY id ASC
            LIMIT ?1
            "#,
        )
        .map_err(|error| format!("failed to prepare history query: {error}"))?;

    let rows = statement
        .query_map(params![HISTORY_BATCH_SIZE as i64], |row| {
            let ran_at = match row.get::<_, i64>(4) {
                Ok(secs) => secs.to_string(),
                Err(_) => row.get::<_, String>(4)?,
            };

            Ok(UnsyncedEntry {
                id: row.get(0)?,
                command: row.get(1)?,
                cwd: row.get(2)?,
                exit_code: row.get(3)?,
                ran_at,
            })
        })
        .map_err(|error| format!("failed to query unsynced history: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to collect unsynced history: {error}"))
}

fn mark_entries_synced(ids: &[i64]) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }

    let connection = Connection::open(history_db_path())
        .map_err(|error| format!("failed to open history database: {error}"))?;

    for id in ids {
        connection
            .execute("UPDATE history SET synced = 1 WHERE id = ?1", params![id])
            .map_err(|error| format!("failed to mark history entry synced: {error}"))?;
    }

    Ok(())
}
