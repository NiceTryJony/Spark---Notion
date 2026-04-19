use crate::db::Note;
use crate::AppState;
use tauri::{Manager, State};

#[tauri::command]
pub fn save_note(content: String, tags: Vec<String>, state: State<'_, AppState>) -> Result<Note, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.save_note(&content, &tags).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_notes(tag: Option<String>, state: State<'_, AppState>) -> Result<Vec<Note>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_notes(tag.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_notes(query: String, state: State<'_, AppState>) -> Result<Vec<Note>, String> {
    if query.trim().is_empty() {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        return db.get_notes(None).map_err(|e| e.to_string());
    }
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.search_notes(&query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_note(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_note(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_note(id: i64, content: String, tags: Vec<String>, state: State<'_, AppState>) -> Result<Note, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_note(id, &content, &tags).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_tags(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_library(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("library") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pin_note(id: i64, pinned: bool, state: State<'_, AppState>) -> Result<Note, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.pin_note(id, pinned).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_checked(id: i64, checked: bool, state: State<'_, AppState>) -> Result<Note, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.toggle_checked(id, checked).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_notes(ids: Vec<i64>, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.reorder_notes(&ids).map_err(|e| e.to_string())
}