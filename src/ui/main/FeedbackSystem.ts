// ============================================
// ScreenAI — Feedback System (like/dislike + popover)
// ============================================

import type { Message, FeedbackEntry, AIProviderConfig } from '../../types';
import { feedbackStore } from '../../storage';
import { generateId } from '../../types';

export interface FeedbackCallbacks {
  onRegenerate: (msg: Message) => void;
  onTryOtherProvider: (msg: Message, provider: AIProviderConfig) => void;
}

export async function saveFeedback(
  msg: Message,
  conversationId: string,
  rating: 'positive' | 'negative',
  reason?: FeedbackEntry['reason'],
  userQuery?: string,
): Promise<FeedbackEntry> {
  return feedbackStore.add({
    messageId: msg.id,
    conversationId,
    rating,
    reason,
    provider: msg.provider || '',
    model: msg.model || '',
    query: userQuery || '',
    hasImage: !!msg.screenshot,
    timestamp: Date.now(),
  });
}

export function renderFeedbackPopover(
  availableProviders: AIProviderConfig[],
  currentProvider: string,
): string {
  const others = availableProviders.filter(p => p.type !== currentProvider && p.enabled && p.apiKey);
  const providerOptions = others.map(p =>
    `<button class="feedback-provider-btn" data-provider-type="${p.type}">${p.label}</button>`
  ).join('');

  return `<div class="feedback-popover">
    <div class="feedback-popover-title">Qu'est-ce qui n'allait pas ?</div>
    <label class="feedback-option"><input type="radio" name="feedback-reason" value="incorrect"> Reponse incorrecte</label>
    <label class="feedback-option"><input type="radio" name="feedback-reason" value="not-useful"> Pas assez utile</label>
    <label class="feedback-option"><input type="radio" name="feedback-reason" value="length"> Trop long / trop court</label>
    <label class="feedback-option"><input type="radio" name="feedback-reason" value="other"> Autre</label>
    <div class="feedback-popover-actions">
      <button class="feedback-action-btn" data-feedback-action="regenerate">Regenerer</button>
      ${others.length > 0 ? `<div class="feedback-other-ai">
        <button class="feedback-action-btn primary" data-feedback-action="try-other">Essayer une autre IA</button>
        <div class="feedback-provider-list" style="display:none">${providerOptions}</div>
      </div>` : ''}
    </div>
  </div>`;
}

export function bindPopoverEvents(
  popover: HTMLElement,
  msg: Message,
  conversationId: string,
  callbacks: FeedbackCallbacks,
  onClose: () => void,
) {
  // Regenerate
  popover.querySelector('[data-feedback-action="regenerate"]')?.addEventListener('click', () => {
    const reason = getSelectedReason(popover);
    saveFeedback(msg, conversationId, 'negative', reason);
    onClose();
    callbacks.onRegenerate(msg);
  });

  // Try other AI
  const tryOtherBtn = popover.querySelector('[data-feedback-action="try-other"]');
  const providerList = popover.querySelector('.feedback-provider-list') as HTMLElement | null;
  if (tryOtherBtn && providerList) {
    tryOtherBtn.addEventListener('click', () => {
      providerList.style.display = providerList.style.display === 'none' ? 'flex' : 'none';
    });
    providerList.querySelectorAll('.feedback-provider-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const reason = getSelectedReason(popover);
        saveFeedback(msg, conversationId, 'negative', reason);
        onClose();
        // The callback receives the provider type string; the caller resolves the full config
        const providerType = (btn as HTMLElement).dataset.providerType!;
        callbacks.onTryOtherProvider(msg, { type: providerType } as any);
      });
    });
  }

  // Close on click outside
  const closeHandler = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node)) {
      onClose();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

function getSelectedReason(popover: HTMLElement): FeedbackEntry['reason'] | undefined {
  const checked = popover.querySelector<HTMLInputElement>('input[name="feedback-reason"]:checked');
  return checked?.value as FeedbackEntry['reason'] | undefined;
}
