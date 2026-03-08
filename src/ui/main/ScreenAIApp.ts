// ============================================
// ScreenAI — Main Application Controller
// ============================================

import type { Project, Conversation, AppSettings } from '../../types';
import { DEFAULT_MODELS, DEFAULT_SYSTEM_PROMPT } from '../../types';
import { projectStore, conversationStore, settingsStore } from '../../storage';
import { Sidebar } from './Sidebar';
import { MainView } from './MainView';
import { SettingsPanel } from './SettingsPanel';
import {
  showNewProjectModal,
  showNewConversationModal,
  showRenameModal,
  showEditProjectModal,
  showConfirmModal,
} from './Modals';
import { t, setUILanguage, type UILanguage } from './i18n';
import { initVersion } from './version';
import { ScreenAIOverlay } from '../overlay/overlay';
import './styles.css';

export class ScreenAIApp {
  private sidebar!: Sidebar;
  private mainView!: MainView;
  private settingsPanel!: SettingsPanel;
  private navbarEl!: HTMLElement;

  private projects: Project[] = [];
  private conversations: Conversation[] = [];
  private selectedProjectId: string | null = null;
  private selectedConversationId: string | null = null;
  private sidebarVisible = true;

  // Navigation history (conversation IDs)
  private navHistory: string[] = [];
  private navIndex = -1;
  private navLocked = false;

  constructor(private container: HTMLElement) {
    this.container.className = 'sai-app';
    this.init();
  }

  private async init() {
    // Load version info
    await initVersion();

    // Load settings and apply theme + language
    const settings = await settingsStore.get();
    // Migrate old system prompts to new default
    const OLD_PROMPTS = [
      'You are a visual assistant. The user shares annotated screenshots to get help. Analyze the image and annotations (arrows, highlights, rectangles) to understand precisely what the user is showing you. Respond clearly and actionably.',
      "You are a helpful, versatile AI assistant. You can answer any question, analyze images and documents, help with code, writing, research, and more. Respond in the user's language.",
    ];
    if (OLD_PROMPTS.includes(settings.systemPrompt)) {
      settings.systemPrompt = DEFAULT_SYSTEM_PROMPT;
      await settingsStore.save(settings);
    }
    this.applyTheme(settings.theme);
    this.applyLanguage(settings.language);

    // Create components
    this.sidebar = new Sidebar(this.container, {
      onSelectProject: (id) => this.selectProject(id),
      onSelectConversation: (id) => this.selectConversation(id),
      onNewProject: () => this.createNewProject(),
      onNewConversation: () => this.createNewConversation(),
      onCapture: () => this.triggerCapture(),
      onOpenSettings: () => this.settingsPanel.toggle(),
      onRenameProject: (id) => this.renameProject(id),
      onRenameConversation: (id) => this.renameConversation(id),
      onDeleteProject: (id) => this.deleteProject(id),
      onDeleteConversation: (id) => this.deleteConversation(id),
      onMoveConversation: (id) => this.moveConversation(id),
      onToggleFavoriteProject: (id) => this.toggleFavoriteProject(id),
      onToggleFavoriteConversation: (id) => this.toggleFavoriteConversation(id),
    });

    this.mainView = new MainView(this.container, {
      onCapture: () => this.triggerCapture(),
      onCaptureFullscreen: () => this.triggerCapture('fullscreen'),
      onCaptureRegion: () => this.triggerCapture('region'),
      onEditProject: (id) => this.editProject(id),
      onConversationUpdated: (conv) => this.onConversationUpdated(conv),
    });

    this.settingsPanel = new SettingsPanel(this.mainView.getSettingsContainer(), {
      onThemeChanged: (theme) => this.applyTheme(theme),
      onLogout: () => this.handleLogout(),
      onLanguageChanged: () => this.rebuildUI(),
    });

    // Build top navbar inside main area
    this.buildNavbar();

    // Load data
    await this.loadData();

    // Global keyboard shortcuts
    this.bindGlobalShortcuts();
  }

  private async loadData() {
    this.projects = await projectStore.getAll();
    this.conversations = await conversationStore.getAll();
    this.sidebar.setData(this.projects, this.conversations);
  }

  // --- Language ---

  private applyLanguage(lang: string) {
    const uiLang = (lang === 'auto' ? 'en' : lang) as UILanguage;
    setUILanguage(uiLang);
  }

