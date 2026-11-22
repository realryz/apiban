use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    Json, Router,
    extract::{FromRequest, Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post},
};
use serde::{
    Deserialize, Deserializer, Serialize,
    de::{DeserializeOwned, Error as _},
};
use serde_json::{Value, json};

use crate::{
    AppState,
    auth::{Principal, generate_token, hash_token},
    config::Role,
    db::{BanStatus, NewBan},
    duration,
    error::ApiError,
};

const ONLINE_WINDOW_SECS: i64 = 15;
const AUTH_CODE_TTL_SECS: i64 = 60;
const MAX_PLAYERS: usize = 2048;
const MAX_IDENTIFIERS: usize = 64;
const MAX_REASON: usize = 500;
const MAX_KEY_NAME: usize = 32;
const MAX_KEYS_PER_USER: usize = 10;
const BAN_ROLES: &[Role] = &[Role::Server, Role::Panel, Role::User];

pub fn router(app: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/me", get(me))
        .route("/v1/server/heartbeat", post(heartbeat))
        .route("/v1/server/check", post(check))
        .route("/v1/players", get(players))
        .route("/v1/bans", get(list_bans).post(create_ban))
        .route("/v1/bans/{id}", get(get_ban).delete(revoke_ban))
        .route("/v1/auth/codes", post(create_auth_code))
        .route("/v1/auth/redeem", post(redeem_auth_code))
        .route("/v1/keys", get(list_keys))
        .route("/v1/keys/owners", get(key_owners))
        .route("/v1/keys/{id}", delete(revoke_key))
        .route("/v1/users/{discord_id}/keys", delete(revoke_user_keys))
        .with_state(app)
}

#[derive(FromRequest)]
#[from_request(via(Json), rejection(ApiError))]
struct ApiJson<T>(T);

#[derive(Default)]
pub struct Live {
    last_heartbeat: Option<i64>,
    players: Vec<OnlinePlayer>,
}

