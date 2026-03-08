// ============================================
// ScreenAI — Token Estimator for Compaction
// ============================================

import type { Message } from '../types';
import { MODEL_CONTEXT_LIMITS } from '../types';

const CHARS_PER_TOKEN = 4;
const RESERVED_FOR_RESPONSE = 4000;
export const COMPACTION_THRESHOLD = 0.70;

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateImageTokens(base64Data: string): number {
  const sizeKB = (base64Data.length * 3) / 4 / 1024;
  if (sizeKB <= 100) return 200;
  if (sizeKB <= 500) return 600;
  if (sizeKB <= 1500) return 1200;
  return 1600;
}

export function estimateMessageTokens(msg: Message): number {
  let tokens = estimateTextTokens(msg.content);
  if (msg.screenshot) {
    const imgSrc = msg.screenshot.annotatedDataUrl || msg.screenshot.dataUrl;
    const base64 = imgSrc.includes(',') ? imgSrc.split(',')[1] : imgSrc;
    tokens += estimateImageTokens(base64);
  }
  if (msg.attachments) {
    for (const att of msg.attachments) {
      if (att.base64) tokens += estimateImageTokens(att.base64);
      if (att.textContent) tokens += estimateTextTokens(att.textContent);
    }
  }
  return tokens;
}

export function estimateTokens(
  systemPrompt: string,
  memoryBlock: string,
  messages: Message[],
): number {
  let total = estimateTextTokens(systemPrompt) + estimateTextTokens(memoryBlock);
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}

export function getContextLimit(model: string): number {
  return MODEL_CONTEXT_LIMITS[model] || 128000;
}

export function getCompactionThreshold(model: string): number {
  return Math.floor(getContextLimit(model) * COMPACTION_THRESHOLD) - RESERVED_FOR_RESPONSE;
}
