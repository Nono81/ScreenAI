// ============================================
// ScreenAI — Main Overlay
// ============================================

import { AnnotationCanvas, type AnnotationTool } from './annotation';
import { RegionSelector, cropScreenshot } from './region';
import { conversationStore, settingsStore } from '../../storage';
import { createConnector } from '../../connectors';
import { renderMarkdown } from '../../utils/markdown';
import type { Conversation, Message, AIProviderType, AppSettings, Screenshot, AppLanguage } from '../../types';
import { generateId, PROVIDER_LABELS, DEFAULT_MODELS, LANGUAGE_LABELS, LANGUAGE_PROMPTS, MODEL_OPTIONS, DEFAULT_SYSTEM_PROMPT } from '../../types';

export class ScreenAIOverlay {
  private root: HTMLDivElement;
  private annotationCanvas: AnnotationCanvas | null = null;
  private currentScreenshot: string = '';
  private conversations: Conversation[] = [];
  private activeConvo: Conversation | null = null;
  private settings: AppSettings | null = null;
  private isStreaming = false;
  private currentView: 'annotation' | 'chat' | 'conversations' | 'settings' = 'annotation';

  public onClose: (() => void) | null = null;

  constructor(private screenshotUrl: string, private mode: 'fullscreen' | 'region') {
    this.root = document.createElement('div');
    this.root.id = 'screenai-root';
    this.root.attachShadow({ mode: 'open' });
    document.body.appendChild(this.root);

    this.init();
  }

  private async init() {
    this.settings = await settingsStore.get();
    this.conversations = await conversationStore.getAll();

    if (this.mode === 'region') {
      new RegionSelector(
        document.body,
        this.screenshotUrl,
        async (region) => {
          this.currentScreenshot = await cropScreenshot(
            this.screenshotUrl,
            region,
            window.innerWidth,
            window.innerHeight
          );
          this.buildUI();
        },
        () => this.destroy()
      );
    } else {
      this.currentScreenshot = this.screenshotUrl;
      this.buildUI();
    }
  }

  private buildUI() {
    const shadow = this.root.shadowRoot!;
    shadow.innerHTML = '';

    // Inject styles
    const style = document.createElement('style');
    style.textContent = this.getStyles();
    shadow.appendChild(style);

    // Main container
    const container = document.createElement('div');
    container.className = 'sai-container';
    container.innerHTML = `
      <div class="sai-left">
        <div class="sai-toolbar" id="sai-toolbar"></div>
        <div class="sai-canvas-wrap" id="sai-canvas-wrap"></div>
      </div>
      <div class="sai-right" id="sai-right">
        <div class="sai-panel" id="sai-panel"></div>
      </div>
    `;
    shadow.appendChild(container);

    // Close on Escape
    this.handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.destroy();
      if (e.ctrlKey && e.key === 'z') this.annotationCanvas?.undo();
    };
    document.addEventListener('keydown', this.handleKeydown);

