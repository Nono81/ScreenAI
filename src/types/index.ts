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
}

export const DEFAULT_MODELS: Record<AIProviderType, string> = {
  claude: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  mistral: 'mistral-large-latest',
  grok: 'grok-2-vision-1220',
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

// --- Messages & Conversations ---
export interface Annotation {
  type: 'arrow' | 'rectangle' | 'highlight' | 'freehand' | 'text';
  points: { x: number; y: number }[];
  color: string;
  lineWidth: number;
  text?: string;
}

export interface Screenshot {
  dataUrl: string; // base64 image
  annotations: Annotation[];
  annotatedDataUrl?: string; // screenshot + annotations merged
  timestamp: number;
  region?: { x: number; y: number; w: number; h: number };
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  screenshot?: Screenshot;
  timestamp: number;
  provider?: AIProviderType;
  model?: string;
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

export const MODEL_OPTIONS: Record<AIProviderType, string[]> = {
  claude: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-20250514'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview'],
  gemini: ['gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  mistral: ['mistral-large-latest', 'mistral-medium-latest', 'pixtral-large-latest'],
  grok: ['grok-2-vision-1220', 'grok-2-1212', 'grok-3', 'grok-3-mini'],
  ollama: ['llava', 'llama3.2-vision', 'bakllava'],
};

export interface AppSettings {
  defaultProvider: AIProviderType;
  providers: Record<AIProviderType, AIProviderConfig>;
  hotkeyFullscreen: string;
  hotkeyRegion: string;
  theme: AppTheme;
  accentColor: string;
  language: AppLanguage;
  systemPrompt: string;
}

export const DEFAULT_SYSTEM_PROMPT = 'You are a visual assistant. The user shares annotated screenshots to get help. Analyze the image and annotations (arrows, highlights, rectangles) to understand precisely what the user is showing you. Respond clearly and actionably.';

export const DEFAULT_SETTINGS: AppSettings = {
  defaultProvider: 'claude',
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
