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

            // Start minimized to tray
            if let Some(window) = app.get_window("main") {
                let _ = window.hide();
            }

            println!("🚀 ScreenAI running in system tray");
            println!("   Alt+Shift+S → Capture screen");
            println!("   Alt+Shift+A → Capture region");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![capture_screen, capture_region])
        .run(tauri::generate_context!())
        .expect("Error running ScreenAI");
}
