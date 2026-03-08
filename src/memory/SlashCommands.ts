// ============================================
// ScreenAI — Slash Commands for Memory
// ============================================
// /remember <text>    — add a fact manually
// /forget <text>      — delete facts matching text
// /memory             — show all saved facts

import type { MemoryCategory } from '../types';
import { memoryStore } from '../storage';
import { MEMORY_CATEGORY_LABELS } from '../types';

export interface SlashResult {
  handled: boolean;
  feedback?: string; // UI feedback message
}

export async function handleSlashCommand(input: string): Promise<SlashResult> {
  const trimmed = input.trim();

  if (trimmed.startsWith('/remember ')) {
    const content = trimmed.slice('/remember '.length).trim();
    if (!content) return { handled: true, feedback: 'Usage: /remember <fait a memoriser>' };
    await memoryStore.add({ category: guessCategory(content), content, source: 'manual' });
    return { handled: true, feedback: `Memorise : "${content}"` };
  }

  if (trimmed === '/memory') {
    const facts = await memoryStore.getAll();
    if (!facts.length) return { handled: true, feedback: 'Aucun souvenir enregistre.' };
    const lines = facts.map(f => `[${MEMORY_CATEGORY_LABELS[f.category]}] ${f.content}`);
    return { handled: true, feedback: lines.join('\n') };
  }

  if (trimmed.startsWith('/forget ')) {
    const query = trimmed.slice('/forget '.length).trim().toLowerCase();
    const facts = await memoryStore.getAll();
    const matches = facts.filter(f => f.content.toLowerCase().includes(query));
    if (!matches.length) return { handled: true, feedback: `Aucun souvenir contenant "${query}".` };
    for (const f of matches) await memoryStore.delete(f.id);
    return { handled: true, feedback: `Oublie : ${matches.length} souvenir(s) contenant "${query}"` };
  }

  if (trimmed === '/forget') {
    return { handled: true, feedback: 'Usage: /forget <texte> — supprime les souvenirs contenant ce texte' };
  }

  return { handled: false };
}

export function isSlashCommand(input: string): boolean {
  const t = input.trim();
  return t.startsWith('/remember ') || t === '/memory' || t.startsWith('/forget');
}

function guessCategory(text: string): MemoryCategory {
  const t = text.toLowerCase();
  if (/\b(je suis|je m'appelle|mon nom|i am|my name)\b/.test(t)) return 'identity';
  if (/\b(travail|job|profess|developpeur|designer|manager|ingenieur|dev|engineer|work)\b/.test(t)) return 'profession';
  if (/\b(projet|project|app|application|site|startup)\b/.test(t)) return 'projects';
  if (/\b(prefere|toujours|jamais|aime|prefer|always|never|like)\b/.test(t)) return 'preferences';
  if (/\b(reponds|utilise|fais|fait|instruc|repondre|use|do|make|always respond)\b/.test(t)) return 'instructions';
  return 'other';
}
