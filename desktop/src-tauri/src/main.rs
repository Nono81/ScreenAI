// ============================================
// ScreenAI Desktop — Tauri Backend
// ============================================

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::Serialize;
use std::process::Command;
use tauri::{
    AppHandle, GlobalShortcutManager, Manager, SystemTray, SystemTrayEvent,
    SystemTrayMenu, SystemTrayMenuItem, CustomMenuItem,
};

#[derive(Clone, Serialize)]
struct CapturePayload {
    data_url: String,
    mode: String,
}

#[derive(Clone, Serialize)]
struct UpdateInfo {
    available: bool,
    version: String,
    body: String,
    date: String,
}

/// Capture the screen using the native OS tool.
/// macOS: uses `screencapture` CLI (reliable, handles permissions natively)
/// Windows/Linux: uses the `screenshots` crate as fallback
fn native_capture(mode: &str) -> Result<CapturePayload, String> {
    let tmp_path = std::env::temp_dir().join("screenai_capture.png");
    let tmp_str = tmp_path.to_str().ok_or("Invalid temp path")?;

    #[cfg(target_os = "macos")]
    {
        // -x = no sound, -C = capture cursor, -t png = format
        // -i = interactive selection (for region mode)
        let args = if mode == "region" {
            vec!["-x", "-i", "-t", "png", tmp_str]
        } else {
            vec!["-x", "-t", "png", tmp_str]
        };

        let output = Command::new("screencapture")
            .args(&args)
            .output()
            .map_err(|e| format!("Failed to run screencapture: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("screencapture failed: {}", stderr));
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Fallback for Windows/Linux using screenshots crate
        use screenshots::Screen;
        use screenshots::image::ImageOutputFormat;
        use std::io::Cursor;

        let screens = Screen::all().map_err(|e| e.to_string())?;
        let screen = screens.first().ok_or("No screen found")?;
        let image = screen.capture().map_err(|e| e.to_string())?;

        let mut buf = Cursor::new(Vec::new());
        image.write_to(&mut buf, ImageOutputFormat::Png)
            .map_err(|e| e.to_string())?;

        std::fs::write(&tmp_path, buf.into_inner())
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
    }

    // Read the PNG file and convert to base64 data URL
    if !tmp_path.exists() {
        return Err("Capture was cancelled or failed".to_string());
    }

    let png_bytes = std::fs::read(&tmp_path)
        .map_err(|e| format!("Failed to read capture: {}", e))?;

    // Clean up temp file
    let _ = std::fs::remove_file(&tmp_path);

    if png_bytes.is_empty() {
        return Err("Capture produced empty file".to_string());
    }

    let base64_data = BASE64.encode(&png_bytes);
    let data_url = format!("data:image/png;base64,{}", base64_data);

    Ok(CapturePayload {
        data_url,
        mode: mode.to_string(),
    })
}

// Capture the primary screen
#[tauri::command]
fn capture_screen() -> Result<CapturePayload, String> {
    native_capture("fullscreen")
}

// Capture a region (interactive selection on macOS)
#[tauri::command]
fn capture_region() -> Result<CapturePayload, String> {
    native_capture("region")
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
    match native_capture(mode) {
        Ok(payload) => {
            if let Some(window) = app.get_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.emit("shortcut-capture", &payload);
            }
        }
        Err(e) => {
            eprintln!("Screen capture failed: {}", e);
            if let Some(window) = app.get_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                // Notify frontend of the error
                let _ = window.emit("capture-error", &e);
            }
        }
    }
}

fn main() {
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
