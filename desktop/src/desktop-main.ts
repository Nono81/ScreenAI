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

  console.log('ScreenAI Desktop ready');
}

init();