impl Live {
    fn online(&self, now: i64) -> bool {
        self.last_heartbeat.is_some_and(|at| now - at <= ONLINE_WINDOW_SECS)
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct OnlinePlayer {
    id: u32,
    #[serde(default)]
    name: String,
    #[serde(default, deserialize_with = "lenient_vec")]
    identifiers: Vec<String>,
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}

async fn me(principal: Principal) -> Json<Value> {
    Json(json!({ "name": principal.name, "role": principal.role }))
}

#[derive(Deserialize)]
struct HeartbeatRequest {
    #[serde(default, deserialize_with = "lenient_vec")]
    players: Vec<OnlinePlayer>,
}

async fn heartbeat(
    State(app): State<AppState>,
    principal: Principal,
    ApiJson(body): ApiJson<HeartbeatRequest>,
) -> Result<Json<Value>, ApiError> {
    principal.require(&[Role::Server])?;
    if body.players.len() > MAX_PLAYERS {
        return Err(ApiError::BadRequest("too many players".into()));
    }

    let players: Vec<OnlinePlayer> = body
        .players
        .into_iter()
        .map(|player| OnlinePlayer {
            id: player.id,
            name: clean_text(&player.name, 64),
            identifiers: clean_identifiers(&player.identifiers),
        })
        .collect();

    let now = now();
    let mut kicks = Vec::new();
    {
        let db = app.db();
        for player in &players {
            if let Some(ban) = db.find_active_ban(&player.identifiers, now)? {
                kicks.push(json!({ "player": player.id, "ban": ban }));
            }
        }
    }
    *app.live_mut() = Live { last_heartbeat: Some(now), players };
    Ok(Json(json!({ "kicks": kicks })))
}

#[derive(Deserialize)]
struct CheckRequest {
    #[serde(default, deserialize_with = "lenient_vec")]
    identifiers: Vec<String>,
}

async fn check(
    State(app): State<AppState>,
    principal: Principal,
    ApiJson(body): ApiJson<CheckRequest>,
) -> Result<Json<Value>, ApiError> {
    principal.require(&[Role::Server])?;
    let ban = app.db().find_active_ban(&clean_identifiers(&body.identifiers), now())?;
    Ok(Json(json!({ "banned": ban.is_some(), "ban": ban })))
}

async fn players(State(app): State<AppState>, principal: Principal) -> Result<Json<Value>, ApiError> {
    principal.require(BAN_ROLES)?;
    let live = app.live();
    let online = live.online(now());
    let players: &[OnlinePlayer] = if online { &live.players } else { &[] };
    Ok(Json(json!({ "online": online, "last_heartbeat": live.last_heartbeat, "players": players })))
}

#[derive(Deserialize)]
struct ListQuery {
    status: Option<String>,
    q: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
}

async fn list_bans(
    State(app): State<AppState>,
    principal: Principal,
    Query(query): Query<ListQuery>,
) -> Result<Json<Value>, ApiError> {
    principal.require(BAN_ROLES)?;
    let status = match query.status.as_deref().map(str::trim).unwrap_or("") {
        "" | "all" => None,
        value => Some(BanStatus::parse(value).ok_or_else(|| {
            ApiError::BadRequest("status must be all, active, expired or revoked".into())
        })?),
    };
    let search = query.q.as_deref().map(str::trim).filter(|q| !q.is_empty());
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let (bans, total) = app.db().list_bans(status, search, limit, query.offset.unwrap_or(0), now())?;
    Ok(Json(json!({ "bans": bans, "total": total })))
}

async fn get_ban(
    State(app): State<AppState>,
    principal: Principal,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    principal.require(BAN_ROLES)?;
    let ban = app.db().get_ban(id, now())?.ok_or_else(|| ban_not_found(id))?;
    Ok(Json(json!(ban)))
}

#[derive(Deserialize)]
struct CreateBanRequest {
    #[serde(default, deserialize_with = "player_id")]
    player: Option<u32>,
    #[serde(default, deserialize_with = "lenient_vec")]
    identifiers: Vec<String>,
    name: Option<String>,
    #[serde(default)]
    reason: String,
    duration: Option<String>,
}

async fn create_ban(
    State(app): State<AppState>,
    principal: Principal,
    ApiJson(request): ApiJson<CreateBanRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    principal.require(BAN_ROLES)?;
    let reason = clean_text(&request.reason, MAX_REASON + 1);
    if reason.is_empty() {
        return Err(ApiError::BadRequest("`reason` is required".into()));
    }
    if reason.chars().count() > MAX_REASON {
        return Err(ApiError::BadRequest(format!("`reason` can be at most {MAX_REASON} characters")));
    }
    let length = duration::parse(request.duration.as_deref()).map_err(ApiError::BadRequest)?;

    let mut identifiers = Vec::with_capacity(request.identifiers.len());
    for raw in &request.identifiers {
        identifiers.push(normalize_identifier(raw).ok_or_else(|| {
            ApiError::BadRequest(format!(
                "invalid identifier `{}`, expected type:value like license:abc123",
                clean_text(raw, 80)
            ))
        })?);
    }
    let mut name = request.name.as_deref().map(|n| clean_text(n, 64)).filter(|n| !n.is_empty());

    let now = now();
    if let Some(id) = request.player {
        let live = app.live();
        if !live.online(now) {
            return Err(ApiError::Unavailable(
                "the FiveM server is offline, so players cannot be banned by id right now".into(),
            ));
        }
        let player = live
            .players
            .iter()
            .find(|player| player.id == id)
            .ok_or_else(|| ApiError::NotFound(format!("no player with id {id} is online")))?;
        identifiers.extend(player.identifiers.iter().cloned());
        name = Some(player.name.clone()).filter(|n| !n.is_empty()).or(name);
    }

    identifiers.sort();
    identifiers.dedup();
    if identifiers.is_empty() {
        return Err(ApiError::BadRequest("send `player` (server id) or `identifiers`".into()));
    }
    if identifiers.len() > MAX_IDENTIFIERS {
        return Err(ApiError::BadRequest(format!("at most {MAX_IDENTIFIERS} identifiers per ban")));
    }

    let ban = app.db().insert_ban(&NewBan {
        player_name: name.as_deref().unwrap_or("unknown"),
        identifiers: &identifiers,
        reason: &reason,
        banned_by: &principal.actor,
        created_at: now,
        expires_at: length.map(|seconds| now + seconds),
    })?;

    let message = match length {
        Some(seconds) => format!("Banned {} (#{}) for {}", ban.player_name, ban.id, duration::humanize(seconds)),
        None => format!("Banned {} (#{}) permanently", ban.player_name, ban.id),
    };
    tracing::info!(by = %principal.actor, reason = %ban.reason, "{message}");
    Ok((StatusCode::CREATED, Json(json!({ "message": message, "ban": ban }))))
}

async fn revoke_ban(
    State(app): State<AppState>,
    principal: Principal,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    principal.require(BAN_ROLES)?;
    let now = now();
    let ban = {
        let db = app.db();
        let ban = db.get_ban(id, now)?.ok_or_else(|| ban_not_found(id))?;
        if ban.status == BanStatus::Revoked {
            return Err(ApiError::Conflict(format!("ban #{id} is already revoked")));
        }
        db.revoke_ban(id, &principal.actor, now)?.ok_or_else(|| ban_not_found(id))?
    };

    let message = format!("Unbanned {} (#{})", ban.player_name, ban.id);
    tracing::info!(by = %principal.actor, "{message}");
    Ok(Json(json!({ "message": message, "ban": ban })))
}

#[derive(Deserialize)]
struct AuthCodeRequest {
    #[serde(default)]
    discord_id: String,
    #[serde(default)]
    discord_name: String,
}

async fn create_auth_code(
    State(app): State<AppState>,
    principal: Principal,
    ApiJson(request): ApiJson<AuthCodeRequest>,
) -> Result<Json<Value>, ApiError> {
    principal.require(&[Role::Bot])?;
    let discord_id = discord_id(&request.discord_id)?;
    let discord_name =
        Some(clean_text(&request.discord_name, 64)).filter(|n| !n.is_empty()).unwrap_or_else(|| discord_id.clone());

    let code = format!("{:06}", rand::random_range(0..1_000_000u32));
    let now = now();
    let expires_at = now + AUTH_CODE_TTL_SECS;
    app.db().save_auth_code(&discord_id, &discord_name, &code, expires_at, now)?;
    tracing::info!("issued an auth code to {discord_name}");
    Ok(Json(json!({ "code": code, "expires_at": expires_at })))
}

#[derive(Deserialize)]
struct RedeemRequest {
    #[serde(default)]
    discord_id: String,
    #[serde(default)]
    code: String,
    #[serde(default)]
    name: String,
}

async fn redeem_auth_code(
    State(app): State<AppState>,
    principal: Principal,
    ApiJson(request): ApiJson<RedeemRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    principal.require(&[Role::Panel])?;
    let discord_id = discord_id(&request.discord_id)?;
    let code = request.code.trim();
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ApiError::BadRequest("the code has exactly 6 digits".into()));
    }
    let name = clean_text(&request.name, MAX_KEY_NAME);
    if name.is_empty() {
        return Err(ApiError::BadRequest("give the key a name".into()));
    }

