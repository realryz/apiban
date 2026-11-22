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

CREATE TABLE IF NOT EXISTS api_keys (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    discord_id   TEXT    NOT NULL,
    discord_name TEXT    NOT NULL,
    token_sha256 TEXT    NOT NULL UNIQUE,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at   INTEGER
);

CREATE INDEX IF NOT EXISTS api_keys_discord_id ON api_keys(discord_id);

CREATE TABLE IF NOT EXISTS auth_codes (
    discord_id   TEXT    PRIMARY KEY,
    discord_name TEXT    NOT NULL,
    code         TEXT    NOT NULL,
    expires_at   INTEGER NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0
);
";

const STATUS: &str = "CASE
    WHEN b.revoked_at IS NOT NULL THEN 'revoked'
    WHEN b.expires_at IS NOT NULL AND b.expires_at <= :now THEN 'expired'
    ELSE 'active' END";

const SELECT_USER_KEYS: &str =
    "SELECT id, name, discord_id, discord_name, created_at, last_used_at FROM api_keys";

const MAX_CODE_ATTEMPTS: i64 = 5;

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

#[derive(Debug, Clone, Serialize)]
pub struct UserKey {
    pub id: i64,
    pub name: String,
    pub discord_id: String,
    pub discord_name: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
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

    pub fn use_user_key(&self, sha256: &str, now: i64) -> rusqlite::Result<Option<UserKey>> {
        let key = self
            .conn
            .query_row(
                &format!("{SELECT_USER_KEYS} WHERE token_sha256 = ?1 AND revoked_at IS NULL"),
                params![sha256],
                user_key_from_row,
            )
            .optional()?;
        if let Some(key) = &key {
            self.conn.execute("UPDATE api_keys SET last_used_at = ?1 WHERE id = ?2", params![now, key.id])?;
        }
        Ok(key)
    }

    pub fn user_keys(&self, discord_id: &str) -> rusqlite::Result<Vec<UserKey>> {
        let mut statement = self.conn.prepare(&format!(
            "{SELECT_USER_KEYS} WHERE discord_id = ?1 AND revoked_at IS NULL ORDER BY id DESC"
        ))?;
        statement.query_map(params![discord_id], user_key_from_row)?.collect()
    }

    pub fn insert_user_key(
        &self,
        name: &str,
        discord_id: &str,
        discord_name: &str,
        sha256: &str,
        now: i64,
    ) -> rusqlite::Result<UserKey> {
        self.conn.execute(
            "INSERT INTO api_keys (name, discord_id, discord_name, token_sha256, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![name, discord_id, discord_name, sha256, now],
        )?;
        let id = self.conn.last_insert_rowid();
        self.conn.query_row(&format!("{SELECT_USER_KEYS} WHERE id = ?1"), params![id], user_key_from_row)
    }

    pub fn revoke_user_key(&self, id: i64, discord_id: &str, now: i64) -> rusqlite::Result<bool> {
        let changed = self.conn.execute(
            "UPDATE api_keys SET revoked_at = ?1 WHERE id = ?2 AND discord_id = ?3 AND revoked_at IS NULL",
            params![now, id, discord_id],
        )?;
        Ok(changed > 0)
    }

    pub fn revoke_user(&self, discord_id: &str, now: i64) -> rusqlite::Result<usize> {
        self.conn.execute("DELETE FROM auth_codes WHERE discord_id = ?1", params![discord_id])?;
        self.conn.execute(
            "UPDATE api_keys SET revoked_at = ?1 WHERE discord_id = ?2 AND revoked_at IS NULL",
            params![now, discord_id],
        )
    }

    pub fn key_owners(&self) -> rusqlite::Result<Vec<String>> {
        let mut statement = self
            .conn
            .prepare("SELECT DISTINCT discord_id FROM api_keys WHERE revoked_at IS NULL ORDER BY discord_id")?;
        statement.query_map([], |row| row.get(0))?.collect()
    }

