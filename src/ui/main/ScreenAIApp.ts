// ============================================
// ScreenAI — Main Application Controller
// ============================================

import type { Project, Conversation, AppSettings } from '../../types';
import { DEFAULT_MODELS } from '../../types';
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
import './styles.css';

export class ScreenAIApp {
  private sidebar!: Sidebar;
  private mainView!: MainView;
  private settingsPanel!: SettingsPanel;

  private projects: Project[] = [];
  private conversations: Conversation[] = [];
  private selectedProjectId: string | null = null;
  private selectedConversationId: string | null = null;

  constructor(private container: HTMLElement) {
    this.container.className = 'sai-app';
    this.init();
  }

  private async init() {
    // Load version info
    await initVersion();

    // Load settings and apply theme + language
    const settings = await settingsStore.get();
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

    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return;

    if (conversation.projectId) {
      this.selectedProjectId = conversation.projectId;
    }

    const project = conversation.projectId
      ? this.projects.find(p => p.id === conversation.projectId) || null
      : null;

    this.mainView.showConversation(conversation, project);
    this.sidebar.setSelection(this.selectedProjectId, id);
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

  private async handleCaptureResult(dataUrl: string) {
    if (!this.selectedConversationId) {
      // No conversation open — auto-create one with the default provider
      const settings = await settingsStore.get();
      const provider = settings.defaultProvider;
      const conv = await conversationStore.create(provider, DEFAULT_MODELS[provider]);
      this.conversations.push(conv);
      this.sidebar.setData(this.projects, this.conversations);
      await this.selectConversation(conv.id);
    }
    this.mainView.attachScreenshot(dataUrl);
  }

  private triggerCapture(mode: 'fullscreen' | 'region' = 'fullscreen') {
    if ((window as any).__TAURI__) {
      const { invoke } = (window as any).__TAURI__;
      if (invoke) {
        // Always capture fullscreen from Rust; for region mode we crop in the frontend
        invoke('capture_screen').then(async (result: any) => {
          const dataUrl = typeof result === 'string' ? result : result?.data_url;
          if (dataUrl) {
            if (mode === 'region') {
              const cropped = await this.showRegionSelector(dataUrl);
              if (cropped) await this.handleCaptureResult(cropped);
            } else {
              await this.handleCaptureResult(dataUrl);
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
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'SCREENAI_CAPTURE_TAB' }, (response: any) => {
        if (response?.dataUrl) {
          this.handleCaptureResult(response.dataUrl);
        }
      });
      return;
    }
    console.warn('Capture not available in this environment');
  }

  /** Called from desktop-main.ts when a global shortcut triggers a capture */
  async attachScreenshotFromShortcut(dataUrl: string, mode: string = 'fullscreen') {
    if (mode === 'region') {
      const cropped = await this.showRegionSelector(dataUrl);
      if (cropped) await this.handleCaptureResult(cropped);
    } else {
      await this.handleCaptureResult(dataUrl);
    }
  }
  // --- Region Selector ---

  private showRegionSelector(fullDataUrl: string): Promise<string | null> {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:crosshair;user-select:none;background:rgba(0,0,0,0.01);';

      const bgImg = document.createElement('img');
      bgImg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;';
      bgImg.src = fullDataUrl;
      overlay.appendChild(bgImg);

      const dim = document.createElement('div');
      dim.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.5);pointer-events:none;';
      overlay.appendChild(dim);

      const selBox = document.createElement('div');
      selBox.style.cssText = 'position:absolute;display:none;pointer-events:none;box-shadow:0 0 0 9999px rgba(0,0,0,0.5);border:2px solid white;';
      overlay.appendChild(selBox);

      const hint = document.createElement('div');
      hint.style.cssText = 'position:absolute;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:white;padding:8px 18px;border-radius:20px;font-size:14px;pointer-events:none;white-space:nowrap;';
      hint.textContent = 'Drag to select a region  •  ESC to cancel';
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
        overlay.remove();
        document.removeEventListener('keydown', onKey);

        if (w < 10 || h < 10) { resolve(null); return; }

        const img = new Image();
        img.onload = () => {
          const sx = img.naturalWidth / window.innerWidth;
          const sy = img.naturalHeight / window.innerHeight;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(w * sx);
          canvas.height = Math.round(h * sy);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, x * sx, y * sy, w * sx, h * sy, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        };
        img.src = fullDataUrl;
      });

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          overlay.remove();
          document.removeEventListener('keydown', onKey);
          resolve(null);
        }
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

      // Ctrl+N -> new conversation
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        this.createNewConversation();
      }
    });
  }
}
