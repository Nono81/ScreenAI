// ============================================
// ScreenAI — Conversation Compactor
// ============================================

import type { Message, Conversation, AIProviderConfig, SummaryData } from '../types';
import { generateId } from '../types';
import { estimateTokens, estimateTextTokens, getCompactionThreshold, getContextLimit } from './TokenEstimator';
import { generateSummary } from './SummaryGenerator';

export interface CompactionResult {
  success: boolean;
  summaryMessage?: Message;
  compactedBeforeIndex: number;
  originalMessageCount: number;
  error?: string;
}

export function shouldCompact(
  conversation: Conversation,
  systemPrompt: string,
  memoryBlock: string,
): boolean {
  const threshold = getCompactionThreshold(conversation.model);
  const currentTokens = estimateTokens(systemPrompt, memoryBlock, conversation.messages);
  return currentTokens > threshold;
}

export function getContextPercentage(
  conversation: Conversation,
  systemPrompt: string,
  memoryBlock: string,
): number {
  const limit = getContextLimit(conversation.model);
  const used = estimateTokens(systemPrompt, memoryBlock, conversation.messages);
  return Math.min(100, Math.round((used / limit) * 100));
}

export async function compactConversation(
  conversation: Conversation,
  providerConfig: AIProviderConfig,
  systemPrompt: string,
  memoryBlock: string,
): Promise<CompactionResult> {
  const messages = conversation.messages;

  // Find compaction boundary: keep last 4 messages (2 exchanges)
  const keepCount = Math.min(4, messages.length);
  const compactBeforeIdx = messages.length - keepCount;

  if (compactBeforeIdx <= 0) {
    return { success: false, compactedBeforeIndex: 0, originalMessageCount: 0, error: 'Not enough messages to compact' };
  }

  // If there's already a compaction, start from after the previous summary
  const startIdx = conversation.compaction ? conversation.compaction.compactedBeforeIndex : 0;
  const messagesToSummarize = messages.slice(startIdx, compactBeforeIdx);

  if (messagesToSummarize.length < 2) {
    return { success: false, compactedBeforeIndex: 0, originalMessageCount: 0, error: 'Not enough new messages to compact' };
  }

  try {
    const summaryText = await generateSummary(messagesToSummarize, providerConfig);

    const originalTokens = messagesToSummarize.reduce((acc, m) => {
      return acc + estimateTextTokens(m.content || '');
    }, 0);

    const summaryData: SummaryData = {
      originalMessageCount: messagesToSummarize.length,
      originalTokenEstimate: originalTokens,
      summaryTokenEstimate: estimateTextTokens(summaryText),
      compactedAt: Date.now(),
    };

    const summaryMessage: Message = {
      id: generateId(),
      role: 'assistant',
      content: summaryText,
      timestamp: Date.now(),
      summary: summaryData,
    };

    return {
      success: true,
      summaryMessage,
      compactedBeforeIndex: compactBeforeIdx,
      originalMessageCount: messagesToSummarize.length,
    };
  } catch (err: any) {
    // Fallback: simple truncation
    const fallbackText = messagesToSummarize
      .slice(-4)
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${(m.content || '').slice(0, 200)}`)
      .join('\n');

    const summaryMessage: Message = {
      id: generateId(),
      role: 'assistant',
      content: `[Resume simplifie - erreur API]\n${fallbackText}`,
      timestamp: Date.now(),
      summary: {
        originalMessageCount: messagesToSummarize.length,
        originalTokenEstimate: 0,
        summaryTokenEstimate: estimateTextTokens(fallbackText),
        compactedAt: Date.now(),
      },
    };

    return {
      success: true,
      summaryMessage,
      compactedBeforeIndex: compactBeforeIdx,
      originalMessageCount: messagesToSummarize.length,
      error: `Fallback used: ${err.message}`,
    };
  }
}

/** Build the messages array to send to API, applying compaction */
export function getEffectiveMessages(conversation: Conversation): Message[] {
  if (!conversation.compaction) return conversation.messages;

  const { compactedBeforeIndex, summaryMessageId } = conversation.compaction;
  const summaryMsg = conversation.messages.find(m => m.id === summaryMessageId);
  const recentMessages = conversation.messages.slice(compactedBeforeIndex);

  if (summaryMsg) {
    return [summaryMsg, ...recentMessages];
  }
  return recentMessages;
}
