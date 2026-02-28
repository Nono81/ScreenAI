// ============================================
// ScreenAI Desktop — Frontend Entry Point
// ============================================
// This bridges the Tauri backend with the shared UI

import { ScreenAIApp } from '@/ui/main/ScreenAIApp';

declare global {
  interface Window {
    __TAURI__: {
      invoke: (cmd: string, args?: any) => Promise<any>;
      event: {
        listen: (event: string, handler: (payload: any) => void) => Promise<() => void>;
        emit: (event: string, payload?: any) => Promise<void>;
      };
    };
    __SCREENAI_APP__: ScreenAIApp | null;
  }
}

const { invoke, event } = window.__TAURI__ || {};

async function init() {
  // Launch the full ScreenAI interface
  const appContainer = document.getElementById('app')!;
  const app = new ScreenAIApp(appContainer);

  // Store reference so we can call attachScreenshot from events
  window.__SCREENAI_APP__ = app;

  if (!event) {
    console.log('Running in browser preview mode (Tauri API not available)');
    return;
  }

  // Signal that the frontend is ready
  await event.emit('ready');

  // Listen for captures triggered by global shortcuts (Alt+Shift+S, Alt+Shift+A)
  // or system tray menu. The Rust backend captures the screen and sends the
  // result here — we just attach it to the current chat.
  await event.listen('shortcut-capture', (e: any) => {
    const payload = e.payload;
    if (payload?.data_url) {
      app.attachScreenshotFromShortcut(payload.data_url);
    }
  });

  // Listen for update availability from Rust backend
  await event.listen('update-available', (e: any) => {
    const info = e.payload;
    showUpdateToast(info.version, info.body);
  });

  console.log('ScreenAI Desktop ready');
}

function showUpdateToast(version: string, body: string) {
  const toast = document.createElement('div');
  toast.className = 'update-toast';
  toast.innerHTML = `
    <div class="update-toast-content">
      <strong>ScreenAI ${version} is available</strong>
      <p>${body ? body.slice(0, 100) : 'A new version is ready to install.'}</p>
      <div class="update-toast-actions">
        <button class="update-toast-btn primary" data-action="update-now">Install & Restart</button>
        <button class="update-toast-btn" data-action="update-later">Later</button>
      </div>
    </div>
  `;
  document.body.appendChild(toast);

  toast.querySelector('[data-action="update-now"]')?.addEventListener('click', async () => {
    try {
      if (invoke) await invoke('install_update');
    } catch (err) {
      console.error('Update install failed:', err);
    }
  });

  toast.querySelector('[data-action="update-later"]')?.addEventListener('click', () => {
    toast.remove();
  });

  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 30000);
}

init();
