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
    pub checked: Vec<bool>,
}

pub struct Database {
    pub conn: Connection,
}

const NOTE_COLS: &str =
    "id, content, tags, created_at, updated_at, pinned, sort_order, checked";

impl Database {
    pub fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous   = NORMAL;
             PRAGMA foreign_keys  = ON;",
        )?;
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
                checked    TEXT    NOT NULL DEFAULT '[]'
            );",
        )?;
        for ddl in [
            "ALTER TABLE notes ADD COLUMN pinned     INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE notes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE notes ADD COLUMN checked    TEXT NOT NULL DEFAULT '[]'",
        ] {
            let _ = conn.execute_batch(ddl);
        }
        conn.execute_batch(
            "UPDATE notes SET checked = '[true]'  WHERE checked = '1';
             UPDATE notes SET checked = '[false]' WHERE checked = '0';",
        )?;
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_notes_list
             ON notes (deleted, pinned DESC, sort_order DESC);",
        )?;
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

    pub fn save_note(&self, content: &str, tags: &[String]) -> Result<Note> {
        let now          = Utc::now().timestamp_millis();
        let tags_json    = serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_string());
        let checked      = initial_checked(content);
        let checked_json = serde_json::to_string(&checked).unwrap_or_else(|_| "[]".to_string());
        self.conn.execute(
            "INSERT INTO notes (content, tags, created_at, updated_at, sort_order, checked)
             VALUES (?1, ?2, ?3, ?3, ?3, ?4)",
            params![content, tags_json, now, checked_json],
        )?;
        let id = self.conn.last_insert_rowid();
        Ok(Note {
            id, content: content.to_string(), tags: tags.to_vec(),
            created_at: now, updated_at: now, pinned: false,
            sort_order: now, checked,
        })
    }

    pub fn get_notes(&self, tag_filter: Option<&str>) -> Result<Vec<Note>> {
        match tag_filter {
            Some(tag) => {
                let sql = format!(
                    "SELECT n.{NOTE_COLS} FROM notes n, json_each(n.tags) je
                     WHERE n.deleted = 0 AND je.value = ?1
                     GROUP BY n.id ORDER BY n.pinned DESC, n.sort_order DESC"
                );
                let mut stmt = self.conn.prepare(&sql)?;
                let r = stmt.query_map(params![tag], row_to_note)?.collect();
                r
            }
            None => {
                let sql = format!(
                    "SELECT {NOTE_COLS} FROM notes
                     WHERE deleted = 0 ORDER BY pinned DESC, sort_order DESC"
                );
                let mut stmt = self.conn.prepare(&sql)?;
                let r = stmt.query_map([], row_to_note)?.collect();
                r
            }
        }
    }

    pub fn search_notes(&self, query: &str) -> Result<Vec<Note>> {
        let safe = sanitize_fts(query);
        if safe.is_empty() { return self.get_notes(None); }
        let fts = format!("{}*", safe);
        let sql = format!(
            "SELECT n.{NOTE_COLS}
             FROM notes n JOIN notes_fts fts ON n.id = fts.rowid
             WHERE fts.notes_fts MATCH ?1 AND n.deleted = 0
             ORDER BY n.pinned DESC, rank"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let r = stmt.query_map(params![fts], row_to_note)?.collect();
        r
    }

    pub fn delete_note(&self, id: i64) -> Result<()> {
        let now = Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE notes SET deleted = 1, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    pub fn update_note(&self, id: i64, content: &str, tags: &[String]) -> Result<Note> {
        let now          = Utc::now().timestamp_millis();
        let tags_json    = serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_string());
        let current      = self.get_checked(id)?;
        let new_checked  = refit_checked(content, &current);
        let checked_json = serde_json::to_string(&new_checked).unwrap_or_else(|_| "[]".to_string());
        let sql = format!(
            "UPDATE notes SET content=?1, tags=?2, updated_at=?3, checked=?4
             WHERE id=?5 RETURNING {NOTE_COLS}"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        stmt.query_row(params![content, tags_json, now, checked_json, id], row_to_note)
    }

    pub fn pin_note(&self, id: i64, pinned: bool) -> Result<Note> {
        let sql = format!("UPDATE notes SET pinned=?1 WHERE id=?2 RETURNING {NOTE_COLS}");
        let mut stmt = self.conn.prepare(&sql)?;
        stmt.query_row(params![pinned as i64, id], row_to_note)
    }

    pub fn toggle_checked(&self, id: i64, index: usize, checked: bool) -> Result<Note> {
        let mut state = self.get_checked(id)?;
        if index < state.len() { state[index] = checked; }
        let checked_json = serde_json::to_string(&state).unwrap_or_else(|_| "[]".to_string());
        let sql = format!("UPDATE notes SET checked=?1 WHERE id=?2 RETURNING {NOTE_COLS}");
        let mut stmt = self.conn.prepare(&sql)?;
        stmt.query_row(params![checked_json, id], row_to_note)
    }

    pub fn get_all_tags(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT je.value FROM notes, json_each(notes.tags) je
             WHERE deleted = 0 ORDER BY je.value",
        )?;
        let r = stmt.query_map([], |row| row.get::<_, String>(0))?.collect();
        r
    }


    /// Counts notes created since the given timestamp (in milliseconds).
    /// If `since_ms == 0` returns total count of non-deleted notes.
    pub fn count_notes_since(&self, since_ms: i64) -> Result<usize> {
        let count: usize = if since_ms > 0 {
            let sql = "SELECT COUNT(*) FROM notes WHERE deleted = 0 AND created_at >= ?1";
            self.conn.query_row(sql, params![since_ms], |row| row.get(0))?
        } else {
            let sql = "SELECT COUNT(*) FROM notes WHERE deleted = 0";
            self.conn.query_row(sql, [], |row| row.get(0))?
        };
        Ok(count)
    }

    // ── Export ────────────────────────────────────────────────────────────────

    /// Returns a Markdown string of all (or recent) notes.
    /// `since_ms = 0` → export all.
    pub fn export_markdown(&self, since_ms: i64) -> Result<String> {
        let notes: Vec<Note> = if since_ms > 0 {
            let sql = format!(
                "SELECT {NOTE_COLS} FROM notes
                 WHERE deleted=0 AND created_at >= ?1
                 ORDER BY pinned DESC, sort_order DESC"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let r = stmt.query_map(params![since_ms], row_to_note)?.collect::<Result<Vec<_>>>()?;
            r
        } else {
            let sql = format!(
                "SELECT {NOTE_COLS} FROM notes
                 WHERE deleted=0 ORDER BY pinned DESC, sort_order DESC"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let r = stmt.query_map([], row_to_note)?.collect::<Result<Vec<_>>>()?;
            r
        };

        if notes.is_empty() {
            return Ok("# Spark Export\n\n_No notes found._\n".to_string());
        }

        let now_str = chrono::DateTime::from_timestamp_millis(Utc::now().timestamp_millis())
            .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_default();

        let mut md = format!("# Spark Export\n\nGenerated: {}\n\n---\n\n", now_str);
        let mut current_day = String::new();

        for note in &notes {
            let day = chrono::DateTime::from_timestamp_millis(note.created_at)
                .map(|dt| dt.format("%Y-%m-%d").to_string())
                .unwrap_or_default();
            let time = chrono::DateTime::from_timestamp_millis(note.created_at)
                .map(|dt| dt.format("%H:%M").to_string())
                .unwrap_or_default();

            if day != current_day {
                current_day = day.clone();
                md.push_str(&format!("## {}\n\n", day));
            }

            let tags_str = if note.tags.is_empty() {
                String::new()
            } else {
                format!("  _{}_", note.tags.join(", "))
            };
            let pin = if note.pinned { " 📌" } else { "" };

            md.push_str(&format!("**{}**{}{}\n\n", time, pin, tags_str));
            md.push_str(&note.content);
            md.push_str("\n\n---\n\n");
        }

        Ok(md)
    }

    // ── Sync ──────────────────────────────────────────────────────────────────

    /// All notes including soft-deleted (needed for tombstone propagation).
    pub fn get_all_for_sync(&self) -> Result<Vec<crate::sync::SyncNote>> {
        let sql = format!(
            "SELECT {NOTE_COLS}, deleted FROM notes ORDER BY updated_at DESC"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let r = stmt.query_map([], |row| {
            let tags_str: String    = row.get(2)?;
            let checked_str: String = row.get(7)?;
            Ok(crate::sync::SyncNote {
                id:         row.get(0)?,
                content:    row.get(1)?,
                tags:       serde_json::from_str(&tags_str).unwrap_or_default(),
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                pinned:     row.get::<_, i64>(5)? != 0,
                checked:    serde_json::from_str(&checked_str).unwrap_or_default(),
                deleted:    row.get::<_, i64>(8)? != 0,
            })
        })?.collect();
        r
    }

    /// Merge incoming notes — last `updated_at` wins per id.
    pub fn merge_sync_notes(&self, incoming: &[crate::sync::SyncNote]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        for note in incoming {
            let tags_j    = serde_json::to_string(&note.tags).unwrap_or_else(|_| "[]".to_string());
            let checked_j = serde_json::to_string(&note.checked).unwrap_or_else(|_| "[]".to_string());
            let del = note.deleted as i64;
            let pin = note.pinned  as i64;

            let existing: Option<i64> = tx
                .query_row("SELECT updated_at FROM notes WHERE id=?1", params![note.id], |r| r.get(0))
                .ok();

            match existing {
                // local новее или равен — local wins, skip
                Some(local_ts) if local_ts > note.updated_at => {}

                // равные timestamps — не-удалённая побеждает удалённую
                Some(local_ts) if local_ts == note.updated_at => {
                    if !note.deleted {
                        tx.execute(
                            "UPDATE notes SET content=?1, tags=?2, updated_at=?3,
                                    deleted=0, pinned=?4, checked=?5 WHERE id=?6",
                            params![note.content, tags_j, note.updated_at, pin, checked_j, note.id],
                        )?;
                    }
                }

                // remote новее — обновляем local
                Some(_) => {
                    tx.execute(
                        "UPDATE notes SET content=?1, tags=?2, updated_at=?3,
                                deleted=?4, pinned=?5, checked=?6 WHERE id=?7",
                        params![note.content, tags_j, note.updated_at, del, pin, checked_j, note.id],
                    )?;
                }

                // нет локально — вставляем
                None => {
                    tx.execute(
                        "INSERT INTO notes(id,content,tags,created_at,updated_at,
                                        deleted,pinned,sort_order,checked)
                        VALUES(?1,?2,?3,?4,?5,?6,?7,?4,?8)",
                        params![note.id, note.content, tags_j, note.created_at,
                                note.updated_at, del, pin, checked_j],
                    )?;
                }
            }
        }
        tx.commit()
    }

    fn get_checked(&self, id: i64) -> Result<Vec<bool>> {
        let json: String = self.conn.query_row(
            "SELECT checked FROM notes WHERE id=?1", params![id], |r| r.get(0),
        )?;
        Ok(serde_json::from_str(&json).unwrap_or_default())
    }
}

fn row_to_note(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    let tags_str: String    = row.get(2)?;
    let checked_str: String = row.get(7)?;
    Ok(Note {
        id: row.get(0)?,
        content: row.get(1)?,
        tags:    serde_json::from_str(&tags_str).unwrap_or_default(),
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        pinned:     row.get::<_, i64>(5)? != 0,
        sort_order: row.get(6)?,
        checked:    serde_json::from_str(&checked_str).unwrap_or_default(),
    })
}

/// Returns `true` if the line looks like a task / to-do item.
///
/// Matches (case-insensitive, anywhere in the line):
///   English : #todo  todo  to-do  "to do"  task
///   Russian : #задача  задача  #сделать  сделать  #надо  надо  #нужно  нужно
///   Polish  : #todo  todo  #zrobić  zrobić  #zadanie  zadanie  #zrób  zrób
fn is_todo_line(line: &str) -> bool {
    let low: String = line.chars().flat_map(|c| c.to_lowercase()).collect();
    const KEYWORDS: &[&str] = &[
        "#todo", "todo","to-do","to do","task","remind","reminder","need to","must","should","plan","checklist","don't forget","dont forget",
        "сделать","нужно","надо","задача","план","напомнить","напомни","не забыть","выполнить","проверить","список дел","запланировать","успеть",
        "zrobić","trzeba","należy","zadanie","przypomnienie","nie zapomnieć","lista zadań","zaplanować",
        "зробити","треба","потрібно","завдання","нагадати","не забути","запланувати","виконати",
        "machen","aufgabe","erledigen","merken","nicht vergessen","planen","erinnerung","vorhaben","müssen","sollen",
    ];
    KEYWORDS.iter().any(|kw| low.contains(kw))
}

fn initial_checked(content: &str) -> Vec<bool> {
    vec![false; content.lines().filter(|l| is_todo_line(l)).count()]
}

fn refit_checked(content: &str, current: &[bool]) -> Vec<bool> {
    let count = content.lines().filter(|l| is_todo_line(l)).count();
    let mut r = vec![false; count];
    for (i, v) in current.iter().take(count).enumerate() { r[i] = *v; }
    r
}

fn sanitize_fts(input: &str) -> String {
    // Keep Unicode alphanumeric (кириллица, emoji), whitespace, and common punctuation
    // Remove only FTS5 special operators: " * ( ) AND OR NOT
    input.chars()
        .filter(|c| {
            // Allow all alphabetic chars (включая кириллицу)
            c.is_alphabetic() ||
            // Allow all numeric chars
            c.is_numeric() ||
            // Allow whitespace
            c.is_whitespace() ||
            // Allow common punctuation except FTS5 operators
            matches!(c, '-' | '_' | '#' | '@' | '.' | ',' | '!' | '?' | ':' | ';')
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}