    let now = now();
    let token = generate_token();
    let key = {
        let db = app.db();
        if db.user_keys(&discord_id)?.len() >= MAX_KEYS_PER_USER {
            return Err(ApiError::Conflict(format!(
                "you already have {MAX_KEYS_PER_USER} API keys, revoke one first"
            )));
        }
        let discord_name = db.redeem_auth_code(&discord_id, code, now)?.ok_or_else(|| {
            ApiError::BadRequest("wrong or expired code, run /auth in Discord again".into())
        })?;
        db.insert_user_key(&name, &discord_id, &discord_name, &hash_token(&token), now)?
    };

    tracing::info!("{} created the api key \"{}\"", key.discord_name, key.name);
    Ok((StatusCode::CREATED, Json(json!({ "token": token, "key": key }))))
}

#[derive(Deserialize)]
struct OwnerQuery {
    #[serde(default)]
    discord_id: String,
}

async fn list_keys(
    State(app): State<AppState>,
    principal: Principal,
    Query(query): Query<OwnerQuery>,
) -> Result<Json<Value>, ApiError> {
    principal.require(&[Role::Panel])?;
    let keys = app.db().user_keys(&discord_id(&query.discord_id)?)?;
    Ok(Json(json!({ "keys": keys })))
}

async fn revoke_key(
    State(app): State<AppState>,
    principal: Principal,
    Path(id): Path<i64>,
    Query(query): Query<OwnerQuery>,
) -> Result<Json<Value>, ApiError> {
    principal.require(&[Role::Panel])?;
    let owner = discord_id(&query.discord_id)?;
    if !app.db().revoke_user_key(id, &owner, now())? {
        return Err(ApiError::NotFound("api key not found".into()));
    }
    tracing::info!("discord user {owner} revoked api key #{id}");
    Ok(Json(json!({ "message": "API key revoked" })))
}

