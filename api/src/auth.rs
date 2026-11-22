use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};
use sha2::{Digest, Sha256};

use crate::{AppState, api::clean_text, config::Role, error::ApiError};

/// Lets the FiveM server say which admin performed an action (e.g. `/ban` in game).
/// Ignored for client keys: their actions are always attributed to the key name.
const ACTOR_HEADER: &str = "x-apiban-actor";

pub fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

pub fn generate_token() -> String {
    let bytes: [u8; 32] = rand::random();
    format!("apiban_{}", hex::encode(bytes))
}

/// The authenticated caller of a request.
pub struct Principal {
    pub name: String,
    pub role: Role,
    /// Name written to `banned_by` / `revoked_by`.
    pub actor: String,
}

impl Principal {
    pub fn require(&self, role: Role) -> Result<(), ApiError> {
        if self.role == role { Ok(()) } else { Err(ApiError::Forbidden) }
    }
}

impl FromRequestParts<AppState> for Principal {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, app: &AppState) -> Result<Self, ApiError> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().split_once(' '))
            .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("bearer"))
            .map(|(_, token)| token.trim())
            .filter(|token| !token.is_empty())
            .ok_or(ApiError::Unauthorized)?;

        // Tokens are 256-bit random values, so comparing their hashes through a map
        // lookup leaks nothing useful about any valid token.
        let Some(key) = app.keys.get(&hash_token(token)) else {
            tracing::warn!("rejected a request with an unknown api key");
            return Err(ApiError::Unauthorized);
        };

        let actor = match key.role {
            Role::Server => parts
                .headers
                .get(ACTOR_HEADER)
                .map(|value| clean_text(&String::from_utf8_lossy(value.as_bytes()), 64))
                .filter(|actor| !actor.is_empty())
                .unwrap_or_else(|| key.name.clone()),
            Role::Client => key.name.clone(),
        };

        Ok(Self { name: key.name.clone(), role: key.role, actor })
    }
}
