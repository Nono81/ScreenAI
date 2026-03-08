// ============================================
// ScreenAI Desktop — Tauri Backend
// ============================================

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use reqwest;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::Serialize;
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

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let tmp_str = tmp_path.to_str().ok_or("Invalid temp path")?;
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
        let di = screen.display_info;
        eprintln!("[ScreenAI] Screen: {}x{} (scale_factor: {})", di.width, di.height, di.scale_factor);
        let image = screen.capture().map_err(|e| e.to_string())?;
        eprintln!("[ScreenAI] Captured image: {}x{}", image.width(), image.height());

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

// Capture fullscreen — hides app window first so it does not appear in screenshot
#[tauri::command]
async fn capture_screen(app: AppHandle) -> Result<CapturePayload, String> {
    if let Some(window) = app.get_window("main") { let _ = window.hide(); }
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    let result = native_capture("fullscreen");
    if let Some(window) = app.get_window("main") { let _ = window.show(); let _ = window.set_focus(); }
    result
}

// Capture region — hides app window first
#[tauri::command]
async fn capture_region(app: AppHandle) -> Result<CapturePayload, String> {
    if let Some(window) = app.get_window("main") { let _ = window.hide(); }
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let result = native_capture("region");
    if let Some(window) = app.get_window("main") { let _ = window.show(); let _ = window.set_focus(); }
    result
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

/// Web search via DuckDuckGo — runs from Rust to bypass CORS restrictions in WebView2
#[tauri::command]
async fn web_search(query: String) -> String {
    let url = format!(
        "https://html.duckduckgo.com/html/?q={}",
        query.chars().take(300).collect::<String>().replace(' ', "+")
    );
    let client = match reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0")
        .build() {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    let html = match client.get(&url).send().await {
        Ok(r) => match r.text().await { Ok(t) => t, Err(_) => return String::new() },
        Err(_) => return String::new(),
    };
    let results = extract_ddg_results(&html);
    if results.is_empty() { return String::new(); }
    let q = if query.len() > 80 { &query[..80] } else { &query };
    format!("[Web: {}]
{}

", q, results.join("
"))
}

fn decode_html_entities(s: &str) -> String {
    let q = char::from(34);
    let a = char::from(39);
    s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
     .replace("&quot;", &q.to_string()).replace("&#39;", &a.to_string()).replace("&nbsp;", " ")
}

fn extract_ddg_results(html: &str) -> Vec<String> {
    let mut results = Vec::new();
    let mut pos = 0usize;
    while results.len() < 5 && pos < html.len() {
        let rest = &html[pos..];
        let Some(rel) = rest.find("class=\"result__a") else { break };
        let base = pos + rel;
        // Extract title text between > and </a>
        let after_marker = &html[base..];
        let Some(tag_end) = after_marker.find('>') else { pos = base + 1; continue };
        let title_start = base + tag_end + 1;
        let title = if let Some(close) = html[title_start..].find("</a>") {
            decode_html_entities(html[title_start..title_start + close].trim())
        } else { pos = base + 1; continue };
        // Find snippet within next 3000 chars
        let lookahead = &html[base..(base + 3000).min(html.len())];
        let snippet = if let Some(sr) = lookahead.find("class=\"result__snippet") {
            let sp = &lookahead[sr..];
            if let Some(te) = sp.find('>') {
                let ss = &sp[te+1..];
                if let Some(ce) = ss.find("</a>") {
                    decode_html_entities(ss[..ce].trim())
                } else { String::new() }
            } else { String::new() }
        } else { String::new() };
        if !title.is_empty() {
            if !snippet.is_empty() {
                results.push(format!("- {}: {}", title, snippet));
            } else {
                results.push(format!("- {}", title));
            }
        }
        pos = base + 1;
    }
    results
}



/// Simple non-streaming Claude call — used for background tasks (e.g. memory detection)
#[tauri::command]
async fn call_claude_simple(
    api_key: String,
    model: String,
    messages_json: String,
    system: String,
    max_tokens: u32,
) -> Result<String, String> {
    let messages: serde_json::Value = serde_json::from_str(&messages_json)
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "stream": false,
        "temperature": 0,
        "system": system,
        "messages": messages,
    });

    let client = reqwest::Client::builder()
        .user_agent("ScreenAI/1.4")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let err_text = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, err_text));
    }

    let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(data["content"][0]["text"].as_str().unwrap_or("[]").to_string())
}

