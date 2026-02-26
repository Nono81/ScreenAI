// ============================================
// ScreenAI — Browser API Compatibility Layer
// ============================================
// Ensures chrome.* APIs work on Firefox (which uses browser.*)
// Firefox supports the chrome.* namespace for most APIs, but
// this polyfill provides a unified reference for edge cases.

declare global {
  // eslint-disable-next-line no-var
  var browser: typeof chrome | undefined;
}

// Firefox exposes `browser` as the primary namespace with Promise-based APIs.
// It also supports `chrome` for compatibility, but some APIs may differ.
// This ensures we always have `chrome` available.
if (typeof globalThis.browser !== 'undefined' && typeof globalThis.chrome === 'undefined') {
  (globalThis as any).chrome = globalThis.browser;
}

export {};
