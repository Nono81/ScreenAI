// ============================================
// ScreenAI — Search Engine (debounce + filtre)
// ============================================

import type { Project, Conversation } from '../../types';

export interface SearchResults {
  projects: Project[];
  conversations: Conversation[];
}

export class SearchEngine {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs = 200;

  search(
    query: string,
    projects: Project[],
    conversations: Conversation[],
  ): SearchResults {
    if (!query.trim()) {
      return { projects, conversations };
    }

    const q = query.toLowerCase().trim();

    const matchedProjects = projects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );

    const matchedProjectIds = new Set(matchedProjects.map(p => p.id));

    const matchedConversations = conversations.filter(c => {
      // Conversation dans un projet matche
      if (c.projectId && matchedProjectIds.has(c.projectId)) return true;
      // Titre matche
      if (c.title.toLowerCase().includes(q)) return true;
      // Contenu des messages matche
      if (c.messages.some(m => m.content?.toLowerCase().includes(q))) return true;
      return false;
    });

    // Ajouter les projets parents des conversations matchees
    const extraProjectIds = new Set(
      matchedConversations
        .filter(c => c.projectId && !matchedProjectIds.has(c.projectId))
        .map(c => c.projectId!)
    );
    const extraProjects = projects.filter(p => extraProjectIds.has(p.id));

    return {
      projects: [...matchedProjects, ...extraProjects],
      conversations: matchedConversations,
    };
  }

  debounce(fn: () => void) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(fn, this.debounceMs);
  }
}
