// ============================================
// ScreenAI — Memory Prompt Builder
// ============================================

import type { MemoryFact, MemoryCategory } from '../types';
import { MEMORY_CATEGORY_LABELS } from '../types';
import { memoryStore } from '../storage';

/**
 * Builds the memory block to prepend to the system prompt.
 * Returns empty string if memory is empty.
 */
export async function buildMemoryBlock(): Promise<string> {
  const facts = await memoryStore.getAll();
  if (!facts.length) return '';

  // Group by category
  const grouped: Partial<Record<MemoryCategory, MemoryFact[]>> = {};
  for (const fact of facts) {
    if (!grouped[fact.category]) grouped[fact.category] = [];
    grouped[fact.category]!.push(fact);
  }

  const lines: string[] = ['[Memoire utilisateur]'];

  const order: MemoryCategory[] = ['identity', 'profession', 'projects', 'preferences', 'instructions', 'other'];
  for (const cat of order) {
    const items = grouped[cat];
    if (!items?.length) continue;
    lines.push(`${MEMORY_CATEGORY_LABELS[cat]}:`);
    for (const f of items) {
      lines.push(`- ${f.content}`);
    }
  }

  lines.push('[/Memoire utilisateur]');
  return lines.join('\n');
}

/**
 * Injects memory block into an existing system prompt.
 */
export async function injectMemory(systemPrompt: string): Promise<string> {
  const block = await buildMemoryBlock();
  if (!block) return systemPrompt;
  return block + '\n\n' + systemPrompt;
}
