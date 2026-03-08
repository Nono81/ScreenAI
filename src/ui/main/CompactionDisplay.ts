// ============================================
// ScreenAI — Compaction Display Components
// ============================================

import type { Message, SummaryData } from '../../types';

/** Render the compaction divider that separates archived from active messages */
export function renderCompactionDivider(summaryData: SummaryData): string {
  const date = new Date(summaryData.compactedAt);
  const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const saved = summaryData.originalTokenEstimate - summaryData.summaryTokenEstimate;
  const savedPct = summaryData.originalTokenEstimate > 0
    ? Math.round((saved / summaryData.originalTokenEstimate) * 100)
    : 0;

  return `<div class="compaction-divider">
    <div class="compaction-divider-line"></div>
    <div class="compaction-divider-label">
      <span class="compaction-icon">&#9670;</span>
      ${summaryData.originalMessageCount} messages compactes &middot; ~${saved > 0 ? saved : 0} tokens economises (${savedPct}%) &middot; ${dateStr}
    </div>
    <div class="compaction-divider-line"></div>
  </div>`;
}

/** Render a summary message bubble (expandable) */
export function renderSummaryMessage(msg: Message): string {
  if (!msg.summary) return '';

  const summary = msg.summary;
  return `<div class="message assistant summary-message" data-id="${msg.id}">
    <div class="summary-header" onclick="this.parentElement.classList.toggle('expanded')">
      <span class="summary-toggle-icon">&#9654;</span>
      <span class="summary-title">Resume de la conversation (${summary.originalMessageCount} messages)</span>
    </div>
    <div class="summary-content">
      <div class="summary-text">${escapeHtml(msg.content)}</div>
      <div class="summary-meta">
        ~${summary.originalTokenEstimate} tokens &rarr; ~${summary.summaryTokenEstimate} tokens
      </div>
    </div>
  </div>`;
}

/** Render the context usage indicator */
export function renderContextIndicator(percentage: number): string {
  let color = 'var(--green, #22c55e)';
  let label = 'Contexte';
  if (percentage > 85) {
    color = 'var(--red, #ef4444)';
    label = 'Contexte critique';
  } else if (percentage > 60) {
    color = 'var(--orange, #f59e0b)';
    label = 'Contexte eleve';
  }

  return `<div class="context-indicator" title="${label}: ${percentage}% utilise">
    <div class="context-bar">
      <div class="context-fill" style="width:${percentage}%;background:${color}"></div>
    </div>
    <span class="context-label">${percentage}%</span>
  </div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}
