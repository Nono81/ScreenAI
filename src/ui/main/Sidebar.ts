// ============================================
// ScreenAI — Sidebar Component
// ============================================

import type { Project, Conversation } from '../../types';
import { ICONS } from './icons';
import { SearchEngine } from './SearchEngine';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { t } from './i18n';
import { getVersion } from './version';

export interface SidebarEvents {
  onSelectProject: (projectId: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onNewProject: () => void;
  onNewConversation: () => void;
  onCapture: () => void;
  onOpenSettings: () => void;
  onRenameProject: (id: string) => void;
  onRenameConversation: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onMoveConversation: (id: string) => void;
}

export class Sidebar {
  private el: HTMLElement;
  private searchEngine = new SearchEngine();
  private contextMenu = new ContextMenu();
  private projects: Project[] = [];
  private conversations: Conversation[] = [];
  private selectedProjectId: string | null = null;
  private selectedConversationId: string | null = null;
  private searchQuery = '';
  private collapsedSections: Set<string> = new Set();

  constructor(private container: HTMLElement, private events: SidebarEvents) {
    this.el = document.createElement('div');
    this.el.className = 'sb';
    this.container.appendChild(this.el);

    // Load collapsed state from localStorage
    try {
      const saved = localStorage.getItem('screenai_collapsed');
      if (saved) this.collapsedSections = new Set(JSON.parse(saved));
    } catch {}

    this.render();
  }

  setData(projects: Project[], conversations: Conversation[]) {
    this.projects = projects;
    this.conversations = conversations;
    this.renderNav();
  }

  setSelection(projectId: string | null, conversationId: string | null) {
    this.selectedProjectId = projectId;
    this.selectedConversationId = conversationId;
    this.renderNav();
  }

  private render() {
    const i = t();
    this.el.innerHTML = `
      <div class="sb-top">
        <div class="sb-brand">
          <div class="logo">${ICONS.logo}</div>
          <span class="sb-name">ScreenAI</span>
          <span class="ver">v${getVersion()}</span>
        </div>
        <button class="bcap" data-action="capture">
          ${ICONS.camera}
          ${i.captureScreen}
        </button>
        <div class="brow">
          <button class="bghost" data-action="new-conversation">
            ${ICONS.plus} ${i.discussion}
          </button>
          <button class="bghost" data-action="new-project">
            ${ICONS.folder} ${i.project}
          </button>
        </div>
      </div>

      <div class="sb-srch">
        <div class="srch-w">
          ${ICONS.search}
          <input class="srch" placeholder="${i.searchPlaceholder}" data-search>
        </div>
      </div>

      <div class="sb-nav" data-nav></div>

      <div class="sb-ft">
        <button class="sb-ft-btn" data-action="settings">
          ${ICONS.settings}
          ${i.settings}
        </button>
      </div>
    `;

    // Event listeners
    this.el.querySelector('[data-action="capture"]')?.addEventListener('click', () => this.events.onCapture());
    this.el.querySelector('[data-action="new-conversation"]')?.addEventListener('click', () => this.events.onNewConversation());
    this.el.querySelector('[data-action="new-project"]')?.addEventListener('click', () => this.events.onNewProject());
    this.el.querySelector('[data-action="settings"]')?.addEventListener('click', () => this.events.onOpenSettings());

    // Search
    const searchInput = this.el.querySelector<HTMLInputElement>('[data-search]')!;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.searchEngine.debounce(() => this.renderNav());
    });

