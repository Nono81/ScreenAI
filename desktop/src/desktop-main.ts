// ============================================
// ScreenAI Desktop — Frontend Entry Point
// ============================================
// This bridges the Tauri backend with the shared UI

import { ScreenAIOverlay } from '../src/ui/overlay/overlay';

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

// Listen for capture events from Rust backend
async function init() {
  if (!event) {
    console.error('Tauri API not available');
    showFallback();
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

function showFallback() {
  document.getElementById('app')!.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;">
      <div>
        <h1 style="font-size:48px;margin-bottom:16px;background:linear-gradient(135deg,#a78bfa,#c4b5fd);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">
          ScreenAI
        </h1>
        <p style="color:#666;font-size:14px;margin-bottom:24px;">
          Universal AI Screen Assistant
        </p>
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px;display:inline-block;">
          <p style="margin-bottom:12px;">Keyboard shortcuts:</p>
          <p><kbd style="background:#1a1a2e;padding:4px 10px;border-radius:4px;color:#a78bfa;font-family:monospace;">Alt+Shift+S</kbd> Full screen capture</p>
          <p style="margin-top:8px;"><kbd style="background:#1a1a2e;padding:4px 10px;border-radius:4px;color:#a78bfa;font-family:monospace;">Alt+Shift+A</kbd> Region capture</p>
        </div>
        <p style="color:#444;font-size:12px;margin-top:20px;">
          The app is running in the system tray
        </p>
      </div>
    </div>
  `;
}

init();
