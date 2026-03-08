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
  onRemoveFromProject: (id: string) => void;
  onToggleFavoriteProject: (id: string) => void;
  onToggleFavoriteConversation: (id: string) => void;
  onEditProject: (id: string) => void;
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
  private expandedProjects: Set<string> = new Set();

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

  private sortByRecency<T extends { updatedAt: number }>(items: T[]): T[] {
    return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Sort projects by most recent conversation activity */
  private sortProjectsByActivity(projects: Project[], conversations: Conversation[]): Project[] {
    const projectLastActivity = new Map<string, number>();
    for (const c of conversations) {
      if (c.projectId) {
        const cur = projectLastActivity.get(c.projectId) || 0;
        if (c.updatedAt > cur) projectLastActivity.set(c.projectId, c.updatedAt);
      }
    }
    return [...projects].sort((a, b) => {
      const aTime = Math.max(a.updatedAt, projectLastActivity.get(a.id) || 0);
      const bTime = Math.max(b.updatedAt, projectLastActivity.get(b.id) || 0);
      return bTime - aTime;
    });
  }

  private renderNav() {
    const nav = this.el.querySelector('[data-nav]')!;
    const i = t();

    // Filter by search
    const { projects: rawProjects, conversations } = this.searchEngine.search(
      this.searchQuery, this.projects, this.conversations
    );

    // Sort by recency
    const projects = this.sortProjectsByActivity(rawProjects, conversations);
    const allConvos = this.sortByRecency([...conversations]);

    // Group conversations by project
    const projectConvos = new Map<string, Conversation[]>();
    for (const c of conversations) {
      if (c.projectId) {
        if (!projectConvos.has(c.projectId)) projectConvos.set(c.projectId, []);
        projectConvos.get(c.projectId)!.push(c);
      }
    }

    // Favorites: discussions only (no project favorites)
    const favConvos = allConvos.filter(c => c.favorite);

    const favoritesCollapsed = this.collapsedSections.has('favorites');
    const projectsCollapsed = this.collapsedSections.has('projects');
    const discussionsCollapsed = this.collapsedSections.has('discussions');

    let html = '';

    // === FAVORIS Section ===
    html += `<div class="sec">
      <div class="sec-h${favoritesCollapsed ? ' cl' : ''}" data-toggle="favorites">
        <span class="sec-t">${i.favorites}</span>
        ${ICONS.chevronDown}
      </div>
      <div class="sec-items">`;
    if (favConvos.length === 0) {
      html += `<div class="empty-state">${i.noFavorite}</div>`;
    } else {
      for (const c of favConvos) {
        html += `<div class="sconv${this.selectedConversationId === c.id ? ' on' : ''}" data-conversation="${c.id}">
          ${this.escapeHtml(c.title)}
        </div>`;
      }
    }
    html += `</div></div>`;

    // === PROJETS Section ===
    html += `<div class="sec">
      <div class="sec-h${projectsCollapsed ? ' cl' : ''}" data-toggle="projects">
        <span class="sec-t">${i.projects}</span>
        ${ICONS.chevronDown}
      </div>
      <div class="sec-items">`;
    if (projects.length === 0) {
      html += `<div class="empty-state">${i.noProject}</div>`;
    } else {
      for (const p of projects) {
        const convos = this.sortByRecency(projectConvos.get(p.id) || []);
        const isExpanded = this.expandedProjects.has(p.id);
        html += `<div class="sproj${isExpanded ? ' expanded' : ''}" data-project="${p.id}">
          <svg class="sproj-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;transition:transform .15s;${isExpanded ? 'transform:rotate(90deg);' : ''}"><polyline points="9 18 15 12 9 6"/></svg>
          ${ICONS.folder}
          <div class="sproj-i"><div class="sproj-n">${this.escapeHtml(p.name)}</div></div>
        </div>`;
        if (isExpanded) {
          for (const c of convos) {
            html += `<div class="sconv sconv-nested${this.selectedConversationId === c.id ? ' on' : ''}" data-conversation="${c.id}">
              ${this.escapeHtml(c.title)}
            </div>`;
          }
        }
      }
    }
    html += `</div></div>`;

    // === DISCUSSIONS Section (non-favorite conversations only) ===
    const nonFavConvos = allConvos.filter(c => !c.favorite);
    html += `<div class="sec">
      <div class="sec-h${discussionsCollapsed ? ' cl' : ''}" data-toggle="discussions">
        <span class="sec-t">${i.discussions}</span>
        ${ICONS.chevronDown}
      </div>
      <div class="sec-items">`;
    if (nonFavConvos.length === 0) {
      html += `<div class="empty-state">${i.noDiscussion}</div>`;
    } else {
      for (const c of nonFavConvos) {
        html += `<div class="sconv${this.selectedConversationId === c.id ? ' on' : ''}" data-conversation="${c.id}">
          ${this.escapeHtml(c.title)}
        </div>`;
      }
    }
    html += `</div></div>`;

    nav.innerHTML = html;

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

    // Project click — toggle expand/collapse
    nav.querySelectorAll('[data-project]').forEach(el => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.project!;
        if (this.expandedProjects.has(id)) {
          this.expandedProjects.delete(id);
        } else {
          this.expandedProjects.add(id);
        }
        this.renderNav();
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = (el as HTMLElement).dataset.project!;
        const project = this.projects.find(p => p.id === id);
        if (!project) return;
        this.contextMenu.show((e as MouseEvent).clientX, (e as MouseEvent).clientY, [
          { label: 'Modifier', action: () => this.events.onEditProject(id) },
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
        e.stopPropagation();
        const id = (el as HTMLElement).dataset.conversation!;
        const conv = this.conversations.find(c => c.id === id);
        if (!conv) return;
        const isFav = conv.favorite;
        const items: ContextMenuItem[] = [
          { label: isFav ? 'Retirer des favoris' : 'Ajouter en favori', action: () => this.events.onToggleFavoriteConversation(id) },
          { label: i.rename, action: () => this.events.onRenameConversation(id) },
          { label: conv.projectId ? 'Changer de projet' : i.moveToProject, action: () => this.events.onMoveConversation(id) },
        ];
        if (conv.projectId) {
          items.push({ label: i.removeFromProject, action: () => this.events.onRemoveFromProject(id) });
        }
        items.push({ label: i.delete, danger: true, action: () => this.events.onDeleteConversation(id) });
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
