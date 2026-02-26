// ============================================
// ScreenAI — Content Script
// ============================================

import './browser-polyfill';
import { ScreenAIOverlay } from './ui/overlay/overlay';
import './ui/highlight/highlight'; // v1.1 — highlight on page

let overlay: ScreenAIOverlay | null = null;

// Listen for capture commands from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SCREENAI_CAPTURE') {
    if (overlay) {
      overlay.destroy();
    }
    overlay = new ScreenAIOverlay(msg.dataUrl, msg.mode);
    overlay.onClose = () => {
      overlay = null;
    };
  }
});

// Also support manual trigger via keyboard (fallback if commands don't work)
document.addEventListener('keydown', (e) => {
  // Alt+Shift+S = fullscreen capture
  if (e.altKey && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'SCREENAI_CAPTURE_TAB' }, (response) => {
      if (response?.dataUrl) {
        if (overlay) overlay.destroy();
        overlay = new ScreenAIOverlay(response.dataUrl, 'fullscreen');
        overlay.onClose = () => { overlay = null; };
      }
    });
  }
  // Alt+Shift+A = region capture
  if (e.altKey && e.shiftKey && e.key === 'A') {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'SCREENAI_CAPTURE_TAB' }, (response) => {
      if (response?.dataUrl) {
        if (overlay) overlay.destroy();
        overlay = new ScreenAIOverlay(response.dataUrl, 'region');
        overlay.onClose = () => { overlay = null; };
      }
    });
  }
});