/// Call Claude API from Rust — bypasses WebView2 CORS entirely
#[tauri::command]
async fn invoke_claude(
    app: AppHandle,
    api_key: String,
    model: String,
    messages_json: String,
    system: String,
    max_tokens: u32,
    request_id: String,
    tools_json: String,
) -> Result<(), String> {
    let window = app.get_window("main").ok_or_else(|| "No window".to_string())?;

    let messages: serde_json::Value = serde_json::from_str(&messages_json)
        .map_err(|e| e.to_string())?;

    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "stream": true,
        "temperature": 0,
        "system": system,
        "messages": messages,
    });

    if !tools_json.is_empty() {
        if let Ok(tools) = serde_json::from_str::<serde_json::Value>(&tools_json) {
            body["tools"] = tools;
        }
    }


    let client = reqwest::Client::builder()
        .user_agent("ScreenAI/1.4")
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json");

    if !tools_json.is_empty() {
        req = req.header("anthropic-beta", "web-search-2025-03-05");
    }

    let mut response = req
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let err_text = response.text().await.unwrap_or_default();
        let err_msg = serde_json::from_str::<serde_json::Value>(&err_text)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| format!("API error {}", status));
        return Err(err_msg);
    }

    let mut buffer = String::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let data: Vec<u8> = chunk.to_vec();
                buffer.push_str(&String::from_utf8_lossy(&data));
                loop {
                    match buffer.find('\n') {
                        Some(pos) => {
                            let line = buffer[..pos].trim().to_string();
                            buffer = buffer[pos + 1..].to_string();
                            if line.starts_with("data: ") {
                                let data = line[6..].trim();
                                if data == "[DONE]" { continue; }
                                if let Ok(ev) = serde_json::from_str::<serde_json::Value>(data) {
                                    if ev["type"].as_str() == Some("content_block_delta") {
                                        if let Some(text) = ev["delta"]["text"].as_str() {
                                            let _ = window.emit("claude-chunk", serde_json::json!({"rid": &request_id, "text": text}));
                                        }
                                    }
                                }
                            }
                        }
                        None => break,
                    }
                }
            }
            Ok(None) => break,
            Err(e) => return Err(e.to_string()),
        }
    }

    let _ = window.emit("claude-done", serde_json::json!({"rid": &request_id}));
    Ok(())
}

/// Toggle fullscreen + decorations (used for Snipping Tool style overlay)
#[tauri::command]
async fn set_fullscreen(app: AppHandle, fullscreen: bool) {
    if let Some(window) = app.get_window("main") {
        let _ = window.set_fullscreen(fullscreen);
        let _ = window.set_decorations(!fullscreen);
    }
}

/// Pending capture data for the overlay window to retrieve
static PENDING_CAPTURE: std::sync::Mutex<Option<(String, String)>> = std::sync::Mutex::new(None);

