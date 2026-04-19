use chrono::Utc;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: i64,
    pub content: String,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub pinned: bool,
    pub sort_order: i64,
    pub checked: bool,
}

pub struct Database {
    pub conn: Connection,
}

// Columns used in every SELECT — single source of truth
const NOTE_COLS: &str =
    "id, content, tags, created_at, updated_at, pinned, sort_order, checked";

impl Database {
    pub fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;

        // WAL + a few perf tweaks
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous   = NORMAL;
             PRAGMA foreign_keys  = ON;",
        )?;

        // Main table
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS notes (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                content    TEXT    NOT NULL,
                tags       TEXT    NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                deleted    INTEGER NOT NULL DEFAULT 0,
                pinned     INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                checked    INTEGER NOT NULL DEFAULT 0
            );",
        )?;

        // Migrations — safe to run on existing DBs
        for ddl in [
            "ALTER TABLE notes ADD COLUMN pinned     INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE notes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE notes ADD COLUMN checked    INTEGER NOT NULL DEFAULT 0",
        ] {
            let _ = conn.execute_batch(ddl); // ignore "duplicate column" errors
        }

        // Index for the common list query (deleted=0 ORDER BY pinned, sort_order)
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_notes_list
             ON notes (deleted, pinned DESC, sort_order DESC);",
        )?;

        // FTS5 for full-text search
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
                 USING fts5(content, content='notes', content_rowid='id');

             CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
                 INSERT INTO notes_fts(rowid, content) VALUES (new.id, new.content);
             END;
             CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
                 INSERT INTO notes_fts(notes_fts, rowid, content)
                     VALUES ('delete', old.id, old.content);
                 INSERT INTO notes_fts(rowid, content) VALUES (new.id, new.content);
             END;
             CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
                 INSERT INTO notes_fts(notes_fts, rowid, content)
                     VALUES ('delete', old.id, old.content);
             END;",
        )?;

        Ok(Database { conn })
    }

    // ── save ──────────────────────────────────────────────────────────────────

    pub fn save_note(&self, content: &str, tags: &[String]) -> Result<Note> {
        let now = Utc::now().timestamp_millis();
        let tags_json = serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_string());
        self.conn.execute(
            "INSERT INTO notes (content, tags, created_at, updated_at, sort_order)
             VALUES (?1, ?2, ?3, ?3, ?3)",
            params![content, tags_json, now],
        )?;
        let id = self.conn.last_insert_rowid();
        Ok(Note {
            id,
            content: content.to_string(),
            tags: tags.to_vec(),
            created_at: now,
            updated_at: now,
            pinned: false,
            sort_order: now,
            checked: false,
        })
    }

    // ── list ──────────────────────────────────────────────────────────────────

    pub fn get_notes(&self, tag_filter: Option<&str>) -> Result<Vec<Note>> {
        match tag_filter {
            Some(tag) => {
                // Use json_each so "#todo" never accidentally matches "#todolist"
                let sql = format!(
                    "SELECT n.{NOTE_COLS}
                     FROM notes n, json_each(n.tags) je
                     WHERE n.deleted = 0 AND je.value = ?1
                     GROUP BY n.id
                     ORDER BY n.pinned DESC, n.sort_order DESC"
                );
                let mut stmt = self.conn.prepare(&sql)?;
                let result = stmt.query_map(params![tag], row_to_note)?.collect();
                result
            }
            None => {
                let sql = format!(
                    "SELECT {NOTE_COLS} FROM notes
                     WHERE deleted = 0
                     ORDER BY pinned DESC, sort_order DESC"
                );
                let mut stmt = self.conn.prepare(&sql)?;
                let result = stmt.query_map([], row_to_note)?.collect();
                result
            }
        }
    }

    // ── search ────────────────────────────────────────────────────────────────

    pub fn search_notes(&self, query: &str) -> Result<Vec<Note>> {
        // Sanitise: strip FTS5 special characters so user input never errors
        let safe_query = sanitize_fts(query);
        if safe_query.is_empty() {
            return self.get_notes(None);
        }
        let fts_query = format!("{}*", safe_query);
        let sql = format!(
            "SELECT n.{NOTE_COLS}
             FROM notes n
             JOIN notes_fts fts ON n.id = fts.rowid
             WHERE fts.notes_fts MATCH ?1 AND n.deleted = 0
             ORDER BY n.pinned DESC, rank"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let result = stmt.query_map(params![fts_query], row_to_note)?.collect();
        result
    }

    // ── delete ────────────────────────────────────────────────────────────────

    pub fn delete_note(&self, id: i64) -> Result<()> {
        self.conn
            .execute("UPDATE notes SET deleted = 1 WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── update / pin / checked ────────────────────────────────────────────────
    // All three use RETURNING to avoid a second SELECT round-trip.

    pub fn update_note(&self, id: i64, content: &str, tags: &[String]) -> Result<Note> {
        let now = Utc::now().timestamp_millis();
        let tags_json = serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_string());
        let sql = format!(
            "UPDATE notes SET content = ?1, tags = ?2, updated_at = ?3
             WHERE id = ?4
             RETURNING {NOTE_COLS}"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        stmt.query_row(params![content, tags_json, now, id], row_to_note)
    }

    pub fn pin_note(&self, id: i64, pinned: bool) -> Result<Note> {
        let sql = format!(
            "UPDATE notes SET pinned = ?1 WHERE id = ?2 RETURNING {NOTE_COLS}"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        stmt.query_row(params![pinned as i64, id], row_to_note)
    }

    pub fn toggle_checked(&self, id: i64, checked: bool) -> Result<Note> {
        let sql = format!(
            "UPDATE notes SET checked = ?1 WHERE id = ?2 RETURNING {NOTE_COLS}"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        stmt.query_row(params![checked as i64, id], row_to_note)
    }

    // ── reorder ───────────────────────────────────────────────────────────────

    pub fn reorder_notes(&self, ids: &[i64]) -> Result<()> {
        // Wrap all updates in a single transaction — atomic and ~10× faster
        let tx = self.conn.unchecked_transaction()?;
        let total = ids.len() as i64;
        for (i, id) in ids.iter().enumerate() {
            let order = (total - i as i64) * 1000;
            tx.execute(
                "UPDATE notes SET sort_order = ?1 WHERE id = ?2",
                params![order, id],
            )?;
        }
        tx.commit()
    }

    // ── tags ──────────────────────────────────────────────────────────────────

    pub fn get_all_tags(&self) -> Result<Vec<String>> {
        // json_each lets SQLite expand the array — no Rust-side JSON parsing needed
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT je.value
             FROM notes, json_each(notes.tags) je
             WHERE deleted = 0
             ORDER BY je.value",
        )?;
        let result = stmt.query_map([], |row| row.get::<_, String>(0))?.collect();
        result
    }
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn row_to_note(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    let tags_str: String = row.get(2)?;
    let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
    Ok(Note {
        id: row.get(0)?,
        content: row.get(1)?,
        tags,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        pinned: row.get::<_, i64>(5)? != 0,
        sort_order: row.get(6)?,
        checked: row.get::<_, i64>(7)? != 0,
    })
}

/// Strip characters that have special meaning in FTS5 queries.
/// Keeps letters, digits, spaces, CJK, and Cyrillic/Latin-extended ranges.
fn sanitize_fts(input: &str) -> String {
    input
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}