    this.buildToolbar(shadow.getElementById('sai-toolbar')!);
    this.buildCanvas(shadow.getElementById('sai-canvas-wrap')!);
    this.showConversationPicker();
  }

  private handleKeydown: ((e: KeyboardEvent) => void) | null = null;

  // ============================================
  // TOOLBAR (left side - annotation tools)
  // ============================================
  private buildToolbar(container: HTMLElement) {
    const tools: { id: AnnotationTool | string; icon: string; label: string }[] = [
      { id: 'pointer', icon: '🖱️', label: 'Selection' },
      { id: 'arrow', icon: '➡️', label: 'Arrow' },
      { id: 'rectangle', icon: '⬜', label: 'Rectangle' },
      { id: 'highlight', icon: '🟨', label: 'Highlight' },
      { id: 'freehand', icon: '✏️', label: 'Freehand' },
      { id: 'text', icon: '🔤', label: 'Text' },
      { id: 'undo', icon: '↩️', label: 'Undo' },
      { id: 'clear', icon: '🗑️', label: 'Clear all' },
    ];

    const colors = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#AF52DE', '#FFFFFF'];

    let html = '<div class="sai-tools">';
    for (const tool of tools) {
      html += `<button class="sai-tool-btn ${tool.id === 'pointer' ? 'active' : ''}" data-tool="${tool.id}" title="${tool.label}">${tool.icon}</button>`;
    }
    html += '</div>';

    html += '<div class="sai-colors">';
    for (const c of colors) {
      html += `<button class="sai-color-btn ${c === '#FF3B30' ? 'active' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`;
    }
    html += '</div>';

    html += `<div class="sai-toolbar-bottom">
      <button class="sai-btn sai-btn-close" id="sai-close-btn" title="Close (Esc)">✕</button>
    </div>`;

    container.innerHTML = html;

    // Events
    container.querySelectorAll('.sai-tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = (btn as HTMLElement).dataset.tool!;
        if (tool === 'undo') { this.annotationCanvas?.undo(); return; }
        if (tool === 'clear') { this.annotationCanvas?.clear(); return; }
        container.querySelectorAll('.sai-tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.annotationCanvas?.setTool(tool as AnnotationTool);
      });
    });

    container.querySelectorAll('.sai-color-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.sai-color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.annotationCanvas?.setColor((btn as HTMLElement).dataset.color!);
      });
    });

    container.querySelector('#sai-close-btn')?.addEventListener('click', () => this.destroy());
  }

  // ============================================
  // CANVAS (center - screenshot + annotations)
  // ============================================
  private buildCanvas(container: HTMLElement) {
    const img = new Image();
    img.src = this.currentScreenshot;
    img.onload = () => {
      this.annotationCanvas = new AnnotationCanvas(
        container,
        this.currentScreenshot,
        img.width,
        img.height
      );
    };
  }

  // ============================================
  // CONVERSATION PICKER (right panel)
  // ============================================
  private showConversationPicker() {
    const panel = this.root.shadowRoot!.getElementById('sai-panel')!;
    const provider = this.settings?.defaultProvider || 'claude';

    let html = `
      <div class="sai-panel-header">
        <h2>💬 Conversation</h2>
        <button class="sai-icon-btn" id="sai-settings-btn" title="Settings">⚙️</button>
      </div>
      <div class="sai-panel-body">
        <button class="sai-btn sai-btn-primary sai-full-width" id="sai-new-convo">
          ＋ New conversation
        </button>
    `;

    if (this.conversations.length > 0) {
      html += '<div class="sai-divider"><span>or attach to</span></div>';
      html += '<div class="sai-convo-list">';
      for (const c of this.conversations.slice(0, 20)) {
        const date = new Date(c.updatedAt).toLocaleDateString('en-US', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        const msgCount = c.messages.length;
        html += `
          <button class="sai-convo-item" data-id="${c.id}">
            <div class="sai-convo-title">${this.escapeHtml(c.title)}</div>
            <div class="sai-convo-meta">${PROVIDER_LABELS[c.provider]} · ${msgCount} msg · ${date}</div>
          </button>
        `;
      }
      html += '</div>';
    }

    html += '</div>';
    panel.innerHTML = html;

    // Events
    panel.querySelector('#sai-new-convo')?.addEventListener('click', async () => {
      const convo = await conversationStore.create(provider, this.settings!.providers[provider].model);
      this.activeConvo = convo;
      this.showChat();
    });

    panel.querySelectorAll('.sai-convo-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id!;
        this.activeConvo = (await conversationStore.get(id)) || null;
        if (this.activeConvo) this.showChat();
      });
    });

    panel.querySelector('#sai-settings-btn')?.addEventListener('click', () => this.showSettings());
  }

  // ============================================
  // CHAT VIEW (right panel)
  // ============================================
  private showChat() {
    const panel = this.root.shadowRoot!.getElementById('sai-panel')!;
    if (!this.activeConvo) return;

    const provider = this.activeConvo.provider;
    const providerLabel = PROVIDER_LABELS[provider] || provider;

    let html = `
      <div class="sai-panel-header">
        <button class="sai-icon-btn" id="sai-back-btn" title="Back">←</button>
        <div class="sai-chat-title">
          <h3>${this.escapeHtml(this.activeConvo.title)}</h3>
          <span class="sai-provider-badge">${providerLabel}</span>
        </div>
        <button class="sai-icon-btn" id="sai-settings-btn2" title="Settings">⚙️</button>
      </div>
      <div class="sai-messages" id="sai-messages"></div>
      <div class="sai-input-area">
        <div class="sai-input-row">
          <textarea class="sai-input" id="sai-input" placeholder="Describe your problem or ask a question..." rows="2"></textarea>
          <button class="sai-btn sai-btn-send" id="sai-send-btn" title="Send">
            <span id="sai-send-icon">➤</span>
          </button>
        </div>
        <div class="sai-input-hint">
          The annotated capture will be sent with your message
        </div>
      </div>
    `;

    panel.innerHTML = html;
    this.renderMessages();

    // Events
    panel.querySelector('#sai-back-btn')?.addEventListener('click', () => {
      this.showConversationPicker();
    });

    panel.querySelector('#sai-settings-btn2')?.addEventListener('click', () => this.showSettings());

    const input = panel.querySelector('#sai-input') as HTMLTextAreaElement;
    const sendBtn = panel.querySelector('#sai-send-btn')!;

    const send = () => {
      if (this.isStreaming) return;
      const text = input.value.trim();
      if (!text && !this.currentScreenshot) return;
      input.value = '';
      this.sendMessage(text);
    };

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    // Auto-focus
    input.focus();
  }

  private renderMessages() {
    const container = this.root.shadowRoot!.getElementById('sai-messages');
    if (!container || !this.activeConvo) return;

    let html = '';
    for (const msg of this.activeConvo.messages) {
      const isUser = msg.role === 'user';
      html += `<div class="sai-msg ${isUser ? 'sai-msg-user' : 'sai-msg-ai'}">`;

      if (isUser && msg.screenshot?.annotatedDataUrl) {
        html += `<img class="sai-msg-screenshot" src="${msg.screenshot.annotatedDataUrl}" alt="capture">`;
      } else if (isUser && msg.screenshot?.dataUrl) {
        html += `<img class="sai-msg-screenshot" src="${msg.screenshot.dataUrl}" alt="capture">`;
      }

      if (msg.content) {
        html += `<div class="sai-msg-content">${isUser ? this.escapeHtml(msg.content) : renderMarkdown(msg.content)}</div>`;
      }

      html += '</div>';
    }

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
  }

  // ============================================
  // SEND MESSAGE
  // ============================================
  private async sendMessage(text: string) {
    if (!this.activeConvo || !this.settings) return;

    const provider = this.activeConvo.provider;
    const config = this.settings.providers[provider];

    if (!config.apiKey && provider !== 'ollama') {
      this.showError('API key missing. Configure it in settings.');
      return;
    }

    // Create screenshot data
    const annotatedUrl = this.annotationCanvas?.toDataUrl() || this.currentScreenshot;
    const screenshot: Screenshot = {
      dataUrl: this.currentScreenshot,
      annotations: this.annotationCanvas?.getAnnotations() || [],
      annotatedDataUrl: annotatedUrl,
      timestamp: Date.now(),
    };

    // User message
    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: text || 'Help me with what you see on screen.',
      screenshot,
      timestamp: Date.now(),
      provider,
      model: config.model,
    };

    this.activeConvo = await conversationStore.addMessage(this.activeConvo.id, userMsg);
    this.renderMessages();

    // AI response
    const aiMsg: Message = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      provider,
      model: config.model,
    };

    // Add empty AI message for streaming
    this.activeConvo!.messages.push(aiMsg);
    this.renderMessages();
    this.isStreaming = true;
    this.updateSendButton(true);

    try {
      const connector = createConnector(config);

      // Build system prompt with language preference
      const langPrompt = this.settings?.language && this.settings.language !== 'auto'
        ? ` ${LANGUAGE_PROMPTS[this.settings.language]}`
        : ' Respond in the user\'s language.';
      const fullPrompt = (this.settings?.systemPrompt || DEFAULT_SYSTEM_PROMPT) + langPrompt;

      await connector.send(this.activeConvo!.messages.slice(0, -1), fullPrompt, (chunk: string, done: boolean) => {
        aiMsg.content += chunk;

        // Update the displayed message
        const messagesEl = this.root.shadowRoot!.getElementById('sai-messages');
        if (messagesEl) {
          const lastMsg = messagesEl.querySelector('.sai-msg:last-child .sai-msg-content');
          if (lastMsg) {
            lastMsg.innerHTML = renderMarkdown(aiMsg.content);
          }
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        if (done) {
          this.isStreaming = false;
          this.updateSendButton(false);
          // Save to DB
          conversationStore.addMessage(this.activeConvo!.id, aiMsg).then((updated: Conversation) => {
            // Remove the temporary message and use the saved one
            this.activeConvo = updated;
          });
        }
      });
    } catch (err: any) {
      aiMsg.content = `❌ Error: ${err.message || 'Could not reach the AI'}`;
      this.isStreaming = false;
      this.updateSendButton(false);
      this.renderMessages();
    }
  }

  private updateSendButton(streaming: boolean) {
    const icon = this.root.shadowRoot!.getElementById('sai-send-icon');
    if (icon) {
      icon.textContent = streaming ? '⏳' : '➤';
    }
  }

  private showError(msg: string) {
    const messagesEl = this.root.shadowRoot!.getElementById('sai-messages');
    if (messagesEl) {
      messagesEl.innerHTML += `<div class="sai-msg sai-msg-error"><div class="sai-msg-content">⚠️ ${msg}</div></div>`;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // ============================================
  // SETTINGS VIEW
  // ============================================
  private showSettings() {
    const panel = this.root.shadowRoot!.getElementById('sai-panel')!;
    if (!this.settings) return;

    let html = `
      <div class="sai-panel-header">
        <button class="sai-icon-btn" id="sai-back-settings" title="Back">←</button>
        <h2>⚙️ Settings</h2>
      </div>
      <div class="sai-panel-body sai-settings-body">
        <div class="sai-setting-group">
          <label class="sai-label">Default AI</label>
          <select class="sai-select" id="sai-default-provider">
    `;

    for (const [key, label] of Object.entries(PROVIDER_LABELS)) {
      const selected = key === this.settings.defaultProvider ? 'selected' : '';
      html += `<option value="${key}" ${selected}>${label}</option>`;
    }

    html += `</select></div>`;

    // Provider configs
    for (const [key, config] of Object.entries(this.settings.providers)) {
      const label = PROVIDER_LABELS[key as AIProviderType];
      html += `
        <div class="sai-setting-group sai-provider-config">
          <div class="sai-provider-header">
            <h4>${label}</h4>
            <label class="sai-toggle">
              <input type="checkbox" data-provider="${key}" data-field="enabled" ${config.enabled ? 'checked' : ''}>
              <span class="sai-toggle-slider"></span>
            </label>
          </div>
          <input class="sai-input-field" type="password" placeholder="API Key" 
            data-provider="${key}" data-field="apiKey" value="${config.apiKey}">
          <input class="sai-input-field" type="text" placeholder="Model" 
            data-provider="${key}" data-field="model" value="${config.model}">
          ${key === 'ollama' ? `<input class="sai-input-field" type="text" placeholder="URL (http://localhost:11434)" 
            data-provider="${key}" data-field="baseUrl" value="${config.baseUrl || ''}">` : ''}
        </div>
      `;
    }

    html += `
      <button class="sai-btn sai-btn-primary sai-full-width" id="sai-save-settings">
        Save
      </button>
    </div>`;

    panel.innerHTML = html;

    // Events
    panel.querySelector('#sai-back-settings')?.addEventListener('click', () => {
      if (this.activeConvo) this.showChat();
      else this.showConversationPicker();
    });

    panel.querySelector('#sai-save-settings')?.addEventListener('click', async () => {
      const select = panel.querySelector('#sai-default-provider') as HTMLSelectElement;
      this.settings!.defaultProvider = select.value as AIProviderType;

      // Collect all provider settings
      panel.querySelectorAll('.sai-input-field').forEach((input) => {
        const el = input as HTMLInputElement;
        const provider = el.dataset.provider as AIProviderType;
        const field = el.dataset.field!;
        (this.settings!.providers[provider] as any)[field] = el.value;
      });

      panel.querySelectorAll('input[type="checkbox"]').forEach((input) => {
        const el = input as HTMLInputElement;
        const provider = el.dataset.provider as AIProviderType;
        this.settings!.providers[provider].enabled = el.checked;
      });

      await settingsStore.save(this.settings!);

      // Show saved feedback
      const btn = panel.querySelector('#sai-save-settings')!;
      btn.textContent = '✓ Saved';
      setTimeout(() => { btn.textContent = 'Save'; }, 1500);
    });
  }

  // ============================================
  // DESTROY
  // ============================================
  destroy() {
    if (this.handleKeydown) {
      document.removeEventListener('keydown', this.handleKeydown);
    }
    this.annotationCanvas?.destroy();
    this.root.remove();
    this.onClose?.();
  }

  // ============================================
  // UTILITIES
  // ============================================
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================
  // STYLES
  // ============================================
  private getStyles(): string {
    return `
      :host {
        all: initial;
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }

      .sai-container {
        display: flex;
        width: 100vw;
        height: 100vh;
        background: #0d0d0d;
      }

      /* ---- LEFT: Canvas + Toolbar ---- */
      .sai-left {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .sai-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: #1a1a2e;
        border-bottom: 1px solid #2a2a4a;
      }

      .sai-tools {
        display: flex;
        gap: 4px;
      }

      .sai-tool-btn {
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 8px;
        cursor: pointer;
        font-size: 16px;
        transition: all 0.15s;
      }

      .sai-tool-btn:hover {
        background: rgba(255,255,255,0.1);
        border-color: rgba(255,255,255,0.15);
      }

      .sai-tool-btn.active {
        background: #a78bfa;
        border-color: #a78bfa;
        box-shadow: 0 0 12px rgba(79,195,247,0.4);
      }

      .sai-colors {
        display: flex;
        gap: 4px;
        margin-left: 12px;
        padding-left: 12px;
        border-left: 1px solid #2a2a4a;
      }

      .sai-color-btn {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        transition: all 0.15s;
      }

      .sai-color-btn:hover {
        transform: scale(1.2);
      }

      .sai-color-btn.active {
        border-color: white;
        box-shadow: 0 0 8px rgba(255,255,255,0.4);
      }

      .sai-toolbar-bottom {
        margin-left: auto;
      }

      .sai-canvas-wrap {
        flex: 1;
        position: relative;
        overflow: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #111;
      }

      .sai-canvas-wrap canvas {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }

      /* ---- RIGHT: Panel ---- */
      .sai-right {
        width: 400px;
        min-width: 400px;
        display: flex;
        flex-direction: column;
        background: #13132b;
        border-left: 1px solid #2a2a4a;
      }

      .sai-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      .sai-panel-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px;
        background: #1a1a2e;
        border-bottom: 1px solid #2a2a4a;
      }

      .sai-panel-header h2, .sai-panel-header h3 {
        color: #e0e0e0;
        font-size: 15px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .sai-chat-title {
        flex: 1;
        min-width: 0;
      }

      .sai-chat-title h3 {
        font-size: 13px;
      }

      .sai-provider-badge {
        font-size: 10px;
        color: #a78bfa;
        background: rgba(79,195,247,0.1);
        padding: 2px 8px;
        border-radius: 10px;
        display: inline-block;
        margin-top: 2px;
      }

      .sai-panel-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
      }

      /* ---- Buttons ---- */
      .sai-btn {
        padding: 8px 16px;
        border-radius: 8px;
        border: none;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.15s;
      }

      .sai-btn-primary {
        background: #a78bfa;
        color: #0d0d0d;
        font-weight: 600;
      }

      .sai-btn-primary:hover {
        background: #81D4FA;
        box-shadow: 0 4px 15px rgba(79,195,247,0.3);
      }

      .sai-btn-close {
        background: rgba(255,60,60,0.2);
        color: #ff6b6b;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        font-size: 16px;
        padding: 0;
      }

      .sai-btn-close:hover {
        background: rgba(255,60,60,0.4);
      }

      .sai-icon-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        font-size: 18px;
        padding: 4px;
        border-radius: 6px;
        transition: background 0.15s;
      }

      .sai-icon-btn:hover {
        background: rgba(255,255,255,0.1);
      }

      .sai-full-width { width: 100%; }

      /* ---- Conversation List ---- */
      .sai-divider {
        display: flex;
        align-items: center;
        margin: 16px 0;
        color: #666;
        font-size: 12px;
      }

      .sai-divider::before, .sai-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: #2a2a4a;
      }

      .sai-divider span {
        padding: 0 10px;
      }

      .sai-convo-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .sai-convo-item {
        display: block;
        width: 100%;
        text-align: left;
        padding: 10px 12px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.15s;
      }

      .sai-convo-item:hover {
        background: rgba(79,195,247,0.1);
        border-color: rgba(79,195,247,0.2);
      }

      .sai-convo-title {
        color: #e0e0e0;
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .sai-convo-meta {
        color: #666;
        font-size: 11px;
      }

      /* ---- Chat Messages ---- */
      .sai-messages {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .sai-msg {
        max-width: 95%;
        border-radius: 12px;
        padding: 10px 14px;
        font-size: 13px;
        line-height: 1.5;
        word-wrap: break-word;
      }

      .sai-msg-user {
        align-self: flex-end;
        background: #1e3a5f;
        color: #e0e0e0;
        border-bottom-right-radius: 4px;
      }

      .sai-msg-ai {
        align-self: flex-start;
        background: #1e1e3a;
        color: #d0d0d0;
        border-bottom-left-radius: 4px;
      }

      .sai-msg-error {
        align-self: center;
        background: rgba(255,60,60,0.15);
        color: #ff6b6b;
      }

      .sai-msg-screenshot {
        display: block;
        max-width: 100%;
        max-height: 150px;
        border-radius: 8px;
        margin-bottom: 8px;
        border: 1px solid rgba(255,255,255,0.1);
      }

      .sai-msg-content {
        color: inherit;
      }

      .sai-msg-content p { margin-bottom: 8px; }
      .sai-msg-content p:last-child { margin-bottom: 0; }

      .sai-msg-content .sai-code-block {
        background: #0d0d1a;
        border-radius: 8px;
        padding: 10px 12px;
        overflow-x: auto;
        font-family: 'SF Mono', Monaco, Consolas, monospace;
        font-size: 12px;
        margin: 8px 0;
        border: 1px solid #2a2a4a;
      }

      .sai-msg-content .sai-inline-code {
        background: rgba(79,195,247,0.15);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: 'SF Mono', Monaco, Consolas, monospace;
        font-size: 12px;
      }

      .sai-msg-content .sai-list {
        padding-left: 18px;
        margin: 6px 0;
      }

      .sai-msg-content strong { color: #a78bfa; }

      /* ---- Input Area ---- */
      .sai-input-area {
        padding: 12px;
        border-top: 1px solid #2a2a4a;
        background: #1a1a2e;
      }

      .sai-input-row {
        display: flex;
        gap: 8px;
      }

      .sai-input {
        flex: 1;
        padding: 10px 14px;
        background: #0d0d1a;
        border: 1px solid #2a2a4a;
        border-radius: 10px;
        color: #e0e0e0;
        font-size: 13px;
        font-family: inherit;
        resize: none;
        outline: none;
        transition: border-color 0.15s;
      }

      .sai-input:focus {
        border-color: #a78bfa;
      }

      .sai-input::placeholder {
        color: #555;
      }

      .sai-btn-send {
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #a78bfa;
        color: #0d0d0d;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        font-size: 18px;
        transition: all 0.15s;
        padding: 0;
      }

      .sai-btn-send:hover {
        background: #81D4FA;
        box-shadow: 0 4px 15px rgba(79,195,247,0.3);
      }

      .sai-input-hint {
        font-size: 11px;
        color: #555;
        margin-top: 6px;
        padding-left: 4px;
      }

      /* ---- Settings ---- */
      .sai-settings-body {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .sai-setting-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .sai-label {
        font-size: 12px;
        color: #888;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .sai-select, .sai-input-field {
        padding: 8px 12px;
        background: #0d0d1a;
        border: 1px solid #2a2a4a;
        border-radius: 8px;
        color: #e0e0e0;
        font-size: 13px;
        outline: none;
        transition: border-color 0.15s;
      }

      .sai-select:focus, .sai-input-field:focus {
        border-color: #a78bfa;
      }

      .sai-provider-config {
        background: rgba(255,255,255,0.02);
        padding: 12px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.05);
      }

      .sai-provider-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }

      .sai-provider-header h4 {
        color: #ccc;
        font-size: 13px;
      }

      /* Toggle switch */
      .sai-toggle {
        position: relative;
        display: inline-block;
        width: 40px;
        height: 22px;
      }

      .sai-toggle input { opacity: 0; width: 0; height: 0; }

      .sai-toggle-slider {
        position: absolute;
        inset: 0;
        background: #333;
        border-radius: 22px;
        cursor: pointer;
        transition: 0.2s;
      }

      .sai-toggle-slider::before {
        content: '';
        position: absolute;
        width: 16px;
        height: 16px;
        left: 3px;
        bottom: 3px;
        background: white;
        border-radius: 50%;
        transition: 0.2s;
      }

      .sai-toggle input:checked + .sai-toggle-slider {
        background: #a78bfa;
      }

      .sai-toggle input:checked + .sai-toggle-slider::before {
        transform: translateX(18px);
      }

      /* Scrollbar */
      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: #555; }
    `;
  }
}
