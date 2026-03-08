// ============================================
// ScreenAI — Dynamic Model Selector Component
// ============================================

import type { AppSettings, AIProviderType, UserTier, ModelPreferences } from '../../types';
import { MODEL_LISTS, PROVIDER_SHORT_LABELS } from '../../types';

const LS_KEY = 'sai_model_prefs';

export function getModelPreferences(): ModelPreferences {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { lastProvider: '', lastModels: {} };
}

export function saveModelPreferences(prefs: ModelPreferences) {
  localStorage.setItem(LS_KEY, JSON.stringify(prefs));
}

export function getUserTier(settings: AppSettings): UserTier {
  const hasByok = settings.apiKeysEnabled !== false && hasAtLeastOneValidKey(settings);
  if (hasByok) return { type: 'byok' };
  return { type: 'free', quota: { used: 0, max: 10 } };
}

function hasAtLeastOneValidKey(settings: AppSettings): boolean {
  const p = settings.providers;
  return (
    (p.claude?.enabled && (p.claude?.apiKey?.length ?? 0) > 0) ||
    (p.openai?.enabled && (p.openai?.apiKey?.length ?? 0) > 0) ||
    (p.gemini?.enabled && (p.gemini?.apiKey?.length ?? 0) > 0) ||
    (p.mistral?.enabled && (p.mistral?.apiKey?.length ?? 0) > 0) ||
    (p.grok?.enabled && (p.grok?.apiKey?.length ?? 0) > 0) ||
    (p.ollama?.enabled && (p.ollama?.baseUrl?.length ?? 0) > 0)
  );
}

export function getAvailableProviders(settings: AppSettings): { id: AIProviderType; name: string }[] {
  const providers: { id: AIProviderType; name: string }[] = [];
  const types: AIProviderType[] = ['claude', 'openai', 'gemini', 'mistral', 'grok', 'ollama'];
  for (const type of types) {
    const config = settings.providers[type];
    if (!config?.enabled) continue;
    if (type === 'ollama') {
      if (config.baseUrl && config.baseUrl.length > 0) {
        providers.push({ id: type, name: PROVIDER_SHORT_LABELS[type] });
      }
    } else {
      if (config.apiKey && config.apiKey.length > 0) {
        providers.push({ id: type, name: PROVIDER_SHORT_LABELS[type] });
      }
    }
  }
  return providers;
}

export function renderModelSelector(tier: UserTier, settings: AppSettings): string {
  if (tier.type === 'free') {
    const q = tier.quota!;
    if (q.used >= q.max) {
      return `<div class="model-selector"><div class="model-chip model-chip-exhausted">Quota epuise &middot; Passer en Premium &rarr;</div></div>`;
    }
    return `<div class="model-selector"><div class="model-chip model-chip-free">ScreenAI Free &middot; ${q.max - q.used}/${q.max}</div></div>`;
  }

  const providers = getAvailableProviders(settings);
  if (providers.length === 0) {
    return `<div class="model-selector"><div class="model-chip model-chip-free">Aucun provider configure</div></div>`;
  }

  const prefs = getModelPreferences();
  const lastProvider = prefs.lastProvider && providers.some(p => p.id === prefs.lastProvider)
    ? prefs.lastProvider
    : providers[0].id;

  const providerOptions = providers.map(p =>
    `<option value="${p.id}"${p.id === lastProvider ? ' selected' : ''}>${p.name}</option>`
  ).join('');

  const isOllama = lastProvider === 'ollama';
  const models = MODEL_LISTS[lastProvider as AIProviderType] || [];
  const lastModel = prefs.lastModels[lastProvider] || (models.length > 0 ? models[0].id : '');

  let modelHtml = '';
  if (isOllama) {
    const ollamaModel = prefs.lastModels['ollama'] || settings.providers.ollama?.model || 'llava';
    modelHtml = `<input class="model-select model-input" type="text" data-model-input value="${ollamaModel}" placeholder="llava, llama3.2-vision...">`;
  } else if (models.length > 0) {
    const modelOptions = models.map(m =>
      `<option value="${m.id}"${m.id === lastModel ? ' selected' : ''}>${m.name}</option>`
    ).join('');
    modelHtml = `<select class="model-select model-detail-select" data-model-select>${modelOptions}</select>`;
  }

  return `<div class="model-selector">
    <select class="model-select provider-select" data-provider-select>${providerOptions}</select>
    ${modelHtml}
  </div>`;
}

