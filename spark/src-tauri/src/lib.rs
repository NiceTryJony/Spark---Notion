mod commands;
mod db;

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
            let db_path = db_dir.join("spark.db");
            let database = db::Database::new(db_path.to_str().unwrap())
                .expect("Failed to open database");
            app.manage(AppState {
                db: Mutex::new(database),
            });

            use tauri_plugin_autostart::ManagerExt;
            let autostart = app.autolaunch();
            if !autostart.is_enabled().unwrap_or(false) {
                let _ = autostart.enable();
            }

            use tauri_plugin_global_shortcut::GlobalShortcutExt;

            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut(
                "CmdOrCtrl+Shift+Space",
                move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(overlay) = handle.get_webview_window("overlay") {
                            let is_visible = overlay.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = overlay.hide();
                            } else {
                                let _ = overlay.center();
                                let _ = overlay.show();
                                let _ = overlay.set_focus();
                            }
                        }
                    }
                },
            )?;

            let handle2 = app.handle().clone();
            app.global_shortcut().on_shortcut(
                "CmdOrCtrl+Shift+L",
                move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(lib) = handle2.get_webview_window("library") {
                            let is_visible = lib.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = lib.set_focus();
                            } else {
                                let _ = lib.show();
                                let _ = lib.set_focus();
                            }
                        }
                    }
                },
            )?;

            let handle3 = app.handle().clone();
            app.global_shortcut().on_shortcut(
                "CmdOrCtrl+Shift+V",
                move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        use tauri_plugin_clipboard_manager::ClipboardExt;
                        if let Ok(text) = handle3.clipboard().read_text() {
                            if !text.trim().is_empty() {
                                let content = text.trim().to_string();
                                let tags = vec!["#clip".to_string()];
                                let state = handle3.state::<AppState>();
                                if let Ok(db) = state.db.lock() {
                                    let _ = db.save_note(&content, &tags);
                                }
                                if let Some(toast) = handle3.get_webview_window("toast") {
                                    let _ = toast.emit("show-toast", &content);
                                    let _ = toast.show();
                                }
                            }
                        }
                    }
                },
            )?;

            let new_note_item = MenuItem::with_id(
                app, "new_note", "New Note       Cmd Or Ctrl+Shift+Space", true, None::<&str>,
            )?;
            let library_item = MenuItem::with_id(
                app, "library", "Open Library   Cmd Or Ctrl+Shift+L", true, None::<&str>,
            )?;
            let sep = PredefinedMenuItem::separator(app)?;
            let autostart_item = MenuItem::with_id(
                app, "toggle_autostart", "Disable Autostart", true, None::<&str>,
            )?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Spark", true, None::<&str>)?;

            let tray_menu = Menu::with_items(
                app,
                &[&new_note_item, &library_item, &sep, &autostart_item, &sep2, &quit_item],
            )?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .tooltip("Spark Notes  Cmd Or Ctrl+Shift+Space")
                .on_menu_event(|app, event| {
                    use tauri_plugin_autostart::ManagerExt;
                    match event.id().as_ref() {
                        "quit" => app.exit(0),
                        "new_note" => {
                            if let Some(w) = app.get_webview_window("overlay") {
                                let _ = w.center();
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "library" => {
                            if let Some(w) = app.get_webview_window("library") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "toggle_autostart" => {
                            let al = app.autolaunch();
                            if al.is_enabled().unwrap_or(false) {
                                let _ = al.disable();
                            } else {
                                let _ = al.enable();
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(false) => {
                if window.label() == "overlay" {
                    let _ = window.hide();
                }
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
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
            commands::reorder_notes,
        ])
        .run(tauri::generate_context!())
        .expect("Error starting Tauri");
}