// ============================================
// ScreenAI Desktop — Frontend Entry Point
// ============================================
// Dual-mode: main app window OR capture overlay window

import { ScreenAIApp } from '@/ui/main/ScreenAIApp';
import { ScreenAIOverlay } from '@/ui/overlay/overlay';
import { RegionSelector, cropScreenshot } from '@/ui/overlay/region';

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
  if (!invoke || !event) {
    // Browser preview: just launch the app
    const appContainer = document.getElementById('app')!;
    const app = new ScreenAIApp(appContainer);
    window.__SCREENAI_APP__ = app;
    console.log('Running in browser preview mode');
    return;
  }

  // Detect which window we are
  const label = await invoke('get_window_label');

  if (label === 'capture-overlay') {
    await initCaptureOverlay();
  } else {
    await initMainWindow();
  }
}

// ==========================================
// Main Window Mode
// ==========================================
async function initMainWindow() {
  const appContainer = document.getElementById('app')!;
  const app = new ScreenAIApp(appContainer);
  window.__SCREENAI_APP__ = app;

  await event.emit('ready');

  await event.listen('show-capture-toolbar', () => {
    app.triggerCaptureFromShortcut();
  });

  await event.listen('shortcut-capture', (e: any) => {
    const payload = e.payload;
    if (payload?.data_url) {
      app.attachScreenshotFromShortcut(payload.data_url, payload.mode || 'fullscreen');
    }
  });

  await event.listen('capture-error', (e: any) => {
    const msg = typeof e.payload === 'string' ? e.payload : 'Screen capture failed';
    showErrorToast(msg);
  });

  await event.listen('update-available', (e: any) => {
    const info = e.payload;
    showUpdateToast(info.version, info.body);
  });

  console.log('ScreenAI Desktop ready');
}

// ==========================================
// Capture Overlay Mode
// ==========================================
async function initCaptureOverlay() {
  // Hide the default #app container
  const appEl = document.getElementById('app');
  if (appEl) appEl.style.display = 'none';

  // Make body transparent/dark for the overlay
  document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:transparent;';

  try {
    const pending = await invoke('get_pending_capture');
    const mode: string = pending.mode;      // "toolbar" or "region"
    const dataUrl: string = pending.dataUrl; // fullscreen screenshot data URL

    if (mode === 'region') {
      // Direct region capture: show region selector immediately
      startRegionCapture(dataUrl);
    } else {
      // Toolbar mode: show capture mode selection
      showCaptureToolbar(dataUrl);
    }
  } catch (err) {
    console.error('Failed to get pending capture:', err);
    await invoke('close_capture_overlay');
  }
}

