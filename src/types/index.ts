// ============================================
// ScreenAI — Core Types
// ============================================

// --- AI Provider ---
export type AIProviderType = 'claude' | 'openai' | 'gemini' | 'mistral' | 'grok' | 'ollama';

export interface AIProviderConfig {
  type: AIProviderType;
  label: string;
  apiKey: string;
  model: string;
  baseUrl?: string; // For Ollama or custom endpoints
  enabled: boolean;
  webSearch?: boolean; // Injected at call time, not stored per provider
}

export const DEFAULT_MODELS: Record<AIProviderType, string> = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
  mistral: 'mistral-large-latest',
  grok: 'grok-3',
  ollama: 'llava',
};

export const PROVIDER_LABELS: Record<AIProviderType, string> = {
  claude: 'Claude (Anthropic)',
  openai: 'GPT (OpenAI)',
  gemini: 'Gemini (Google)',
  mistral: 'Mistral',
  grok: 'Grok (xAI)',
  ollama: 'Ollama (Local)',
};

// --- Memory ---
export type MemoryCategory = 'identity' | 'profession' | 'projects' | 'preferences' | 'instructions' | 'other';

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  identity: 'Identite',
  profession: 'Profession',
  projects: 'Projets',
  preferences: 'Preferences',
  instructions: 'Instructions',
  other: 'Autres',
};

export interface MemoryFact {
  id: string;
  category: MemoryCategory;
  content: string;
  createdAt: number;
  updatedAt: number;
  source: 'manual' | 'auto';
  conversationId?: string;
}

// --- Messages & Conversations ---
export interface Annotation {
  type: 'arrow' | 'rectangle' | 'highlight' | 'freehand' | 'text' | 'circle' | 'line' | 'highlighter' | 'blur' | 'number';
  points: { x: number; y: number }[];
  color: string;
  lineWidth: number;
  text?: string;
  number?: number;
}

export interface Screenshot {
  dataUrl: string; // base64 image
  annotations: Annotation[];
  annotatedDataUrl?: string; // screenshot + annotations merged
  timestamp: number;
  region?: { x: number; y: number; w: number; h: number };
}

// --- File Attachments ---
export type FileCategory = 'image' | 'pdf' | 'text' | 'capture' | 'unsupported';

export interface MessageAttachment {
  id: string;
  name: string;
  type: FileCategory;
  size: number;
  mimeType: string;
  base64?: string;       // images (< 1MB full, > 1MB thumbnail), PDFs for Claude/Gemini
  thumbnail?: string;   // 64x64 data URL for image preview
  textContent?: string; // extracted text (text files, code, PDF fallback)
}

export interface BestOfAlternative {
  provider: string;
  model: string;
  content: string;
  responseTime: number;
  rank: number;
}

export interface BestOfData {
  isBestOf: true;
  totalProviders: number;
  judgeReason: string;
  winner: { provider: string; model: string; responseTime: number };
  alternatives: BestOfAlternative[];
}

export interface SummaryData {
  originalMessageCount: number;
  originalTokenEstimate: number;
  summaryTokenEstimate: number;
  compactedAt: number;
}


export type FeedbackReason = 'incorrect' | 'not-useful' | 'length' | 'other';

export interface FeedbackEntry {
  id: string;
  messageId: string;
  conversationId: string;
  rating: 'positive' | 'negative';
  reason?: FeedbackReason;
  provider: string;
  model: string;
  query: string;
  hasImage: boolean;
  timestamp: number;
}
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  screenshot?: Screenshot;
  timestamp: number;
  provider?: AIProviderType;
  model?: string;
  bestOf?: BestOfData;
  attachments?: MessageAttachment[];
  summary?: SummaryData;
  feedback?: 'positive' | 'negative';
}

export interface ConversationCompaction {
  compactedAt: number;
  originalMessageCount: number;
  summaryMessageId: string;
  compactedBeforeIndex: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  provider: AIProviderType;
  model: string;
  projectId?: string; // undefined = standalone conversation
  createdAt: number;
  updatedAt: number;
  compaction?: ConversationCompaction;
  favorite?: boolean;
  favoritedAt?: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  instructions: string; // Custom system prompt for this project
  provider: AIProviderType;
  model: string;
  createdAt: number;
  updatedAt: number;
  favorite?: boolean;
  favoritedAt?: number;
}

// --- Settings ---
export type AppLanguage = 'auto' | 'en' | 'fr' | 'es' | 'de' | 'zh' | 'ja' | 'ko';
export type AppTheme = 'dark' | 'light' | 'auto';

export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  auto: 'Auto (detect)',
  en: 'English',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
};

export const LANGUAGE_PROMPTS: Record<AppLanguage, string> = {
  auto: 'Respond in the user\'s language.',
  en: 'Always respond in English.',
  fr: 'Réponds toujours en français.',
  es: 'Responde siempre en español.',
  de: 'Antworte immer auf Deutsch.',
  zh: '请始终用中文回答。',
  ja: '常に日本語で回答してください。',
  ko: '항상 한국어로 답변해 주세요.',
};

export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-6': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-sonnet-4-5-20250929': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'o1': 128000,
  'o3-mini': 128000,
  'gemini-2.5-pro': 1000000,
  'gemini-2.5-flash': 1000000,
  'gemini-2.0-flash': 1000000,
  'mistral-large-latest': 128000,
  'mistral-small-latest': 128000,
  'pixtral-large-latest': 128000,
  'grok-3': 131072,
  'grok-3-mini': 131072,
  'grok-2-vision-1220': 32768,
  'llava': 8000,
  'llama3.2-vision': 8000,
  'bakllava': 8000,
};

