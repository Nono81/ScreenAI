// ============================================
// ScreenAI — Memory Auto-Detector
// ============================================

import type { Message, AIProviderConfig, MemoryCategory } from '../types';
import { memoryStore } from '../storage';

const DETECT_EVERY_N = 4;

export interface DetectedFact {
  category: MemoryCategory;
  content: string;
}

export function shouldDetect(messages: Message[]): boolean {
  const userCount = messages.filter(m => m.role === 'user').length;
  return userCount > 0 && userCount % DETECT_EVERY_N === 0;
}

export async function detectAndSave(
  messages: Message[],
  providerConfig: AIProviderConfig,
  conversationId: string,
): Promise<number> {
  const detected = await detectFacts(messages, providerConfig);
  if (!detected.length) return 0;

  const existing = await memoryStore.getAll();
  const existingContents = existing.map(f => f.content.toLowerCase());

  let saved = 0;
  for (const fact of detected) {
    const normalized = fact.content.trim();
    if (!normalized) continue;
    const isDup = existingContents.some(c => {
      const sim = normalized.toLowerCase();
      return c.includes(sim.slice(0, 30)) || sim.includes(c.slice(0, 30));
    });
    if (isDup) continue;
    await memoryStore.add({
      category: fact.category,
      content: normalized,
      source: 'auto',
      conversationId,
    });
    saved++;
  }
  return saved;
}

async function detectFacts(messages: Message[], config: AIProviderConfig): Promise<DetectedFact[]> {
  const recent = messages.slice(-8);
  const transcript = recent
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content?.slice(0, 300) || ''}`)
    .join('\n');

  const system = `Tu es un extracteur de faits. Lis la conversation et extrais UNIQUEMENT les informations stables sur l'utilisateur (nom, profession, projets, preferences, instructions speciales). Reponds UNIQUEMENT avec un tableau JSON valide, ou [] si aucun fait notable. Format: [{"category":"identity|profession|projects|preferences|instructions|other","content":"fait concis"}]. Maximum 5 faits.`;
  const prompt = `Conversation:\n${transcript}\n\nExtrais les faits memorables sur l'utilisateur.`;

  try {
    let response = '[]';
    if (config.type === 'claude' && config.apiKey) {
      response = await callClaude(prompt, system, config.apiKey);
    } else if (config.type === 'openai' && config.apiKey) {
      response = await callOpenAI(prompt, system, config.apiKey);
    } else {
      return [];
    }

    const match = response.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as DetectedFact[];
    if (!Array.isArray(parsed)) return [];

    const valid: MemoryCategory[] = ['identity', 'profession', 'projects', 'preferences', 'instructions', 'other'];
    return parsed.filter(f =>
      f && typeof f.content === 'string' && f.content.trim() &&
      valid.includes(f.category)
    ).slice(0, 5);
  } catch {
    return [];
  }
}

async function callClaude(prompt: string, system: string, apiKey: string): Promise<string> {
  try {
    // Use Tauri Rust command to avoid CORS in desktop mode
    const __tauri = (window as any).__TAURI__;
    const invokeFn = __tauri?.tauri?.invoke ?? __tauri?.invoke;
    if (invokeFn) {
      const result = await invokeFn('call_claude_simple', {
        apiKey,
        model: 'claude-haiku-4-5-20251001',
        messagesJson: JSON.stringify([{ role: 'user', content: prompt }]),
        system,
        maxTokens: 400,
      });
      return result || '[]';
    }
    // Browser fallback
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return '[]';
    const data = await res.json();
    return data.content?.[0]?.text || '[]';
  } catch { return '[]'; }
}

async function callOpenAI(prompt: string, system: string, apiKey: string): Promise<string> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 400,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return '[]';
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '[]';
  } catch { return '[]'; }
}
