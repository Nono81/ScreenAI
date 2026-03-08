// ============================================
// ScreenAI — AI Connectors
// ============================================

import type { AIProviderConfig, AIProviderType, Message, MessageAttachment } from '../types';

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


// --- Attachment content builders ---
function buildClaudeAttachmentParts(attachments: MessageAttachment[]): any[] {
  const parts: any[] = [];
  for (const att of attachments) {
    if ((att.type === 'image' || att.type === 'capture') && att.base64) {
      parts.push({ type: 'image', source: { type: 'base64', media_type: att.mimeType || 'image/png', data: att.base64 } });
    } else if (att.type === 'pdf') {
      if (att.base64) {
        parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: att.base64 } });
      } else if (att.textContent) {
        parts.push({ type: 'text', text: `--- Fichier PDF : ${att.name} ---\n${att.textContent}\n--- Fin ---` });
      }
    } else if (att.type === 'text' && att.textContent !== undefined) {
      parts.push({ type: 'text', text: `--- Fichier : ${att.name} ---\n${att.textContent}\n--- Fin ---` });
    }
  }
  return parts;
}

function buildOpenAIAttachmentParts(attachments: MessageAttachment[]): any[] {
  const parts: any[] = [];
  for (const att of attachments) {
    if ((att.type === 'image' || att.type === 'capture') && att.base64) {
      parts.push({ type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${att.base64}`, detail: 'high' } });
    } else if (att.type === 'pdf' && att.textContent !== undefined) {
      parts.push({ type: 'text', text: `--- Fichier PDF : ${att.name} ---\n${att.textContent || '[PDF sans texte extractible]'}\n--- Fin ---` });
    } else if (att.type === 'text' && att.textContent !== undefined) {
      parts.push({ type: 'text', text: `--- Fichier : ${att.name} ---\n${att.textContent}\n--- Fin ---` });
    }
  }
  return parts;
}

function buildGeminiAttachmentParts(attachments: MessageAttachment[]): any[] {
  const parts: any[] = [];
  for (const att of attachments) {
    if ((att.type === 'image' || att.type === 'capture') && att.base64) {
      parts.push({ inline_data: { mime_type: att.mimeType || 'image/png', data: att.base64 } });
    } else if (att.type === 'pdf' && att.base64) {
      parts.push({ inline_data: { mime_type: 'application/pdf', data: att.base64 } });
    } else if (att.type === 'text' && att.textContent !== undefined) {
      parts.push({ text: `--- Fichier : ${att.name} ---\n${att.textContent}\n--- Fin ---` });
    }
  }
  return parts;
}

function buildOllamaAttachmentImages(attachments: MessageAttachment[]): string[] {
  return attachments.filter(a => (a.type === 'image' || a.type === 'capture') && a.base64).map(a => a.base64!);
}

function buildTextAttachments(attachments: MessageAttachment[]): string {
  return attachments
    .filter(a => (a.type === 'pdf' || a.type === 'text') && a.textContent !== undefined)
    .map(a => `--- Fichier${a.type === 'pdf' ? ' PDF' : ''} : ${a.name} ---\n${a.textContent || '[vide]'}\n--- Fin ---`)
    .join('\n\n');
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
// DuckDuckGo Web Search (for non-Claude providers)
// ============================================
async function duckDuckGoSearch(query: string): Promise<string> {
  try {
    // Use Tauri invoke when available — Rust bypasses CORS completely

    const tauri = (window as any).__TAURI__;
    if (tauri?.invoke) {
      const result = await tauri.invoke('web_search', { query }) as string;
      return result || '';
    }
    // Browser fallback (extension mode)
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query.slice(0, 300));
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!res.ok) return '';
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const snips: string[] = [];
    doc.querySelectorAll('.result').forEach((el: Element, i: number) => {
      if (i >= 5) return;
      const t = el.querySelector('.result__a')?.textContent?.trim();
      const s = el.querySelector('.result__snippet')?.textContent?.trim();
      if (t && s) snips.push('- ' + t + ': ' + s);
    });
    if (!snips.length) return '';
    return '[Web: ' + query.slice(0, 80) + ']' + String.fromCharCode(10) + snips.join(String.fromCharCode(10)) + String.fromCharCode(10,10);
  } catch { return ''; }
}
async function injectWeb(messages: Message[], sys: string): Promise<string> {
  const last = [...messages].reverse().find(m => m.role === 'user');
  if (!last?.content) return sys;
  const r = await duckDuckGoSearch(last.content);
  return r ? r + sys : sys;
}

// ============================================
// Claude (Anthropic)
// ============================================
class ClaudeConnector implements AIConnector {
  constructor(private config: AIProviderConfig) {}

  async send(messages: Message[], systemPrompt: string | undefined, onStream: StreamCallback): Promise<string> {
    // Only include images/attachments for the last user message to save tokens
    const lastUserIdx = messages.map((m, i) => m.role === 'user' ? i : -1).filter(i => i >= 0).pop() ?? -1;
    const apiMessages = messages.map((msg, idx) => {
      const content: any[] = [];
      content.push({ type: 'text', text: msg.content || 'Analyze this.' });
      if (msg.role === 'user' && idx === lastUserIdx) {
        // Include full images/attachments only for the latest user message
        if (msg.attachments?.length) {
          content.push(...buildClaudeAttachmentParts(msg.attachments));
        }
        if (msg.screenshot) {
          const imgSrc = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
          const { base64, mimeType } = extractBase64(imgSrc);
          content.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } });
        }
      } else if (msg.role === 'user') {
        // For older messages, replace images with lightweight placeholders
        if (msg.attachments?.length) {
          content.push({ type: 'text', text: '[Fichiers joints: ' + msg.attachments.map(a => a.name).join(', ') + ']' });
        }
        if (msg.screenshot) {
          content.push({ type: 'text', text: '[Image/capture envoyee precedemment]' });
        }
      }
      return { role: msg.role, content };
    });

    const sys = systemPrompt || `Tu es ScreenAI, un assistant intelligent polyvalent. Tu peux analyser des captures d'ecran et images, rechercher des informations sur le web, repondre a toutes sortes de questions, et aider avec du code, de la redaction, et tout type de tache.

Regles de reponse :
- N'utilise jamais d'emojis dans tes reponses
- Sois direct et concis, va droit au but
- Ne fais pas de listes d'hypotheses quand tu n'es pas sur -- dis simplement que tu n'es pas certain
- Utilise un ton professionnel mais accessible
- Structure tes reponses avec des titres et paragraphes si la reponse est longue, sinon reste simple
- Reponds dans la langue de l'utilisateur`;

    // Claude uses its native web_search tool — no DuckDuckGo injection needed
    const tools = this.config.webSearch
      ? [{ type: 'web_search_20250305', name: 'web_search' }]
      : undefined;

    const __tauri = (window as any).__TAURI__;
    // Tauri v1: invoke is at __TAURI__.tauri.invoke, event at __TAURI__.event
    const invokeFn = __tauri?.tauri?.invoke ?? __tauri?.invoke;
    const eventApi = __tauri?.event;
    if (invokeFn && eventApi?.listen) {
      return this.sendViaRust({ invoke: invokeFn, event: eventApi }, apiMessages, sys, tools, onStream);
    }
    if (__tauri) {
      throw new Error('Tauri found but invoke/event unavailable. Keys: ' + Object.keys(__tauri).join(','));
    }
    return this.sendViaFetch(apiMessages, sys, tools, onStream);
  }

  private async sendViaRust(tauri: any, apiMessages: any[], system: string, tools: any[] | undefined, onStream: StreamCallback): Promise<string> {
    const rid = Math.random().toString(36).slice(2, 10);
    let fullResponse = '';
    let chunkUn: (() => void) | null = null;
    let doneUn: (() => void) | null = null;
    try {
      await new Promise<void>((resolve, reject) => {
        const go = async () => {
          chunkUn = await tauri.event.listen('claude-chunk', (e: any) => {
            if (e.payload?.rid !== rid) return;
            const t = e.payload.text as string;
            fullResponse += t;
            onStream(t, false);
          });
          doneUn = await tauri.event.listen('claude-done', (e: any) => {
            if (e.payload?.rid !== rid) return;
            onStream('', true);
            resolve();
          });
          try {
            await tauri.invoke('invoke_claude', {
              apiKey: this.config.apiKey,
              model: this.config.model,
              messagesJson: JSON.stringify(apiMessages),
              system,
              maxTokens: 4096,
              requestId: rid,
              toolsJson: tools ? JSON.stringify(tools) : '',
            });
          } catch (err) {
            reject(typeof err === 'string' ? new Error(err as string) : err as Error);
          }
        };
        go().catch(reject);
      });
    } finally {
      chunkUn?.();
      doneUn?.();
    }
    return fullResponse;
  }

  private async sendViaFetch(apiMessages: any[], system: string, tools: any[] | undefined, onStream: StreamCallback): Promise<string> {
    const hdrs: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    if (tools?.length) hdrs['anthropic-beta'] = 'web-search-2025-03-05';
    const reqBody: any = { model: this.config.model, max_tokens: 4096, stream: true, system, messages: apiMessages };
    if (tools?.length) reqBody.tools = tools;
    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify(reqBody),
      });
    } catch (fetchErr: any) {
      throw new Error('fetch() failed: ' + (fetchErr?.message || String(fetchErr)));
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: { message: 'API error ' + response.status } }));
      throw new Error(err.error?.message || 'Claude API error ' + response.status);
    }
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
    let sysContent = systemPrompt || `Tu es ScreenAI, un assistant intelligent polyvalent. Tu peux analyser des captures d'ecran et images, rechercher des informations sur le web, repondre a toutes sortes de questions, et aider avec du code, de la redaction, et tout type de tache.

Regles de reponse :
- N'utilise jamais d'emojis dans tes reponses
- Sois direct et concis, va droit au but
- Ne fais pas de listes d'hypotheses quand tu n'es pas sur -- dis simplement que tu n'es pas certain
- Utilise un ton professionnel mais accessible
- Structure tes reponses avec des titres et paragraphes si la reponse est longue, sinon reste simple
- Reponds dans la langue de l'utilisateur`;
    if (this.config.webSearch) sysContent = await injectWeb(messages, sysContent);
    const apiMessages: any[] = [
      { role: 'system', content: sysContent }
    ];

    for (const msg of messages) {
      const content: any[] = [];
      if (msg.role === 'user' && msg.attachments?.length) {
        content.push(...buildOpenAIAttachmentParts(msg.attachments));
      }
      if (msg.role === 'user' && msg.screenshot) {
        const imgSrc = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
        content.push({ type: 'image_url', image_url: { url: imgSrc, detail: 'high' } });
      }
      content.push({ type: 'text', text: msg.content || 'Analyze this.' });
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
    let sysContent = systemPrompt || `Tu es ScreenAI, un assistant intelligent polyvalent. Tu peux analyser des captures d'ecran et images, rechercher des informations sur le web, repondre a toutes sortes de questions, et aider avec du code, de la redaction, et tout type de tache.

Regles de reponse :
- N'utilise jamais d'emojis dans tes reponses
- Sois direct et concis, va droit au but
- Ne fais pas de listes d'hypotheses quand tu n'es pas sur -- dis simplement que tu n'es pas certain
- Utilise un ton professionnel mais accessible
- Structure tes reponses avec des titres et paragraphes si la reponse est longue, sinon reste simple
- Reponds dans la langue de l'utilisateur`;
    if (this.config.webSearch) sysContent = await injectWeb(messages, sysContent);
    const contents: any[] = [];

    for (const msg of messages) {
      const parts: any[] = [];
      if (msg.role === 'user' && msg.attachments?.length) {
        parts.push(...buildGeminiAttachmentParts(msg.attachments));
      }
      if (msg.role === 'user' && msg.screenshot) {
        const imgSrc = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
        const { base64, mimeType } = extractBase64(imgSrc);
        parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
      }
      parts.push({ text: msg.content || 'Analyze this.' });
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
    let sysContent = systemPrompt || `Tu es ScreenAI, un assistant intelligent polyvalent. Tu peux analyser des captures d'ecran et images, rechercher des informations sur le web, repondre a toutes sortes de questions, et aider avec du code, de la redaction, et tout type de tache.

Regles de reponse :
- N'utilise jamais d'emojis dans tes reponses
- Sois direct et concis, va droit au but
- Ne fais pas de listes d'hypotheses quand tu n'es pas sur -- dis simplement que tu n'es pas certain
- Utilise un ton professionnel mais accessible
- Structure tes reponses avec des titres et paragraphes si la reponse est longue, sinon reste simple
- Reponds dans la langue de l'utilisateur`;
    if (this.config.webSearch) sysContent = await injectWeb(messages, sysContent);
    const apiMessages: any[] = [
      { role: 'system', content: sysContent }
    ];

    for (const msg of messages) {
      const content: any[] = [];
      if (msg.role === 'user' && msg.attachments?.length) {
        content.push(...buildOpenAIAttachmentParts(msg.attachments));
      }
      if (msg.role === 'user' && msg.screenshot) {
        const imgSrc = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
        content.push({ type: 'image_url', image_url: { url: imgSrc } });
      }
      content.push({ type: 'text', text: msg.content || 'Analyze this.' });
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
    let sysContent = systemPrompt || `Tu es ScreenAI, un assistant intelligent polyvalent. Tu peux analyser des captures d'ecran et images, rechercher des informations sur le web, repondre a toutes sortes de questions, et aider avec du code, de la redaction, et tout type de tache.

Regles de reponse :
- N'utilise jamais d'emojis dans tes reponses
- Sois direct et concis, va droit au but
- Ne fais pas de listes d'hypotheses quand tu n'es pas sur -- dis simplement que tu n'es pas certain
- Utilise un ton professionnel mais accessible
- Structure tes reponses avec des titres et paragraphes si la reponse est longue, sinon reste simple
- Reponds dans la langue de l'utilisateur`;
    if (this.config.webSearch) sysContent = await injectWeb(messages, sysContent);
    const apiMessages: any[] = [
      { role: 'system', content: sysContent }
    ];

    for (const msg of messages) {
      const content: any[] = [];
      if (msg.role === 'user' && msg.attachments?.length) {
        content.push(...buildOpenAIAttachmentParts(msg.attachments));
      }
      if (msg.role === 'user' && msg.screenshot) {
        const imgSrc = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
        content.push({ type: 'image_url', image_url: { url: imgSrc, detail: 'high' } });
      }
      content.push({ type: 'text', text: msg.content || 'Analyze this.' });
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
    let sysContent = systemPrompt || `Tu es ScreenAI, un assistant intelligent polyvalent. Tu peux analyser des captures d'ecran et images, rechercher des informations sur le web, repondre a toutes sortes de questions, et aider avec du code, de la redaction, et tout type de tache.

Regles de reponse :
- N'utilise jamais d'emojis dans tes reponses
- Sois direct et concis, va droit au but
- Ne fais pas de listes d'hypotheses quand tu n'es pas sur -- dis simplement que tu n'es pas certain
- Utilise un ton professionnel mais accessible
- Structure tes reponses avec des titres et paragraphes si la reponse est longue, sinon reste simple
- Reponds dans la langue de l'utilisateur`;
    if (this.config.webSearch) sysContent = await injectWeb(messages, sysContent);
    
    const ollamaMessages = messages.map(msg => {
      let textContent = msg.content || 'Analyze this.';
      if (msg.role === 'user' && msg.attachments?.length) {
        const textExtra = buildTextAttachments(msg.attachments);
        if (textExtra) textContent = textExtra + '\n\n' + textContent;
      }
      const result: any = { role: msg.role, content: textContent };
      const images: string[] = [];
      if (msg.role === 'user' && msg.screenshot) {
        const imgSrc = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
        const { base64 } = extractBase64(imgSrc);
        images.push(base64);
      }
      if (msg.role === 'user' && msg.attachments?.length) {
        images.push(...buildOllamaAttachmentImages(msg.attachments));
      }
      if (images.length) result.images = images;
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
