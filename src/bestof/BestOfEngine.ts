// ============================================
// ScreenAI — Best Of Engine
// Envoie la requête en parallèle à N providers,
// un juge IA sélectionne la meilleure réponse.
// ============================================

import type { Message, AIProviderConfig } from '../types';
import { createConnector } from '../connectors';

export interface BestOfCandidate {
  provider: string;
  model: string;
  content: string;
  responseTime: number;
  status: 'success' | 'error';
  error?: string;
}

export interface BestOfResult {
  winner: BestOfCandidate;
  alternatives: (BestOfCandidate & { rank: number })[];
  judgeReason: string;
  totalProviders: number;
}

export interface ProviderStatus {
  provider: string;
  status: 'waiting' | 'loading' | 'done' | 'error';
}

const JUDGE_SYSTEM_PROMPT = `Tu es un évaluateur objectif de réponses IA. Tu compares plusieurs réponses à une même question et tu choisis la meilleure.

Critères d'évaluation (par ordre d'importance) :
1. Exactitude : La réponse est-elle factuelle et correcte ?
2. Complétude : La réponse couvre-t-elle tous les aspects de la question ?
3. Clarté : La réponse est-elle bien structurée et facile à comprendre ?
4. Pertinence : La réponse répond-elle directement à la question posée ?
5. Concision : La réponse est-elle efficace sans être trop verbeuse ?

Réponds UNIQUEMENT en JSON valide, sans texte avant ou après :
{"winner": <numéro (1, 2, 3...)>, "reason": "<justification courte en 1-2 phrases>"}`;

function truncateForJudge(content: string): string {
  const MAX = 6000;
  if (content.length <= MAX) return content;
  return content.slice(0, MAX) + '\n\n[... réponse tronquée pour évaluation]';
}

async function judgeResponses(
  question: string,
  responses: BestOfCandidate[],
  judgeConfig: AIProviderConfig,
): Promise<{ winnerIndex: number; reason: string }> {
  let prompt = `Question de l'utilisateur :\n"${question}"\n\n`;
  responses.forEach((r, i) => {
    prompt += `--- Réponse ${i + 1} (${r.provider}) ---\n${truncateForJudge(r.content)}\n\n`;
  });
  prompt += 'Quelle réponse est la meilleure ? Réponds en JSON.';

  try {
    const connector = createConnector({
      ...judgeConfig,
      model: 'claude-haiku-4-5-20251001',
      webSearch: false,
    });
    let judgeResponse = '';
    await connector.send(
      [{ id: 'judge', role: 'user', content: prompt, timestamp: Date.now() }],
      JUDGE_SYSTEM_PROMPT,
      (chunk) => { if (chunk) judgeResponse += chunk; },
    );
    const match = judgeResponse.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const idx = Number(parsed.winner) - 1;
      return {
        winnerIndex: isFinite(idx) ? Math.max(0, Math.min(idx, responses.length - 1)) : 0,
        reason: String(parsed.reason || ''),
      };
    }
  } catch { /* fallback below */ }

  // Fallback : réponse la plus longue
  const longestIndex = responses.reduce(
    (best, r, i) => r.content.length > responses[best].content.length ? i : best, 0
  );
  return { winnerIndex: longestIndex, reason: 'Sélection automatique (réponse la plus complète)' };
}

export async function executeBestOf(
  messages: Message[],
  providers: AIProviderConfig[],
  systemPrompt: string,
  onProgress: (done: number, total: number, statuses: ProviderStatus[]) => void,
): Promise<BestOfResult> {
  const total = providers.length;
  const statuses: ProviderStatus[] = providers.map(p => ({ provider: p.label, status: 'loading' }));
  onProgress(0, total, [...statuses]);

  let doneCount = 0;

  const promises = providers.map(async (cfg, idx) => {
    const startTime = Date.now();
    try {
      const connector = createConnector({ ...cfg, webSearch: false });
      let content = '';
      await connector.send(messages, systemPrompt, (chunk) => { if (chunk) content += chunk; });
      statuses[idx] = { provider: cfg.label, status: 'done' };
      doneCount++;
      onProgress(doneCount, total, [...statuses]);
      return { provider: cfg.label, model: cfg.model, content, responseTime: Date.now() - startTime, status: 'success' as const };
    } catch (err: any) {
      statuses[idx] = { provider: cfg.label, status: 'error' };
      doneCount++;
      onProgress(doneCount, total, [...statuses]);
      return { provider: cfg.label, model: cfg.model, content: '', responseTime: Date.now() - startTime, status: 'error' as const, error: String(err?.message || err) };
    }
  });

  const results = (await Promise.allSettled(promises))
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter(Boolean) as BestOfCandidate[];

  const successful = results.filter(r => r.status === 'success' && r.content.length > 0);

  if (successful.length === 0) {
    const errors = results.map(r => r.error || 'erreur').join(', ');
    throw new Error(`Aucune IA n'a pu répondre (${errors}). Réessayez ou sélectionnez un modèle individuel.`);
  }

  if (successful.length === 1) {
    return { winner: successful[0], alternatives: [], judgeReason: '', totalProviders: total };
  }

  // Jugement
  const judgeConfig = providers.find(p => p.type === 'claude') || providers[0];
  const { winnerIndex, reason } = await judgeResponses(
    messages[messages.length - 1]?.content || '',
    successful,
    judgeConfig,
  );

  const winner = successful[winnerIndex];
  const alternatives = successful
    .filter((_, i) => i !== winnerIndex)
    .map((r, i) => ({ ...r, rank: i + 2 }));

  return { winner, alternatives, judgeReason: reason, totalProviders: total };
}
