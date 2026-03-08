// ============================================
// ScreenAI — Chat View Component
// ============================================

import type { Conversation, Message, AppSettings, AIProviderConfig, BestOfData, Project } from '../../types';
import { PROVIDER_LABELS, generateId } from '../../types';
import { renderMarkdown } from '../../utils/markdown';
import { createConnector, type StreamCallback } from '../../connectors';
import { executeBestOf, type ProviderStatus } from '../../bestof/BestOfEngine';
import { conversationStore, settingsStore } from '../../storage';
import { processFile, validateFiles, formatSize, categorizeFile, ACCEPT_STRING } from './FileUpload';
import type { MessageAttachment } from '../../types';
import { injectMemory } from '../../memory/MemoryPrompt';
import { handleSlashCommand, isSlashCommand } from '../../memory/SlashCommands';
import { shouldDetect, detectAndSave } from '../../memory/MemoryDetector';
import { ICONS } from './icons';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { t } from './i18n';
import { shouldCompact, compactConversation, getEffectiveMessages, getContextPercentage } from '../../compaction/Compactor';
import { renderCompactionDivider, renderSummaryMessage, renderContextIndicator } from './CompactionDisplay';
import { renderUserActions, renderAIBadge, renderAIActionsButtons, renderEditMode, handleCopyFeedback } from './MessageActions';
import { saveFeedback, renderFeedbackPopover, bindPopoverEvents } from './FeedbackSystem';
import { getUserTier, renderModelSelector, bindModelSelectorEvents, getSelectedModel, renderModelBadge, getModelPreferences, saveModelPreferences } from './ModelSelector';

export interface ChatViewEvents {
  onCapture: () => void;
  onCaptureFullscreen: () => void;
  onCaptureRegion: () => void;
  onConversationUpdated: (conversation: Conversation) => void;
  onRenameConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  onMoveConversation?: (id: string) => void;
  onRemoveFromProject?: (id: string) => void;
  onToggleFavoriteConversation?: (id: string) => void;
}

// Premium check: plan 'pro' OU override local (localStorage.setItem('sai_bestof','1'))
function isPremium(): boolean {
  if (localStorage.getItem('sai_bestof') === '1') return true;
  // Auth service check (can be upgraded when plan detection is implemented)
  return false;
}

export class ChatView {
  private el: HTMLElement;
  private conversation: Conversation | null = null;
  private currentProject: Project | null = null;
  private settings: AppSettings | null = null;
  private projectInstructions = '';
  private isStreaming = false;
  private bestOfMode = false;
  private contextMenu = new ContextMenu();
  private memoryCount = 0;
  private pendingAttachments: MessageAttachment[] = [];
  private fileInput: HTMLInputElement | null = null;

  constructor(private container: HTMLElement, private events: ChatViewEvents) {
    this.el = document.createElement('div');
    this.el.className = 'chat';
    this.container.appendChild(this.el);
  }

  async setConversation(conversation: Conversation | null, projectInstructions = '', project: Project | null = null) {
    this.conversation = conversation;
    this.currentProject = project;
    this.projectInstructions = projectInstructions;
    this.pendingAttachments = [];
    this.settings = await settingsStore.get();

    if (conversation) {
      this.el.classList.add('on');
      // Load memory count for header indicator
      if (this.settings?.memoryEnabled !== false) {
        const { memoryStore } = await import('../../storage');
        const facts = await memoryStore.getAll();
        this.memoryCount = facts.length;
      } else {
        this.memoryCount = 0;
      }
      this.render();
    } else {
      this.el.classList.remove('on');
      this.el.innerHTML = '';
    }
  }

  attachScreenshot(dataUrl: string) {
    if (this.pendingAttachments.length >= 5) {
      this.showToast('Maximum 5 fichiers par message');
      return;
    }
    // Estimate size from base64 data URL
    const base64Part = dataUrl.split(',')[1] || '';
    const sizeEstimate = Math.round(base64Part.length * 3 / 4);
    this.pendingAttachments.push({
      id: generateId(),
      name: `Capture ${this.pendingAttachments.filter(a => a.type === 'capture').length + 1}`,
      type: 'capture',
      size: sizeEstimate,
      mimeType: 'image/png',
      base64: base64Part,
      thumbnail: dataUrl,
    });
    this.updateAttachmentChip();
  }

