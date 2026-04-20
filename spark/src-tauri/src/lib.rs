mod commands;
mod db;
mod sync;
mod url_title;

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::ShortcutState;

pub struct AppState {
    pub db: Mutex<db::Database>,
    pub db_path: String,
    pub sync_server: Mutex<Option<sync::SyncServerHandle>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let db_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&db_dir)?;
            let db_path     = db_dir.join("spark.db");
            let db_path_str = db_path.to_str().unwrap().to_string();
            let database    = db::Database::new(&db_path_str).expect("Failed to open database");

            app.manage(AppState {
                db: Mutex::new(database),
                db_path: db_path_str,
                sync_server: Mutex::new(None),
            });

            use tauri_plugin_autostart::ManagerExt;
            if !app.autolaunch().is_enabled().unwrap_or(false) {
                let _ = app.autolaunch().enable();
            }

            use tauri_plugin_global_shortcut::GlobalShortcutExt;

            // ── Ctrl+Shift+Space → toggle overlay ──────────────────────────
            let h = app.handle().clone();
            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+Space", move |_, _, event| {
                if event.state() == ShortcutState::Pressed {
                    if let Some(w) = h.get_webview_window("overlay") {
                        if w.is_visible().unwrap_or(false) { let _ = w.hide(); }
                        else { let _ = w.center(); let _ = w.show(); let _ = w.set_focus(); }
                    }
                }
            })?;

            // ── Ctrl+Shift+L → show library ────────────────────────────────
            let h2 = app.handle().clone();
            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+L", move |_, _, event| {
                if event.state() == ShortcutState::Pressed {
                    if let Some(w) = h2.get_webview_window("library") {
                        if w.is_visible().unwrap_or(false) { let _ = w.set_focus(); }
                        else { let _ = w.show(); let _ = w.set_focus(); }
                    }
                }
            })?;

            // ── Ctrl+Shift+V → Smart Paste ─────────────────────────────────
            //
            // Behaviour:
            //   - Plain text  → save as-is with extracted tags
            //   - URL         → try to fetch <title> asynchronously
            //                   success  → "Title — url  #link"
            //                   timeout/fail → "url  #link"   (plain fallback)
            //   - Both cases show a toast after saving
            let h3 = app.handle().clone();
            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+V", move |_, _, event| {
                if event.state() != ShortcutState::Pressed { return; }

                use tauri_plugin_clipboard_manager::ClipboardExt;
                let text = match h3.clipboard().read_text() {
                    Ok(t) if !t.trim().is_empty() => t.trim().to_string(),
                    _ => return,
                };

                let h3_clone = h3.clone();

                // Spawn an async task so we don't block the shortcut thread
                tauri::async_runtime::spawn(async move {
                    let (content, tags) = if url_title::looks_like_url(&text) {
                        // Try to fetch the page title (5 s timeout built into fetch_url_title)
                        let title = url_title::fetch_url_title(&text).await;
                        let content = match title {
                            Some(t) => format!("{} — {}", t, text),
                            None    => text.clone(),
                        };
                        (content, vec!["#link".to_string()])
                    } else {
                        // Plain text — use normal tag extraction
                        let tags = extract_tags_simple(&text);
                        (text.clone(), tags)
                    };

                    // Save to DB
                    let state = h3_clone.state::<AppState>();
                    if let Ok(db) = state.db.lock() {
                        let _ = db.save_note(&content, &tags);
                    }

                    // Show toast
                    if let Some(toast) = h3_clone.get_webview_window("toast") {
                        let app_handle = h3_clone.clone();   // h3_clone уже AppHandle
                        // 1. Эмитим глобальное событие "notes-updated" (чтобы фронтенд обновил список заметок)
                        let _ = app_handle.emit("notes-updated", ());   // () — пустой payload
                        let _ = toast.show();
                        #[derive(serde::Serialize, Clone)]
                        struct ToastPayload { content: String, tag: String }
                        let _ = toast.emit("show-toast", ToastPayload {
                           content, tag: tags.first().cloned().unwrap_or_default()
                        });
                    }
                });
            })?;

            // ── System tray ────────────────────────────────────────────────
            let new_note_item  = MenuItem::with_id(app, "new_note",          "New Note       Ctrl+Shift+Space", true, None::<&str>)?;
            let library_item   = MenuItem::with_id(app, "library",           "Open Library   Ctrl+Shift+L",     true, None::<&str>)?;
            let sep            = PredefinedMenuItem::separator(app)?;
            let autostart_item = MenuItem::with_id(app, "toggle_autostart",  "Disable Autostart",               true, None::<&str>)?;
            let sep2           = PredefinedMenuItem::separator(app)?;
            let quit_item      = MenuItem::with_id(app, "quit",              "Quit Spark",                      true, None::<&str>)?;

            let tray_menu = Menu::with_items(app, &[&new_note_item, &library_item, &sep, &autostart_item, &sep2, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .tooltip("Spark Notes  Ctrl+Shift+Space")
                .on_menu_event(|app, event| {
                    use tauri_plugin_autostart::ManagerExt;
                    match event.id().as_ref() {
                        "quit"             => app.exit(0),
                        "new_note"         => { if let Some(w) = app.get_webview_window("overlay")  { let _ = w.center(); let _ = w.show(); let _ = w.set_focus(); } }
                        "library"          => { if let Some(w) = app.get_webview_window("library")  { let _ = w.show();   let _ = w.set_focus(); } }
                        "toggle_autostart" => {
                            let al = app.autolaunch();
                            if al.is_enabled().unwrap_or(false) { let _ = al.disable(); }
                            else { let _ = al.enable(); }
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::save_note,
            commands::get_notes,
            commands::search_notes,
            commands::delete_note,
            commands::update_note,
            commands::get_all_tags,
            commands::show_library,
            commands::pin_note,
            commands::toggle_checked,
            commands::export_notes,
            commands::start_sync_server,
            commands::stop_sync_server,
            commands::sync_from_host,
        ])
        .run(tauri::generate_context!())
        .expect("Error starting Tauri");
}

// ── Tag extraction mini-helper for clipboard text ─────────────────────────────
// We can't call the JS extractTags() from Rust, so we mirror the most important
// keyword checks here for the plain-text paste path.
fn extract_tags_simple(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut tags: Vec<&str> = vec![];

    // Explicit #hashtags typed in the text
    let explicit: Vec<String> = {
        let mut found = vec![];
        let mut i = 0;
        let bytes = text.as_bytes();
        while i < bytes.len() {
            if bytes[i] == b'#' {
                let start = i + 1;
                let end = bytes[start..]
                    .iter()
                    .position(|&b| !b.is_ascii_alphanumeric() && b != b'_')
                    .map(|p| start + p)
                    .unwrap_or(bytes.len());
                if end > start {
                    found.push(format!("#{}", &text[start..end].to_lowercase()));
                }
                i = end;
            } else {
                i += 1;
            }
        }
        found
    };

    // Simple keyword checks (subset)
    if lower.contains("todo") || lower.contains("сделать") || lower.contains("нужно") { tags.push("#todo"); }
    if lower.contains("http://") || lower.contains("https://") || lower.contains("www.") { tags.push("#link"); }
    if lower.contains("купить") || lower.contains("buy") || lower.contains("заказать") { tags.push("#buy"); }
    if lower.contains("идея") || lower.contains("idea") || lower.contains("мысль") { tags.push("#idea"); }
    if lower.contains("работа") || lower.contains("work") || lower.contains("проект") { tags.push("#work"); }
    if lower.contains("#clip") { tags.push("#clip"); }

    let mut result: Vec<String> = tags.iter().map(|s| s.to_string()).collect();
    result.extend(explicit);
    result.sort();
    result.dedup();
    result
}