  private rebuildUI() {
    // Full rebuild: destroy and recreate all components
    this.container.innerHTML = '';
    this.init();
  }

  // --- Navigation ---

  private async selectProject(id: string) {
    this.selectedProjectId = id;
    this.selectedConversationId = null;

    const project = this.projects.find(p => p.id === id);
    if (project) {
      this.mainView.showProject(project);
    }
    this.sidebar.setSelection(id, null);
  }

  private async selectConversation(id: string) {
    this.selectedConversationId = id;
    this.pushNavHistory(id);

    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return;

    if (conversation.projectId) {
      this.selectedProjectId = conversation.projectId;
    }

    const project = conversation.projectId
      ? this.projects.find(p => p.id === conversation.projectId) || null
      : null;

    await this.mainView.showConversation(conversation, project);
    this.sidebar.setSelection(this.selectedProjectId, id);
  }

  // --- Top Navbar ---

  private buildNavbar() {
    this.navbarEl = document.createElement('div');
    this.navbarEl.className = 'topnav';
    this.navbarEl.innerHTML = `
      <button class="topnav-btn" id="topnav-hamburger" title="Sidebar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <button class="topnav-btn" id="topnav-new" title="Nouvelle conversation">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
      </button>
      <button class="topnav-btn" id="topnav-back" title="Precedent" disabled>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button class="topnav-btn" id="topnav-forward" title="Suivant" disabled>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    `;

    // Insert at top of .mn
    const mn = this.container.querySelector('.mn');
    if (mn) mn.prepend(this.navbarEl);

    // Events
    this.navbarEl.querySelector('#topnav-hamburger')!.addEventListener('click', () => this.toggleSidebar());
    this.navbarEl.querySelector('#topnav-new')!.addEventListener('click', () => this.createNewConversation());
    this.navbarEl.querySelector('#topnav-back')!.addEventListener('click', () => this.navBack());
    this.navbarEl.querySelector('#topnav-forward')!.addEventListener('click', () => this.navForward());
  }

  private toggleSidebar() {
    this.sidebarVisible = !this.sidebarVisible;
    const sb = this.container.querySelector('.sb') as HTMLElement;
    if (sb) sb.style.display = this.sidebarVisible ? '' : 'none';
  }

  private pushNavHistory(conversationId: string) {
    if (this.navLocked) return;
    // If navigating from middle of history, truncate forward
    if (this.navIndex < this.navHistory.length - 1) {
      this.navHistory = this.navHistory.slice(0, this.navIndex + 1);
    }
    // Don't push duplicates
    if (this.navHistory[this.navHistory.length - 1] !== conversationId) {
      this.navHistory.push(conversationId);
    }
    this.navIndex = this.navHistory.length - 1;
    this.updateNavButtons();
  }

  private navBack() {
    if (this.navIndex <= 0) return;
    this.navIndex--;
    this.navLocked = true;
    this.selectConversation(this.navHistory[this.navIndex]);
    this.navLocked = false;
    this.updateNavButtons();
  }

  private navForward() {
    if (this.navIndex >= this.navHistory.length - 1) return;
    this.navIndex++;
    this.navLocked = true;
    this.selectConversation(this.navHistory[this.navIndex]);
    this.navLocked = false;
    this.updateNavButtons();
  }

  private updateNavButtons() {
    const back = this.navbarEl?.querySelector('#topnav-back') as HTMLButtonElement;
    const fwd = this.navbarEl?.querySelector('#topnav-forward') as HTMLButtonElement;
    if (back) back.disabled = this.navIndex <= 0;
    if (fwd) fwd.disabled = this.navIndex >= this.navHistory.length - 1;
  }

  // --- CRUD Projects ---

  private createNewProject() {
    showNewProjectModal(async (data) => {
      await projectStore.create({
        name: data.name,
        description: data.description,
        instructions: data.instructions,
        provider: data.provider,
        model: DEFAULT_MODELS[data.provider],
      });
      await this.loadData();
    });
  }

  private editProject(id: string) {
    const project = this.projects.find(p => p.id === id);
    if (!project) return;

    showEditProjectModal(project, async (data) => {
      await projectStore.update(id, {
        name: data.name,
        description: data.description,
        instructions: data.instructions,
        provider: data.provider,
        model: DEFAULT_MODELS[data.provider],
      });
      await this.loadData();

      if (this.selectedProjectId === id) {
        this.selectProject(id);
      }
    });
  }