    this.renderNav();
  }

  private renderNav() {
    const nav = this.el.querySelector('[data-nav]')!;
    const i = t();

    // Filter by search
    const { projects, conversations } = this.searchEngine.search(
      this.searchQuery, this.projects, this.conversations
    );

    // Projects and their conversations
    const projectConvos = new Map<string, Conversation[]>();
    const standalone: Conversation[] = [];

    for (const c of conversations) {
      if (c.projectId) {
        if (!projectConvos.has(c.projectId)) projectConvos.set(c.projectId, []);
        projectConvos.get(c.projectId)!.push(c);
      } else {
        standalone.push(c);
      }
    }

    const projectsCollapsed = this.collapsedSections.has('projects');
    const discussionsCollapsed = this.collapsedSections.has('discussions');

    nav.innerHTML = `
      <!-- Projects Section -->
      <div class="sec">
        <div class="sec-h${projectsCollapsed ? ' cl' : ''}" data-toggle="projects">
          <span class="sec-t">${i.projects}</span>
          ${ICONS.chevronDown}
        </div>
        <div class="sec-items">
          ${projects.length === 0 ? `<div class="empty-state">${i.noProject}</div>` :
            projects.map(p => {
              const convos = projectConvos.get(p.id) || [];
              const isActive = this.selectedProjectId === p.id;
              return `
                <div class="sproj${isActive ? ' on' : ''}" data-project="${p.id}">
                  ${ICONS.folder}
                  <div class="sproj-i">
                    <div class="sproj-n">${this.escapeHtml(p.name)}</div>
                    <div class="sproj-m">${convos.length} ${i.conversations}</div>
                  </div>
                </div>
                ${isActive ? convos.map(c => `
                  <div class="sconv${this.selectedConversationId === c.id ? ' on' : ''}" data-conversation="${c.id}">
                    ${this.escapeHtml(c.title)}
                  </div>
                `).join('') : ''}
              `;
            }).join('')
          }
        </div>
      </div>

      <!-- Discussions Section -->
      <div class="sec">
        <div class="sec-h${discussionsCollapsed ? ' cl' : ''}" data-toggle="discussions">
          <span class="sec-t">${i.discussions}</span>
          ${ICONS.chevronDown}
        </div>
        <div class="sec-items">
          ${standalone.length === 0 ? `<div class="empty-state">${i.noDiscussion}</div>` :
            standalone.map(c => `
              <div class="sconv${this.selectedConversationId === c.id ? ' on' : ''}" data-conversation="${c.id}">
                ${this.escapeHtml(c.title)}
              </div>
            `).join('')
          }
        </div>
      </div>
    `;

    // Section collapse toggles
    nav.querySelectorAll('[data-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const section = (el as HTMLElement).dataset.toggle!;
        if (this.collapsedSections.has(section)) {
          this.collapsedSections.delete(section);
        } else {
          this.collapsedSections.add(section);
        }
        this.saveCollapsedState();
        this.renderNav();
      });
    });

    // Project click
    nav.querySelectorAll('[data-project]').forEach(el => {
      el.addEventListener('click', () => {
        this.events.onSelectProject((el as HTMLElement).dataset.project!);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const id = (el as HTMLElement).dataset.project!;
        const project = this.projects.find(p => p.id === id);
        if (!project) return;
        this.contextMenu.show((e as MouseEvent).clientX, (e as MouseEvent).clientY, [
          { label: i.rename, action: () => this.events.onRenameProject(id) },
          { label: i.delete, danger: true, action: () => this.events.onDeleteProject(id) },
        ]);
      });
    });

    // Conversation click
    nav.querySelectorAll('[data-conversation]').forEach(el => {
      el.addEventListener('click', () => {
        this.events.onSelectConversation((el as HTMLElement).dataset.conversation!);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const id = (el as HTMLElement).dataset.conversation!;
        const items: ContextMenuItem[] = [
          { label: i.rename, action: () => this.events.onRenameConversation(id) },
          { label: i.moveToProject, action: () => this.events.onMoveConversation(id) },
          { label: i.delete, danger: true, action: () => this.events.onDeleteConversation(id) },
        ];
        this.contextMenu.show((e as MouseEvent).clientX, (e as MouseEvent).clientY, items);
      });
    });
  }

  focusSearch() {
    const input = this.el.querySelector<HTMLInputElement>('[data-search]');
    input?.focus();
  }

  private saveCollapsedState() {
    try {
      localStorage.setItem('screenai_collapsed', JSON.stringify([...this.collapsedSections]));
    } catch {}
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
