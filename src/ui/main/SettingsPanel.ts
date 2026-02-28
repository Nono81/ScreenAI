// ============================================
// ScreenAI — Settings Panel (slide-over)
// ============================================

import type { AppSettings, AIProviderType } from '../../types';
import { PROVIDER_LABELS, MODEL_OPTIONS, LANGUAGE_LABELS, type AppLanguage } from '../../types';
import { settingsStore } from '../../storage';
import { ICONS } from './icons';
import { t, setUILanguage, type UILanguage } from './i18n';
import { getVersion } from './version';

export interface SettingsPanelEvents {
  onThemeChanged: (theme: string) => void;
  onLogout: () => void;
  onLanguageChanged?: () => void;
}

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
    const version = getVersion();

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

          <!-- Personal Preferences -->
          <div class="ss">
            <div class="sst">${i.personalPreferences}</div>
            <div class="sd" style="margin-bottom:8px">${i.personalPreferencesDesc}</div>
            <textarea class="pta" rows="3" data-setting="systemPrompt" placeholder="${i.personalPreferencesPlaceholder}">${this.escapeHtml(s.systemPrompt)}</textarea>
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
          </div>

          <!-- Shortcuts -->
          <div class="ss">
            <div class="sst">${i.shortcuts}</div>
            ${this.renderShortcuts(s)}
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

          <!-- About -->
          <div class="ss">
            <div class="sst">${i.about}</div>
            <div class="sr">
              <div class="s-l">
                <div class="sl">${i.version}</div>
                <div class="sd">v${version}</div>
              </div>
            </div>
            <div class="sr" style="flex-direction:column;gap:8px;align-items:stretch">
              <button class="upd-btn" data-action="check-update">
                ${ICONS.download}
                ${i.checkForUpdates}
              </button>
              <div class="upd-status" data-update-status style="display:none"></div>
            </div>
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

  private renderShortcuts(s: AppSettings): string {
    const i = t();
    const shortcuts = s.shortcuts || {
      captureFullscreen: 'Alt+Shift+S',
      captureRegion: 'Alt+Shift+A',
      highlight: 'Alt+Shift+H',
      search: 'Ctrl+K',
    };

    const items = [
      { key: 'captureFullscreen', label: i.captureFullscreen, shortcut: shortcuts.captureFullscreen || 'Alt+Shift+S' },
      { key: 'captureRegion', label: i.captureZone, shortcut: shortcuts.captureRegion || 'Alt+Shift+A' },
      { key: 'highlight', label: i.highlight, shortcut: shortcuts.highlight || 'Alt+Shift+H' },
      { key: 'search', label: i.search, shortcut: shortcuts.search || 'Ctrl+K' },
    ];

    return items.map(item => `
      <div class="sr shortcut-row" data-shortcut-key="${item.key}">
        <div class="s-l"><div class="sl">${item.label}</div></div>
        <div class="kbd-combo kbd-editable" data-shortcut-edit="${item.key}" title="${i.editShortcut}">
          ${item.shortcut.split('+').map(k => `<span class="kbd">${k}</span>`).join('')}
        </div>
      </div>
    `).join('');
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
      const uiLang = (lang === 'auto' ? 'en' : lang) as UILanguage;
      setUILanguage(uiLang);
      if (this.settings) this.settings.language = lang;
      this.render();
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

    // Check for updates
    this.el.querySelector('[data-action="check-update"]')?.addEventListener('click', () => this.checkForUpdates());

    // Editable shortcuts
    this.el.querySelectorAll('[data-shortcut-edit]').forEach(el => {
      el.addEventListener('click', () => this.startEditingShortcut(el as HTMLElement));
    });
  }

  private startEditingShortcut(el: HTMLElement) {
    const i = t();
    const key = el.dataset.shortcutEdit!;
    el.innerHTML = `<span class="kbd kbd-recording">${i.pressNewShortcut}</span>`;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Ignore modifier-only presses
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);

      const shortcut = parts.join('+');

      // Update settings
      if (this.settings) {
        if (!this.settings.shortcuts) {
          this.settings.shortcuts = {
            captureFullscreen: 'Alt+Shift+S',
            captureRegion: 'Alt+Shift+A',
            highlight: 'Alt+Shift+H',
            search: 'Ctrl+K',
          };
        }
        (this.settings.shortcuts as any)[key] = shortcut;
      }

      // Update display
      el.innerHTML = shortcut.split('+').map(k => `<span class="kbd">${k}</span>`).join('');
      document.removeEventListener('keydown', handler, true);
    };

    document.addEventListener('keydown', handler, true);
  }

  private async checkForUpdates() {
    const i = t();
    const statusEl = this.el.querySelector('[data-update-status]') as HTMLElement;
    const btnEl = this.el.querySelector('[data-action="check-update"]') as HTMLButtonElement;

    const isTauri = !!(window as any).__TAURI__;
    const isExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

    if (isExtension) {
      const isFirefox = navigator.userAgent.includes('Firefox');
      const storeUrl = isFirefox
        ? 'https://addons.mozilla.org/firefox/addon/screenai/'
        : 'https://chrome.google.com/webstore/detail/screenai/';
      window.open(storeUrl, '_blank');
      return;
    }

    if (!isTauri) {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.innerHTML = `<span class="upd-ok">${i.upToDate}</span>`;
        setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
      }
      return;
    }

    // Show checking state
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.innerHTML = `<span class="upd-checking">${i.checkForUpdates}...</span>`;
    }
    if (btnEl) btnEl.disabled = true;

    try {
      const result = await (window as any).__TAURI__.invoke('check_for_updates');
      if (result.available) {
        if (statusEl) {
          statusEl.innerHTML = `
            <div class="upd-avail">
              <div class="upd-avail-text">${i.updateAvailableDesc(result.version)}</div>
              <button class="upd-install-btn" data-action="install-update">
                ${ICONS.download}
                ${i.installAndRestart}
              </button>
            </div>
          `;
          statusEl.querySelector('[data-action="install-update"]')?.addEventListener('click', () => this.installUpdate());
        }
      } else {
        if (statusEl) {
          statusEl.innerHTML = `<span class="upd-ok">${i.upToDate}</span>`;
          setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
        }
      }
    } catch {
      if (statusEl) {
        statusEl.innerHTML = `<span class="upd-err">${i.updateError}</span>`;
      }
    } finally {
      if (btnEl) btnEl.disabled = false;
    }
  }

  private async installUpdate() {
    const i = t();
    const statusEl = this.el.querySelector('[data-update-status]') as HTMLElement;
    if (statusEl) {
      statusEl.innerHTML = `<span class="upd-checking">${i.downloading}</span>`;
    }

    try {
      await (window as any).__TAURI__.invoke('install_update');
    } catch {
      if (statusEl) {
        statusEl.innerHTML = `<span class="upd-err">${i.updateError}</span>`;
      }
    }
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
