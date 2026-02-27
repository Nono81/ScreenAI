// ============================================
// ScreenAI Desktop — Frontend Entry Point
// ============================================
// This bridges the Tauri backend with the shared UI

import { ScreenAIOverlay } from '@/ui/overlay/overlay';

declare global {
  interface Window {
    __TAURI__: {
      invoke: (cmd: string, args?: any) => Promise<any>;
      event: {
        listen: (event: string, handler: (payload: any) => void) => Promise<() => void>;
        emit: (event: string, payload?: any) => Promise<void>;
      };
    };
  }
}

const { invoke, event } = window.__TAURI__ || {};

let currentOverlay: ScreenAIOverlay | null = null;

// Show the home screen immediately
function showHomeScreen() {
  const isTauri = !!event;
  const platform = navigator.platform?.toLowerCase() || '';
  const isMac = platform.includes('mac');
  const modKey = isMac ? '⌥⇧' : 'Alt+Shift+';

  document.getElementById('app')!.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div>
        <div style="margin-bottom:24px;">
          <svg width="64" height="64" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="128" height="128" rx="28" fill="url(#g)"/>
            <defs><linearGradient id="g" x1="0" y1="0" x2="128" y2="128"><stop stop-color="#7c3aed"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs>
            <circle cx="64" cy="56" r="20" stroke="white" stroke-width="5" fill="none"/>
            <rect x="38" y="82" width="52" height="6" rx="3" fill="white" opacity="0.7"/>
            <rect x="46" y="94" width="36" height="4" rx="2" fill="white" opacity="0.4"/>
          </svg>
        </div>
        <h1 style="font-size:42px;margin-bottom:8px;background:linear-gradient(135deg,#a78bfa,#c4b5fd);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:700;">
          ScreenAI
        </h1>
        <p style="color:#888;font-size:15px;margin-bottom:32px;">
          Universal AI Screen Assistant
        </p>
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:24px 32px;display:inline-block;text-align:left;">
          <p style="margin-bottom:16px;color:#aaa;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Keyboard shortcuts</p>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
            <kbd style="background:#1a1a2e;padding:6px 14px;border-radius:6px;color:#a78bfa;font-family:monospace;font-size:14px;border:1px solid rgba(167,139,250,0.2);">${modKey}S</kbd>
            <span style="color:#ccc;font-size:14px;">Full screen capture</span>
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <kbd style="background:#1a1a2e;padding:6px 14px;border-radius:6px;color:#a78bfa;font-family:monospace;font-size:14px;border:1px solid rgba(167,139,250,0.2);">${modKey}A</kbd>
            <span style="color:#ccc;font-size:14px;">Region capture</span>
          </div>
        </div>
        <p style="color:#555;font-size:12px;margin-top:24px;">
          ${isTauri ? '✓ Running in system tray — use shortcuts or tray menu to capture' : 'Running in browser preview mode'}
        </p>
      </div>
    </div>
  `;
}

// Listen for capture events from Rust backend
async function init() {
  // Always show home screen first
  showHomeScreen();

  if (!event) {
    console.error('Tauri API not available — running in preview mode');
    return;
  }

  // Signal that the frontend is ready
  await event.emit('ready');

  // Listen for screen captures from the backend
  await event.listen('capture', (e: any) => {
    const payload = e.payload;
    if (currentOverlay) {
      currentOverlay.destroy();
    }
    currentOverlay = new ScreenAIOverlay(payload.data_url, payload.mode);
    currentOverlay.onClose = () => {
      currentOverlay = null;
      // Hide the overlay window when done
      if (invoke) {
        invoke('close_overlay').catch(() => {});
      }
    };
  });

  console.log('🚀 ScreenAI Desktop ready');
}

init();