  private renameProject(id: string) {
    const project = this.projects.find(p => p.id === id);
    if (!project) return;

    showRenameModal(project.name, async (newName) => {
      await projectStore.update(id, { name: newName });
      await this.loadData();
    });
  }

  private deleteProject(id: string) {
    const project = this.projects.find(p => p.id === id);
    if (!project) return;

    const i = t();
    const convCount = this.conversations.filter(c => c.projectId === id).length;
    const message = convCount > 0
      ? i.deleteProjectMsg(project.name, convCount)
      : i.deleteProjectMsgSimple(project.name);

    showConfirmModal(message, async () => {
      const convos = this.conversations.filter(c => c.projectId === id);
      for (const c of convos) {
        await conversationStore.update(c.id, { projectId: undefined });
      }
      await projectStore.delete(id);

      if (this.selectedProjectId === id) {
        this.selectedProjectId = null;
        this.selectedConversationId = null;
        this.mainView.showWelcome();
      }
      await this.loadData();
    });
  }

  // --- CRUD Conversations ---

  private createNewConversation() {
    const projectList = this.projects.map(p => ({ id: p.id, name: p.name }));

    showNewConversationModal(projectList, async (data) => {
      const conv = await conversationStore.create(
        data.provider,
        DEFAULT_MODELS[data.provider],
        data.projectId || undefined
      );

      if (data.title) {
        await conversationStore.update(conv.id, { title: data.title });
      }

      await this.loadData();
      this.selectConversation(conv.id);
    });
  }

  private renameConversation(id: string) {
    const conv = this.conversations.find(c => c.id === id);
    if (!conv) return;

    showRenameModal(conv.title, async (newName) => {
      await conversationStore.update(id, { title: newName });
      await this.loadData();
    });
  }

  private deleteConversation(id: string) {
    const conv = this.conversations.find(c => c.id === id);
    if (!conv) return;

    const i = t();
    showConfirmModal(i.deleteConvMsg(conv.title), async () => {
      await conversationStore.delete(id);

      if (this.selectedConversationId === id) {
        this.selectedConversationId = null;
        if (this.selectedProjectId) {
          this.selectProject(this.selectedProjectId);
        } else {
          this.mainView.showWelcome();
        }
      }
      await this.loadData();
    });
  }

  private moveConversation(id: string) {
    const conv = this.conversations.find(c => c.id === id);
    if (!conv) return;

    const projectList = this.projects.map(p => ({ id: p.id, name: p.name }));

    showNewConversationModal(projectList, async (data) => {
      await conversationStore.update(id, { projectId: data.projectId || undefined });
      await this.loadData();
    });
  }

  // --- Callbacks ---

  private onConversationUpdated(conv: Conversation) {
    const idx = this.conversations.findIndex(c => c.id === conv.id);
    if (idx >= 0) {
      this.conversations[idx] = conv;
    }
    this.sidebar.setData(this.projects, this.conversations);
  }

  // --- Capture ---

