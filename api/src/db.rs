use std::path::Path;

use rusqlite::{Connection, OptionalExtension, Row, named_params, params};
use serde::Serialize;

const SCHEMA: &str = "
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    player_name TEXT    NOT NULL,
    reason      TEXT    NOT NULL,
    banned_by   TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER,
    revoked_at  INTEGER,
    revoked_by  TEXT
);

CREATE TABLE IF NOT EXISTS ban_identifiers (
    ban_id     INTEGER NOT NULL REFERENCES bans(id) ON DELETE CASCADE,
    identifier TEXT    NOT NULL,
    PRIMARY KEY (ban_id, identifier)
);

CREATE INDEX IF NOT EXISTS ban_identifiers_identifier ON ban_identifiers(identifier);
";

/// The single definition of a ban's status. Every query binds `:now`.
const STATUS: &str = "CASE
    WHEN b.revoked_at IS NOT NULL THEN 'revoked'
    WHEN b.expires_at IS NOT NULL AND b.expires_at <= :now THEN 'expired'
    ELSE 'active' END";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BanStatus {
    Active,
    Expired,
    Revoked,
}

impl BanStatus {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "active" => Some(Self::Active),
            "expired" => Some(Self::Expired),
            "revoked" => Some(Self::Revoked),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Expired => "expired",
            Self::Revoked => "revoked",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Ban {
    pub id: i64,
    pub player_name: String,
    pub identifiers: Vec<String>,
    pub reason: String,
    pub banned_by: String,
    pub created_at: i64,
    pub expires_at: Option<i64>,
    pub revoked_at: Option<i64>,
    pub revoked_by: Option<String>,
    pub status: BanStatus,
}

pub struct NewBan<'a> {
    pub player_name: &'a str,
    pub identifiers: &'a [String],
    pub reason: &'a str,
    pub banned_by: &'a str,
    pub created_at: i64,
    pub expires_at: Option<i64>,
}

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    fn memory() -> rusqlite::Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> rusqlite::Result<Self> {
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    pub fn insert_ban(&mut self, ban: &NewBan) -> rusqlite::Result<Ban> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO bans (player_name, reason, banned_by, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![ban.player_name, ban.reason, ban.banned_by, ban.created_at, ban.expires_at],
        )?;
        let id = tx.last_insert_rowid();
        {
            let mut insert = tx.prepare(
                "INSERT OR IGNORE INTO ban_identifiers (ban_id, identifier) VALUES (?1, ?2)",
            )?;
            for identifier in ban.identifiers {
                insert.execute(params![id, identifier])?;
            }
        }
        tx.commit()?;
        self.get_ban(id, ban.created_at)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn get_ban(&self, id: i64, now: i64) -> rusqlite::Result<Option<Ban>> {
        self.conn
            .query_row(
                &format!("{} WHERE b.id = :id", select_bans()),
                named_params! { ":now": now, ":id": id },
                ban_from_row,
            )
            .optional()
    }

    /// The strongest active ban matching any of the identifiers: permanent first,
    /// then the one that runs longest.
    pub fn find_active_ban(&self, identifiers: &[String], now: i64) -> rusqlite::Result<Option<Ban>> {
        if identifiers.is_empty() {
            return Ok(None);
        }
        let identifiers = serde_json::to_string(identifiers).expect("strings serialize");
        self.conn
            .query_row(
                &format!(
                    "{} WHERE {STATUS} = 'active'
                       AND EXISTS (SELECT 1 FROM ban_identifiers i
                                   WHERE i.ban_id = b.id
                                     AND i.identifier IN (SELECT value FROM json_each(:identifiers)))
                     ORDER BY b.expires_at IS NULL DESC, b.expires_at DESC, b.id DESC
                     LIMIT 1",
                    select_bans()
                ),
                named_params! { ":now": now, ":identifiers": identifiers },
                ban_from_row,
            )
            .optional()
    }

    /// Newest bans first. `search` matches the ban id, player name, reason, author or an identifier.
    pub fn list_bans(
        &self,
        status: Option<BanStatus>,
        search: Option<&str>,
        limit: u32,
        offset: u32,
        now: i64,
    ) -> rusqlite::Result<(Vec<Ban>, i64)> {
        let filter = format!(
            "WHERE (:status IS NULL OR {STATUS} = :status)
               AND (:search IS NULL
                    OR CAST(b.id AS TEXT) = ltrim(:search, '#')
                    OR b.player_name LIKE :like ESCAPE '\\'
                    OR b.reason LIKE :like ESCAPE '\\'
                    OR b.banned_by LIKE :like ESCAPE '\\'
                    OR EXISTS (SELECT 1 FROM ban_identifiers i
                               WHERE i.ban_id = b.id AND i.identifier LIKE :like ESCAPE '\\'))"
        );
        let status = status.map(BanStatus::as_str);
        let like = search.map(|s| format!("%{}%", s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")));

        let total = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM bans b {filter}"),
            named_params! { ":now": now, ":status": status, ":search": search, ":like": like },
            |row| row.get(0),
        )?;
        let mut statement = self.conn.prepare(&format!(
            "{} {filter} ORDER BY b.id DESC LIMIT :limit OFFSET :offset",
            select_bans()
        ))?;
        let bans = statement
            .query_map(
                named_params! {
                    ":now": now, ":status": status, ":search": search, ":like": like,
                    ":limit": limit, ":offset": offset,
                },
                ban_from_row,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok((bans, total))
    }

    pub fn revoke_ban(&self, id: i64, revoked_by: &str, now: i64) -> rusqlite::Result<Option<Ban>> {
        self.conn.execute(
            "UPDATE bans SET revoked_at = ?1, revoked_by = ?2 WHERE id = ?3 AND revoked_at IS NULL",
            params![now, revoked_by, id],
        )?;
        self.get_ban(id, now)
    }
}

fn select_bans() -> String {
    format!(
        "SELECT b.id, b.player_name, b.reason, b.banned_by, b.created_at, b.expires_at,
                b.revoked_at, b.revoked_by,
                (SELECT json_group_array(identifier) FROM ban_identifiers WHERE ban_id = b.id),
                {STATUS}
         FROM bans b"
    )
}

fn ban_from_row(row: &Row) -> rusqlite::Result<Ban> {
    let identifiers: String = row.get(8)?;
    let status: String = row.get(9)?;
    Ok(Ban {
        id: row.get(0)?,
        player_name: row.get(1)?,
        reason: row.get(2)?,
        banned_by: row.get(3)?,
        created_at: row.get(4)?,
        expires_at: row.get(5)?,
        revoked_at: row.get(6)?,
        revoked_by: row.get(7)?,
        identifiers: serde_json::from_str(&identifiers).unwrap_or_default(),
        status: BanStatus::parse(&status).unwrap_or(BanStatus::Active),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ban(db: &mut Db, identifiers: &[&str], created_at: i64, expires_at: Option<i64>) -> Ban {
        let identifiers: Vec<String> = identifiers.iter().map(|s| s.to_string()).collect();
        db.insert_ban(&NewBan {
            player_name: "Tester",
            identifiers: &identifiers,
            reason: "cheating",
            banned_by: "test",
            created_at,
            expires_at,
        })
        .unwrap()
    }

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn finds_active_bans_by_any_identifier() {
        let mut db = Db::memory().unwrap();
        let created = ban(&mut db, &["license:abc", "discord:1"], 100, Some(200));
        assert_eq!(created.status, BanStatus::Active);
        assert_eq!(created.identifiers.len(), 2);

        let found = db.find_active_ban(&ids(&["steam:x", "discord:1"]), 150).unwrap().unwrap();
        assert_eq!(found.id, created.id);
        assert!(db.find_active_ban(&ids(&["license:other"]), 150).unwrap().is_none());
        assert!(db.find_active_ban(&ids(&["license:abc"]), 200).unwrap().is_none(), "expired");
    }

    #[test]
    fn prefers_permanent_bans_and_ignores_revoked() {
        let mut db = Db::memory().unwrap();
        ban(&mut db, &["license:abc"], 100, Some(500));
        let permanent = ban(&mut db, &["license:abc"], 100, None);
        let found = db.find_active_ban(&ids(&["license:abc"]), 150).unwrap().unwrap();
        assert_eq!(found.id, permanent.id);

        let revoked = db.revoke_ban(permanent.id, "admin", 160).unwrap().unwrap();
        assert_eq!(revoked.status, BanStatus::Revoked);
        assert_eq!(revoked.revoked_by.as_deref(), Some("admin"));
        let found = db.find_active_ban(&ids(&["license:abc"]), 170).unwrap().unwrap();
        assert_ne!(found.id, permanent.id);
    }

    #[test]
    fn lists_with_filters() {
        let mut db = Db::memory().unwrap();
        ban(&mut db, &["license:a"], 100, Some(150));
        let active = ban(&mut db, &["license:b_1"], 100, None);
        let revoked = ban(&mut db, &["license:c"], 100, None);
        db.revoke_ban(revoked.id, "admin", 120).unwrap();

        let (all, total) = db.list_bans(None, None, 50, 0, 200).unwrap();
        assert_eq!((all.len(), total), (3, 3));
        assert_eq!(all[0].id, revoked.id, "newest first");

        let (bans, total) = db.list_bans(Some(BanStatus::Active), None, 50, 0, 200).unwrap();
        assert_eq!((bans[0].id, total), (active.id, 1));
        let (_, total) = db.list_bans(Some(BanStatus::Expired), None, 50, 0, 200).unwrap();
        assert_eq!(total, 1);

        let (bans, _) = db.list_bans(None, Some("_"), 50, 0, 200).unwrap();
        assert_eq!(bans.len(), 1, "underscore is matched literally");
        let (bans, _) = db.list_bans(None, Some(&format!("#{}", active.id)), 50, 0, 200).unwrap();
        assert_eq!(bans[0].id, active.id);
        let (page, total) = db.list_bans(None, None, 1, 1, 200).unwrap();
        assert_eq!((page.len(), total), (1, 3));
    }
}
