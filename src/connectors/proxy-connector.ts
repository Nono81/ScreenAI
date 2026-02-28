// ============================================
// ScreenAI — Proxy Connector (for free-tier users)
// ============================================
// Uses the Supabase Edge Function ai-proxy to relay requests
// through server-side API keys when the user has no own key.

import type { Message } from '../types';
import { getSupabase } from '../auth/supabase';
import type { StreamCallback } from './index';

const PROXY_URL_SUFFIX = '/functions/v1/ai-proxy';

export class ProxyConnector {
  private supabaseUrl: string;

  constructor() {
    this.supabaseUrl = import.meta.env?.VITE_SUPABASE_URL || '';
  }

  isAvailable(): boolean {
    const supabase = getSupabase();
    return !!(supabase && this.supabaseUrl);
  }

  async send(
    messages: Message[],
    provider: string,
    model: string,
    systemPrompt?: string,
    onStream?: StreamCallback
  ): Promise<string> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not configured');

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated — sign in to use the free AI proxy');

    const url = `${this.supabaseUrl}${PROXY_URL_SUFFIX}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        provider,
        model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          screenshot: m.screenshot ? {
            dataUrl: m.screenshot.annotatedDataUrl || m.screenshot.dataUrl,
          } : undefined,
        })),
        systemPrompt,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `Proxy error: ${response.status}`);
    }

    // Handle SSE streaming
    if (response.body && onStream) {
      return this.handleStream(response.body, onStream);
    }

    // Non-streaming fallback
    const data = await response.json();
    return data.content || data.text || '';
  }

  private async handleStream(body: ReadableStream, onStream: StreamCallback): Promise<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              onStream('', true);
              return fullResponse;
            }

            try {
              const parsed = JSON.parse(data);
              // Handle Claude format
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                fullResponse += parsed.delta.text;
                onStream(parsed.delta.text, false);
              }
              // Handle OpenAI format
              if (parsed.choices?.[0]?.delta?.content) {
                const chunk = parsed.choices[0].delta.content;
                fullResponse += chunk;
                onStream(chunk, false);
              }
            } catch {}
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    onStream('', true);
    return fullResponse;
  }
}

export const proxyConnector = new ProxyConnector();
