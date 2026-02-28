// ============================================
// ScreenAI — Version Detection Utility
// ============================================

let cachedVersion = '1.1.0';

export async function initVersion(): Promise<string> {
  const isTauri = !!(window as any).__TAURI__;
  if (isTauri) {
    try {
      cachedVersion = await (window as any).__TAURI__.invoke('get_app_version');
    } catch {}
  } else if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    cachedVersion = chrome.runtime.getManifest().version;
  }
  return cachedVersion;
}

export function getVersion(): string {
  return cachedVersion;
}
