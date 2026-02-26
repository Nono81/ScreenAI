// ============================================
// ScreenAI — Popup Script
// ============================================

import './browser-polyfill';
import { conversationStore } from './storage';
import { PROVIDER_LABELS } from './types';
import type { AIProviderType } from './types';

async function init() {
  const container = document.getElementById('conversations')!;
  const conversations = await conversationStore.getAll();

  if (conversations.length === 0) {
    container.innerHTML = '<div class="empty">No conversations yet. Take a capture to get started!</div>';
    return;
  }

  container.innerHTML = '';

  for (const convo of conversations.slice(0, 15)) {
    const date = new Date(convo.updatedAt).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

    const label = PROVIDER_LABELS[convo.provider as AIProviderType] || convo.provider;
    const msgCount = convo.messages.length;

    const btn = document.createElement('button');
    btn.className = 'convo-item';
    btn.innerHTML = `
      <div class="convo-title">${escapeHtml(convo.title)}</div>
      <div class="convo-meta">${label} · ${msgCount} messages · ${date}</div>
    `;

    // Click to open capture with this conversation pre-selected
    btn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      // Store selected conversation ID
      await chrome.storage.local.set({ screenai_resume_convo: convo.id });

      // Trigger a capture
      const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png', quality: 95 });
      chrome.tabs.sendMessage(tab.id, {
        type: 'SCREENAI_CAPTURE',
        mode: 'fullscreen',
        dataUrl,
        resumeConvoId: convo.id,
      });

      window.close();
    });

    container.appendChild(btn);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Highlight button (v1.1)
document.getElementById('highlight-btn')?.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'toggle-highlight' });
    window.close();
  }
});

// Settings button
document.getElementById('settings-btn')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'settings.html' });
});

// GitHub button
document.getElementById('github-btn')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://github.com/Nono81/ScreenAI' });
});

init();
