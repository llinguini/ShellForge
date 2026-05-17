use serde_json::Value;
use std::path::Path;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::net::{UnixListener, UnixStream};

const SOCKET_PATH: &str = "/tmp/shellforge.sock";

pub fn spawn_socket_listener(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = listen(app).await {
            eprintln!("ShellForge socket listener stopped: {error}");
        }
    });
}

async fn listen(app: AppHandle) -> std::io::Result<()> {
    if Path::new(SOCKET_PATH).exists() {
        std::fs::remove_file(SOCKET_PATH)?;
    }

    let listener = UnixListener::bind(SOCKET_PATH)?;
    println!("ShellForge listening on {SOCKET_PATH}");

    loop {
        let (stream, _) = listener.accept().await?;
        let app = app.clone();

        tauri::async_runtime::spawn(async move {
            if let Err(error) = handle_stream(stream, app).await {
                eprintln!("failed to read ShellForge socket message: {error}");
            }
        });
    }
}

async fn handle_stream(mut stream: UnixStream, app: AppHandle) -> std::io::Result<()> {
    let mut buffer = String::new();
    stream.read_to_string(&mut buffer).await?;

    for message in buffer.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let msg: Value = serde_json::from_str(message).unwrap_or_default();
        let _ = app.emit("socket_message", msg);
    }

    Ok(())
}