    pub fn save_auth_code(
        &self,
        discord_id: &str,
        discord_name: &str,
        code: &str,
        expires_at: i64,
        now: i64,
    ) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM auth_codes WHERE expires_at <= ?1", params![now])?;
        self.conn.execute(
            "INSERT OR REPLACE INTO auth_codes (discord_id, discord_name, code, expires_at, attempts)
             VALUES (?1, ?2, ?3, ?4, 0)",
            params![discord_id, discord_name, code, expires_at],
        )?;
        Ok(())
    }

    pub fn redeem_auth_code(&self, discord_id: &str, code: &str, now: i64) -> rusqlite::Result<Option<String>> {
        let row: Option<(String, String, i64, i64)> = self
            .conn
            .query_row(
                "SELECT discord_name, code, expires_at, attempts FROM auth_codes WHERE discord_id = ?1",
                params![discord_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?;
        let Some((discord_name, expected, expires_at, attempts)) = row else {
            return Ok(None);
        };

        let expired = expires_at <= now;
        if !expired && expected == code {
            self.conn.execute("DELETE FROM auth_codes WHERE discord_id = ?1", params![discord_id])?;
            return Ok(Some(discord_name));
        }
        if expired || attempts + 1 >= MAX_CODE_ATTEMPTS {
            self.conn.execute("DELETE FROM auth_codes WHERE discord_id = ?1", params![discord_id])?;
        } else {
            self.conn.execute(
                "UPDATE auth_codes SET attempts = attempts + 1 WHERE discord_id = ?1",
                params![discord_id],
            )?;
        }
        Ok(None)
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

fn user_key_from_row(row: &Row) -> rusqlite::Result<UserKey> {
    Ok(UserKey {
        id: row.get(0)?,
        name: row.get(1)?,
        discord_id: row.get(2)?,
        discord_name: row.get(3)?,
        created_at: row.get(4)?,
        last_used_at: row.get(5)?,
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

    #[test]
    fn auth_codes_work_once_and_lock_after_failed_attempts() {
        let db = Db::memory().unwrap();
        db.save_auth_code("42", "ryz", "123456", 160, 100).unwrap();
        assert_eq!(db.redeem_auth_code("43", "123456", 110).unwrap(), None, "other user");
        assert_eq!(db.redeem_auth_code("42", "123456", 110).unwrap().as_deref(), Some("ryz"));
        assert_eq!(db.redeem_auth_code("42", "123456", 111).unwrap(), None, "single use");

        db.save_auth_code("42", "ryz", "123456", 160, 100).unwrap();
        assert_eq!(db.redeem_auth_code("42", "123456", 160).unwrap(), None, "expired");

        db.save_auth_code("42", "ryz", "123456", 160, 100).unwrap();
        for _ in 0..MAX_CODE_ATTEMPTS {
            assert_eq!(db.redeem_auth_code("42", "000000", 110).unwrap(), None);
        }
        assert_eq!(db.redeem_auth_code("42", "123456", 110).unwrap(), None, "locked");
    }

    #[test]
    fn user_keys_belong_to_their_owner() {
        let db = Db::memory().unwrap();
        let key = db.insert_user_key("iPhone", "42", "ryz", "hash-a", 100).unwrap();
        db.insert_user_key("Laptop", "42", "ryz", "hash-b", 101).unwrap();
        db.insert_user_key("Phone", "7", "other", "hash-c", 102).unwrap();

        assert_eq!(db.use_user_key("hash-a", 150).unwrap().unwrap().id, key.id);
        assert_eq!(db.user_keys("42").unwrap()[1].last_used_at, Some(150));
        assert_eq!(db.key_owners().unwrap(), vec!["42".to_string(), "7".to_string()]);

        assert!(!db.revoke_user_key(key.id, "7", 160).unwrap(), "not the owner");
        assert!(db.revoke_user_key(key.id, "42", 160).unwrap());
        assert!(db.use_user_key("hash-a", 170).unwrap().is_none());

        assert_eq!(db.revoke_user("42", 180).unwrap(), 1);
        assert!(db.use_user_key("hash-b", 190).unwrap().is_none());
        assert_eq!(db.key_owners().unwrap(), vec!["7".to_string()]);
    }
}
