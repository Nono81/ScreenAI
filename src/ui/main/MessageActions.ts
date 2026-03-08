// ============================================
// ScreenAI — Message Actions (copy, retry, edit)
// ============================================

import type { Message, Conversation } from '../../types';
import { ICONS } from './icons';

export interface MessageActionCallbacks {
  onCopy: (msg: Message) => void;
  onRetryUser: (msg: Message) => void;
  onRetryAI: (msg: Message) => void;
  onEdit: (msg: Message) => void;
  onLike: (msg: Message) => void;
  onDislike: (msg: Message, btnEl: HTMLElement) => void;
}

export function renderUserActions(): string {
  return `<div class="msg-actions msg-actions-user">
    <button class="msg-action-btn" data-msg-action="copy" title="Copier">${ICONS.copy}</button>
    <button class="msg-action-btn" data-msg-action="edit" title="Modifier">${ICONS.edit}</button>
    <button class="msg-action-btn" data-msg-action="retry-user" title="Reessayer">${ICONS.refresh}</button>
  </div>`;
}

export function renderAIBadge(msg: Message): string {
  const provider = msg.provider || '';
  const model = msg.model || '';
  if (!provider && !model) return '';
  return `<div class="msg-footer"><span class="msg-badge">${provider}${model ? ' &middot; ' + model : ''}</span></div>`;
}

export function renderAIActionsButtons(msg: Message): string {
  const likeClass = msg.feedback === 'positive' ? ' active' : '';
  const dislikeClass = msg.feedback === 'negative' ? ' active' : '';
  return `<div class="msg-actions msg-actions-ai">
    <button class="msg-action-btn" data-msg-action="copy" title="Copier">${ICONS.copy}</button>
    <button class="msg-action-btn feedback-btn${likeClass}" data-msg-action="like" title="Bonne reponse">${ICONS.thumbUp}</button>
    <button class="msg-action-btn feedback-btn${dislikeClass}" data-msg-action="dislike" title="Mauvaise reponse">${ICONS.thumbDown}</button>
    <button class="msg-action-btn" data-msg-action="retry-ai" title="Reessayer">${ICONS.refresh}</button>
  </div>`;
}

// Keep old name as alias for backward compatibility
export function renderAIActions(msg: Message): string {
  return renderAIBadge(msg) + renderAIActionsButtons(msg);
}

export function renderEditMode(msg: Message, hasImage: boolean): string {
  const imgHtml = hasImage
    ? `<div class="msg-edit-img-wrap" style="position:relative;display:inline-block"><img class="mimg" src="${msg.screenshot?.annotatedDataUrl || msg.screenshot?.dataUrl || ''}" alt="Capture"><button class="msg-edit-remove-img" data-action="remove-edit-img">&#10005;</button></div>`
    : '';
  return `<div class="msg-edit-container">
    ${imgHtml}
    <textarea class="msg-edit-textarea">${escapeForTextarea(msg.content)}</textarea>
    <div class="msg-edit-actions">
      <button class="msg-edit-cancel">Annuler</button>
      <button class="msg-edit-send">Envoyer</button>
    </div>
  </div>`;
}

export function handleCopyFeedback(btn: HTMLElement) {
  btn.classList.add('copied');
  const original = btn.innerHTML;
  btn.innerHTML = ICONS.check;
  setTimeout(() => {
    btn.classList.remove('copied');
    btn.innerHTML = original;
  }, 1500);
}

function escapeForTextarea(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