async fn key_owners(State(app): State<AppState>, principal: Principal) -> Result<Json<Value>, ApiError> {
    principal.require(&[Role::Bot])?;
    Ok(Json(json!({ "discord_ids": app.db().key_owners()? })))
}

async fn revoke_user_keys(
    State(app): State<AppState>,
    principal: Principal,
    Path(raw): Path<String>,
) -> Result<Json<Value>, ApiError> {
    principal.require(&[Role::Bot])?;
    let owner = discord_id(&raw)?;
    let revoked = app.db().revoke_user(&owner, now())?;
    if revoked > 0 {
        tracing::info!("revoked {revoked} api key(s) of discord user {owner}");
    }
    Ok(Json(json!({ "revoked": revoked })))
}

fn ban_not_found(id: i64) -> ApiError {
    ApiError::NotFound(format!("ban #{id} not found"))
}

pub fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub fn clean_text(text: &str, max: usize) -> String {
    let cleaned: String = text.trim().chars().filter(|c| !c.is_control()).take(max).collect();
    cleaned.trim().to_string()
}

fn discord_id(raw: &str) -> Result<String, ApiError> {
    let id = raw.trim();
    if (5..=25).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit()) {
        Ok(id.to_string())
    } else {
        Err(ApiError::BadRequest("`discord_id` must be a Discord user id".into()))
    }
}

fn normalize_identifier(raw: &str) -> Option<String> {
    let identifier = raw.trim();
    let (kind, value) = identifier.split_once(':')?;
    let valid = (3..=128).contains(&identifier.len())
        && !kind.is_empty()
        && !value.is_empty()
        && !identifier.chars().any(|c| c.is_whitespace() || c.is_control());
    valid.then(|| identifier.to_string())
}

fn clean_identifiers(raw: &[String]) -> Vec<String> {
    raw.iter().filter_map(|i| normalize_identifier(i)).take(MAX_IDENTIFIERS).collect()
}

fn lenient_vec<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    match Value::deserialize(deserializer)? {
        Value::Null => Ok(Vec::new()),
        Value::Object(map) if map.is_empty() => Ok(Vec::new()),
        value => serde_json::from_value(value).map_err(D::Error::custom),
    }
}

fn player_id<'de, D>(deserializer: D) -> Result<Option<u32>, D::Error>
where
    D: Deserializer<'de>,
{
    let invalid = || D::Error::custom("`player` must be the server id of an online player");
    match Value::deserialize(deserializer)? {
        Value::Null => Ok(None),
        Value::String(text) if text.trim().is_empty() => Ok(None),
        Value::String(text) => text.trim().parse().map(Some).map_err(|_| invalid()),
        Value::Number(number) => number
            .as_u64()
            .or_else(|| number.as_f64().filter(|f| f.fract() == 0.0 && *f >= 0.0).map(|f| f as u64))
            .and_then(|id| u32::try_from(id).ok())
            .map(Some)
            .ok_or_else(invalid),
        _ => Err(invalid()),
    }
}
