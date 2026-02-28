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
    SystemTrayMenu, SystemTrayMenuItem, CustomMenuItem, WindowBuilder, WindowUrl,
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

    // Convert to PNG bytes
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

// Check for updates from GitHub Releases
#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<UpdateInfo, String> {
    match app.updater().check().await {
        Ok(update) => {
            if update.is_update_available() {
                Ok(UpdateInfo {
                    available: true,
                    version: update.latest_version().to_string(),
                    body: update.body().unwrap_or(&String::new()).to_string(),
                    date: update.date().map(|d| d.to_string()).unwrap_or_default(),
                })
            } else {
                Ok(UpdateInfo {
                    available: false,
                    version: String::new(),
                    body: String::new(),
                    date: String::new(),
                })
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

// Download and install an update, then restart
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    match app.updater().check().await {
        Ok(update) => {
            if update.is_update_available() {
                update.download_and_install().await.map_err(|e| e.to_string())?;
                Ok(())
            } else {
                Err("No update available".to_string())
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

fn create_overlay_window(app: &AppHandle, _mode: &str) {
    // Hide main window, show overlay
    if let Some(main_window) = app.get_window("main") {
        let _ = main_window.hide();
    }

    // Small delay to let the window hide
    std::thread::sleep(std::time::Duration::from_millis(200));

    // Capture screen
    match capture_screen() {
        Ok(payload) => {
            // Create or show the overlay window
            if let Some(overlay) = app.get_window("overlay") {
                let _ = overlay.show();
                let _ = overlay.set_focus();
                let _ = overlay.emit("capture", &payload);
            } else {
                let overlay = WindowBuilder::new(
                    app,
                    "overlay",
                    WindowUrl::App("index.html".into()),
                )
                .title("ScreenAI — Capture")
                .fullscreen(true)
                .decorations(false)
                .always_on_top(true)
                .build();

                if let Ok(window) = overlay {
                    let payload_clone = payload.clone();
                    // Wait for window to load, then send capture
                    let win = window.clone();
                    window.once("ready", move |_event: tauri::Event| {
                        let _ = win.emit("capture", &payload_clone);
                    });
                }
            }
        }
        Err(e) => {
            eprintln!("Screen capture failed: {}", e);
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
                    "capture" => create_overlay_window(app, "fullscreen"),
                    "capture_region" => create_overlay_window(app, "region"),
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
                    create_overlay_window(app, "fullscreen");
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
                    create_overlay_window(&handle_fs, "fullscreen");
                })
                .expect("Failed to register fullscreen shortcut");

            let handle_rg = handle.clone();
            app.global_shortcut_manager()
                .register("Alt+Shift+A", move || {
                    create_overlay_window(&handle_rg, "region");
                })
                .expect("Failed to register region shortcut");

            // Show main window on startup
            if let Some(window) = app.get_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Auto-check for updates in background (after 5s delay)
            let update_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                match update_handle.updater().check().await {
                    Ok(update) => {
                        if update.is_update_available() {
                            let info = UpdateInfo {
                                available: true,
                                version: update.latest_version().to_string(),
                                body: update.body().unwrap_or(&String::new()).to_string(),
                                date: update.date().map(|d| d.to_string()).unwrap_or_default(),
                            };
                            if let Some(window) = update_handle.get_window("main") {
                                let _ = window.emit("update-available", &info);
                            }
                        }
                    }
                    Err(e) => eprintln!("Update check failed: {}", e),
                }
            });

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
