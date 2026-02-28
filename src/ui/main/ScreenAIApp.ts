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

  private triggerCapture(mode: 'fullscreen' | 'region' = 'fullscreen') {
    // Desktop: use Tauri native capture
    if ((window as any).__TAURI__) {
      const { invoke } = (window as any).__TAURI__;
      if (invoke) {
        const cmd = mode === 'region' ? 'capture_region' : 'capture_screen';
        invoke(cmd).then((result: any) => {
          const dataUrl = typeof result === 'string' ? result : result?.data_url;
          if (dataUrl) {
            this.mainView.attachScreenshot(dataUrl);
          }
        }).catch((err: any) => {
          console.error('Capture failed:', err);
        });
        return;
      }
    }

    // Extension: send message to background
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'SCREENAI_CAPTURE_TAB' }, (response: any) => {
        if (response?.dataUrl) {
          this.mainView.attachScreenshot(response.dataUrl);
        }
      });
      return;
    }

    console.warn('Capture not available in this environment');
  }

  /** Called from desktop-main.ts when a global shortcut triggers a capture */
  attachScreenshotFromShortcut(dataUrl: string) {
    this.mainView.attachScreenshot(dataUrl);
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
