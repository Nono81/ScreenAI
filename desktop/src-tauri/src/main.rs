// ============================================
// ScreenAI Desktop — Tauri Backend
// ============================================

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use screenshots::image::ImageOutputFormat;
use screenshots::Screen;
use serde::Serialize;
use std::io::Cursor;
use tauri::{
    AppHandle, GlobalShortcutManager, Manager, SystemTray, SystemTrayEvent,
    SystemTrayMenu, SystemTrayMenuItem, CustomMenuItem,
};

#[derive(Clone, Serialize)]
struct CapturePayload {
    data_url: String,
    width: u32,
    height: u32,
    mode: String,
}

#[derive(Clone, Serialize)]
struct UpdateInfo {
    available: bool,
    version: String,
    body: String,
    date: String,
}

// Capture the primary screen and return as base64 PNG
#[tauri::command]
fn capture_screen() -> Result<CapturePayload, String> {
    let screens = Screen::all().map_err(|e| e.to_string())?;
    let screen = screens.first().ok_or("No screen found")?;

    let image = screen.capture().map_err(|e| e.to_string())?;
    let width = image.width();
    let height = image.height();

    let mut buf = Cursor::new(Vec::new());
    image
        .write_to(&mut buf, ImageOutputFormat::Png)
        .map_err(|e| e.to_string())?;

    let base64_data = BASE64.encode(buf.into_inner());
    let data_url = format!("data:image/png;base64,{}", base64_data);

    Ok(CapturePayload {
        data_url,
        width,
        height,
        mode: "fullscreen".to_string(),
    })
}

// Capture a specific region
#[tauri::command]
fn capture_region(x: i32, y: i32, w: u32, h: u32) -> Result<CapturePayload, String> {
    let screens = Screen::all().map_err(|e| e.to_string())?;
    let screen = screens.first().ok_or("No screen found")?;

    let image = screen
        .capture_area(x, y, w, h)
        .map_err(|e| e.to_string())?;

    let width = image.width();
    let height = image.height();

    let mut buf = Cursor::new(Vec::new());
    image
        .write_to(&mut buf, ImageOutputFormat::Png)
        .map_err(|e| e.to_string())?;

    let base64_data = BASE64.encode(buf.into_inner());
    let data_url = format!("data:image/png;base64,{}", base64_data);

    Ok(CapturePayload {
        data_url,
        width,
        height,
        mode: "region".to_string(),
    })
}

// Return app version from tauri.conf.json
#[tauri::command]
fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

// Check for updates — returns not available when updater is disabled
#[tauri::command]
async fn check_for_updates(_app: AppHandle) -> Result<UpdateInfo, String> {
    Ok(UpdateInfo {
        available: false,
        version: String::new(),
        body: String::new(),
        date: String::new(),
    })
}

// Install update — no-op when updater is disabled
#[tauri::command]
async fn install_update(_app: AppHandle) -> Result<(), String> {
    Err("Updater is not configured yet".to_string())
}

/// Capture screen via global shortcut and send result to the main window
fn shortcut_capture(app: &AppHandle, mode: &str) {
    let capture_result = if mode == "region" {
        // For region, we still capture fullscreen for now
        // (region selection will be done in the frontend)
        capture_screen()
    } else {
        capture_screen()
    };

    match capture_result {
        Ok(payload) => {
            // Show main window and bring to front
            if let Some(window) = app.get_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                // Send capture to the frontend
                let _ = window.emit("shortcut-capture", &payload);
            }
        }
        Err(e) => {
            eprintln!("Screen capture failed: {}", e);
            // Still show the window even if capture fails
            if let Some(window) = app.get_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    }
}

fn main() {
    // System tray menu
    let tray_menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("capture", "📸 Capture (Alt+Shift+S)"))
        .add_item(CustomMenuItem::new("capture_region", "✂️ Region (Alt+Shift+A)"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("show", "Open ScreenAI"))
        .add_item(CustomMenuItem::new("quit", "Quit"));

    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| {
            match event {
                SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                    "capture" => shortcut_capture(app, "fullscreen"),
                    "capture_region" => shortcut_capture(app, "region"),
                    "show" => {
                        if let Some(window) = app.get_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => std::process::exit(0),
                    _ => {}
                },
                SystemTrayEvent::LeftClick { .. } => {
                    // Left click on tray icon → show main window
                    if let Some(window) = app.get_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            let handle = app.handle();

            // Register global shortcuts
            let handle_fs = handle.clone();
            app.global_shortcut_manager()
                .register("Alt+Shift+S", move || {
                    shortcut_capture(&handle_fs, "fullscreen");
                })
                .expect("Failed to register fullscreen shortcut");

            let handle_rg = handle.clone();
            app.global_shortcut_manager()
                .register("Alt+Shift+A", move || {
                    shortcut_capture(&handle_rg, "region");
                })
                .expect("Failed to register region shortcut");

            // Show main window on startup
            if let Some(window) = app.get_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            println!("🚀 ScreenAI running in system tray");
            println!("   Alt+Shift+S → Capture screen");
            println!("   Alt+Shift+A → Capture region");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture_screen,
            capture_region,
            get_app_version,
            check_for_updates,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("Error running ScreenAI");
}
