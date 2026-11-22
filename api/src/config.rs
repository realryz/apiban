use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    #[serde(default = "default_bind")]
    pub bind: String,
    #[serde(default = "default_database")]
    pub database: PathBuf,
    #[serde(default)]
    pub keys: Vec<ApiKey>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApiKey {
    pub name: String,
    pub role: Role,
    /// Hex SHA-256 of the token. The token itself is never stored.
    pub sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// The FiveM server: heartbeat, join checks and in-game bans.
    Server,
    /// A person or device (iPhone shortcut, dashboard): manage bans.
    Client,
}

fn default_bind() -> String {
    "127.0.0.1:8080".into()
}

fn default_database() -> PathBuf {
    "apiban.db".into()
}

impl Config {
    pub fn load(path: &Path) -> Result<Self, String> {
        let text = fs::read_to_string(path)
            .map_err(|e| format!("cannot read config {}: {e}", path.display()))?;
        let mut config: Config =
            toml::from_str(&text).map_err(|e| format!("invalid config {}: {e}", path.display()))?;

        if config.keys.is_empty() {
            return Err("config has no [[keys]], create one with `apiban-api keygen <name>`".into());
        }

        let mut names = HashSet::new();
        let mut hashes = HashSet::new();
        for key in &mut config.keys {
            key.name = key.name.trim().to_string();
            key.sha256 = key.sha256.trim().to_ascii_lowercase();
            if key.name.is_empty() || key.name.chars().count() > 64 {
                return Err("every key needs a name of 1-64 characters".into());
            }
            if key.sha256.len() != 64 || !key.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(format!(
                    "key `{}`: sha256 must be 64 hex characters (use `apiban-api keygen`)",
                    key.name
                ));
            }
            if !names.insert(key.name.clone()) {
                return Err(format!("key name `{}` is used twice", key.name));
            }
            if !hashes.insert(key.sha256.clone()) {
                return Err(format!("key `{}` reuses the hash of another key", key.name));
            }
        }
        Ok(config)
    }
}