/// Open a separate fullscreen overlay window for capture (toolbar or direct region).
/// The main window stays hidden — only the overlay appears.
fn open_capture_overlay(app: &AppHandle, mode: &str) {
    let app_clone = app.clone();
    let mode_str = mode.to_string();
    tauri::async_runtime::spawn(async move {
        // Hide main window so it doesn't appear in the screenshot
        if let Some(window) = app_clone.get_window("main") {
            let _ = window.hide();
        }
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;

        match native_capture("fullscreen") {
            Ok(payload) => {
                // Store capture data for the overlay to retrieve
                if let Ok(mut pending) = PENDING_CAPTURE.lock() {
                    *pending = Some((mode_str.clone(), payload.data_url));
                }

                // Close existing overlay if any
                if let Some(old) = app_clone.get_window("capture-overlay") {
                    let _ = old.close();
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                }

                // Create fullscreen overlay window (no decorations, always on top)
                if let Err(e) = tauri::WindowBuilder::new(
                    &app_clone,
                    "capture-overlay",
                    tauri::WindowUrl::App("index.html".into())
                )
                .title("ScreenAI Capture")
                .decorations(false)
                .always_on_top(true)
                .fullscreen(true)
                .skip_taskbar(true)
                .build() {
                    eprintln!("Failed to create capture overlay: {}", e);
                    if let Some(w) = app_clone.get_window("main") {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            }
            Err(e) => {
                if let Some(w) = app_clone.get_window("main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                    let _ = w.emit("capture-error", &e);
                }
            }
        }
    });
}

/// Show the capture toolbar overlay — used by Alt+Shift+S
fn show_capture_toolbar(app: &AppHandle) {
    open_capture_overlay(app, "toolbar");
}

/// Tauri command to open capture overlay from JS
#[tauri::command]
fn open_capture_overlay_cmd(app: AppHandle, mode: String) {
    open_capture_overlay(&app, &mode);
}

#[tauri::command]
fn get_window_label(window: tauri::Window) -> String {
    window.label().to_string()
}

#[tauri::command]
fn get_pending_capture() -> Result<serde_json::Value, String> {
    let mut pending = PENDING_CAPTURE.lock().map_err(|e| e.to_string())?;
    match pending.take() {
        Some((mode, data_url)) => Ok(serde_json::json!({"mode": mode, "dataUrl": data_url})),
        None => Err("No pending capture".to_string()),
    }
}

#[tauri::command]
async fn send_capture_to_main(app: AppHandle, data_url: String, mode: String) -> Result<(), String> {
    if let Some(overlay) = app.get_window("capture-overlay") {
        let _ = overlay.close();
    }
    if let Some(window) = app.get_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("shortcut-capture", CapturePayload { data_url, mode });
    }
    Ok(())
}

#[tauri::command]
async fn close_capture_overlay(app: AppHandle) {
    if let Some(overlay) = app.get_window("capture-overlay") {
        let _ = overlay.close();
    }
    if let Some(window) = app.get_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Share a file using the native OS share dialog (Windows)
#[tauri::command]
async fn share_native(file_path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // Use PowerShell to open the Windows share dialog
        let escaped = file_path.replace("'", "''");
        let script = format!(
            "[Windows.ApplicationModel.DataTransfer.DataTransferManager, Windows.ApplicationModel.DataTransfer, ContentType=WindowsRuntime] > $null; \
             $file = [Windows.Storage.StorageFile]::GetFileFromPathAsync('{}').GetAwaiter().GetResult(); \
             $dto = [Windows.ApplicationModel.DataTransfer.DataTransferManager]::GetForCurrentView(); \
             # Fallback: open share via explorer context menu",
            escaped
        );
        // Simpler approach: use explorer shell verb
        match Command::new("rundll32.exe")
            .args(["shell32.dll,OpenAs_RunDLL", &file_path])
            .spawn()
        {
            Ok(_) => {},
            Err(_) => {
                // Fallback: open the file location
                let _ = Command::new("explorer.exe")
                    .args(["/select,", &file_path])
                    .spawn();
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let _ = Command::new("open")
            .args(["-a", "Finder", &file_path])
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let _ = Command::new("xdg-open")
            .arg(&file_path)
            .spawn();
    }
    Ok(())
}

/// Update a global shortcut: unregister the old one and register the new one.
/// `action` is one of: "captureFullscreen" (opens toolbar), "captureRegion", "captureWindow"
#[tauri::command]
fn update_shortcut(app_handle: AppHandle, old_shortcut: String, new_shortcut: String, action: String) -> Result<(), String> {
    let mut manager = app_handle.global_shortcut_manager();

    // Unregister old shortcut (ignore errors — it may not exist)
    if !old_shortcut.is_empty() {
        let _ = manager.unregister(&old_shortcut);
    }

    // Register new shortcut
    let handle = app_handle.clone();
    let act = action.clone();
    manager.register(&new_shortcut, move || {
        match act.as_str() {
            "captureFullscreen" => open_capture_overlay(&handle, "toolbar"),
            "captureRegion" => open_capture_overlay(&handle, "region"),
            "captureWindow" => open_capture_overlay(&handle, "window"),
            _ => {}
        }
    }).map_err(|e| format!("Impossible d'enregistrer le raccourci {}: {}", new_shortcut, e))?;

    Ok(())
}


#[tauri::command]
async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Cannot read {}: {}", path, e))
}

/// Convert unix days since epoch to (year, month, day)
fn unix_days_to_date(days: u64) -> (u64, u64, u64) {
    // Civil date algorithm from https://howardhinnant.github.io/date_algorithms.html
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

/// Get the dedicated ScreenAI captures directory (~/Documents/ScreenAI/Captures/)
fn get_screenai_captures_dir() -> std::path::PathBuf {
    let base = dirs::document_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| std::env::temp_dir()));
    let captures_dir = base.join("ScreenAI").join("Captures");
    std::fs::create_dir_all(&captures_dir).ok();
    captures_dir
}

/// Save annotated capture to a temp file and return its path
#[tauri::command]
fn save_temp_capture(data: Vec<u8>) -> Result<String, String> {
    let captures_dir = get_screenai_captures_dir();
    // Use a human-readable timestamp for the filename
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Format as ScreenAI_YYYY-MM-DD_HH-MM-SS.png
    let secs_since_midnight = now % 86400;
    let hours = secs_since_midnight / 3600;
    let minutes = (secs_since_midnight % 3600) / 60;
    let seconds = secs_since_midnight % 60;
    // Simple date calc from unix timestamp
    let days = now / 86400;
    let (year, month, day) = unix_days_to_date(days);
    let filename = format!("ScreenAI_{}-{:02}-{:02}_{:02}-{:02}-{:02}.png", year, month, day, hours, minutes, seconds);
    let path = captures_dir.join(&filename);
    std::fs::write(&path, &data)
        .map_err(|e| format!("Erreur ecriture fichier temp: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/// Reveal a file in Windows Explorer (select it)
#[tauri::command]
fn reveal_in_explorer(path: String) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn();
    }
}

/// Save bytes to an arbitrary path (used for PDF export + image save from overlay)
#[tauri::command]
fn write_file_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &data)
        .map_err(|e| format!("Erreur ecriture: {}", e))
}