export const MODEL_OPTIONS: Record<AIProviderType, string[]> = {
  claude: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  mistral: ['mistral-large-latest', 'mistral-small-latest', 'pixtral-large-latest'],
  grok: ['grok-3', 'grok-3-mini', 'grok-2-vision-1220'],
  ollama: ['llava', 'llama3.2-vision', 'bakllava'],
};

export interface ModelOption {
  id: string;
  name: string;
}

export const MODEL_LISTS: Record<AIProviderType, ModelOption[]> = {
  claude: [
    { id: 'claude-opus-4-6', name: 'Opus 4.6' },
    { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
    { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5' },
    { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
    { id: 'o1', name: 'o1' },
    { id: 'o3-mini', name: 'o3-mini' },
  ],
  gemini: [
    { id: 'gemini-2.5-pro', name: '2.5 Pro' },
    { id: 'gemini-2.5-flash', name: '2.5 Flash' },
    { id: 'gemini-2.0-flash', name: '2.0 Flash' },
  ],
  mistral: [
    { id: 'mistral-large-latest', name: 'Large' },
    { id: 'mistral-small-latest', name: 'Small' },
    { id: 'pixtral-large-latest', name: 'Pixtral Large' },
  ],
  grok: [
    { id: 'grok-3', name: 'Grok 3' },
    { id: 'grok-3-mini', name: 'Grok 3 mini' },
    { id: 'grok-2-vision-1220', name: 'Grok 2 Vision' },
  ],
  ollama: [], // Free text input
};

export const PROVIDER_SHORT_LABELS: Record<AIProviderType, string> = {
  claude: 'Claude',
  openai: 'GPT',
  gemini: 'Gemini',
  mistral: 'Mistral',
  grok: 'Grok',
  ollama: 'Ollama',
};

export interface ModelPreferences {
  lastProvider: string;
  lastModels: Record<string, string>;
}

export interface UserTier {
  type: 'free' | 'premium' | 'byok' | 'premium+byok';
  quota?: { used: number; max: number };
}

export interface ShortcutConfig {
  captureFullscreen: string;
  captureRegion: string;
  highlight: string;
  search: string;
}

export interface AppSettings {
  defaultProvider: AIProviderType;
  providers: Record<AIProviderType, AIProviderConfig>;
  apiKeysEnabled: boolean;
  hotkeyFullscreen: string;
  hotkeyRegion: string;
  theme: AppTheme;
  accentColor: string;
  language: AppLanguage;
  systemPrompt: string;
  shortcuts?: ShortcutConfig;
  webSearch: boolean;
  memoryEnabled: boolean;
  memoryAutoDetect: boolean;
}

export const DEFAULT_SYSTEM_PROMPT = `Tu es ScreenAI, un assistant intelligent polyvalent. Tu peux analyser des captures d'ecran et images, rechercher des informations sur le web, repondre a toutes sortes de questions, et aider avec du code, de la redaction, et tout type de tache.

Regles de reponse :
- N'utilise jamais d'emojis dans tes reponses
- Sois direct et concis, va droit au but
- Ne fais pas de listes d'hypotheses quand tu n'es pas sur -- dis simplement que tu n'es pas certain
- Utilise un ton professionnel mais accessible
- Structure tes reponses avec des titres et paragraphes si la reponse est longue, sinon reste simple
- Reponds dans la langue de l'utilisateur`;

export const DEFAULT_SETTINGS: AppSettings = {
  defaultProvider: 'claude',
  apiKeysEnabled: true,
  providers: {
    claude: { type: 'claude', label: 'Claude', apiKey: '', model: DEFAULT_MODELS.claude, enabled: false },
    openai: { type: 'openai', label: 'OpenAI', apiKey: '', model: DEFAULT_MODELS.openai, enabled: false },
    gemini: { type: 'gemini', label: 'Gemini', apiKey: '', model: DEFAULT_MODELS.gemini, enabled: false },
    mistral: { type: 'mistral', label: 'Mistral', apiKey: '', model: DEFAULT_MODELS.mistral, enabled: false },
    grok: { type: 'grok', label: 'Grok', apiKey: '', model: DEFAULT_MODELS.grok, enabled: false },
    ollama: { type: 'ollama', label: 'Ollama', apiKey: '', model: DEFAULT_MODELS.ollama, baseUrl: 'http://localhost:11434', enabled: false },
  },
  hotkeyFullscreen: 'Alt+Shift+S',
  hotkeyRegion: 'Alt+Shift+A',
  theme: 'light',
  accentColor: '#7c3aed',
  language: 'en',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  shortcuts: {
    captureFullscreen: 'Alt+Shift+S',
    captureRegion: 'Alt+Shift+A',
    highlight: 'Alt+Shift+H',
    search: 'Ctrl+K',
  },
  webSearch: true,
  memoryEnabled: true,
  memoryAutoDetect: true,
};

// --- Events ---
export type CaptureMode = 'fullscreen' | 'region';

export interface CaptureRequest {
  mode: CaptureMode;
}

export interface CaptureResult {
  dataUrl: string;
  width: number;
  height: number;
}

// --- Utility ---
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + '…' : str;
}
