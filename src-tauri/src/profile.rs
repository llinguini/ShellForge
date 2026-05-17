use crate::credentials::{daemon_config_path, load_config};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProfileAlias {
    pub id: String,
    pub name: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProfileCommand {
    pub id: String,
    pub name: String,
    pub script: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct InitialProfile {
    pub aliases: Vec<ProfileAlias>,
    pub commands: Vec<ProfileCommand>,
    pub active_theme: Option<Value>,
}

#[derive(Deserialize)]
struct ApiProfileResponse {
    #[serde(default)]
    aliases: Vec<ProfileAlias>,
    #[serde(default)]
    commands: Vec<ProfileCommand>,
    #[serde(default)]
    active_theme: Option<Value>,
    #[serde(default)]
    theme: Option<Value>,
}

pub async fn load_initial_profile() -> InitialProfile {
    let Some(config) = load_config(&daemon_config_path()) else {
        return InitialProfile::default();
    };

    let client = reqwest::Client::new();
    let response = match client
        .get(format!("{}/v1/profile", config.api_url.trim_end_matches('/')))
        .bearer_auth(&config.access_token)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            eprintln!("ShellForge profile request failed: {error}");
            return InitialProfile::default();
        }
    };

    if !response.status().is_success() {
        eprintln!("ShellForge profile returned status {}", response.status());
        return InitialProfile::default();
    }

    let body: ApiProfileResponse = match response.json().await {
        Ok(body) => body,
        Err(error) => {
            eprintln!("ShellForge invalid profile response: {error}");
            return InitialProfile::default();
        }
    };

    InitialProfile {
        aliases: body.aliases,
        commands: body.commands,
        active_theme: body.active_theme.or(body.theme),
    }
}
