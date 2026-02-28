// ============================================
// ScreenAI — Chat View Component
// ============================================

import type { Conversation, Message, AppSettings, AIProviderType } from '../../types';
import { PROVIDER_LABELS, generateId } from '../../types';
import { renderMarkdown } from '../../utils/markdown';
import { createConnector, type StreamCallback } from '../../connectors';
import { conversationStore, settingsStore } from '../../storage';
import { ICONS } from './icons';
import { t } from './i18n';

export interface ChatViewEvents {
  onCaptureFullscreen: () => void;
  onCaptureRegion: () => void;
  onConversationUpdated: (conversation: Conversation) => void;
}

export class ChatView {
  private el: HTMLElement;
  private conversation: Conversation | null = null;
  private settings: AppSettings | null = null;
  private projectInstructions = '';
  private isStreaming = false;
  private pendingScreenshot: string | null = null;

  constructor(private container: HTMLElement, private events: ChatViewEvents) {
    this.el = document.createElement('div');
    this.el.className = 'chat';
    this.container.appendChild(this.el);
  }

  async setConversation(conversation: Conversation | null, projectInstructions = '') {
    this.conversation = conversation;
    this.projectInstructions = projectInstructions;
    this.settings = await settingsStore.get();
    this.pendingScreenshot = null;

    if (conversation) {
      this.el.classList.add('on');
      this.render();
    } else {
      this.el.classList.remove('on');
      this.el.innerHTML = '';
    }
  }

  attachScreenshot(dataUrl: string) {
    this.pendingScreenshot = dataUrl;
    this.updateAttachmentChip();
  }

  private render() {
    if (!this.conversation) return;
    const c = this.conversation;
    const i = t();
    const provider = PROVIDER_LABELS[c.provider] || c.provider;

    this.el.innerHTML = `
      <div class="ch">
        <div class="ch-t">
          <h3>${this.escapeHtml(c.title)}</h3>
          <span class="badge">${provider} · ${c.model}</span>
        </div>
        <button class="ib" data-action="edit-conv" title="Edit">
          ${ICONS.edit}
        </button>
      </div>

      <div class="msgs" data-messages></div>

      <div class="ibar">
        <div class="irow">
          <textarea class="itx" placeholder="${i.inputPlaceholder}" rows="1" data-input></textarea>
          <div class="itools">
            <button class="it" title="${i.captureFullscreen}" data-action="capture-full">
              ${ICONS.camera}
            </button>
            <button class="it" title="${i.captureZone}" data-action="capture-region">
              ${ICONS.grid}
            </button>
            <button class="it pr" title="Send" data-action="send">
              ${ICONS.send}
            </button>
          </div>
        </div>
        <div class="imeta" data-meta></div>
      </div>
    `;

    this.renderMessages();
    this.bindEvents();
  }

  private renderMessages() {
    const msgContainer = this.el.querySelector('[data-messages]');
    if (!msgContainer || !this.conversation) return;

    msgContainer.innerHTML = this.conversation.messages.map(msg => {
      const isUser = msg.role === 'user';
      let content = '';

      if (msg.screenshot) {
        const imgSrc = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
        content += `<img class="mimg" src="${imgSrc}" alt="Capture" data-lightbox>`;
      }

      if (msg.content) {
        if (isUser) {
          content += `<p>${this.escapeHtml(msg.content)}</p>`;
        } else {
          content += renderMarkdown(msg.content);
        }
      }

      return `<div class="msg ${isUser ? 'mu' : 'ma'}">${content}</div>`;
    }).join('');

    // Scroll to bottom
    msgContainer.scrollTop = msgContainer.scrollHeight;

    // Lightbox on images
    msgContainer.querySelectorAll('[data-lightbox]').forEach(img => {
      img.addEventListener('click', () => this.showLightbox((img as HTMLImageElement).src));
    });
  }

  private bindEvents() {
    const input = this.el.querySelector<HTMLTextAreaElement>('[data-input]')!;
    const sendBtn = this.el.querySelector('[data-action="send"]')!;

    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    // Enter = send, Shift+Enter = newline
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    sendBtn.addEventListener('click', () => this.sendMessage());

    this.el.querySelector('[data-action="capture-full"]')?.addEventListener('click', () => {
      this.events.onCaptureFullscreen();
    });

    this.el.querySelector('[data-action="capture-region"]')?.addEventListener('click', () => {
      this.events.onCaptureRegion();
    });
  }