export function getModelDisplayName(provider: string, model: string): string {
  const models = MODEL_LISTS[provider as AIProviderType] || [];
  const found = models.find(m => m.id === model);
  return found ? found.name : model;
}

export function renderModelBadge(provider?: string, model?: string): string {
  if (!provider || !model) return '';
  const providerLabel = PROVIDER_SHORT_LABELS[provider as AIProviderType] || provider;
  const modelName = getModelDisplayName(provider, model);
  return `<div class="msg-badge">${providerLabel} &middot; ${modelName}</div>`;
}

export interface SelectedModel {
  provider: AIProviderType;
  model: string;
}

export function getSelectedModel(container: HTMLElement, settings: AppSettings): SelectedModel | null {
  const providerSelect = container.querySelector<HTMLSelectElement>('[data-provider-select]');
  if (!providerSelect) {
    // Free tier or no provider
    return null;
  }

  const provider = providerSelect.value as AIProviderType;
  let model = '';

  if (provider === 'ollama') {
    const input = container.querySelector<HTMLInputElement>('[data-model-input]');
    model = input?.value.trim() || settings.providers.ollama?.model || 'llava';
  } else {
    const modelSelect = container.querySelector<HTMLSelectElement>('[data-model-select]');
    if (modelSelect) {
      model = modelSelect.value;
    } else {
      // Fallback to settings model
      model = settings.providers[provider]?.model || '';
    }
  }

  return { provider, model };
}

export function bindModelSelectorEvents(container: HTMLElement, settings: AppSettings) {
  const providerSelect = container.querySelector<HTMLSelectElement>('[data-provider-select]');
  if (!providerSelect) return;

  providerSelect.addEventListener('change', () => {
    const provider = providerSelect.value as AIProviderType;
    const prefs = getModelPreferences();
    prefs.lastProvider = provider;
    saveModelPreferences(prefs);
    updateModelDropdown(container, provider, settings);
  });

  const modelSelect = container.querySelector<HTMLSelectElement>('[data-model-select]');
  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      const provider = providerSelect.value;
      const prefs = getModelPreferences();
      prefs.lastModels[provider] = modelSelect.value;
      saveModelPreferences(prefs);
    });
  }

  const modelInput = container.querySelector<HTMLInputElement>('[data-model-input]');
  if (modelInput) {
    modelInput.addEventListener('change', () => {
      const prefs = getModelPreferences();
      prefs.lastModels['ollama'] = modelInput.value.trim();
      saveModelPreferences(prefs);
    });
  }
}

function updateModelDropdown(container: HTMLElement, provider: AIProviderType, settings: AppSettings) {
  // Remove existing model selector
  const existingSelect = container.querySelector('[data-model-select]');
  const existingInput = container.querySelector('[data-model-input]');
  existingSelect?.remove();
  existingInput?.remove();

  const selectorDiv = container.querySelector('.model-selector');
  if (!selectorDiv) return;

  const prefs = getModelPreferences();
  const isOllama = provider === 'ollama';

  if (isOllama) {
    const ollamaModel = prefs.lastModels['ollama'] || settings.providers.ollama?.model || 'llava';
    const input = document.createElement('input');
    input.className = 'model-select model-input';
    input.type = 'text';
    input.dataset.modelInput = '';
    input.value = ollamaModel;
    input.placeholder = 'llava, llama3.2-vision...';
    input.addEventListener('change', () => {
      const p = getModelPreferences();
      p.lastModels['ollama'] = input.value.trim();
      saveModelPreferences(p);
    });
    selectorDiv.appendChild(input);
  } else {
    const models = MODEL_LISTS[provider] || [];
    if (models.length > 0) {
      const select = document.createElement('select');
      select.className = 'model-select model-detail-select';
      select.dataset.modelSelect = '';
      const lastModel = prefs.lastModels[provider] || models[0].id;
      select.innerHTML = models.map(m =>
        `<option value="${m.id}"${m.id === lastModel ? ' selected' : ''}>${m.name}</option>`
      ).join('');
      select.addEventListener('change', () => {
        const p = getModelPreferences();
        p.lastModels[provider] = select.value;
        saveModelPreferences(p);
      });
      selectorDiv.appendChild(select);
    }
  }
}