  private render() {
    if (!this.conversation) return;
    const c = this.conversation;
    const i = t();
    this.el.innerHTML = `
      <div class="ch">
        <div class="ch-t" data-title-area>
          ${this.currentProject ? `<h3><span style="color:var(--t2);font-weight:500;">${this.escapeHtml(this.currentProject.name)}</span> <span style="color:var(--t3);margin:0 4px;">/</span> ${this.escapeHtml(c.title)}</h3>` : `<h3>${this.escapeHtml(c.title)}</h3>`}
          <button class="ib ch-menu-btn" data-action="title-menu" title="Menu" style="margin-left:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
        </div>
        ${this.memoryCount > 0 && this.settings?.memoryEnabled !== false ? `<span class="mem-indicator" title="${this.memoryCount} souvenir(s) actif(s)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;color:var(--t2)"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg> ${this.memoryCount}</span>` : ''}
        <span data-context-indicator></span>
      </div>

      <div class="msgs" data-messages></div>

      <div class="ibar">
        ${this.settings ? renderModelSelector(getUserTier(this.settings), this.settings) : ''}
        <div class="irow">
          <textarea class="itx" placeholder="${i.inputPlaceholder}" rows="1" data-input></textarea>
          <div class="itools">
            <button class="it" title="Capturer" data-action="capture">
              ${ICONS.camera}
            </button>
            <button class="it" title="Joindre un fichier (Ctrl+U)" data-action="upload-file">
              ${ICONS.paperclip}
            </button>
            <button class="it bestof-toggle-it" title="Meilleure reponse (Best Of)" data-action="toggle-bestof" aria-pressed="false">
              &#10022;
            </button>
            <button class="it pr" title="Send" data-action="send">
              ${ICONS.send}
            </button>
          </div>
        </div>
        <div class="imeta" data-meta></div>
        <div class="chat-disclaimer">ScreenAI peut faire des erreurs. Veuillez verifier les reponses.</div>
      </div>
    `;

    // Dropzone overlay
    const dropzone = document.createElement('div');
    dropzone.className = 'chat-dropzone';
    dropzone.innerHTML = `<div class='chat-dropzone-content'><div class='chat-dropzone-icon'>${ICONS.paperclip}</div><div class='chat-dropzone-text'>Deposez vos fichiers ici</div></div>`;
    this.el.style.position = 'relative';
    this.el.appendChild(dropzone);
    this.setupFileInput();
    this.setupDragDrop(dropzone);
    this.setupTauriFileDrop(dropzone);
    this.renderMessages();
    this.bindEvents();
    if (this.settings) {
      bindModelSelectorEvents(this.el, this.settings);
    }
    this.updateContextIndicator();
    this.updateAttachmentChip();
    this.syncBestOfButton();
  }