  private async sendMessage() {
    if (this.isStreaming || !this.conversation) return;

    const input = this.el.querySelector<HTMLTextAreaElement>('[data-input]')!;
    const text = input.value.trim();
    if (!text && !this.pendingScreenshot) return;

    // Create user message
    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      provider: this.conversation.provider,
      model: this.conversation.model,
    };

    if (this.pendingScreenshot) {
      userMsg.screenshot = {
        dataUrl: this.pendingScreenshot,
        annotations: [],
        timestamp: Date.now(),
      };
    }

    // Add to storage
    this.conversation = await conversationStore.addMessage(this.conversation.id, userMsg);
    this.events.onConversationUpdated(this.conversation);

    // Reset input
    input.value = '';
    input.style.height = 'auto';
    this.pendingScreenshot = null;
    this.updateAttachmentChip();

    // Display message
    this.renderMessages();

    // Send to AI
    await this.streamAIResponse();
  }

  private async streamAIResponse() {
    if (!this.conversation || !this.settings) return;

    this.isStreaming = true;
    const i = t();
    const providerConfig = this.settings.providers[this.conversation.provider];

    if (!providerConfig?.enabled || !providerConfig?.apiKey) {
      const errorMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: `${i.configureApiKey} (${PROVIDER_LABELS[this.conversation.provider]})`,
        timestamp: Date.now(),
      };
      this.conversation = await conversationStore.addMessage(this.conversation.id, errorMsg);
      this.events.onConversationUpdated(this.conversation);
      this.renderMessages();
      this.isStreaming = false;
      return;
    }

    // Add empty AI message (for streaming)
    const msgContainer = this.el.querySelector('[data-messages]')!;
    const aiMsgEl = document.createElement('div');
    aiMsgEl.className = 'msg ma streaming-cursor';
    msgContainer.appendChild(aiMsgEl);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    let fullResponse = '';

    try {
      const connector = createConnector({
        ...providerConfig,
        model: this.conversation.model,
      });

      // System prompt
      let systemPrompt = this.settings.systemPrompt || '';
      if (this.projectInstructions) {
        systemPrompt = this.projectInstructions + '\n\n' + systemPrompt;
      }

      // Language
      const langPrompts: Record<string, string> = {
        fr: 'Réponds toujours en français.',
        en: 'Always respond in English.',
        es: 'Responde siempre en español.',
        de: 'Antworte immer auf Deutsch.',
      };
      if (this.settings.language !== 'auto' && langPrompts[this.settings.language]) {
        systemPrompt += '\n' + langPrompts[this.settings.language];
      }

      const onStream: StreamCallback = (chunk, done) => {
        if (chunk) {
          fullResponse += chunk;
          aiMsgEl.innerHTML = renderMarkdown(fullResponse);
          msgContainer.scrollTop = msgContainer.scrollHeight;
        }
        if (done) {
          aiMsgEl.classList.remove('streaming-cursor');
        }
      };

      await connector.send(this.conversation.messages, systemPrompt || undefined, onStream);
    } catch (err: any) {
      fullResponse = `Error: ${err.message || i.errorContact}`;
      aiMsgEl.innerHTML = `<p style="color:var(--red)">${fullResponse}</p>`;
      aiMsgEl.classList.remove('streaming-cursor');
    }

    // Save response
    const aiMsg: Message = {
      id: generateId(),
      role: 'assistant',
      content: fullResponse,
      timestamp: Date.now(),
    };
    this.conversation = await conversationStore.addMessage(this.conversation.id, aiMsg);
    this.events.onConversationUpdated(this.conversation);
    this.isStreaming = false;
  }

  private updateAttachmentChip() {
    const meta = this.el.querySelector('[data-meta]');
    if (!meta) return;
    const i = t();

    if (this.pendingScreenshot) {
      meta.innerHTML = `<span class="chip">${i.captureAttached}</span>`;
    } else {
      meta.innerHTML = '';
    }
  }

  private showLightbox(src: string) {
    const lb = document.createElement('div');
    lb.className = 'lightbox op';
    lb.innerHTML = `<img src="${src}">`;
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
