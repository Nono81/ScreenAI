// ============================================
// ScreenAI — Main View (welcome + project header + chat)
// ============================================

import type { Project, Conversation } from '../../types';
import { ICONS } from './icons';
import { ChatView, type ChatViewEvents } from './ChatView';
import { t } from './i18n';

export interface MainViewEvents extends ChatViewEvents {
  onCapture: () => void;
  onEditProject: (id: string) => void;
}

export class MainView {
  private el: HTMLElement;
  private welcomeEl: HTMLElement;
  private projectHeaderEl: HTMLElement;
  private chatView: ChatView;
  private currentProject: Project | null = null;

  constructor(private container: HTMLElement, private events: MainViewEvents) {
    this.el = document.createElement('div');
    this.el.className = 'mn';
    this.container.appendChild(this.el);

    // Welcome screen
    this.welcomeEl = document.createElement('div');
    this.welcomeEl.className = 'welc';
    this.el.appendChild(this.welcomeEl);

    // Project header
    this.projectHeaderEl = document.createElement('div');
    this.projectHeaderEl.className = 'ph';
    this.projectHeaderEl.style.display = 'none';
    this.el.appendChild(this.projectHeaderEl);

    // Chat view
    this.chatView = new ChatView(this.el, {
      onCaptureFullscreen: events.onCaptureFullscreen,
      onCaptureRegion: events.onCaptureRegion,
      onConversationUpdated: events.onConversationUpdated,
    });

    this.renderWelcome();
  }

  showWelcome() {
    this.currentProject = null;
    this.welcomeEl.classList.remove('hid');
    this.projectHeaderEl.style.display = 'none';
    this.chatView.setConversation(null);
  }

  showProject(project: Project) {
    this.currentProject = project;
    this.welcomeEl.classList.add('hid');
    this.renderProjectHeader(project);
    this.projectHeaderEl.style.display = '';
    this.chatView.setConversation(null);
  }

  showConversation(conversation: Conversation, project: Project | null) {
    this.currentProject = project;
    this.welcomeEl.classList.add('hid');

    if (project) {
      this.renderProjectHeader(project);
      this.projectHeaderEl.style.display = '';
    } else {
      this.projectHeaderEl.style.display = 'none';
    }

    this.chatView.setConversation(conversation, project?.instructions || '');
  }

  attachScreenshot(dataUrl: string) {
    this.chatView.attachScreenshot(dataUrl);
  }

  getSettingsContainer(): HTMLElement {
    return this.el;
  }

  private renderWelcome() {
    const isMac = navigator.platform?.toLowerCase().includes('mac');
    const mod1 = isMac ? '⌥' : 'Alt';
    const mod2 = isMac ? '⇧' : 'Shift';
    const i = t();

    this.welcomeEl.innerHTML = `
      <div class="welc-ico">
        ${ICONS.camera}
      </div>
      <h1>${i.welcomeTitle}</h1>
      <p>${i.welcomeDesc}</p>
      <button class="bcap bcap-lg" data-action="capture">
        ${ICONS.camera}
        ${i.captureMyScreen}
      </button>
      <div class="scuts">
        <div>
          <span class="kbd">${mod1}</span>
          <span class="kbd">${mod2}</span>
          <span class="kbd">S</span>
          ${i.fullscreen}
        </div>
        <div>
          <span class="kbd">${mod1}</span>
          <span class="kbd">${mod2}</span>
          <span class="kbd">A</span>
          ${i.zone}
        </div>
      </div>
    `;

    this.welcomeEl.querySelector('[data-action="capture"]')?.addEventListener('click', () => {
      this.events.onCapture();
    });
  }

  private renderProjectHeader(project: Project) {
    this.projectHeaderEl.innerHTML = `
      <div class="ph-top">
        <h2>${this.escapeHtml(project.name)}</h2>
        <button class="ib" data-action="edit-project" title="Edit">
          ${ICONS.edit}
        </button>
      </div>
      ${project.description ? `<div class="ph-desc">${this.escapeHtml(project.description)}</div>` : ''}
      ${project.instructions ? `<div class="ph-instr">${this.escapeHtml(project.instructions)}</div>` : ''}
    `;

    this.projectHeaderEl.querySelector('[data-action="edit-project"]')?.addEventListener('click', () => {
      if (this.currentProject) {
        this.events.onEditProject(this.currentProject.id);
      }
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
