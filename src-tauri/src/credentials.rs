use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    pub api_url: String,
    pub access_token: String,
    pub refresh_token: String,
    pub device_token: String,
}

#[derive(Serialize)]
pub struct CredentialsStatus {
    pub configured: bool,
}

#[derive(Serialize)]
struct LoginRequest<'a> {
    email: &'a str,
    password: &'a str,
}

#[derive(Deserialize)]
struct LoginResponse {
    access_token: String,
    refresh_token: String,
}

#[derive(Serialize)]
struct DeviceRegisterRequest {
    name: String,
    os: String,
    os_version: String,
    arch: String,
    hostname: String,
    shell: String,
    sf_version: String,
}

#[derive(Deserialize)]
struct DeviceRegisterResponse {
    device_token: String,
}

pub fn daemon_config_path() -> PathBuf {
    shellforge_dir().join("daemon.json")
}

fn shellforge_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".shellforge")
}

pub fn check_credentials() -> CredentialsStatus {
    let configured = load_config(&daemon_config_path()).is_some();
    CredentialsStatus { configured }
}

pub fn load_config(path: &PathBuf) -> Option<DaemonConfig> {
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

pub async fn save_credentials(
    api_url: String,
    email: String,
    password: String,
) -> Result<(), String> {
    let api_url = api_url.trim().trim_end_matches('/').to_string();
    if api_url.is_empty() {
        return Err("Invalid credentials".to_string());
    }

    let client = reqwest::Client::new();
    let login_response = client
        .post(format!("{api_url}/v1/auth/login"))
        .json(&LoginRequest {
            email: &email,
            password: &password,
        })
        .send()
        .await
        .map_err(|_| "Invalid credentials".to_string())?;

    if !login_response.status().is_success() {
        return Err("Invalid credentials".to_string());
    }

    let login: LoginResponse = login_response
        .json()
        .await
        .map_err(|_| "Invalid credentials".to_string())?;

    let hostname = read_hostname();
    let device_response = client
        .post(format!("{api_url}/v1/devices"))
        .bearer_auth(&login.access_token)
        .json(&DeviceRegisterRequest {
            name: hostname.clone(),
            os: current_os_name().to_string(),
            os_version: String::new(),
            arch: std::env::consts::ARCH.to_string(),
            hostname,
            shell: default_shell(),
            sf_version: env!("CARGO_PKG_VERSION").to_string(),
        })
        .send()
        .await
        .map_err(|_| "Could not register device".to_string())?;

    if !device_response.status().is_success() {
        return Err("Could not register device".to_string());
    }

    let device: DeviceRegisterResponse = device_response
        .json()
        .await
        .map_err(|_| "Could not register device".to_string())?;

    let config = DaemonConfig {
        api_url,
        access_token: login.access_token,
        refresh_token: login.refresh_token,
        device_token: device.device_token,
    };

    save_config(&daemon_config_path(), &config)?;
    Ok(())
}

fn read_hostname() -> String {
    std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "shellforge".to_string())
}

fn current_os_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}
