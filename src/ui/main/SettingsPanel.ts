// ============================================
// ScreenAI — Settings Panel (slide-over)
// ============================================

import type { AppSettings, AIProviderType, MemoryFact, MemoryCategory } from '../../types';
import { PROVIDER_LABELS, LANGUAGE_LABELS, MEMORY_CATEGORY_LABELS, type AppLanguage } from '../../types';
import { settingsStore, memoryStore } from '../../storage';
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
  private memoryFacts: MemoryFact[] = [];

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
    this.memoryFacts = await memoryStore.getAll();
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

          <!-- Language & Web Search -->
          <div class="ss">
            <div class="sst">${i.aiSection}</div>

            <div class="sr">
              <div class="s-l"><div class="sl">${i.responseLang}</div></div>
              <select class="sel" data-setting="language">
                ${(Object.keys(LANGUAGE_LABELS) as AppLanguage[]).map(k =>
                  `<option value="${k}"${k === s.language ? ' selected' : ''}>${LANGUAGE_LABELS[k]}</option>`
                ).join('')}
              </select>
            </div>

            <div class="sr">
              <div class="s-l">
                <div class="sl">Web Search</div>
                <div class="sd">Claude: native tool &mdash; Others: DuckDuckGo (auto-injected)</div>
              </div>
              <label class="tgl">
                <input type="checkbox" data-setting="webSearch" ${s.webSearch ? 'checked' : ''}>
                <span class="tgt"></span>
              </label>
            </div>
          </div>

          <!-- API Keys -->
          <div class="ss">
            <div class="api-keys-wrapper">
              <div class="api-keys-header" data-action="toggle-api-keys">
                <div>
                  <div class="api-keys-title">Mes cles API</div>
                  <div class="api-keys-desc">Utilisez vos propres cles pour un acces illimite a tous les modeles IA.</div>
                </div>
                <label class="tgl">
                  <input type="checkbox" data-setting="apiKeysEnabled" ${s.apiKeysEnabled !== false ? 'checked' : ''}>
                  <span class="tgt"></span>
                </label>
              </div>
              <div class="api-keys-content${s.apiKeysEnabled !== false ? ' expanded' : ''}" data-api-keys-content>
                ${this.renderProviderCards(s)}
              </div>
            </div>
          </div>

          <!-- Personal Preferences -->
          <div class="ss">
            <div class="sst">${i.personalPreferences}</div>
            <div class="sd" style="margin-bottom:8px">${i.personalPreferencesDesc}</div>
            <textarea class="pta" rows="3" data-setting="systemPrompt" placeholder="${i.personalPreferencesPlaceholder}">${this.escapeHtml(s.systemPrompt)}</textarea>
          </div>

          <!-- Memory -->
          <div class="ss">
            <div class="sst">Memoire</div>
            <div class="sr">
              <div class="s-l">
                <div class="sl">Activer la memoire</div>
                <div class="sd">Inject les souvenirs dans chaque conversation</div>
              </div>
              <label class="tgl">
                <input type="checkbox" data-setting="memoryEnabled" ${s.memoryEnabled !== false ? 'checked' : ''}>
                <span class="tgt"></span>
              </label>
            </div>
            <div class="sr">
              <div class="s-l">
                <div class="sl">Detection automatique</div>
                <div class="sd">L IA detecte automatiquement les faits a memoriser</div>
              </div>
              <label class="tgl">
                <input type="checkbox" data-setting="memoryAutoDetect" ${s.memoryAutoDetect !== false ? 'checked' : ''}>
                <span class="tgt"></span>
              </label>
            </div>
            ${this.renderMemoryFacts()}
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

      return `
        <div class="provider-card" data-provider="${type}">
          <div class="provider-card-header">
            <span class="provider-card-name">${PROVIDER_LABELS[type]}</span>
            <label class="tgl">
              <input type="checkbox" data-toggle-provider="${type}" ${config.enabled ? 'checked' : ''}>
              <span class="tgt"></span>
            </label>
          </div>
          <div class="provider-card-fields${config.enabled ? '' : ' disabled'}" data-provider-fields="${type}">
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
                <div class="api-key-input-wrapper">
                  <input class="api-key-input" type="password" data-provider-key="${type}" value="${config.apiKey}" placeholder="${this.getKeyPlaceholder(type)}">
                  <button class="api-key-toggle-visibility" type="button" data-toggle-key-vis="${type}" title="Afficher/Masquer">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  </button>
                </div>
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
      { key: 'captureFullscreen', label: `Capture d'ecran`, shortcut: shortcuts.captureFullscreen || 'Alt+Shift+S' },
      { key: 'captureRegion', label: 'Capture zone (directe)', shortcut: shortcuts.captureRegion || 'Alt+Shift+A' },
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

  private renderMemoryFacts(): string {
    const facts = this.memoryFacts;
    let html = '';
    if (facts.length > 0) {
      html += '<div class="mem-facts-list">';
      for (const f of facts) {
        const cat = MEMORY_CATEGORY_LABELS[f.category] || f.category;
        html += `<div class="mem-fact-row"><div class="mem-fact-content"><span class="mem-fact-cat">${this.escapeHtml(cat)}</span><span class="mem-fact-text">${this.escapeHtml(f.content)}</span></div><button class="mem-fact-del" data-delete-fact="${f.id}" title="Supprimer">&#10005;</button></div>`;
      }
      html += '</div>';
      html += '<div class="mem-add-row" style="margin-top:6px"><button class="mem-add-btn" data-action="mem-clear-all" style="background:transparent;color:var(--err);border:1px solid var(--err)">Tout effacer</button></div>';
    } else {
      html += '<div class="sd" style="margin-top:4px">Aucun souvenir enregistre.</div>';
    }
    html += '<div class="mem-add-row"><input class="si" type="text" data-mem-add-input placeholder="Ajouter un souvenir..." style="flex:1"><button class="mem-add-btn" data-action="mem-add">Ajouter</button></div>';
    return html;
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

    // Language change -> update UI language + re-render (save immediately to avoid losing change on rebuild)
    this.el.querySelector('[data-setting="language"]')?.addEventListener('change', (e) => {
      const lang = (e.target as HTMLSelectElement).value as AppLanguage;
      const uiLang = (lang === 'auto' ? 'en' : lang) as UILanguage;
      setUILanguage(uiLang);
      if (this.settings) {
        this.settings.language = lang;
        settingsStore.save(this.settings);
      }
      this.render();
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

    // API keys master toggle
    const apiKeysToggle = this.el.querySelector<HTMLInputElement>('[data-setting="apiKeysEnabled"]');
    if (apiKeysToggle) {
      apiKeysToggle.addEventListener('change', () => {
        const content = this.el.querySelector('[data-api-keys-content]');
        if (content) {
          content.classList.toggle('expanded', apiKeysToggle.checked);
        }
        if (this.settings) this.settings.apiKeysEnabled = apiKeysToggle.checked;
      });
    }

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

    // Eye icon: toggle password visibility
    this.el.querySelectorAll('[data-toggle-key-vis]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const type = (btn as HTMLElement).dataset.toggleKeyVis!;
        const input = this.el.querySelector<HTMLInputElement>(`[data-provider-key="${type}"]`);
        if (input) {
          const isPassword = input.type === 'password';
          input.type = isPassword ? 'text' : 'password';
          // Update eye icon
          (btn as HTMLElement).innerHTML = isPassword
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        }
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

    // Memory: delete fact
    this.el.querySelectorAll('[data-delete-fact]').forEach(el => {
      el.addEventListener('click', async () => {
        const id = (el as HTMLElement).dataset.deleteFact!;
        await memoryStore.delete(id);
        this.memoryFacts = this.memoryFacts.filter(f => f.id !== id);
        this.render();
      });
    });

    // Memory: add fact
    this.el.querySelector('[data-action="mem-add"]')?.addEventListener('click', async () => {
      const input = this.el.querySelector<HTMLInputElement>('[data-mem-add-input]');
      if (!input) return;
      const content = input.value.trim();
      if (!content) return;
      const fact = await memoryStore.add({ category: 'other', content, source: 'manual' });
      this.memoryFacts.push(fact);
      this.render();
    });

    // Memory: clear all
    this.el.querySelector('[data-action="mem-clear-all"]')?.addEventListener('click', async () => {
      if (!confirm('Effacer tous les souvenirs ?')) return;
      await memoryStore.deleteAll();
      this.memoryFacts = [];
      this.render();
    });
  }

  private startEditingShortcut(el: HTMLElement) {
    const i = t();
    const key = el.dataset.shortcutEdit!;
    el.innerHTML = `<span class="kbd kbd-recording">${i.pressNewShortcut}</span>`;

    const handler = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Ignore modifier-only presses
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

      // Escape cancels editing
      if (e.key === 'Escape') {
        const current = this.settings?.shortcuts?.[key as keyof typeof this.settings.shortcuts] || '';
        el.innerHTML = current ? current.split('+').map(k => `<span class="kbd">${k}</span>`).join('') : '';
        document.removeEventListener('keydown', handler, true);
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);

      // Must have at least one modifier
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        el.innerHTML = `<span class="kbd kbd-recording" style="color:#ff6b6b">Ajoutez un modificateur (Ctrl, Alt, Shift)</span>`;
        return;
      }

      const shortcut = parts.join('+');

      // Check for conflicts with other shortcuts
      if (this.settings?.shortcuts) {
        for (const [k, v] of Object.entries(this.settings.shortcuts)) {
          if (k !== key && v === shortcut) {
            el.innerHTML = `<span class="kbd kbd-recording" style="color:#ff6b6b">Conflit avec un autre raccourci</span>`;
            setTimeout(() => {
              el.innerHTML = `<span class="kbd kbd-recording">${i.pressNewShortcut}</span>`;
            }, 1500);
            return;
          }
        }
      }

      // Get old shortcut before updating
      const oldShortcut = this.settings?.shortcuts?.[key as keyof typeof this.settings.shortcuts] || '';

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

      // Update global shortcut in Tauri for capture shortcuts
      const globalActions = ['captureFullscreen', 'captureRegion'];
      if (globalActions.includes(key)) {
        const tauri = (window as any).__TAURI__;
        if (tauri?.invoke) {
          // Convert shortcut format: Tauri uses "Alt+Shift+S" style
          const action = key === 'captureRegion' ? 'captureRegion' : 'captureFullscreen';
          try {
            await tauri.invoke('update_shortcut', {
              oldShortcut: oldShortcut,
              newShortcut: shortcut,
              action,
            });
          } catch (err) {
            console.error('Failed to update global shortcut:', err);
            el.innerHTML = `<span class="kbd kbd-recording" style="color:#ff6b6b">Erreur: raccourci non disponible</span>`;
            // Revert settings
            if (this.settings?.shortcuts) {
              (this.settings.shortcuts as any)[key] = oldShortcut;
            }
            setTimeout(() => {
              el.innerHTML = oldShortcut ? oldShortcut.split('+').map(k => `<span class="kbd">${k}</span>`).join('') : '';
            }, 2000);
            document.removeEventListener('keydown', handler, true);
            return;
          }
        }
      }

      // Update display
      el.innerHTML = shortcut.split('+').map(k => `<span class="kbd">${k}</span>`).join('');
      document.removeEventListener('keydown', handler, true);

      // Auto-save shortcut change
      if (this.settings) {
        await settingsStore.save(this.settings);
      }
    };

    document.addEventListener('keydown', handler, true);
  }

  private async checkForUpdates() {
    const i = t();
    const statusEl = this.el.querySelector('[data-update-status]') as HTMLElement;
    const btnEl = this.el.querySelector('[data-action="check-update"]') as HTMLButtonElement;

    const isTauri = !!(window as any).__TAURI__;

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
    const language = this.el.querySelector<HTMLSelectElement>('[data-setting="language"]');
    if (language) this.settings.language = language.value as any;

    const systemPrompt = this.el.querySelector<HTMLTextAreaElement>('[data-setting="systemPrompt"]');
    if (systemPrompt) this.settings.systemPrompt = systemPrompt.value;

    const wsToggle = this.el.querySelector<HTMLInputElement>('[data-setting="webSearch"]');
    if (wsToggle) this.settings.webSearch = wsToggle.checked;

    const apiKeysToggle = this.el.querySelector<HTMLInputElement>('[data-setting="apiKeysEnabled"]');
    if (apiKeysToggle) this.settings.apiKeysEnabled = apiKeysToggle.checked;

    const memEnabled = this.el.querySelector<HTMLInputElement>('[data-setting="memoryEnabled"]');
    if (memEnabled) this.settings.memoryEnabled = memEnabled.checked;

    const memAutoDetect = this.el.querySelector<HTMLInputElement>('[data-setting="memoryAutoDetect"]');
    if (memAutoDetect) this.settings.memoryAutoDetect = memAutoDetect.checked;

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
      }
    }

    // Set defaultProvider to the first enabled one
    const firstEnabled = providers.find(p => this.settings!.providers[p].enabled);
    if (firstEnabled) this.settings.defaultProvider = firstEnabled;

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