/// Clean up old ScreenAI captures (older than 24 hours)
#[tauri::command]
fn cleanup_temp_captures() -> u32 {
    let captures_dir = get_screenai_captures_dir();
    let mut removed = 0u32;
    if let Ok(entries) = std::fs::read_dir(&captures_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("ScreenAI_") && name.ends_with(".png") {
                if let Ok(meta) = entry.metadata() {
                    if let Ok(modified) = meta.modified() {
                        let age = std::time::SystemTime::now()
                            .duration_since(modified)
                            .unwrap_or_default();
                        if age.as_secs() > 86400 {
                            let _ = std::fs::remove_file(entry.path());
                            removed += 1;
                        }
                    }
                }
            }
        }
    }
    removed
}

/// OCR: decode data URL to a temp PNG, run tesseract CLI, return text
#[tauri::command]
fn ocr_extract(image_data_url: String) -> Result<String, String> {
    // Strip data URL prefix
    let b64 = image_data_url
        .find(",")
        .map(|i| &image_data_url[i + 1..])
        .unwrap_or(&image_data_url);

    let bytes = BASE64.decode(b64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    let tmp_dir = std::env::temp_dir().join("screenai-ocr");
    let _ = std::fs::create_dir_all(&tmp_dir);
    let input_path = tmp_dir.join("ocr_input.png");
    let output_path = tmp_dir.join("ocr_output");

    std::fs::write(&input_path, &bytes)
        .map_err(|e| format!("Write temp file error: {}", e))?;

    // Run tesseract CLI
    let result = std::process::Command::new("tesseract")
        .arg(input_path.to_string_lossy().to_string())
        .arg(output_path.to_string_lossy().to_string())
        .arg("-l").arg("eng+fra")
        .output();

    match result {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Tesseract error: {}", stderr));
            }
            // tesseract writes to output_path.txt
            let txt_path = tmp_dir.join("ocr_output.txt");
            let text = std::fs::read_to_string(&txt_path)
                .map_err(|e| format!("Read OCR result error: {}", e))?;
            // Cleanup
            let _ = std::fs::remove_file(&input_path);
            let _ = std::fs::remove_file(&txt_path);
            Ok(text)
        }
        Err(_) => {
            // tesseract CLI not installed — let JS handle it with tesseract.js
            let _ = std::fs::remove_file(&input_path);
            Err("tesseract_not_found".to_string())
        }
    }
}

