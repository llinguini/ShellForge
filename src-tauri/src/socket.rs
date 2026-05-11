use serde_json::Value;
use std::path::Path;
use tokio::io::AsyncReadExt;
use tokio::net::{UnixListener, UnixStream};

const SOCKET_PATH: &str = "/tmp/shellforge.sock";

pub fn spawn_socket_listener() {
    tauri::async_runtime::spawn(async {
        if let Err(error) = listen().await {
            eprintln!("ShellForge socket listener stopped: {error}");
        }
    });
}

async fn listen() -> std::io::Result<()> {
    if Path::new(SOCKET_PATH).exists() {
        std::fs::remove_file(SOCKET_PATH)?;
    }

    let listener = UnixListener::bind(SOCKET_PATH)?;
    println!("ShellForge listening on {SOCKET_PATH}");

    loop {
        let (stream, _) = listener.accept().await?;

        tauri::async_runtime::spawn(async {
            if let Err(error) = log_stream(stream).await {
                eprintln!("failed to read ShellForge socket message: {error}");
            }
        });
    }
}

async fn log_stream(mut stream: UnixStream) -> std::io::Result<()> {
    let mut buffer = String::new();
    stream.read_to_string(&mut buffer).await?;

    for message in buffer.lines().map(str::trim).filter(|line| !line.is_empty()) {
        match serde_json::from_str::<Value>(message) {
            Ok(value) => println!("ShellForge socket message: {value}"),
            Err(error) => eprintln!("invalid ShellForge socket JSON ({error}): {message}"),
        }
    }

    Ok(())
}
