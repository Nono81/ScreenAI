// ============================================
// ScreenAI — Settings Panel (slide-over)
// ============================================

import type { AppSettings, AIProviderType } from '../../types';
import { PROVIDER_LABELS, MODEL_OPTIONS, LANGUAGE_LABELS, type AppLanguage } from '../../types';
import { settingsStore } from '../../storage';
import { ICONS } from './icons';
import { t, setUILanguage, type UILanguage } from './i18n';

export interface SettingsPanelEvents {
  onThemeChanged: (theme: string) => void;
  onAccentChanged: (color: string) => void;
  onLogout: () => void;
  onLanguageChanged?: () => void;
}

const ACCENT_COLORS = [
  '#7c3aed', '#6366f1', '#ef4444', '#f59e0b', '#10b981', '#06b6d4'
];

export class SettingsPanel {
  private el: HTMLElement;
  private settings: AppSettings | null = null;
  private isOpen = false;

  constructor(private container: HTMLElement, private events: SettingsPanelEvents) {
    this.el = document.createElement('div');
    this.el.className = 'so';
    this.container.appendChild(this.el);

    // Close on backdrop click
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
  }

  async open() {
    this.settings = await settingsStore.get();
    this.render();
    requestAnimationFrame(() => {
      this.el.classList.add('op');
      this.isOpen = true;
    });
  }

