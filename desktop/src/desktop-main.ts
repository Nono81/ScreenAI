// ============================================
// ScreenAI Desktop — Frontend Entry Point
// ============================================
// This bridges the Tauri backend with the shared UI

import { ScreenAIOverlay } from '@/ui/overlay/overlay';
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
  }
}

const { invoke, event } = window.__TAURI__ || {};

let currentOverlay: ScreenAIOverlay | null = null;

// Listen for capture events from Rust backend
async function init() {
  // Launch the full ScreenAI interface
  const appContainer = document.getElementById('app')!;
  new ScreenAIApp(appContainer);

  if (!event) {
    console.log('Running in browser preview mode (Tauri API not available)');
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
