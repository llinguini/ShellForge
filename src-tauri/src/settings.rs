use crate::credentials::{daemon_config_path, load_config, DaemonConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncSettings {
    pub sync_history: bool,
    pub sync_theme: bool,
    pub sync_aliases: bool,
    pub sync_commands: bool,
    pub sync_tabs: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountInfo {
    pub connected: bool,
    pub email: String,
    pub username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub api_url: String,
    pub member_since: String,
}

#[derive(Deserialize)]
struct UserMeResponse {
    user: UserRecord,
}

#[derive(Deserialize)]
struct UserRecord {
    #[serde(default)]
    email: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    created_at: String,
}

#[derive(Deserialize)]
struct ProfilePayload {
    #[serde(default)]
    sync_settings: Option<SyncSettings>,
}

fn api_url_from_config(config: &DaemonConfig) -> String {
    config.api_url.trim_end_matches('/').to_string()
}

async fn fetch_user_me(config: &DaemonConfig) -> Result<UserRecord, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/v1/user/me", api_url_from_config(config)))
        .bearer_auth(&config.access_token)
        .send()
        .await
        .map_err(|error| format!("user request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("user returned status {}", response.status()));
    }

    response
        .json::<UserMeResponse>()
        .await
        .map_err(|error| format!("invalid user response: {error}"))
        .map(|payload| payload.user)
}

async fn fetch_profile(config: &DaemonConfig) -> Result<ProfilePayload, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/v1/profile", api_url_from_config(config)))
        .bearer_auth(&config.access_token)
        .send()
        .await
        .map_err(|error| format!("profile request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("profile returned status {}", response.status()));
    }

    response
        .json::<ProfilePayload>()
        .await
        .map_err(|error| format!("invalid profile response: {error}"))
}

pub async fn get_account_info() -> AccountInfo {
    let Some(config) = load_config(&daemon_config_path()) else {
        return AccountInfo {
            connected: false,
            email: String::new(),
            username: String::new(),
            display_name: None,
            api_url: String::new(),
            member_since: String::new(),
        };
    };

    let api_url = api_url_from_config(&config);
    match fetch_user_me(&config).await {
        Ok(user) => AccountInfo {
            connected: true,
            email: user.email,
            username: user.username,
            display_name: user.display_name,
            api_url,
            member_since: user.created_at,
        },
        Err(_) => AccountInfo {
            connected: false,
            email: String::new(),
            username: String::new(),
            display_name: None,
            api_url,
            member_since: String::new(),
        },
    }
}

pub fn logout() -> Result<(), String> {
    let path = daemon_config_path();
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("failed to remove credentials: {error}"))?;
    }
    Ok(())
}

pub async fn get_sync_settings() -> SyncSettings {
    let Some(config) = load_config(&daemon_config_path()) else {
        return SyncSettings::default();
    };

    match fetch_profile(&config).await {
        Ok(profile) => profile.sync_settings.unwrap_or_default(),
        Err(_) => SyncSettings::default(),
    }
}

pub async fn update_sync_setting(key: String, value: bool) -> Result<(), String> {
    let config = load_config(&daemon_config_path())
        .ok_or_else(|| "ShellForge is not connected".to_string())?;

    let mut body = HashMap::new();
    body.insert(key, value);

    let client = reqwest::Client::new();
    let response = client
        .patch(format!("{}/v1/profile/sync", api_url_from_config(&config)))
        .bearer_auth(&config.access_token)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("sync update request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("sync update returned status {}", response.status()));
    }

    Ok(())
}
