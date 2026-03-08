// ============================================
// ScreenAI — Summary Generator for Compaction
// ============================================

import type { Message, AIProviderConfig } from '../types';

const SUMMARY_MODEL = 'claude-haiku-4-5-20251001';
const MAX_SUMMARY_TOKENS = 1024;

export async function generateSummary(
  messages: Message[],
  providerConfig: AIProviderConfig,
): Promise<string> {
  const transcript = messages
    .map(m => {
      let line = `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content || ''}`;
      if (m.screenshot) line += ' [image jointe]';
      if (m.attachments?.length) line += ` [fichiers: ${m.attachments.map(a => a.name).join(', ')}]`;
      return line.slice(0, 500);
    })
    .join('\n');

  const system = `Tu es un assistant qui resume des conversations. Resume la conversation ci-dessous de maniere concise mais complete. Garde les informations cles: decisions prises, faits importants, contexte necessaire pour continuer la conversation. Format: paragraphe(s) fluide(s), pas de liste. Maximum 300 mots.`;
  const prompt = `Resume cette conversation (${messages.length} messages):\n\n${transcript}`;

  if (providerConfig.type === 'claude' && providerConfig.apiKey) {
    return callClaudeForSummary(prompt, system, providerConfig.apiKey);
  }
  if (providerConfig.type === 'openai' && providerConfig.apiKey) {
    return callOpenAIForSummary(prompt, system, providerConfig.apiKey);
  }
  return fallbackSummary(messages);
}

async function callClaudeForSummary(prompt: string, system: string, apiKey: string): Promise<string> {
  const __tauri = (window as any).__TAURI__;
  const invokeFn = __tauri?.tauri?.invoke ?? __tauri?.invoke;
  if (invokeFn) {
    const result = await invokeFn('call_claude_simple', {
      apiKey,
      model: SUMMARY_MODEL,
      messagesJson: JSON.stringify([{ role: 'user', content: prompt }]),
      system,
      maxTokens: MAX_SUMMARY_TOKENS,
    });
    if (result && result.trim()) return result;
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      max_tokens: MAX_SUMMARY_TOKENS,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Summary API error: ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function callOpenAIForSummary(prompt: string, system: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: MAX_SUMMARY_TOKENS,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Summary API error: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function fallbackSummary(messages: Message[]): string {
  const lines: string[] = [];
  for (const m of messages.slice(-6)) {
    const prefix = m.role === 'user' ? 'User' : 'Assistant';
    lines.push(`${prefix}: ${(m.content || '').slice(0, 150)}`);
  }
  return `[Resume automatique simplifie]\n${lines.join('\n')}`;
}