  private showCaptureError(msg: string) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--redbg);color:var(--red);border:1px solid var(--red);border-radius:8px;padding:10px 18px;font-size:13px;z-index:999;';
    toast.textContent = 'Capture failed: ' + msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  private async handleCaptureResult(dataUrl: string, mode: 'fullscreen' | 'region' = 'fullscreen') {
    const overlay = new ScreenAIOverlay(dataUrl, mode);
    overlay.onAttach = async (annotatedDataUrl: string) => {
      if (!this.selectedConversationId) {
        const settings = await settingsStore.get();
        const provider = settings.defaultProvider;
        const conv = await conversationStore.create(provider, DEFAULT_MODELS[provider]);
        this.conversations.push(conv);
        this.sidebar.setData(this.projects, this.conversations);
        await this.selectConversation(conv.id);
      }
      this.mainView.attachScreenshot(annotatedDataUrl);
    };
    overlay.onClose = () => {
      this.loadData();
    };
  }

  private triggerCapture(mode: 'fullscreen' | 'region' = 'fullscreen') {
    // Always use the Tauri separate overlay window for capture
    const tauri = (window as any).__TAURI__;
    if (tauri?.invoke) {
      const tauriMode = mode === 'region' ? 'region' : 'toolbar';
      tauri.invoke('open_capture_overlay_cmd', { mode: tauriMode }).catch((err: any) => {
        console.error('Failed to open capture overlay:', err);
        // Fallback to in-app capture if Tauri command fails
        this.executeCapture(mode);
      });
    } else {
      // Browser preview fallback
      this.showCaptureToolbar(mode);
    }
  }

  /** Called from desktop-main.ts when Alt+Shift+S triggers the capture toolbar */
  triggerCaptureFromShortcut() {
    // No-op: the shortcut is now handled entirely by Rust
  }

  private showCaptureToolbar(defaultMode: string) {
    document.querySelector('.sai-capture-bar')?.remove();

    const bar = document.createElement('div');
    bar.className = 'sai-capture-bar';

    const modes = [
      { id: 'region', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4 3"/></svg>`, label: 'Zone' },
      { id: 'fullscreen', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/></svg>`, label: 'Plein ecran' },
      { id: 'freeform', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3c-3 0-8 1-8 6s4 4 4 8c0 2.5-2 4-2 4h12s-2-1.5-2-4c0-4 4-3 4-8s-5-6-8-6z"/></svg>`, label: 'Forme libre' },
      { id: 'window', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>`, label: 'Fenetre' },
    ];

    const btnsHtml = modes.map(m =>
      `<button class="scb${m.id === defaultMode ? ' scb-on' : ''}" data-cap-mode="${m.id}" title="${m.label}">${m.icon}<span>${m.label}</span></button>`
    ).join('');

    bar.innerHTML = `
      <div class="scb-modes">${btnsHtml}</div>
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
      <button class="scb scb-off" title="Bientot disponible" disabled><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg><span>Video</span></button>
      <div class="scb-sep"></div>
      <button class="scb-go">Capturer</button>
      <button class="scb-close" title="Annuler (Esc)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    `;

    document.body.appendChild(bar);

    let selectedMode = defaultMode;

    bar.querySelectorAll('.scb:not(.scb-off)').forEach(btn => {
      btn.addEventListener('click', () => {
        bar.querySelectorAll('.scb').forEach(b => b.classList.remove('scb-on'));
        btn.classList.add('scb-on');
        selectedMode = (btn as HTMLElement).dataset.capMode!;
      });
    });

    const cancelBar = () => { bar.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelBar(); };
    document.addEventListener('keydown', onKey);

    bar.querySelector('.scb-close')!.addEventListener('click', cancelBar);

    bar.querySelector('.scb-go')!.addEventListener('click', async () => {
      const delay = parseInt((bar.querySelector('.scb-delay-sel') as HTMLSelectElement).value) || 0;
      cancelBar();
      if (delay > 0) await this.showCountdown(delay);
      this.executeCapture(selectedMode as any);
    });
  }

  private showCountdown(seconds: number): Promise<void> {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);z-index:99999;';
      const num = document.createElement('div');
      num.style.cssText = 'font-size:120px;font-weight:700;color:white;text-shadow:0 4px 20px rgba(0,0,0,0.5);transition:transform 0.3s,opacity 0.3s;';
      overlay.appendChild(num);
      document.body.appendChild(overlay);

      let remaining = seconds;
      const tick = () => {
        if (remaining <= 0) {
          overlay.remove();
          resolve();
          return;
        }
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

  private executeCapture(mode: 'fullscreen' | 'region' | 'freeform' | 'window') {
    if ((window as any).__TAURI__) {
      const { invoke } = (window as any).__TAURI__;
      if (invoke) {
        invoke('capture_screen').then(async (result: any) => {
          const dataUrl = typeof result === 'string' ? result : result?.data_url;
          if (dataUrl) {
            if (mode === 'region') {
              const cropped = await this.showRegionSelector(dataUrl);
              if (cropped) await this.handleCaptureResult(cropped, 'fullscreen');
            } else if (mode === 'freeform') {
              const cropped = await this.showFreeformSelector(dataUrl);
              if (cropped) await this.handleCaptureResult(cropped, 'fullscreen');
            } else if (mode === 'window') {
              const cropped = await this.showWindowSelector(dataUrl);
              if (cropped) await this.handleCaptureResult(cropped, 'fullscreen');
            } else {
              await this.handleCaptureResult(dataUrl, 'fullscreen');
            }
          } else {
            this.showCaptureError('No image data returned');
          }
        }).catch((err: any) => {
          this.showCaptureError(err?.message || String(err));
        });
        return;
      }
    }
    console.warn('Capture not available in this environment');
  }

  /** Called from desktop-main.ts when a global shortcut triggers a capture */
  async attachScreenshotFromShortcut(dataUrl: string, mode: string = 'fullscreen') {
    if (mode === 'region') {
      const cropped = await this.showRegionSelector(dataUrl);
      if (cropped) await this.handleCaptureResult(cropped, 'fullscreen');
    } else if (mode === 'window') {
      const cropped = await this.showWindowSelector(dataUrl);
      if (cropped) await this.handleCaptureResult(cropped, 'fullscreen');
    } else {
      await this.handleCaptureResult(dataUrl, 'fullscreen');
    }
  }
  // --- Region Selector ---

  private async setWindowFullscreen(fs: boolean) {
    const tauri = (window as any).__TAURI__;
    if (tauri?.invoke) {
      await tauri.invoke('set_fullscreen', { fullscreen: fs }).catch(() => {});
    }
  }

  private showRegionSelector(fullDataUrl: string): Promise<string | null> {
    // Enter fullscreen so overlay covers the entire screen (Snipping Tool style)
    this.setWindowFullscreen(true);

    return new Promise(resolve => {
      const exitAndResolve = (result: string | null) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        this.setWindowFullscreen(false);
        resolve(result);
      };

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:crosshair;user-select:none;background:rgba(0,0,0,0.01);';

      const bgImg = document.createElement('img');
      bgImg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;';
      bgImg.src = fullDataUrl;
      overlay.appendChild(bgImg);

      const dim = document.createElement('div');
      dim.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:none;';
      overlay.appendChild(dim);

      const selBox = document.createElement('div');
      selBox.style.cssText = 'position:absolute;display:none;pointer-events:none;box-shadow:0 0 0 9999px rgba(0,0,0,0.45);border:2px solid #fff;';
      overlay.appendChild(selBox);

      const hint = document.createElement('div');
      hint.style.cssText = 'position:absolute;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:white;padding:10px 22px;border-radius:20px;font-size:15px;pointer-events:none;white-space:nowrap;letter-spacing:0.3px;';
      hint.textContent = 'Glisser pour sélectionner  •  Échap pour annuler';
      overlay.appendChild(hint);

      let startX = 0, startY = 0, dragging = false;

      const getRect = (ex: number, ey: number) => ({
        x: Math.min(startX, ex), y: Math.min(startY, ey),
        w: Math.abs(ex - startX), h: Math.abs(ey - startY),
      });

      overlay.addEventListener('mousedown', (e) => {
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        selBox.style.display = 'none';
      });

      overlay.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const { x, y, w, h } = getRect(e.clientX, e.clientY);
        Object.assign(selBox.style, { display: 'block', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      });

      overlay.addEventListener('mouseup', (e) => {
        if (!dragging) return;
        dragging = false;
        const { x, y, w, h } = getRect(e.clientX, e.clientY);

        if (w < 10 || h < 10) { exitAndResolve(null); return; }

        const img = new Image();
        img.onload = () => {
          const sx = img.naturalWidth / window.innerWidth;
          const sy = img.naturalHeight / window.innerHeight;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(w * sx);
          canvas.height = Math.round(h * sy);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, x * sx, y * sy, w * sx, h * sy, 0, 0, canvas.width, canvas.height);
          exitAndResolve(canvas.toDataURL('image/png'));
        };
        img.src = fullDataUrl;
      });

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          exitAndResolve(null);
        }
      };
      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
    });
  }

  // --- Window Selector ---

  private async showWindowSelector(fullDataUrl: string): Promise<string | null> {
    const tauri = (window as any).__TAURI__;
    let windowList: { title: string; x: number; y: number; w: number; h: number }[] = [];
    if (tauri?.invoke) {
      try {
        windowList = await tauri.invoke('list_windows');
      } catch { /* fallback to region */ }
    }
    if (!windowList.length) {
      return this.showRegionSelector(fullDataUrl);
    }

    this.setWindowFullscreen(true);

    return new Promise(resolve => {
      const exitAndResolve = (result: string | null) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        this.setWindowFullscreen(false);
        resolve(result);
      };

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:pointer;user-select:none;';

      const bgImg = document.createElement('img');
      bgImg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;';
      bgImg.src = fullDataUrl;
      overlay.appendChild(bgImg);

      const dim = document.createElement('div');
      dim.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:none;';
      overlay.appendChild(dim);

      const highlight = document.createElement('div');
      highlight.style.cssText = 'position:absolute;display:none;pointer-events:none;border:3px solid #a78bfa;background:rgba(167,139,250,0.08);box-shadow:0 0 0 9999px rgba(0,0,0,0.45);border-radius:4px;transition:all 0.08s;';
      overlay.appendChild(highlight);

      const label = document.createElement('div');
      label.style.cssText = 'position:absolute;display:none;pointer-events:none;background:rgba(0,0,0,0.85);color:white;padding:4px 10px;border-radius:6px;font-size:12px;white-space:nowrap;font-family:-apple-system,sans-serif;';
      overlay.appendChild(label);

      const hint = document.createElement('div');
      hint.style.cssText = 'position:absolute;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:white;padding:10px 22px;border-radius:20px;font-size:15px;pointer-events:none;white-space:nowrap;';
      hint.textContent = 'Cliquer sur une fenetre  \u2022  Echap pour annuler';
      overlay.appendChild(hint);

      // Scale factor: screen coords → viewport coords
      const dpr = window.devicePixelRatio || 1;

      overlay.addEventListener('mousemove', (e) => {
        const mx = e.clientX * dpr;
        const my = e.clientY * dpr;
        // Find the smallest window containing the cursor
        let best: typeof windowList[0] | null = null;
        let bestArea = Infinity;
        for (const win of windowList) {
          if (mx >= win.x && mx <= win.x + win.w && my >= win.y && my <= win.y + win.h) {
            const area = win.w * win.h;
            if (area < bestArea) { bestArea = area; best = win; }
          }
        }
        if (best) {
          const vx = best.x / dpr;
          const vy = best.y / dpr;
          const vw = best.w / dpr;
          const vh = best.h / dpr;
          highlight.style.display = 'block';
          highlight.style.left = vx + 'px';
          highlight.style.top = vy + 'px';
          highlight.style.width = vw + 'px';
          highlight.style.height = vh + 'px';
          label.style.display = 'block';
          label.textContent = best.title.length > 50 ? best.title.slice(0, 47) + '...' : best.title;
          label.style.left = vx + 'px';
          label.style.top = Math.max(0, vy - 28) + 'px';
        } else {
          highlight.style.display = 'none';
          label.style.display = 'none';
        }
      });

      overlay.addEventListener('click', (e) => {
        const mx = e.clientX * dpr;
        const my = e.clientY * dpr;
        let best: typeof windowList[0] | null = null;
        let bestArea = Infinity;
        for (const win of windowList) {
          if (mx >= win.x && mx <= win.x + win.w && my >= win.y && my <= win.y + win.h) {
            const area = win.w * win.h;
            if (area < bestArea) { bestArea = area; best = win; }
          }
        }
        if (!best) return;

        const img = new Image();
        img.onload = () => {
          const sx = img.naturalWidth / (window.innerWidth * dpr);
          const sy = img.naturalHeight / (window.innerHeight * dpr);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(best!.w * sx);
          canvas.height = Math.round(best!.h * sy);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, best!.x * sx, best!.y * sy, best!.w * sx, best!.h * sy, 0, 0, canvas.width, canvas.height);
          exitAndResolve(canvas.toDataURL('image/png'));
        };
        img.src = fullDataUrl;
      });

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') exitAndResolve(null);
      };
      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
    });
  }

  // --- Freeform Selector ---

  private showFreeformSelector(fullDataUrl: string): Promise<string | null> {
    this.setWindowFullscreen(true);

    return new Promise(resolve => {
      const exitAndResolve = (result: string | null) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        this.setWindowFullscreen(false);
        resolve(result);
      };

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:crosshair;user-select:none;';

      const bgImg = document.createElement('img');
      bgImg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;';
      bgImg.src = fullDataUrl;
      overlay.appendChild(bgImg);

      const dim = document.createElement('div');
      dim.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:none;';
      overlay.appendChild(dim);

      // SVG for drawing freeform path with cutout
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
      svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
      overlay.appendChild(svg);

      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('fill', 'none');
      pathEl.setAttribute('stroke', '#a78bfa');
      pathEl.setAttribute('stroke-width', '2');
      pathEl.setAttribute('stroke-dasharray', '6 4');
      svg.appendChild(pathEl);

      const hint = document.createElement('div');
      hint.style.cssText = 'position:absolute;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:white;padding:10px 22px;border-radius:20px;font-size:15px;pointer-events:none;white-space:nowrap;';
      hint.textContent = 'Dessiner une forme libre  \u2022  Echap pour annuler';
      overlay.appendChild(hint);

      const points: { x: number; y: number }[] = [];
      let drawing = false;

      overlay.addEventListener('mousedown', (e) => {
        drawing = true;
        points.length = 0;
        points.push({ x: e.clientX, y: e.clientY });
      });

      overlay.addEventListener('mousemove', (e) => {
        if (!drawing) return;
        points.push({ x: e.clientX, y: e.clientY });
        let d = `M ${points[0].x} ${points[0].y}`;
        for (let i = 1; i < points.length; i++) d += ` L ${points[i].x} ${points[i].y}`;
        pathEl.setAttribute('d', d);
      });

      overlay.addEventListener('mouseup', () => {
        if (!drawing || points.length < 10) { drawing = false; return; }
        drawing = false;

        // Crop using canvas clip
        const img = new Image();
        img.onload = () => {
          const sx = img.naturalWidth / window.innerWidth;
          const sy = img.naturalHeight / window.innerHeight;

          const xs = points.map(p => p.x);
          const ys = points.map(p => p.y);
          const minX = Math.min(...xs);
          const minY = Math.min(...ys);
          const maxX = Math.max(...xs);
          const maxY = Math.max(...ys);
          const w = maxX - minX;
          const h = maxY - minY;

          const canvas = document.createElement('canvas');
          canvas.width = Math.round(w * sx);
          canvas.height = Math.round(h * sy);
          const ctx = canvas.getContext('2d')!;

          // Draw clip path
          ctx.beginPath();
          ctx.moveTo((points[0].x - minX) * sx, (points[0].y - minY) * sy);
          for (const p of points.slice(1)) {
            ctx.lineTo((p.x - minX) * sx, (p.y - minY) * sy);
          }
          ctx.closePath();
          ctx.clip();

          ctx.drawImage(img, minX * sx, minY * sy, w * sx, h * sy, 0, 0, canvas.width, canvas.height);
          exitAndResolve(canvas.toDataURL('image/png'));
        };
        img.src = fullDataUrl;
      });

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') exitAndResolve(null);
      };
      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
    });
  }

  // --- Theme ---

  private applyTheme(theme: string) {
    if (theme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.body.classList.toggle('dark', prefersDark);
    } else {
      document.body.classList.toggle('dark', theme === 'dark');
    }
  }

  // --- Auth ---

  private handleLogout() {
    const i = t();
    showConfirmModal(i.disconnectConfirm, () => {
      // TODO: implement with Supabase auth
      console.log('Logout');
    });
  }

  // --- Keyboard Shortcuts ---

  private bindGlobalShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+K -> focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.sidebar.focusSearch();
      }

      // Escape -> close settings / modal
      if (e.key === 'Escape') {
        this.settingsPanel.close();
      }
      // Ctrl+Shift+D -> show debug payload
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        const report = localStorage.getItem('sai_debug_payload') || 'No debug data yet. Send a message with an image first.';
        alert(report);
      }

      // Ctrl+N -> new conversation
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        this.createNewConversation();
      }
    });
  }

  private async toggleFavoriteProject(id: string) {
    const p = await projectStore.get(id);
    if (!p) return;
    const newFav = !p.favorite;
    await projectStore.update(id, { favorite: newFav, favoritedAt: newFav ? Date.now() : undefined });
    await this.loadData();
  }

  private async toggleFavoriteConversation(id: string) {
    const c = await conversationStore.get(id);
    if (!c) return;
    const newFav = !c.favorite;
    await conversationStore.update(id, { favorite: newFav, favoritedAt: newFav ? Date.now() : undefined });
    await this.loadData();
  }
}
