use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    Json, Router,
    extract::{FromRequest, Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::{
    Deserialize, Deserializer, Serialize,
    de::{DeserializeOwned, Error as _},
};
use serde_json::{Value, json};

use crate::{
    AppState,
    auth::Principal,
    config::Role,
    db::{BanStatus, NewBan},
    duration,
    error::ApiError,
};

/// The FiveM resource sends a heartbeat every 3 seconds; after this long without one
/// the server counts as offline.
const ONLINE_WINDOW_SECS: i64 = 15;
const MAX_PLAYERS: usize = 2048;
const MAX_IDENTIFIERS: usize = 64;
const MAX_REASON: usize = 500;

pub fn router(app: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/me", get(me))
        .route("/v1/server/heartbeat", post(heartbeat))
        .route("/v1/server/check", post(check))
        .route("/v1/players", get(players))
        .route("/v1/bans", get(list_bans).post(create_ban))
        .route("/v1/bans/{id}", get(get_ban).delete(revoke_ban))
        .with_state(app)
}

/// `Json` that reports bad bodies as `{"error": ...}` like every other error.
#[derive(FromRequest)]
#[from_request(via(Json), rejection(ApiError))]
struct ApiJson<T>(T);

/// What the FiveM server reported in its last heartbeat.
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

/// Called by the FiveM resource: stores who is online and answers with the
/// players that have an active ban and must be kicked.
async fn heartbeat(
    State(app): State<AppState>,
    principal: Principal,
    ApiJson(body): ApiJson<HeartbeatRequest>,
) -> Result<Json<Value>, ApiError> {
    principal.require(Role::Server)?;
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

/// Called by the FiveM resource while a player connects.
async fn check(
    State(app): State<AppState>,
    principal: Principal,
    ApiJson(body): ApiJson<CheckRequest>,
) -> Result<Json<Value>, ApiError> {
    principal.require(Role::Server)?;
    let ban = app.db().find_active_ban(&clean_identifiers(&body.identifiers), now())?;
    Ok(Json(json!({ "banned": ban.is_some(), "ban": ban })))
}

async fn players(State(app): State<AppState>, _: Principal) -> Json<Value> {
    let live = app.live();
    let online = live.online(now());
    let players: &[OnlinePlayer] = if online { &live.players } else { &[] };
    Json(json!({ "online": online, "last_heartbeat": live.last_heartbeat, "players": players }))
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
    _: Principal,
    Query(query): Query<ListQuery>,
) -> Result<Json<Value>, ApiError> {
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
    _: Principal,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    let ban = app.db().get_ban(id, now())?.ok_or_else(|| not_found(id))?;
    Ok(Json(json!(ban)))
}

#[derive(Deserialize)]
struct CreateBanRequest {
    /// Server id of an online player, e.g. `12`.
    #[serde(default, deserialize_with = "player_id")]
    player: Option<u32>,
    /// Identifiers to ban, e.g. `license:abc...` (for offline players).
    #[serde(default, deserialize_with = "lenient_vec")]
    identifiers: Vec<String>,
    name: Option<String>,
    #[serde(default)]
    reason: String,
    /// `30m`, `12h`, `7d`, `2w`, `1y`; empty or `perm` for a permanent ban.
    duration: Option<String>,
}

async fn create_ban(
    State(app): State<AppState>,
    principal: Principal,
    ApiJson(request): ApiJson<CreateBanRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
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
    tracing::info!(by = %principal.actor, key = %principal.name, reason = %ban.reason, "{message}");
    Ok((StatusCode::CREATED, Json(json!({ "message": message, "ban": ban }))))
}

async fn revoke_ban(
    State(app): State<AppState>,
    principal: Principal,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    let now = now();
    let ban = {
        let db = app.db();
        let ban = db.get_ban(id, now)?.ok_or_else(|| not_found(id))?;
        if ban.status == BanStatus::Revoked {
            return Err(ApiError::Conflict(format!("ban #{id} is already revoked")));
        }
        db.revoke_ban(id, &principal.actor, now)?.ok_or_else(|| not_found(id))?
    };

    let message = format!("Unbanned {} (#{})", ban.player_name, ban.id);
    tracing::info!(by = %principal.actor, key = %principal.name, "{message}");
    Ok(Json(json!({ "message": message, "ban": ban })))
}

fn not_found(id: i64) -> ApiError {
    ApiError::NotFound(format!("ban #{id} not found"))
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Trims, drops control characters and cuts the text to `max` characters.
pub fn clean_text(text: &str, max: usize) -> String {
    let cleaned: String = text.trim().chars().filter(|c| !c.is_control()).take(max).collect();
    cleaned.trim().to_string()
}

/// FiveM identifiers look like `license:abc123`, `discord:123` or `token:3:abc`.
fn normalize_identifier(raw: &str) -> Option<String> {
    let identifier = raw.trim();
    let (kind, value) = identifier.split_once(':')?;
    let valid = (3..=128).contains(&identifier.len())
        && !kind.is_empty()
        && !value.is_empty()
        && !identifier.chars().any(|c| c.is_whitespace() || c.is_control());
    valid.then(|| identifier.to_string())
}

/// For data sent by the FiveM server: keep the valid identifiers, skip the rest.
fn clean_identifiers(raw: &[String]) -> Vec<String> {
    raw.iter().filter_map(|i| normalize_identifier(i)).take(MAX_IDENTIFIERS).collect()
}

/// Accepts a JSON array, `null` or `{}` (FiveM's Lua JSON encoder may turn an empty
/// table into an object).
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

/// Accepts `12`, `12.0` or `"12"`: iOS Shortcuts sends numbers either way.
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
