// ============================================
// ScreenAI — Background Service Worker
// ============================================

import './browser-polyfill';

// Listen for keyboard commands
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'capture-fullscreen' || command === 'capture-region') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Capture the visible tab
    const dataUrl = await chrome.tabs.captureVisibleTab({
      format: 'png',
      quality: 95,
    });

    // Send to content script
    chrome.tabs.sendMessage(tab.id, {
      type: 'SCREENAI_CAPTURE',
      mode: command === 'capture-fullscreen' ? 'fullscreen' : 'region',
      dataUrl,
    });
  }

  if (command === 'toggle-highlight') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'toggle-highlight' });
    }
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SCREENAI_CAPTURE_TAB') {
    chrome.tabs.captureVisibleTab({ format: 'png', quality: 95 })
      .then(dataUrl => sendResponse({ dataUrl }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // async response
  }
});

// Note: chrome.action.onClicked is not used because default_popup is set in the manifest.
// When a popup is defined, onClicked never fires.