/// List visible windows with their screen positions (for window capture mode)
#[tauri::command]
fn list_windows() -> Vec<serde_json::Value> {
    let mut windows = Vec::new();

    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;

        #[link(name = "user32")]
        extern "system" {
            fn EnumWindows(lpEnumFunc: unsafe extern "system" fn(isize, isize) -> i32, lParam: isize) -> i32;
            fn IsWindowVisible(hWnd: isize) -> i32;
            fn GetWindowTextW(hWnd: isize, lpString: *mut u16, nMaxCount: i32) -> i32;
            fn GetWindowRect(hWnd: isize, lpRect: *mut [i32; 4]) -> i32;
            fn GetWindowLongW(hWnd: isize, nIndex: i32) -> i32;
        }

        static mut WIN_LIST: Vec<serde_json::Value> = Vec::new();

        unsafe extern "system" fn enum_cb(hwnd: isize, _: isize) -> i32 {
            if IsWindowVisible(hwnd) == 0 { return 1; }

            // Skip tool windows, popups, etc.
            let ex_style = GetWindowLongW(hwnd, -20); // GWL_EXSTYLE
            if ex_style & 0x00000080 != 0 { return 1; } // WS_EX_TOOLWINDOW

            let mut title_buf = [0u16; 256];
            let len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 256);
            if len <= 0 { return 1; }
            let title = OsString::from_wide(&title_buf[..len as usize]).to_string_lossy().to_string();
            if title.is_empty() { return 1; }

            let mut rect = [0i32; 4];
            GetWindowRect(hwnd, &mut rect);
            let x = rect[0]; let y = rect[1];
            let w = rect[2] - rect[0]; let h = rect[3] - rect[1];
            if w <= 0 || h <= 0 { return 1; }

            WIN_LIST.push(serde_json::json!({
                "title": title,
                "x": x, "y": y, "w": w, "h": h,
            }));
            1
        }

        unsafe {
            WIN_LIST.clear();
            EnumWindows(enum_cb, 0);
            windows = WIN_LIST.clone();
        }
    }

    windows
}

fn main() {
    let tray_menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("capture", "Capture (Alt+Shift+S)"))
        .add_item(CustomMenuItem::new("capture_region", "Region (Alt+Shift+A)"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("show", "Open ScreenAI"))
        .add_item(CustomMenuItem::new("quit", "Quit"));

    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| {
            match event {
                SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                    "capture" => open_capture_overlay(app, "toolbar"),
                    "capture_region" => open_capture_overlay(app, "region"),
                    // "capture_window" removed — not implemented yet
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
            match app.global_shortcut_manager().register("Alt+Shift+S", move || {
                show_capture_toolbar(&handle_fs);
            }) {
                Ok(_) => println!("   Alt+Shift+S → Show capture toolbar"),
                Err(e) => eprintln!("Warning: could not register Alt+Shift+S (shortcut already taken?): {}", e),
            }

            let handle_rg = handle.clone();
            match app.global_shortcut_manager().register("Alt+Shift+A", move || {
                open_capture_overlay(&handle_rg, "region");
            }) {
                Ok(_) => println!("   Alt+Shift+A → Capture region"),
                Err(e) => eprintln!("Warning: could not register Alt+Shift+A (shortcut already taken?): {}", e),
            }

            // Alt+Shift+W (window capture) removed — not implemented yet

            if let Some(window) = app.get_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Clean old temp captures at startup
            let cleaned = cleanup_temp_captures();
            if cleaned > 0 { println!("   Cleaned {} old temp capture(s)", cleaned); }

            println!("🚀 ScreenAI running in system tray");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture_screen,
            capture_region,
            get_app_version,
            check_for_updates,
            install_update,
            set_fullscreen,
            web_search,
            invoke_claude,
            call_claude_simple,
            read_file_bytes,
            list_windows,
            save_temp_capture,
            reveal_in_explorer,
            write_file_bytes,
            cleanup_temp_captures,
            update_shortcut,
            ocr_extract,
            get_window_label,
            get_pending_capture,
            send_capture_to_main,
            close_capture_overlay,
            open_capture_overlay_cmd,
            share_native
        ])
        .run(tauri::generate_context!())
        .expect("Error running ScreenAI");
}
