// ============================================
// ScreenAI — AI Connectors
// ============================================

import type { AIProviderConfig, AIProviderType, Message } from '../types';

export interface AIResponse {
  content: string;
  done: boolean;
}

export type StreamCallback = (chunk: string, done: boolean) => void;

// --- Base interface ---
export interface AIConnector {
  send(messages: Message[], systemPrompt: string | undefined, onStream: StreamCallback): Promise<string>;
}

// --- Utility: extract base64 from dataUrl ---
function extractBase64(dataUrl: string): { base64: string; mimeType: string } {
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return { base64: dataUrl, mimeType: 'image/png' };
  return { base64: match[2], mimeType: match[1] };
}

// --- Build message history for APIs ---
function buildImageContent(msg: Message): any[] {
  const parts: any[] = [];
  if (msg.screenshot?.annotatedDataUrl || msg.screenshot?.dataUrl) {
    const imgUrl = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
    parts.push({ type: 'image', dataUrl: imgUrl });
  }
  if (msg.content) {
    parts.push({ type: 'text', content: msg.content });
  }
  return parts;
}

// ============================================
// Claude (Anthropic)
// ============================================
class ClaudeConnector implements AIConnector {
  constructor(private config: AIProviderConfig) {}

  async send(messages: Message[], systemPrompt: string | undefined, onStream: StreamCallback): Promise<string> {
    const apiMessages = messages.map(msg => {
      const content: any[] = [];
      if (msg.role === 'user' && msg.screenshot) {
        const imgSrc = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
        const { base64, mimeType } = extractBase64(imgSrc);
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: base64 }
        });
      }
      content.push({ type: 'text', text: msg.content || 'Analyze this screenshot.' });
      return { role: msg.role, content };
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 4096,
        stream: true,
        system: systemPrompt || 'You are a visual assistant. The user shares annotated screenshots. Analyze the image and annotations to understand what the user is showing you. Respond in the user\'s language.',
        messages: apiMessages,
      }),
    });

    return this.handleSSE(response, onStream);
  }

  private async handleSSE(response: Response, onStream: StreamCallback): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_delta' && event.delta?.text) {
            full += event.delta.text;
            onStream(event.delta.text, false);
          }
        } catch {}
      }
    }

    onStream('', true);
    return full;
  }
}

// ============================================
// OpenAI (GPT-4o)
// ============================================
class OpenAIConnector implements AIConnector {
  constructor(private config: AIProviderConfig) {}

  async send(messages: Message[], systemPrompt: string | undefined, onStream: StreamCallback): Promise<string> {
    const sysContent = systemPrompt || 'You are a visual assistant. Analyze annotated screenshots and respond in the user\'s language.';
    const apiMessages: any[] = [
      { role: 'system', content: sysContent }
    ];

    for (const msg of messages) {
      const content: any[] = [];
      if (msg.role === 'user' && msg.screenshot) {
        const imgSrc = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
        content.push({ type: 'image_url', image_url: { url: imgSrc, detail: 'high' } });
      }
      content.push({ type: 'text', text: msg.content || 'Analyze this screenshot.' });
      apiMessages.push({ role: msg.role, content });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 4096,
        stream: true,
        messages: apiMessages,
      }),
    });

    return this.handleSSE(response, onStream);
  }

  private async handleSSE(response: Response, onStream: StreamCallback): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);
          const delta = event.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onStream(delta, false);
          }
        } catch {}
      }
    }

    onStream('', true);
    return full;
  }
}

// ============================================
// Gemini (Google)
// ============================================
class GeminiConnector implements AIConnector {
  constructor(private config: AIProviderConfig) {}

  async send(messages: Message[], systemPrompt: string | undefined, onStream: StreamCallback): Promise<string> {
    const sysContent = systemPrompt || 'You are a visual assistant. Analyze annotated screenshots and respond in the user\'s language.';
    const contents: any[] = [];

    for (const msg of messages) {
      const parts: any[] = [];
      if (msg.role === 'user' && msg.screenshot) {
        const imgSrc = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
        const { base64, mimeType } = extractBase64(imgSrc);
        parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
      }
      parts.push({ text: msg.content || 'Analyze this screenshot.' });
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:streamGenerateContent?alt=sse&key=${this.config.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: sysContent }] },
        contents,
      }),
    });

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          const text = event.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            full += text;
            onStream(text, false);
          }
        } catch {}
      }
    }

    onStream('', true);
    return full;
  }
}

