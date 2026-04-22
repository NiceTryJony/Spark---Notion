use crate::db::Note;
use crate::AppState;
use tauri::{Manager, State};

// ── Standard commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn save_note(content: String, tags: Vec<String>, state: State<'_, AppState>) -> Result<Note, String> {
    state.db.lock().map_err(|e| e.to_string())?.save_note(&content, &tags).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_notes(tag: Option<String>, state: State<'_, AppState>) -> Result<Vec<Note>, String> {
    state.db.lock().map_err(|e| e.to_string())?.get_notes(tag.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_notes(query: String, state: State<'_, AppState>) -> Result<Vec<Note>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if query.trim().is_empty() {
        db.get_notes(None).map_err(|e| e.to_string())
    } else {
        db.search_notes(&query).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn delete_note(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    state.db.lock().map_err(|e| e.to_string())?.delete_note(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_note(id: i64, content: String, tags: Vec<String>, state: State<'_, AppState>) -> Result<Note, String> {
    state.db.lock().map_err(|e| e.to_string())?.update_note(id, &content, &tags).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_tags(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    state.db.lock().map_err(|e| e.to_string())?.get_all_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_library(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("library") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pin_note(id: i64, pinned: bool, state: State<'_, AppState>) -> Result<Note, String> {
    state.db.lock().map_err(|e| e.to_string())?.pin_note(id, pinned).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_checked(id: i64, index: usize, checked: bool, state: State<'_, AppState>) -> Result<Note, String> {
    state.db.lock().map_err(|e| e.to_string())?.toggle_checked(id, index, checked).map_err(|e| e.to_string())
}

// ── Export ────────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct ExportResult {
    pub path: String,
    pub note_count: usize,
}

/// Export notes to a Markdown file in Documents folder.
/// `since_ms = 0` → all notes; positive value → since that timestamp.


// #[tauri::command]
// pub fn export_notes(since_ms: i64, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<ExportResult, String> {
//     let md = state.db.lock().map_err(|e| e.to_string())?
//         .export_markdown(since_ms)
//         .map_err(|e| e.to_string())?;

//     // Count separator occurrences as a proxy for note count
//     // let note_count = md.matches("\n---\n").count();
//      let note_count = state.db.lock().map_err(|e| e.to_string())?
//      .count_notes_since(since_ms).map_err(|e| e.to_string())?;

//     // Write to Documents/spark-export-YYYY-MM-DD.md
//     let date_str = chrono::Utc::now().format("%Y-%m-%d").to_string();
//     let filename = format!("spark-export-{}.md", date_str);

//     let doc_dir = app.path()
//         .document_dir()
//         .map_err(|e| e.to_string())?;

//     std::fs::create_dir_all(&doc_dir).map_err(|e| e.to_string())?;
//     let path = doc_dir.join(&filename);
//     std::fs::write(&path, &md).map_err(|e| e.to_string())?;

//     Ok(ExportResult {
//         path: path.to_string_lossy().to_string(),
//         note_count,
//     })
// }

#[tauri::command]
pub fn export_notes(since_ms: i64, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<ExportResult, String> {
    let db_guard = state.db.lock().map_err(|e| e.to_string())?;
    let db = &*db_guard;   // &Database

    let md = db.export_markdown(since_ms)
        .map_err(|e| e.to_string())?;

    let note_count = db.count_notes_since(since_ms)
        .map_err(|e| e.to_string())?;

    // Запись файла
    let date_str = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let filename = format!("spark-export-{}.md", date_str);

    let doc_dir = app.path()
        .document_dir()
        .map_err(|e| e.to_string())?;

    std::fs::create_dir_all(&doc_dir).map_err(|e| e.to_string())?;
    let path = doc_dir.join(&filename);

    std::fs::write(&path, &md).map_err(|e| e.to_string())?;

    Ok(ExportResult {
        path: path.to_string_lossy().to_string(),
        note_count,
    })
}

// ── Sync ──────────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct SyncServerInfo {
    pub address: String,  // "192.168.1.5:PORT"
    pub pin: String,      // "123456" - PIN for guest authorization
}

/// Start the sync HTTP server. Returns the address and PIN to share with the guest.
#[tauri::command]
pub async fn start_sync_server(state: tauri::State<'_, AppState>) -> Result<SyncServerInfo, String> {
    use std::sync::Arc;

    // If already running, stop it first
    {
        let mut handle = state.sync_server.lock().map_err(|e| e.to_string())?;
        if let Some(h) = handle.take() {
            h.stop();
        }
    }

    // Wrap db in Arc for the async server
    // We use a separate connection for the sync server to avoid Mutex contention
    let db_path = state.db_path.clone();
    let db = crate::db::Database::new(&db_path).map_err(|e| e.to_string())?;
    let db_arc = Arc::new(std::sync::Mutex::new(db));

    let server_handle = crate::sync::start_server(db_arc)
        .await
        .map_err(|e| e.to_string())?;

    let port = server_handle.addr.port();
    let ip   = crate::sync::local_ip();
    let addr = format!("{}:{}", ip, port);
    let pin  = server_handle.pin.clone();  // ← NEW: Get PIN from handle

    {
        let mut handle = state.sync_server.lock().map_err(|e| e.to_string())?;
        *handle = Some(server_handle);
    }

    Ok(SyncServerInfo { address: addr, pin })
}

/// Stop the sync server.
#[tauri::command]
pub fn stop_sync_server(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut handle = state.sync_server.lock().map_err(|e| e.to_string())?;
    if let Some(h) = handle.take() {
        h.stop();
    }
    Ok(())
}

/// Connect to a host with PIN, exchange notes, return number of notes received.
#[tauri::command]
pub async fn sync_from_host(host_addr: String, pin: String, state: tauri::State<'_, AppState>) -> Result<usize, String> {
    use std::sync::Arc;

    let db_path = state.db_path.clone();
    let db = crate::db::Database::new(&db_path).map_err(|e| e.to_string())?;
    let db_arc = Arc::new(std::sync::Mutex::new(db));

    let result = crate::sync::sync_as_guest(&host_addr, &pin, db_arc)
        .await
        .map_err(|e| e.to_string())?;

    Ok(result.received)
}