  private syncBestOfButton() {
    const btn = this.el.querySelector<HTMLButtonElement>('[data-action="toggle-bestof"]');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(this.bestOfMode));
    btn.classList.toggle('active', this.bestOfMode);
  }

  private getBestOfProviders(): AIProviderConfig[] {
    if (!this.settings) return [];
    return Object.values(this.settings.providers).filter(p => p.enabled && p.apiKey);
  }

  private renderMessages() {
    const msgContainer = this.el.querySelector('[data-messages]');
    if (!msgContainer || !this.conversation) return;

    const compaction = this.conversation.compaction;
    const compactedBeforeIdx = compaction ? compaction.compactedBeforeIndex : -1;

    msgContainer.innerHTML = this.conversation.messages.map((msg, idx) => {
      if (msg.summary) {
        return renderSummaryMessage(msg) + renderCompactionDivider(msg.summary);
      }
      const isUser = msg.role === 'user';
      const isArchived = compactedBeforeIdx >= 0 && idx < compactedBeforeIdx;
      let content = '';

      if (msg.attachments?.length) {
        content += this.renderAttachments(msg.attachments);
      }
      if (msg.screenshot) {
        const imgSrc = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
        content += `<img class="mimg" src="${imgSrc}" data-fullsrc="${imgSrc}" alt="Capture" data-lightbox draggable="false">`;
      }

      if (msg.content) {
        if (isUser) {
          content += `<p>${this.escapeHtml(msg.content)}</p>`;
        } else if (msg.bestOf) {
          content += this.renderBestOfContent(msg);
        } else {
          content += renderMarkdown(msg.content);
        }
      }

      const archivedClass = isArchived ? ' archived-msg' : '';
      const side = isUser ? 'mu' : 'ma';
      const badge = (!isUser && !msg.bestOf) ? renderAIBadge(msg) : '';
      const actions = isUser ? renderUserActions() : (!msg.bestOf ? renderAIActionsButtons(msg) : '');
      return `<div class="msg-wrap ${side}-wrap" data-msg-id="${msg.id}"><div class="msg ${side}${msg.bestOf ? ' bestof-winner' : ''}${archivedClass}"><div class="msg-content">${content}</div>${badge}</div>${actions}</div>`;
    }).join('');

    msgContainer.scrollTop = msgContainer.scrollHeight;

    msgContainer.querySelectorAll('[data-lightbox]').forEach(img => {
      const el = img as HTMLImageElement;
      img.addEventListener('click', () => this.showLightbox(el.dataset.fullsrc || el.src));
    });

    msgContainer.querySelectorAll('[data-att-lightbox]').forEach(img => {
      const el = img as HTMLImageElement;
      img.addEventListener('click', () => this.showLightbox(el.dataset.fullsrc || el.src));
    });

    // Generate thumbnails for large images (async, non-blocking)
    msgContainer.querySelectorAll<HTMLImageElement>('[data-fullsrc]').forEach(async (img) => {
      const maxW = img.classList.contains('msg-img-thumb') ? 160 : 800;
      const thumb = await ChatView.createThumbnail(img.dataset.fullsrc!, maxW);
      if (thumb !== img.dataset.fullsrc) img.src = thumb;
    });

    msgContainer.querySelectorAll('.bestof-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => this.toggleAlternatives(btn as HTMLElement));
    });

    msgContainer.querySelectorAll('[data-msg-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = (btn as HTMLElement).dataset.msgAction!;
        const msgEl = (btn as HTMLElement).closest('[data-msg-id]') as HTMLElement;
        if (!msgEl) return;
        const msgId = msgEl.dataset.msgId!;
        const msg = this.conversation?.messages.find(m => m.id === msgId);
        if (!msg) return;
        this.handleMessageAction(action, msg, msgEl, btn as HTMLElement);
      });
    });
  }

  private renderBestOfContent(msg: Message): string {
    const bo = msg.bestOf!;
    const n = bo.totalProviders;
    const altCount = bo.alternatives.length;

    const altsHtml = bo.alternatives.map(alt => `
      <div class="bestof-alt">
        <div class="bestof-alt-header">
          <span class="bestof-alt-rank">#${alt.rank}</span>
          <span class="bestof-alt-provider">${this.escapeHtml(alt.provider)} &middot; ${this.escapeHtml(alt.model)}</span>
          <span class="bestof-alt-time">${(alt.responseTime / 1000).toFixed(1)}s</span>
        </div>
        <div class="bestof-alt-content">${renderMarkdown(alt.content)}</div>
      </div>
    `).join('');

    const reasonHtml = bo.judgeReason
      ? `<div class="bestof-reason">&#128161; ${this.escapeHtml(bo.judgeReason)}</div>`
      : '';

    const toggleHtml = altCount > 0 ? `
      <button class="bestof-toggle-btn" data-open="false">
        Voir les ${altCount} autre${altCount > 1 ? 's' : ''} reponse${altCount > 1 ? 's' : ''} &#9660;
      </button>
      <div class="bestof-alternatives" style="display:none">${altsHtml}</div>
    ` : '';

    return `
      <div class="bestof-badge">
        <span class="bestof-badge-icon">&#10022;</span>
        <span class="bestof-badge-text">Meilleure reponse</span>
        <span class="bestof-badge-meta">Best of ${n} &middot; ${this.escapeHtml(bo.winner.provider)}</span>
      </div>
      ${renderMarkdown(msg.content)}
      ${reasonHtml}
      ${toggleHtml}
    `;
  }

  private toggleAlternatives(btn: HTMLElement) {
    const open = btn.getAttribute('data-open') === 'true';
    const alts = btn.nextElementSibling as HTMLElement;
    if (!alts) return;
    const n = alts.children.length;
    if (open) {
      alts.style.display = 'none';
      btn.setAttribute('data-open', 'false');
      btn.innerHTML = `Voir les ${n} autre${n > 1 ? 's' : ''} reponse${n > 1 ? 's' : ''} &#9660;`;
    } else {
      alts.style.display = 'flex';
      btn.setAttribute('data-open', 'true');
      btn.innerHTML = `Masquer les autres reponses &#9650;`;
    }
  }

  private bindEvents() {
    const input = this.el.querySelector<HTMLTextAreaElement>('[data-input]')!;
    const sendBtn = this.el.querySelector('[data-action="send"]')!;

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    sendBtn.addEventListener('click', () => this.sendMessage());

    this.el.querySelector('[data-action="capture"]')?.addEventListener('click', () => {
      this.events.onCapture();
    });

    this.el.querySelector('[data-action="toggle-bestof"]')?.addEventListener('click', () => {
      this.toggleBestOfMode();
    });

    this.el.querySelector('[data-action="upload-file"]')?.addEventListener('click', () => {
      this.fileInput?.click();
    });

    // Ctrl+U shortcut
    const keyHandler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
        e.preventDefault();
        this.fileInput?.click();
      }
    };
    this.el.addEventListener('keydown', keyHandler);

    // Paste images from clipboard
    this.el.querySelector<HTMLTextAreaElement>('[data-input]')?.addEventListener('paste', async (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItems = items.filter(item => item.type.startsWith('image/'));
      if (imageItems.length > 0) {
        e.preventDefault();
        const files = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
        await this.handleFiles(files);
      }
    });

    // Title dropdown menu
    this.el.querySelector('[data-action="title-menu"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.conversation) return;
      const btn = e.currentTarget as HTMLElement;
      const rect = btn.getBoundingClientRect();
      const id = this.conversation.id;
      const isFav = this.conversation.favorite;
      const ii = t();
      const inProject = !!this.conversation!.projectId;
      const items: ContextMenuItem[] = [
        { label: ii.rename, action: () => this.events.onRenameConversation?.(id) },
        { label: isFav ? 'Retirer des favoris' : 'Ajouter en favori', action: () => this.events.onToggleFavoriteConversation?.(id) },
        { label: inProject ? 'Changer de projet' : ii.moveToProject, action: () => this.events.onMoveConversation?.(id) },
      ];
      if (inProject) {
        items.push({ label: ii.removeFromProject, action: () => this.events.onRemoveFromProject?.(id) });
      }
      items.push({ label: ii.delete, danger: true, action: () => this.events.onDeleteConversation?.(id) });
      this.contextMenu.show(rect.left, rect.bottom + 4, items);
    });
  }

  private setupFileInput() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = ACCEPT_STRING;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      if (input.files?.length) await this.handleFiles(Array.from(input.files));
      input.value = '';
    });
    document.body.appendChild(input);
    this.fileInput = input;
  }

  private setupDragDrop(dropzone: HTMLElement) {
    let dragCounter = 0;
    this.el.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (!e.dataTransfer?.types?.includes('Files')) return;
      dragCounter++;
      dropzone.classList.add('active');
    });
    this.el.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) { dragCounter = 0; dropzone.classList.remove('active'); }
    });
    this.el.addEventListener('dragover', (e) => { e.preventDefault(); });
    this.el.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      dropzone.classList.remove('active');
      const files = Array.from(e.dataTransfer?.files || []);
      const newFiles = files.filter(f => !this.pendingAttachments.some(a => a.name === f.name && a.size === f.size));
      if (newFiles.length) await this.handleFiles(newFiles);
    });
  }

  private setupTauriFileDrop(dropzone: HTMLElement) {
    const tauri = (window as any).__TAURI__;
    if (!tauri?.event) return;
    // Show dropzone overlay on hover
    tauri.event.listen('tauri://file-drop-hover', () => {
      dropzone.classList.add('active');
    });
    tauri.event.listen('tauri://file-drop-cancelled', () => {
      dropzone.classList.remove('active');
    });
    // Handle dropped files
    tauri.event.listen('tauri://file-drop', async (event: any) => {
      dropzone.classList.remove('active');
      const paths: string[] = event.payload || [];
      if (!paths.length) return;
      const files: File[] = [];
      for (const filePath of paths) {
        try {
          const bytes: Uint8Array = await tauri.invoke('read_file_bytes', { path: filePath });
          const name = filePath.split(/[\\/]/).pop() || filePath;
          files.push(new File([bytes], name));
        } catch {
          // Fallback: try reading as text via fs API
          try {
            const text: string = await tauri.fs.readTextFile(filePath);
            const name = filePath.split(/[\\/]/).pop() || filePath;
            files.push(new File([text], name, { type: 'text/plain' }));
          } catch (e2: any) {
            const name = filePath.split(/[\\/]/).pop() || filePath;
            this.showToast(`Erreur de lecture : ${name}`);
          }
        }
      }
      if (files.length) await this.handleFiles(files);
    });
  }

  private async handleFiles(files: File[]) {
    const { valid, errors } = validateFiles(files, this.pendingAttachments);
    for (const err of errors) this.showToast(err);
    for (const file of valid) {
      try {
        const processed = await processFile(file);
        this.pendingAttachments.push(processed);
      } catch (e: any) {
        this.showToast(e.message || `Erreur : ${file.name}`);
      }
    }
    this.updateAttachmentChip();
  }

  private removeAttachment(id: string) {
    this.pendingAttachments = this.pendingAttachments.filter(a => a.id !== id);
    this.updateAttachmentChip();
  }

  private toggleBestOfMode() {
    if (!this.bestOfMode && !isPremium()) {
      this.showToast('Best Of est une feature Premium. Activez avec: localStorage.setItem("sai_bestof","1")');
      return;
    }
    const providers = this.getBestOfProviders();
    if (!this.bestOfMode && providers.length < 2) {
      this.showToast('Configurez au moins 2 providers avec une cle API pour utiliser Best Of.');
      return;
    }
    this.bestOfMode = !this.bestOfMode;
    this.syncBestOfButton();
    this.updateAttachmentChip();
  }

  private showToast(msg: string) {
    const toast = document.createElement('div');
    toast.className = 'bestof-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  private async sendMessage() {
    if (this.isStreaming || !this.conversation) return;

    const input = this.el.querySelector<HTMLTextAreaElement>('[data-input]')!;
    const text = input.value.trim();
    if (!text && !this.pendingAttachments.length) return;

    // Handle slash commands
    if (text && isSlashCommand(text)) {
      input.value = '';
      input.style.height = 'auto';
      const result = await handleSlashCommand(text);
      if (result.handled && result.feedback) {
        this.showToast(result.feedback);
        if (text.startsWith('/remember') || text.startsWith('/forget')) {
          const { memoryStore } = await import('../../storage');
          const facts = await memoryStore.getAll();
          this.memoryCount = facts.length;
          const indicator = this.el.querySelector('.mem-indicator');
          if (indicator) indicator.innerHTML = this.memoryCount > 0 ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;color:var(--t2)"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg> ${this.memoryCount}` : '';
        }
      }
      return;
    }

    // Get selected provider/model from the dropdown
    const selected = this.settings ? getSelectedModel(this.el, this.settings) : null;
    const activeProvider = selected?.provider || this.conversation.provider;
    const activeModel = selected?.model || this.conversation.model;

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      provider: activeProvider,
      model: activeModel,
    };

    if (this.pendingAttachments.length) {
      userMsg.attachments = [...this.pendingAttachments];
    }

    this.conversation = await conversationStore.addMessage(this.conversation.id, userMsg);
    this.events.onConversationUpdated(this.conversation);

    input.value = '';
    input.style.height = 'auto';
    this.pendingAttachments = [];
    this.updateAttachmentChip();
    this.renderMessages();

    if (this.bestOfMode) {
      await this.executeBestOfResponse();
    } else {
      await this.streamAIResponse();
    }
  }

  private async executeBestOfResponse() {
    if (!this.conversation || !this.settings) return;

    this.isStreaming = true;
    const providers = this.getBestOfProviders();
    const msgContainer = this.el.querySelector('[data-messages]')!;

    const progressEl = document.createElement('div');
    progressEl.className = 'msg ma bestof-loading';
    progressEl.innerHTML = this.renderProgress(0, providers.length,
      providers.map(p => ({ provider: p.label, status: 'loading' as const }))
    );
    msgContainer.appendChild(progressEl);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    let systemPrompt = this.settings.systemPrompt || '';
    if (this.projectInstructions) systemPrompt = this.projectInstructions + '\n\n' + systemPrompt;

    if (this.settings.memoryEnabled !== false) {
      systemPrompt = await injectMemory(systemPrompt);
    }
    let fullResponse = '';
    let bestOfData: BestOfData | undefined;

    try {
      const result = await executeBestOf(
        this.conversation.messages,
        providers,
        systemPrompt,
        (done, total, statuses) => {
          progressEl.innerHTML = this.renderProgress(done, total, statuses);
          msgContainer.scrollTop = msgContainer.scrollHeight;
        },
      );

      fullResponse = result.winner.content;
      bestOfData = {
        isBestOf: true,
        totalProviders: result.totalProviders,
        judgeReason: result.judgeReason,
        winner: {
          provider: result.winner.provider,
          model: result.winner.model,
          responseTime: result.winner.responseTime,
        },
        alternatives: result.alternatives.map(a => ({
          provider: a.provider,
          model: a.model,
          content: a.content,
          responseTime: a.responseTime,
          rank: a.rank,
        })),
      };
    } catch (err: any) {
      const errText = String(err?.message || err);
      progressEl.remove();
      const errEl = document.createElement('div');
      errEl.className = 'msg ma';
      errEl.innerHTML = `<div style="background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.3);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px"><span style="font-size:1.3em">&#9888;</span><span style="flex:1;color:var(--red)">${this.escapeHtml(errText)}</span><button class="bsm" data-action="retry" style="white-space:nowrap">Reessayer</button></div>`;
      msgContainer.appendChild(errEl);
      msgContainer.scrollTop = msgContainer.scrollHeight;
      const retryBtn = errEl.querySelector('[data-action="retry"]');
      if (retryBtn) retryBtn.addEventListener('click', () => { errEl.remove(); this.streamBestOfResponse(); });
      this.isStreaming = false;
      return;
    }

    progressEl.remove();
    const aiMsg: Message = {
      id: generateId(),
      role: 'assistant',
      content: fullResponse,
      timestamp: Date.now(),
      bestOf: bestOfData,
    };
    this.conversation = await conversationStore.addMessage(this.conversation.id, aiMsg);
    this.events.onConversationUpdated(this.conversation);
    this.renderMessages();
    this.isStreaming = false;
  }

  private renderProgress(done: number, total: number, statuses: ProviderStatus[]): string {
    const isJudging = done === total && total > 0;
    const title = isJudging
      ? `${total}/${total} reponses recues - Evaluation...`
      : done === 0
        ? `Interrogation de ${total} IA en cours...`
        : `${done}/${total} reponses recues...`;

    const icons: Record<string, string> = { waiting: '&#9675;', loading: '&#10227;', done: '&#10003;', error: '&#10007;' };
    const detail = statuses.map(s =>
      `<span class="bestof-provider ${s.status}">${this.escapeHtml(s.provider)} ${icons[s.status] || ''}</span>`
    ).join('');

    return `
      <div class="bestof-progress">
        <div class="bestof-progress-icon">&#10022;</div>
        <div class="bestof-progress-text">
          <div class="bestof-progress-title">${this.escapeHtml(title)}</div>
          <div class="bestof-progress-detail">${detail}</div>
        </div>
      </div>
    `;
  }

  private async streamAIResponse() {
    if (!this.conversation || !this.settings) return;

    this.isStreaming = true;
    const i = t();

    // Use selected provider/model from the dropdown
    const selected = getSelectedModel(this.el, this.settings);
    const activeProvider = selected?.provider || this.conversation.provider;
    const activeModel = selected?.model || this.conversation.model;
    const providerConfig = this.settings.providers[activeProvider];

    if (!providerConfig?.enabled || (!providerConfig?.apiKey && activeProvider !== 'ollama')) {
      this.showToast(`${i.configureApiKey} (${PROVIDER_LABELS[activeProvider]})`);
      this.renderMessages();
      this.isStreaming = false;
      return;
    }

    const msgContainer = this.el.querySelector('[data-messages]')!;
    const aiMsgEl = document.createElement('div');
    aiMsgEl.className = 'msg ma streaming-cursor';
    msgContainer.appendChild(aiMsgEl);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    let fullResponse = '';

    try {
      const connector = createConnector({
        ...providerConfig,
        model: activeModel,
        webSearch: this.settings?.webSearch ?? true,
      });

      let systemPrompt = this.settings.systemPrompt || '';
      if (this.projectInstructions) {
        systemPrompt = this.projectInstructions + '\n\n' + systemPrompt;
      }

      const langPrompts: Record<string, string> = {
        fr: 'Reponds toujours en francais.',
        en: 'Always respond in English.',
        es: 'Responde siempre en espanol.',
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

      const effectiveMsgs = getEffectiveMessages(this.conversation);
      await connector.send(effectiveMsgs, systemPrompt || undefined, onStream);
    } catch (err: any) {
      const errText = err.message || i.errorContact;
      aiMsgEl.innerHTML = `<div style="background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.3);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px"><span style="font-size:1.3em">&#9888;</span><span style="flex:1;color:var(--red)">${this.escapeHtml(errText)}</span><button class="bsm" data-action="retry" style="white-space:nowrap">Reessayer</button></div>`;
      aiMsgEl.classList.remove('streaming-cursor');
      const retryBtn = aiMsgEl.querySelector('[data-action="retry"]');
      if (retryBtn) retryBtn.addEventListener('click', () => { aiMsgEl.remove(); this.streamAIResponse(); });
      this.isStreaming = false;
      return;
    }

    const aiMsg: Message = {
      id: generateId(),
      role: 'assistant',
      content: fullResponse,
      timestamp: Date.now(),
      provider: activeProvider,
      model: activeModel,
    };
    this.conversation = await conversationStore.addMessage(this.conversation.id, aiMsg);
    this.events.onConversationUpdated(this.conversation);
    this.isStreaming = false;
    this.updateContextIndicator();
    await this.checkAndCompact();

    // Auto-detect memory facts
    if (this.settings?.memoryAutoDetect !== false && this.settings?.memoryEnabled !== false) {
      const providerConfig = this.settings!.providers[activeProvider];
      if (shouldDetect(this.conversation.messages)) {
        const saved = await detectAndSave(this.conversation.messages, providerConfig, this.conversation.id);
        if (saved > 0) {
          this.memoryCount += saved;
          const indicator = this.el.querySelector('.mem-indicator');
          if (indicator) indicator.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;color:var(--t2)"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg> ${this.memoryCount}`;
          this.showToast(`${saved} souvenir(s) detecte(s) automatiquement`);
        }
      }
    }
  }

  private updateAttachmentChip() {
    const meta = this.el.querySelector('[data-meta]');
    if (!meta) return;
    const chips: string[] = [];
    if (this.bestOfMode) {
      const n = this.getBestOfProviders().length;
      chips.push(`<span class="chip chip-bestof">&#10022; Interroge ${n} IA en parallele</span>`);
    }
    // All attachment chips (captures + files)
    for (const att of this.pendingAttachments) {
      const icon = att.thumbnail
        ? `<img src="${att.thumbnail}" class="attached-file-thumb" alt="">`
        : att.type === 'capture'
        ? `<span class="attached-file-icon">&#128247;</span>`
        : `<span class="attached-file-icon">${att.type === 'pdf' ? '&#128196;' : att.type === 'image' ? '&#128444;' : '&#128196;'}</span>`;
      const name = att.name.length > 28 ? att.name.slice(0, 25) + '...' : att.name;
      chips.push(`<span class="attached-file" data-att-id="${att.id}">${icon}<span class="attached-file-name">${this.escapeHtml(name)}</span><span class="attached-file-size">${formatSize(att.size)}</span><button class="attached-file-remove" data-remove-att="${att.id}" title="Retirer">&#10005;</button></span>`);
    }
    meta.innerHTML = chips.join('');
    // Bind remove buttons
    meta.querySelectorAll('[data-remove-att]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeAttachment((btn as HTMLElement).dataset.removeAtt!);
      });
    });
  }

  private showLightbox(src: string) {
    const lb = document.createElement('div');
    lb.className = 'lightbox op';
    lb.innerHTML = `<img src="${src}">`;
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
  }

  /** Downscale a data URL image for chat display (max 800px wide) */
  private static createThumbnail(dataUrl: string, maxWidth = 800): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (img.width <= maxWidth) { resolve(dataUrl); return; }
        const scale = maxWidth / img.width;
        const canvas = document.createElement('canvas');
        canvas.width = maxWidth;
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  private renderAttachments(attachments: MessageAttachment[]): string {
    if (!attachments.length) return '';
    const images = attachments.filter(a => a.type === 'image' || a.type === 'capture');
    const others = attachments.filter(a => a.type !== 'image' && a.type !== 'capture');
    let html = '';
    if (images.length > 0) {
      html += '<div class="msg-files-grid">';
      for (const img of images) {
        if (img.thumbnail || img.base64) {
          const src = img.base64 ? `data:${img.mimeType};base64,${img.base64}` : img.thumbnail!;
          html += `<img class="msg-img-thumb" src="${src}" data-fullsrc="${src}" alt="${this.escapeHtml(img.name)}" data-att-lightbox draggable="false">`;
        }
      }
      html += '</div>';
    }
    for (const att of others) {
      const icon = att.type === 'pdf' ? '&#128196;' : '&#128196;';
      const name = att.name.length > 35 ? att.name.slice(0, 32) + '...' : att.name;
      html += `<div class="msg-file"><span class="msg-file-icon">${icon}</span><div class="msg-file-info"><span class="msg-file-name">${this.escapeHtml(name)}</span><span class="msg-file-size">${formatSize(att.size)}</span></div></div>`;
    }
    return html;
  }

  private async handleMessageAction(action: string, msg: Message, msgEl: HTMLElement, btnEl: HTMLElement) {
    if (action === 'copy') {
      await navigator.clipboard.writeText(msg.content || '');
      handleCopyFeedback(btnEl);
    } else if (action === 'retry-user') {
      this.retryFromMessage(msg);
    } else if (action === 'retry-ai') {
      this.retryAIMessage(msg);
    } else if (action === 'edit') {
      this.enterEditMode(msg, msgEl);
    } else if (action === 'like') {
      btnEl.classList.toggle('active');
      const siblingDislike = msgEl.querySelector('[data-msg-action="dislike"]');
      siblingDislike?.classList.remove('active');
      msg.feedback = 'positive';
      if (this.conversation) {
        saveFeedback(msg, this.conversation.id, 'positive', undefined, this.findUserQuery(msg));
        await conversationStore.update(this.conversation.id, { messages: this.conversation.messages });
      }
    } else if (action === 'dislike') {
      btnEl.classList.toggle('active');
      const siblingLike = msgEl.querySelector('[data-msg-action="like"]');
      siblingLike?.classList.remove('active');
      msg.feedback = 'negative';
      if (this.conversation) {
        saveFeedback(msg, this.conversation.id, 'negative', undefined, this.findUserQuery(msg));
        await conversationStore.update(this.conversation.id, { messages: this.conversation.messages });
      }
      this.showFeedbackPopover(msg, msgEl, btnEl);
    }
  }

  private showFeedbackPopover(msg: Message, msgEl: HTMLElement, _btnEl: HTMLElement) {
    msgEl.querySelectorAll('.feedback-popover').forEach(p => p.remove());
    const providers = this.settings ? Object.values(this.settings.providers) : [];
    const html = renderFeedbackPopover(providers, msg.provider || '');
    const container = msgEl.querySelector('.msg-actions-ai') || msgEl;
    container.insertAdjacentHTML('beforeend', html);
    const popover = container.querySelector('.feedback-popover') as HTMLElement;
    if (popover) {
      bindPopoverEvents(popover, msg, this.conversation?.id || '', {
        onRegenerate: (m) => this.retryAIMessage(m),
        onTryOtherProvider: (m, p) => this.retryWithProvider(m, p.type as any),
      }, () => popover.remove());
    }
  }

  private findUserQuery(aiMsg: Message): string {
    if (!this.conversation) return '';
    const idx = this.conversation.messages.findIndex(m => m.id === aiMsg.id);
    if (idx <= 0) return '';
    const prev = this.conversation.messages[idx - 1];
    return prev?.role === 'user' ? (prev.content || '') : '';
  }

  private async retryFromMessage(userMsg: Message) {
    if (!this.conversation || this.isStreaming) return;
    const idx = this.conversation.messages.findIndex(m => m.id === userMsg.id);
    if (idx < 0) return;
    this.conversation.messages = this.conversation.messages.slice(0, idx + 1);
    this.conversation = await conversationStore.update(this.conversation.id, { messages: this.conversation.messages });
    this.events.onConversationUpdated(this.conversation);
    this.renderMessages();
    await this.streamAIResponse();
  }

  private async retryAIMessage(aiMsg: Message) {
    if (!this.conversation || this.isStreaming) return;
    const idx = this.conversation.messages.findIndex(m => m.id === aiMsg.id);
    if (idx < 0) return;
    this.conversation.messages = this.conversation.messages.slice(0, idx);
    this.conversation = await conversationStore.update(this.conversation.id, { messages: this.conversation.messages });
    this.events.onConversationUpdated(this.conversation);
    this.renderMessages();
    await this.streamAIResponse();
  }

  private async retryWithProvider(aiMsg: Message, providerType: string) {
    if (!this.conversation || !this.settings || this.isStreaming) return;
    const idx = this.conversation.messages.findIndex(m => m.id === aiMsg.id);
    if (idx < 0) return;
    this.conversation.messages = this.conversation.messages.slice(0, idx);
    this.conversation = await conversationStore.update(this.conversation.id, { messages: this.conversation.messages });
    this.events.onConversationUpdated(this.conversation);
    this.renderMessages();

    const pc = this.settings.providers[providerType as keyof typeof this.settings.providers];
    if (!pc?.apiKey) { this.showToast('Provider non configure'); return; }

    this.isStreaming = true;
    const msgContainer = this.el.querySelector('[data-messages]')!;
    const aiMsgEl = document.createElement('div');
    aiMsgEl.className = 'msg ma streaming-cursor';
    msgContainer.appendChild(aiMsgEl);
    msgContainer.scrollTop = msgContainer.scrollHeight;
    let fullResponse = '';

    try {
      const connector = createConnector({ ...pc, webSearch: this.settings?.webSearch ?? true });
      let systemPrompt = this.settings.systemPrompt || '';
      if (this.projectInstructions) systemPrompt = this.projectInstructions + String.fromCharCode(10, 10) + systemPrompt;
      const effectiveMsgs = getEffectiveMessages(this.conversation);
      await connector.send(effectiveMsgs, systemPrompt || undefined, (chunk, done) => {
        if (chunk) { fullResponse += chunk; aiMsgEl.innerHTML = renderMarkdown(fullResponse); msgContainer.scrollTop = msgContainer.scrollHeight; }
        if (done) aiMsgEl.classList.remove('streaming-cursor');
      });
    } catch (err: any) {
      aiMsgEl.innerHTML = '<div style="color:var(--red)">' + (err.message || 'Error') + '</div>';
      aiMsgEl.classList.remove('streaming-cursor');
      this.isStreaming = false;
      return;
    }

    const newAiMsg: Message = { id: generateId(), role: 'assistant', content: fullResponse, timestamp: Date.now(), provider: pc.type, model: pc.model };
    this.conversation = await conversationStore.addMessage(this.conversation.id, newAiMsg);
    this.events.onConversationUpdated(this.conversation);
    this.renderMessages();
    this.isStreaming = false;
  }

  private enterEditMode(msg: Message, msgEl: HTMLElement) {
    const hasImage = !!msg.screenshot;
    msgEl.classList.add('msg-editing');
    msgEl.innerHTML = renderEditMode(msg, hasImage);
    const textarea = msgEl.querySelector<HTMLTextAreaElement>('.msg-edit-textarea');
    const cancelBtn = msgEl.querySelector('.msg-edit-cancel');
    const sendBtn = msgEl.querySelector('.msg-edit-send');
    const removeImgBtn = msgEl.querySelector('[data-action="remove-edit-img"]');
    let keepImage = hasImage;

    textarea?.focus();

    cancelBtn?.addEventListener('click', () => this.renderMessages());
    removeImgBtn?.addEventListener('click', () => {
      msgEl.querySelector('.msg-edit-img-wrap')?.remove();
      keepImage = false;
    });
    sendBtn?.addEventListener('click', async () => {
      if (!this.conversation || this.isStreaming) return;
      const newText = textarea?.value.trim() || '';
      if (!newText) return;
      const idx = this.conversation.messages.findIndex(m => m.id === msg.id);
      if (idx < 0) return;
      this.conversation.messages[idx] = { ...msg, content: newText, screenshot: keepImage ? msg.screenshot : undefined };
      this.conversation.messages = this.conversation.messages.slice(0, idx + 1);
      this.conversation = await conversationStore.update(this.conversation.id, { messages: this.conversation.messages });
      this.events.onConversationUpdated(this.conversation);
      this.renderMessages();
      await this.streamAIResponse();
    });
  }

  private async checkAndCompact() {
    if (!this.conversation || !this.settings) return;
    const selected = getSelectedModel(this.el, this.settings);
    const compactProvider = selected?.provider || this.conversation.provider;
    const providerConfig = this.settings.providers[compactProvider];
    if (!providerConfig?.apiKey) return;

    let systemPrompt = this.settings.systemPrompt || '';
    if (this.projectInstructions) systemPrompt = this.projectInstructions + String.fromCharCode(10,10) + systemPrompt;

    const memoryBlock = '';

    if (!shouldCompact(this.conversation, systemPrompt, memoryBlock)) return;

    const result = await compactConversation(this.conversation, providerConfig, systemPrompt, memoryBlock);
    if (!result.success || !result.summaryMessage) return;

    const msgs = [...this.conversation.messages];
    msgs.splice(result.compactedBeforeIndex, 0, result.summaryMessage);

    this.conversation.messages = msgs;
    this.conversation.compaction = {
      compactedAt: Date.now(),
      originalMessageCount: result.originalMessageCount,
      summaryMessageId: result.summaryMessage.id,
      compactedBeforeIndex: result.compactedBeforeIndex,
    };

    this.conversation = await conversationStore.update(this.conversation.id, { messages: this.conversation.messages, compaction: this.conversation.compaction });
    this.events.onConversationUpdated(this.conversation);
    this.renderMessages();
    this.updateContextIndicator();
    this.showToast(`Conversation compactee (${result.originalMessageCount} messages resumes)`);
  }

  private updateContextIndicator() {
    const el = this.el.querySelector('[data-context-indicator]');
    if (!el || !this.conversation || !this.settings) return;
    let systemPrompt = this.settings.systemPrompt || '';
    if (this.projectInstructions) systemPrompt = this.projectInstructions + String.fromCharCode(10,10) + systemPrompt;
    const pct = getContextPercentage(this.conversation, systemPrompt, '');
    if (pct > 30) {
      el.innerHTML = renderContextIndicator(pct);
    } else {
      el.innerHTML = '';
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