// ============================================
// Mistral
// ============================================
class MistralConnector implements AIConnector {
  constructor(private config: AIProviderConfig) {}

  async send(messages: Message[], systemPrompt: string | undefined, onStream: StreamCallback): Promise<string> {
    const sysContent = systemPrompt || 'You are a visual assistant. Analyze annotated screenshots and respond in the user\'s language.';
    const apiMessages: any[] = [
      { role: 'system', content: sysContent }
    ];

    for (const msg of messages) {
      const content: any[] = [];
      if (msg.role === 'user' && msg.screenshot) {
        const imgSrc = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
        content.push({ type: 'image_url', image_url: { url: imgSrc } });
      }
      content.push({ type: 'text', text: msg.content || 'Analyze this screenshot.' });
      apiMessages.push({ role: msg.role, content });
    }

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 4096,
        stream: true,
        messages: apiMessages,
      }),
    });

    // Same SSE format as OpenAI
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);
          const delta = event.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onStream(delta, false);
          }
        } catch {}
      }
    }

    onStream('', true);
    return full;
  }
}

// ============================================
// Grok (xAI) — OpenAI-compatible API
// ============================================
class GrokConnector implements AIConnector {
  constructor(private config: AIProviderConfig) {}

  async send(messages: Message[], systemPrompt: string | undefined, onStream: StreamCallback): Promise<string> {
    const sysContent = systemPrompt || 'You are a visual assistant. Analyze annotated screenshots and respond in the user\'s language.';
    const apiMessages: any[] = [
      { role: 'system', content: sysContent }
    ];

    for (const msg of messages) {
      const content: any[] = [];
      if (msg.role === 'user' && msg.screenshot) {
        const imgSrc = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
        content.push({ type: 'image_url', image_url: { url: imgSrc, detail: 'high' } });
      }
      content.push({ type: 'text', text: msg.content || 'Analyze this screenshot.' });
      apiMessages.push({ role: msg.role, content });
    }

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 4096,
        stream: true,
        messages: apiMessages,
      }),
    });

    return this.handleSSE(response, onStream);
  }

  private async handleSSE(response: Response, onStream: StreamCallback): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);
          const delta = event.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onStream(delta, false);
          }
        } catch {}
      }
    }

    onStream('', true);
    return full;
  }
}

// ============================================
// Ollama (Local)
// ============================================
class OllamaConnector implements AIConnector {
  constructor(private config: AIProviderConfig) {}

  async send(messages: Message[], systemPrompt: string | undefined, onStream: StreamCallback): Promise<string> {
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';
    const sysContent = systemPrompt || 'You are a visual assistant. Analyze annotated screenshots and respond in the user\'s language.';
    
    const ollamaMessages = messages.map(msg => {
      const result: any = { role: msg.role, content: msg.content || 'Analyze this screenshot.' };
      if (msg.role === 'user' && msg.screenshot) {
        const imgSrc = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
        const { base64 } = extractBase64(imgSrc);
        result.images = [base64];
      }
      return result;
    });

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: sysContent },
          ...ollamaMessages,
        ],
        stream: true,
      }),
    });

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.message?.content) {
            full += event.message.content;
            onStream(event.message.content, false);
          }
          if (event.done) {
            onStream('', true);
            return full;
          }
        } catch {}
      }
    }

    onStream('', true);
    return full;
  }
}

// ============================================
// Factory
// ============================================
export function createConnector(config: AIProviderConfig): AIConnector {
  switch (config.type) {
    case 'claude': return new ClaudeConnector(config);
    case 'openai': return new OpenAIConnector(config);
    case 'gemini': return new GeminiConnector(config);
    case 'mistral': return new MistralConnector(config);
    case 'grok': return new GrokConnector(config);
    case 'ollama': return new OllamaConnector(config);
    default: throw new Error(`Unknown provider: ${config.type}`);
  }
}