// Show the capture toolbar with mode buttons — same style as in-app toolbar
function showCaptureToolbar(screenshotUrl: string) {
  // Background: the frozen screenshot dimmed
  const bg = document.createElement('div');
  bg.style.cssText = `position:fixed;inset:0;z-index:1;background:url('${screenshotUrl}') no-repeat center/cover;`;
  document.body.appendChild(bg);

  const dimmer = document.createElement('div');
  dimmer.style.cssText = 'position:fixed;inset:0;z-index:2;background:rgba(0,0,0,0.4);';
  document.body.appendChild(dimmer);

  const modes = [
    { id: 'region', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4 3"/></svg>`, label: 'Zone' },
    { id: 'fullscreen', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/></svg>`, label: 'Plein ecran' },
    { id: 'freeform', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3c-3 0-8 1-8 6s4 4 4 8c0 2.5-2 4-2 4h12s-2-1.5-2-4c0-4 4-3 4-8s-5-6-8-6z"/></svg>`, label: 'Forme libre' },
    { id: 'window', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>`, label: 'Fenetre' },
  ];

  let selectedMode = 'fullscreen';

  const btnsHtml = modes.map(m =>
    `<button class="scb${m.id === 'fullscreen' ? ' scb-on' : ''}" data-cap-mode="${m.id}" title="${m.label}">${m.icon}<span>${m.label}</span></button>`
  ).join('');

  const bar = document.createElement('div');
  bar.className = 'sai-capture-bar';
  bar.style.zIndex = '10';
  bar.innerHTML = `
    <div class="scb-modes">
      ${btnsHtml}
    </div>
    <div class="scb-sep"></div>
    <div class="scb-delay">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <select class="scb-delay-sel">
        <option value="0">0s</option>
        <option value="3">3s</option>
        <option value="5">5s</option>
        <option value="10">10s</option>
      </select>
    </div>
    <div class="scb-sep"></div>
    <button class="scb-go">Capturer</button>
    <button class="scb-close" title="Annuler (Esc)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  `;
  document.body.appendChild(bar);

  // Mode selection
  bar.querySelectorAll('.scb:not(.scb-off)').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.scb').forEach(b => b.classList.remove('scb-on'));
      btn.classList.add('scb-on');
      selectedMode = (btn as HTMLElement).dataset.capMode!;
    });
  });

  const cleanup = () => { bar.remove(); dimmer.remove(); bg.remove(); document.removeEventListener('keydown', escHandler); };

  // Close
  bar.querySelector('.scb-close')!.addEventListener('click', () => { cleanup(); invoke('close_capture_overlay'); });

  // Escape
  const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') { cleanup(); invoke('close_capture_overlay'); } };
  document.addEventListener('keydown', escHandler);

  // Capture
  bar.querySelector('.scb-go')!.addEventListener('click', async () => {
    const delay = parseInt((bar.querySelector('.scb-delay-sel') as HTMLSelectElement).value) || 0;
    cleanup();

    if (delay > 0) {
      await showCountdown(delay, screenshotUrl);
    }

    if (selectedMode === 'region' || selectedMode === 'freeform') {
      startRegionCapture(screenshotUrl);
    } else {
      openAnnotationOverlay(screenshotUrl, 'fullscreen');
    }
  });
}

function showCountdown(seconds: number, screenshotUrl: string): Promise<void> {
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.style.cssText = `position:fixed;inset:0;z-index:5;background:url('${screenshotUrl}') no-repeat center/cover;`;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);z-index:6;';
    const num = document.createElement('div');
    num.style.cssText = 'font-size:120px;font-weight:700;color:white;text-shadow:0 4px 20px rgba(0,0,0,0.5);transition:transform 0.3s,opacity 0.3s;';
    overlay.appendChild(num);
    document.body.appendChild(bg);
    document.body.appendChild(overlay);

    let remaining = seconds;
    const tick = () => {
      if (remaining <= 0) { overlay.remove(); bg.remove(); resolve(); return; }
      num.textContent = String(remaining);
      num.style.transform = 'scale(1.1)';
      num.style.opacity = '0.9';
      setTimeout(() => { num.style.transform = 'scale(1)'; num.style.opacity = '1'; }, 150);
      remaining--;
      setTimeout(tick, 1000);
    };
    tick();
  });
}

function startRegionCapture(screenshotUrl: string) {
  new RegionSelector(
    document.body,
    screenshotUrl,
    async (region) => {
      const cropped = await cropScreenshot(
        screenshotUrl,
        region,
        window.innerWidth,
        window.innerHeight
      );
      openAnnotationOverlay(cropped, 'fullscreen');
    },
    () => {
      // User cancelled region selection
      invoke('close_capture_overlay');
    }
  );
}

function openAnnotationOverlay(screenshotUrl: string, mode: 'fullscreen' | 'region') {
  const overlay = new ScreenAIOverlay(screenshotUrl, mode);

  // When user clicks "Envoyer a l'IA", send the annotated image to main window
  overlay.onAttach = async (annotatedDataUrl: string) => {
    await invoke('send_capture_to_main', { dataUrl: annotatedDataUrl, mode });
  };

  // When overlay is closed (X button or Escape), close the overlay window
  overlay.onClose = () => {
    invoke('close_capture_overlay');
  };
}

// ==========================================
// Toast helpers (main window only)
// ==========================================
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

function showErrorToast(msg: string) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#3d0000;color:#ff6b6b;border:1px solid #ff6b6b;border-radius:8px;padding:10px 18px;font-size:13px;z-index:999;max-width:400px;text-align:center;';
  toast.textContent = 'Capture failed: ' + msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

init();
