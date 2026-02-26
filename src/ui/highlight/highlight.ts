// ============================================
// ScreenAI — Highlight Manager (v1.1)
// ============================================
// Allows users to highlight text directly on the page
// before capturing a screenshot.

import highlightCSS from './highlight.css?inline';

// Inject CSS into the page
const styleEl = document.createElement('style');
styleEl.textContent = highlightCSS;
document.head.appendChild(styleEl);

class HighlightManager {
  private static instance: HighlightManager | null = null;
  private active: boolean = false;
  private highlightCount: number = 0;
  private badge: HTMLDivElement | null = null;
  private boundMouseUp: ((e: MouseEvent) => void) | null = null;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;

  static getInstance(): HighlightManager {
    if (!HighlightManager.instance) {
      HighlightManager.instance = new HighlightManager();
    }
    return HighlightManager.instance;
  }

  isActive(): boolean {
    return this.active;
  }

  toggle(): void {
    this.active ? this.deactivate() : this.activate();
  }

  activate(): void {
    if (this.active) return;
    this.active = true;

    document.body.style.cursor = 'text';
    document.body.classList.add('screenai-highlight-mode');

    this.boundMouseUp = this.handleMouseUp.bind(this);
    this.boundKeyDown = this.handleKeyDown.bind(this);
    document.addEventListener('mouseup', this.boundMouseUp);
    document.addEventListener('keydown', this.boundKeyDown);

    this.createBadge();
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;

    document.body.style.cursor = '';
    document.body.classList.remove('screenai-highlight-mode');

    if (this.boundMouseUp) {
      document.removeEventListener('mouseup', this.boundMouseUp);
    }
    if (this.boundKeyDown) {
      document.removeEventListener('keydown', this.boundKeyDown);
    }

    if (this.badge && this.badge.parentNode) {
      this.badge.parentNode.removeChild(this.badge);
      this.badge = null;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.deactivate();
    }
  }

  private handleMouseUp(_e: MouseEvent): void {
    if (!this.active) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const text = range.toString().trim();
    if (!text) return;

    // Don't highlight inside editable elements
    const container = range.startContainer.parentElement;
    if (container && (
      container.isContentEditable ||
      container.tagName === 'INPUT' ||
      container.tagName === 'TEXTAREA' ||
      container.closest('input, textarea, [contenteditable="true"]')
    )) {
      selection.removeAllRanges();
      return;
    }

    try {
      this.wrapRange(range);
      this.highlightCount++;
      this.updateBadge();
    } catch (err) {
      console.warn('[ScreenAI] Highlight wrap failed:', err);
    }

    selection.removeAllRanges();
  }

  private wrapRange(range: Range): void {
    // Simple case: selection is within a single text node
    if (
      range.startContainer === range.endContainer &&
      range.startContainer.nodeType === Node.TEXT_NODE
    ) {
      const mark = document.createElement('mark');
      mark.className = 'screenai-highlight';
      range.surroundContents(mark);
      return;
    }

    // Complex case: selection spans multiple nodes
    // Collect all text nodes within the range
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node: Node) => {
          const nodeRange = document.createRange();
          nodeRange.selectNodeContents(node);
          if (
            range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0 &&
            range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0
          ) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        },
      }
    );

    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }

    // Wrap each text node individually
    for (const textNode of textNodes) {
      const mark = document.createElement('mark');
      mark.className = 'screenai-highlight';
      const parent = textNode.parentNode;
      if (parent) {
        parent.insertBefore(mark, textNode);
        mark.appendChild(textNode);
      }
    }
  }

  clearAll(): void {
    const highlights = document.querySelectorAll('mark.screenai-highlight');
    highlights.forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
        parent.normalize();
      }
    });
    this.highlightCount = 0;
    this.updateBadge();
  }

  private createBadge(): void {
    if (this.badge) return;

    this.badge = document.createElement('div');
    this.badge.id = 'screenai-highlight-badge';
    this.badge.innerHTML = `
      <span class="screenai-badge-icon">&#9998;</span>
      <span class="screenai-badge-text">
        Mode surlignage actif &mdash;
        <span id="screenai-highlight-count">0</span> passage(s)
      </span>
      <button id="screenai-highlight-clear" title="Effacer tout">
        Effacer
      </button>
      <button id="screenai-highlight-close" title="Quitter (Echap)">
        &times;
      </button>
    `;
    document.body.appendChild(this.badge);

    document.getElementById('screenai-highlight-clear')
      ?.addEventListener('click', () => this.clearAll());
    document.getElementById('screenai-highlight-close')
      ?.addEventListener('click', () => this.deactivate());
  }

  private updateBadge(): void {
    const counter = document.getElementById('screenai-highlight-count');
    if (counter) {
      counter.textContent = String(this.highlightCount);
    }
  }

  destroy(): void {
    this.deactivate();
    this.clearAll();
    HighlightManager.instance = null;
  }
}

// Singleton instance
const manager = HighlightManager.getInstance();

// Listen for messages from background/popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'toggle-highlight') {
    manager.toggle();
    sendResponse({ active: manager.isActive() });
  }
  if (message.action === 'clear-highlights') {
    manager.clearAll();
    sendResponse({ cleared: true });
  }
});

export { HighlightManager };
