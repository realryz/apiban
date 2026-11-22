mod api;
mod auth;
mod config;
mod db;
mod duration;
mod error;

use std::{
    collections::HashMap,
    path::PathBuf,
    process::ExitCode,
    sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard},
};

use tracing_subscriber::EnvFilter;

use crate::{
    api::Live,
    config::{Config, Role, ServiceKey},
    db::Db,
};

const USAGE: &str = "\
apiban-api - HTTP API for the apiban FiveM ban system

USAGE:
    apiban-api [serve]                 start the API (reads $APIBAN_CONFIG, default ./config.toml)
    apiban-api keygen <name> <role>    create a service key; role is `server`, `bot` or `panel`
";

pub struct App {
    keys: HashMap<String, ServiceKey>,
    db: Mutex<Db>,
    live: RwLock<Live>,
}

pub type AppState = Arc<App>;

impl App {
    fn db(&self) -> MutexGuard<'_, Db> {
        self.db.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn live(&self) -> RwLockReadGuard<'_, Live> {
        self.live.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn live_mut(&self) -> RwLockWriteGuard<'_, Live> {
        self.live.write().unwrap_or_else(PoisonError::into_inner)
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        None | Some("serve") => serve().await,
        Some("keygen") => keygen(&args[1..]),
        Some("help" | "-h" | "--help") => {
            print!("{USAGE}");
            Ok(())
        }
        Some(other) => Err(format!("unknown command `{other}`\n\n{USAGE}")),
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("error: {message}");
            ExitCode::FAILURE
        }
    }
}

async fn serve() -> Result<(), String> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let path = PathBuf::from(std::env::var("APIBAN_CONFIG").unwrap_or_else(|_| "config.toml".into()));
    let config = Config::load(&path)?;
    let db = Db::open(&config.database)
        .map_err(|e| format!("cannot open database {}: {e}", config.database.display()))?;

    let count = |role: Role| config.keys.iter().filter(|k| k.role == role).count();
    let summary = format!(
        "{} server, {} bot, {} panel key(s)",
        count(Role::Server),
        count(Role::Bot),
        count(Role::Panel)
    );
    let app = Arc::new(App {
        keys: config.keys.into_iter().map(|key| (key.sha256.clone(), key)).collect(),
        db: Mutex::new(db),
        live: RwLock::default(),
    });

    let listener = tokio::net::TcpListener::bind(&config.bind)
        .await
        .map_err(|e| format!("cannot listen on {}: {e}", config.bind))?;
    tracing::info!("apiban api listening on {} ({summary})", config.bind);

    axum::serve(listener, api::router(app))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .map_err(|e| format!("server error: {e}"))
}

fn keygen(args: &[String]) -> Result<(), String> {
    let usage = "usage: apiban-api keygen <name> <server|bot|panel>";
    let name = args.first().map(|n| n.trim()).filter(|n| !n.is_empty()).ok_or(usage)?;
    let role = match args.get(1).map(String::as_str) {
        Some(role @ ("server" | "bot" | "panel")) => role,
        Some(other) => return Err(format!("unknown role `{other}`\n{usage}")),
        None => return Err(usage.into()),
    };

    let token = auth::generate_token();
    println!("New {role} key for \"{name}\".\n");
    println!("Token (shown only once):\n\n    {token}\n");
    println!("Add this to config.toml and restart the API:\n");
    println!("[[keys]]");
    println!("name = {name:?}");
    println!("role = \"{role}\"");
    println!("sha256 = \"{}\"", auth::hash_token(&token));
    Ok(())
}