  close() {
    this.el.classList.remove('op');
    this.isOpen = false;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  private render() {
    if (!this.settings) return;
    const s = this.settings;
    const i = t();

    this.el.innerHTML = `
      <div class="sod">
        <div class="soh">
          <button class="ib" data-action="close" title="Close">
            ${ICONS.close}
          </button>
          <h3>${i.settingsTitle}</h3>
        </div>

        <div class="sob">

          <!-- AI -->
          <div class="ss">
            <div class="sst">${i.aiSection}</div>

            <div class="sr">
              <div class="s-l"><div class="sl">${i.defaultAI}</div></div>
              <select class="sel" data-setting="defaultProvider">
                ${(Object.keys(PROVIDER_LABELS) as AIProviderType[]).map(k =>
                  `<option value="${k}"${k === s.defaultProvider ? ' selected' : ''}>${PROVIDER_LABELS[k]}</option>`
                ).join('')}
              </select>
            </div>

            <div class="sr">
              <div class="s-l"><div class="sl">${i.responseLang}</div></div>
              <select class="sel" data-setting="language">
                ${(Object.keys(LANGUAGE_LABELS) as AppLanguage[]).map(k =>
                  `<option value="${k}"${k === s.language ? ' selected' : ''}>${LANGUAGE_LABELS[k]}</option>`
                ).join('')}
              </select>
            </div>

            ${this.renderProviderCards(s)}
          </div>

          <!-- Appearance -->
          <div class="ss">
            <div class="sst">${i.appearance}</div>

            <div class="sr" style="flex-direction:column;gap:8px;align-items:flex-start">
              <div class="sl">${i.theme}</div>
              <div class="th-row">
                <div class="th-o${s.theme === 'light' ? ' on' : ''}" data-theme="light">${i.light}</div>
                <div class="th-o${s.theme === 'dark' ? ' on' : ''}" data-theme="dark">${i.dark}</div>
                <div class="th-o${s.theme === 'auto' ? ' on' : ''}" data-theme="auto">${i.auto}</div>
              </div>
            </div>

            <div class="sr" style="flex-direction:column;gap:8px;align-items:flex-start">
              <div class="sl">${i.accentColor}</div>
              <div class="ac-row">
                ${ACCENT_COLORS.map(c =>
                  `<div class="ac-o${c === s.accentColor ? ' on' : ''}" style="background:${c}" data-accent="${c}"></div>`
                ).join('')}
              </div>
            </div>
          </div>

          <!-- System Prompt -->
          <div class="ss">
            <div class="sst">${i.systemPrompt}</div>
            <div class="sd">${i.systemPromptDesc}</div>
            <textarea class="pta" rows="4" data-setting="systemPrompt">${this.escapeHtml(s.systemPrompt)}</textarea>
          </div>

          <!-- Shortcuts -->
          <div class="ss">
            <div class="sst">${i.shortcuts}</div>
            <div class="sr">
              <div class="s-l"><div class="sl">${i.captureFullscreen}</div></div>
              <div class="kbd-combo">
                <span class="kbd">Alt</span><span class="kbd">Shift</span><span class="kbd">S</span>
              </div>
            </div>
            <div class="sr">
              <div class="s-l"><div class="sl">${i.captureZone}</div></div>
              <div class="kbd-combo">
                <span class="kbd">Alt</span><span class="kbd">Shift</span><span class="kbd">A</span>
              </div>
            </div>
            <div class="sr">
              <div class="s-l"><div class="sl">${i.highlight}</div></div>
              <div class="kbd-combo">
                <span class="kbd">Alt</span><span class="kbd">Shift</span><span class="kbd">H</span>
              </div>
            </div>
            <div class="sr">
              <div class="s-l"><div class="sl">${i.search}</div></div>
              <div class="kbd-combo">
                <span class="kbd">Ctrl</span><span class="kbd">K</span>
              </div>
            </div>
          </div>

          <!-- Account -->
          <div class="ss">
            <div class="sst">${i.account}</div>
            <div class="sr">
              <div class="s-l">
                <div class="sl">${i.localMode}</div>
                <div class="sd">${i.localModeDesc}</div>
              </div>
            </div>
            <button class="sb-ft-btn" data-action="logout" style="margin-top:4px">
              ${ICONS.logOut}
              ${i.logOut}
            </button>
          </div>

          <button class="bsv" data-action="save">${i.save}</button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderProviderCards(s: AppSettings): string {
    const i = t();
    const providers: AIProviderType[] = ['claude', 'openai', 'gemini', 'mistral', 'grok', 'ollama'];

    return providers.map(type => {
      const config = s.providers[type];
      const isOllama = type === 'ollama';
      const models = MODEL_OPTIONS[type] || [];

      return `
        <div class="pc" data-provider="${type}">
          <div class="pch">
            <span class="pcn">${PROVIDER_LABELS[type]}</span>
            <label class="tgl">
              <input type="checkbox" data-toggle-provider="${type}" ${config.enabled ? 'checked' : ''}>
              <span class="tgt"></span>
            </label>
          </div>
          <div class="pcf${config.enabled ? '' : ' disabled'}" data-provider-fields="${type}">
            ${isOllama ? `
              <div>
                <div class="fl">${i.serverUrl}</div>
                <input class="si" type="text" data-provider-url="${type}" value="${config.baseUrl || 'http://localhost:11434'}" placeholder="http://localhost:11434">
              </div>
              <div>
                <div class="fl">${i.model}</div>
                <input class="si" type="text" data-provider-model-input="${type}" value="${config.model}" placeholder="llava, llama3.2-vision...">
              </div>
            ` : `
              <div>
                <div class="fl">${i.apiKey}</div>
                <input class="si" type="password" data-provider-key="${type}" value="${config.apiKey}" placeholder="${this.getKeyPlaceholder(type)}">
              </div>
              <div>
                <div class="fl">${i.model}</div>
                <select class="sel" data-provider-model="${type}">
                  ${models.map(m => `<option value="${m}"${m === config.model ? ' selected' : ''}>${m}</option>`).join('')}
                </select>
              </div>
            `}
          </div>
        </div>
      `;
    }).join('');
  }

  private getKeyPlaceholder(type: AIProviderType): string {
    const placeholders: Partial<Record<AIProviderType, string>> = {
      claude: 'sk-ant-...',
      openai: 'sk-...',
      gemini: 'AI...',
      mistral: '...',
      grok: 'xai-...',
    };
    return placeholders[type] || '...';
  }

  private bindEvents() {
    // Close
    this.el.querySelector('[data-action="close"]')?.addEventListener('click', () => this.close());

    // Language change -> update UI language + re-render
    this.el.querySelector('[data-setting="language"]')?.addEventListener('change', (e) => {
      const lang = (e.target as HTMLSelectElement).value as AppLanguage;
      // Map AppLanguage to UILanguage (auto -> en)
      const uiLang = (lang === 'auto' ? 'en' : lang) as UILanguage;
      setUILanguage(uiLang);
      if (this.settings) this.settings.language = lang;
      // Re-render settings panel
      this.render();
      // Notify parent to re-render the whole UI
      this.events.onLanguageChanged?.();
    });

    // Theme
    this.el.querySelectorAll('[data-theme]').forEach(el => {
      el.addEventListener('click', () => {
        const theme = (el as HTMLElement).dataset.theme!;
        this.el.querySelectorAll('.th-o').forEach(t => t.classList.remove('on'));
        el.classList.add('on');
        if (this.settings) this.settings.theme = theme as any;
        this.events.onThemeChanged(theme);
      });
    });

    // Accent colors
    this.el.querySelectorAll('[data-accent]').forEach(el => {
      el.addEventListener('click', () => {
        const color = (el as HTMLElement).dataset.accent!;
        this.el.querySelectorAll('.ac-o').forEach(a => a.classList.remove('on'));
        el.classList.add('on');
        if (this.settings) this.settings.accentColor = color;
        this.events.onAccentChanged(color);
      });
    });

    // Provider toggles
    this.el.querySelectorAll('[data-toggle-provider]').forEach(el => {
      el.addEventListener('change', () => {
        const type = (el as HTMLInputElement).dataset.toggleProvider as AIProviderType;
        const enabled = (el as HTMLInputElement).checked;
        const fields = this.el.querySelector(`[data-provider-fields="${type}"]`);
        if (fields) {
          fields.classList.toggle('disabled', !enabled);
        }
        if (this.settings) this.settings.providers[type].enabled = enabled;
      });
    });

    // Save
    this.el.querySelector('[data-action="save"]')?.addEventListener('click', () => this.save());

    // Logout
    this.el.querySelector('[data-action="logout"]')?.addEventListener('click', () => {
      this.events.onLogout();
    });
  }

  private async save() {
    if (!this.settings) return;
    const i = t();

    // Collect values
    const defaultProvider = this.el.querySelector<HTMLSelectElement>('[data-setting="defaultProvider"]');
    if (defaultProvider) this.settings.defaultProvider = defaultProvider.value as AIProviderType;

    const language = this.el.querySelector<HTMLSelectElement>('[data-setting="language"]');
    if (language) this.settings.language = language.value as any;

    const systemPrompt = this.el.querySelector<HTMLTextAreaElement>('[data-setting="systemPrompt"]');
    if (systemPrompt) this.settings.systemPrompt = systemPrompt.value;

    // Provider configs
    const providers: AIProviderType[] = ['claude', 'openai', 'gemini', 'mistral', 'grok', 'ollama'];
    for (const type of providers) {
      const toggle = this.el.querySelector<HTMLInputElement>(`[data-toggle-provider="${type}"]`);
      if (toggle) this.settings.providers[type].enabled = toggle.checked;

      if (type === 'ollama') {
        const url = this.el.querySelector<HTMLInputElement>(`[data-provider-url="${type}"]`);
        if (url) this.settings.providers[type].baseUrl = url.value;
        const model = this.el.querySelector<HTMLInputElement>(`[data-provider-model-input="${type}"]`);
        if (model) this.settings.providers[type].model = model.value;
      } else {
        const key = this.el.querySelector<HTMLInputElement>(`[data-provider-key="${type}"]`);
        if (key) this.settings.providers[type].apiKey = key.value;
        const model = this.el.querySelector<HTMLSelectElement>(`[data-provider-model="${type}"]`);
        if (model) this.settings.providers[type].model = model.value;
      }
    }

    await settingsStore.save(this.settings);

    // Feedback
    const saveBtn = this.el.querySelector<HTMLButtonElement>('[data-action="save"]')!;
    saveBtn.textContent = i.saved;
    saveBtn.style.background = 'var(--grn)';
    setTimeout(() => {
      saveBtn.textContent = i.save;
      saveBtn.style.background = '';
    }, 1500);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
