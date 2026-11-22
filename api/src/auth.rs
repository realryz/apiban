use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};
use sha2::{Digest, Sha256};

use crate::{
    AppState,
    api::{clean_text, now},
    config::Role,
    error::ApiError,
};

const ACTOR_HEADER: &str = "x-apiban-actor";

pub fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

pub fn generate_token() -> String {
    let bytes: [u8; 32] = rand::random();
    format!("apiban_{}", hex::encode(bytes))
}

pub struct Principal {
    pub name: String,
    pub role: Role,
    pub actor: String,
}

impl Principal {
    pub fn require(&self, roles: &[Role]) -> Result<(), ApiError> {
        if roles.contains(&self.role) { Ok(()) } else { Err(ApiError::Forbidden) }
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
        let hash = hash_token(token);

        if let Some(key) = app.keys.get(&hash) {
            let actor = match key.role {
                Role::Server | Role::Panel => parts
                    .headers
                    .get(ACTOR_HEADER)
                    .map(|value| clean_text(&String::from_utf8_lossy(value.as_bytes()), 64))
                    .filter(|actor| !actor.is_empty()),
                Role::Bot | Role::User => None,
            };
            return Ok(Self {
                name: key.name.clone(),
                role: key.role,
                actor: actor.unwrap_or_else(|| key.name.clone()),
            });
        }

        let user_key = app.db().use_user_key(&hash, now())?;
        match user_key {
            Some(key) => Ok(Self {
                actor: format!("{} ({})", key.discord_name, key.name),
                name: key.name,
                role: Role::User,
            }),
            None => {
                tracing::warn!("rejected a request with an unknown api key");
                Err(ApiError::Unauthorized)
            }
        }
    }
}
