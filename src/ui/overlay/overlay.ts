// ============================================
// ScreenAI — Main Overlay
// ============================================

import { AnnotationCanvas, type AnnotationTool } from './annotation';
import { RegionSelector, cropScreenshot } from './region';
import { conversationStore, settingsStore } from '../../storage';
import { createConnector } from '../../connectors';
import { renderMarkdown } from '../../utils/markdown';
import { generatePdfBlob } from './PdfExport';
import type { Conversation, Message, AIProviderType, AppSettings, Screenshot, AppLanguage } from '../../types';
import { generateId, PROVIDER_LABELS, DEFAULT_MODELS, LANGUAGE_LABELS, LANGUAGE_PROMPTS, MODEL_OPTIONS, DEFAULT_SYSTEM_PROMPT } from '../../types';

export class ScreenAIOverlay {
  private root: HTMLDivElement;
  private annotationCanvas: AnnotationCanvas | null = null;
  private currentScreenshot: string = '';
  private conversations: Conversation[] = [];
  private activeConvo: Conversation | null = null;
  private settings: AppSettings | null = null;
  private isStreaming = false;
  private currentView: 'annotation' | 'chat' | 'conversations' | 'settings' = 'annotation';

  public onClose: (() => void) | null = null;
  public onAttach: ((annotatedDataUrl: string) => void) | null = null;

  constructor(private screenshotUrl: string, private mode: 'fullscreen' | 'region') {
    this.root = document.createElement('div');
    this.root.id = 'screenai-root';
    this.root.attachShadow({ mode: 'open' });
    document.body.appendChild(this.root);

    this.init();
  }

  private async init() {
    this.settings = await settingsStore.get();
    this.conversations = await conversationStore.getAll();

    if (this.mode === 'region') {
      new RegionSelector(
        document.body,
        this.screenshotUrl,
        async (region) => {
          this.currentScreenshot = await cropScreenshot(
            this.screenshotUrl,
            region,
            window.innerWidth,
            window.innerHeight
          );
          this.buildUI();
        },
        () => this.destroy()
      );
    } else {
      this.currentScreenshot = this.screenshotUrl;
      this.buildUI();
    }
  }

  private buildUI() {
    const shadow = this.root.shadowRoot!;
    shadow.innerHTML = '';

    // Inject styles
    const style = document.createElement('style');
    style.textContent = this.getStyles();
    shadow.appendChild(style);

    // Main container — toolbar vertical on left
    const container = document.createElement('div');
    container.className = 'sai-container';
    container.innerHTML = `
      <div class="sai-toolbar" id="sai-toolbar"></div>
      <div class="sai-center">
        <div class="sai-canvas-wrap" id="sai-canvas-wrap"></div>
        <div class="sai-action-bar" id="sai-action-bar"></div>
      </div>
    `;
    shadow.appendChild(container);

    // Keyboard shortcuts
    this.handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { this.destroy(); return; }
      if (e.ctrlKey && e.key === 'z') { this.annotationCanvas?.undo(); return; }
      if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { this.annotationCanvas?.redo(); return; }
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); this.handleSaveCapture(); return; }
      if (e.ctrlKey && e.shiftKey && e.key === 'X') { e.preventDefault(); this.startCrop(); return; }
      // Tool shortcuts (only when not in text input)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const toolMap: Record<string, AnnotationTool> = {
        p: 'pointer', a: 'arrow', l: 'line', r: 'rectangle', c: 'circle',
        t: 'text', n: 'number', h: 'highlighter', b: 'blur', e: 'eraser',
        d: 'freehand', i: 'pipette',
      };
      const tool = toolMap[e.key.toLowerCase()];
      if (tool) {
        this.annotationCanvas?.setTool(tool);
        this.updateToolbarActive(tool);
      }
    };
    document.addEventListener('keydown', this.handleKeydown);

    this.buildToolbar(shadow.getElementById('sai-toolbar')!);
    this.buildCanvas(shadow.getElementById('sai-canvas-wrap')!);
    this.buildActionBar(shadow.getElementById('sai-action-bar')!);
  }

  private handleKeydown: ((e: KeyboardEvent) => void) | null = null;
  private toolbarContainer: HTMLElement | null = null;

  private updateToolbarActive(tool: string) {
    if (!this.toolbarContainer) return;
    this.toolbarContainer.querySelectorAll('.sai-tool-btn').forEach(b => b.classList.remove('active'));
    const btn = this.toolbarContainer.querySelector(`[data-tool="${tool}"]`);
    if (btn) btn.classList.add('active');
  }

  // ============================================
  // TOOLBAR (vertical left side — clean/minimal design)
  // ============================================

  // SVG icons (monochrome, stroke-width 1.8)
  private static TOOL_ICONS: Record<string, string> = {
    pointer: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>',
    freehand: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
    highlighter: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l-6 6v3h9l3-3"/><path d="M22 12l-4.6 4.6a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8L14 4"/></svg>',
    arrow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
    line: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="5" y1="19" x2="19" y2="5"/></svg>',
    rectangle: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
    circle: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/></svg>',
    highlight: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="8" rx="1" fill="currentColor" opacity="0.2"/><rect x="3" y="8" width="18" height="8" rx="1"/></svg>',
    text: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9.5" y1="20" x2="14.5" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
    number: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><text x="12" y="16" text-anchor="middle" fill="currentColor" stroke="none" font-size="11" font-weight="600">1</text></svg>',
    blur: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="8" x2="8" y2="8.01"/><line x1="12" y1="8" x2="12" y2="8.01"/><line x1="16" y1="8" x2="16" y2="8.01"/><line x1="8" y1="12" x2="8" y2="12.01"/><line x1="12" y1="12" x2="12" y2="12.01"/><line x1="16" y1="12" x2="16" y2="12.01"/><line x1="8" y1="16" x2="8" y2="16.01"/><line x1="12" y1="16" x2="12" y2="16.01"/><line x1="16" y1="16" x2="16" y2="16.01"/></svg>',
    eraser: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14.6 1.6c.8-.8 2-.8 2.8 0l5 5c.8.8.8 2 0 2.8L11 20"/><path d="M6 11l7 7"/></svg>',
    pipette: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22l1-1h3l9-9"/><path d="M3 21l9-9"/><circle cx="18" cy="6" r="3"/><path d="M14.5 9.5L9 15"/></svg>',
    crop: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.13 1L6 16a2 2 0 002 2h15"/><path d="M1 6.13L16 6a2 2 0 012 2v15"/></svg>',
    ocr: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><text x="12" y="15" text-anchor="middle" fill="currentColor" stroke="none" font-size="11" font-weight="700">T</text></svg>',
    undo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 105.64-11.36L1 10"/></svg>',
    redo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-5.64-11.36L23 10"/></svg>',
    clear: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  };

  private isCropping = false;
  private cropOverlay: HTMLElement | null = null;
  private preCropDataUrl: string | null = null;

  private buildToolbar(container: HTMLElement) {
    this.toolbarContainer = container;
    const I = ScreenAIOverlay.TOOL_ICONS;

    // Primary tools — always visible
    const primaryTools: { id: string; label: string; key: string }[] = [
      { id: 'freehand', label: 'Crayon', key: 'D' },
      { id: 'arrow', label: 'Fleche', key: 'A' },
      { id: 'rectangle', label: 'Rectangle', key: 'R' },
      { id: 'circle', label: 'Cercle', key: 'C' },
      { id: 'text', label: 'Inserer texte', key: 'T' },
      { id: 'highlight', label: 'Surlignage zone', key: '' },
      { id: 'blur', label: 'Floutage', key: 'B' },
      { id: 'eraser', label: 'Gomme', key: 'E' },
      { id: 'crop', label: 'Rogner', key: '' },
    ];

    // Secondary tools — in "more" popover
    const secondaryTools: { id: string; label: string; key: string }[] = [
      { id: 'highlighter', label: 'Surligneur', key: 'H' },
      { id: 'line', label: 'Ligne', key: 'L' },
      { id: 'number', label: 'Numero', key: 'N' },
      { id: 'pipette', label: 'Pipette', key: 'I' },
      { id: 'ocr', label: 'Extraire le texte (OCR)', key: '' },
    ];

    const colors = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#AF52DE', '#FFFFFF'];

    let html = '<div class="sai-tools sai-tools-primary">';
    for (const tool of primaryTools) {
      const keyHint = tool.key ? ` (${tool.key})` : '';
      html += `<button class="sai-tool-btn ${tool.id === 'freehand' ? 'active' : ''}" data-tool="${tool.id}" title="${tool.label}${keyHint}">${I[tool.id] || ''}</button>`;
    }
    html += '</div>';

    // "More" button + popover for secondary tools
    html += '<div class="sai-more-wrap">';
    html += `<button class="sai-tool-btn sai-more-btn" id="sai-more-btn" title="Plus d'outils"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg></button>`;
    html += '<div class="sai-more-popover" id="sai-more-popover">';
    for (const tool of secondaryTools) {
      const keyHint = tool.key ? ` (${tool.key})` : '';
      html += `<button class="sai-tool-btn" data-tool="${tool.id}" title="${tool.label}${keyHint}">${I[tool.id] || ''}<span class="sai-more-label">${tool.label}</span></button>`;
    }
    html += '</div></div>';

    html += '<div class="sai-sep-h"></div>';

    // Undo / Redo / Clear
    html += '<div class="sai-tools">';
    html += `<button class="sai-tool-btn" data-tool="undo" title="Annuler (Ctrl+Z)">${I.undo}</button>`;
    html += `<button class="sai-tool-btn" data-tool="redo" title="Retablir (Ctrl+Y)">${I.redo}</button>`;
    html += `<button class="sai-tool-btn" data-tool="clear" title="Tout effacer">${I.clear}</button>`;
    html += '</div>';

    html += '<div class="sai-sep-h"></div>';

    // Color dot — opens popover
    html += '<div class="sai-color-trigger-wrap">';
    html += `<button class="sai-color-dot" id="sai-color-dot" title="Couleur et epaisseur" style="background:#FF3B30;"></button>`;
    html += '<div class="sai-color-popover" id="sai-color-popover">';
    html += '<div class="sai-popover-colors">';
    for (const c of colors) {
      html += `<button class="sai-pop-color ${c === '#FF3B30' ? 'active' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`;
    }
    html += '</div>';
    html += '<div class="sai-popover-widths">';
    html += '<span class="sai-pop-label">Epaisseur</span>';
    html += '<div class="sai-pop-width-row">';
    for (const w of [{ v: 2, label: 'Fin' }, { v: 4, label: 'Moyen' }, { v: 7, label: 'Epais' }]) {
      html += `<button class="sai-pop-width ${w.v === 4 ? 'active' : ''}" data-width="${w.v}" title="${w.label}"><span style="display:inline-block;width:${w.v * 4}px;height:${w.v}px;background:currentColor;border-radius:${w.v}px;"></span></button>`;
    }
    html += '</div></div></div></div>';

    // Spacer
    html += '<div class="sai-toolbar-spacer"></div>';

    // Close button
    html += `<button class="sai-tool-btn sai-close-tool" id="sai-close-btn" title="Fermer (Esc)">${I.close}</button>`;

    container.innerHTML = html;

    // Tool events (skip the "more" button which has no data-tool)
    container.querySelectorAll('.sai-tool-btn[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = (btn as HTMLElement).dataset.tool!;
        if (tool === 'undo') { this.annotationCanvas?.undo(); return; }
        if (tool === 'redo') { this.annotationCanvas?.redo(); return; }
        if (tool === 'clear') { this.annotationCanvas?.clear(); return; }
        if (tool === 'crop') { this.startCrop(); return; }
        if (tool === 'ocr') { this.handleOCR(); return; }
        this.updateToolbarActive(tool);
        this.annotationCanvas?.setTool(tool as AnnotationTool);
      });
    });

    // "More" tools popover toggle
    const moreBtn = container.querySelector('#sai-more-btn') as HTMLElement;
    const morePopover = container.querySelector('#sai-more-popover') as HTMLElement;
    let moreJustOpened = false;
    if (moreBtn && morePopover) {
      moreBtn.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        const willOpen = !morePopover.classList.contains('open');
        popover?.classList.remove('open');
        if (willOpen) {
          // Position the popover next to the button using fixed positioning
          const rect = moreBtn.getBoundingClientRect();
          morePopover.style.left = (rect.right + 8) + 'px';
          morePopover.style.top = rect.top + 'px';
        }
        morePopover.classList.toggle('open');
        if (willOpen) { moreJustOpened = true; setTimeout(() => moreJustOpened = false, 100); }
      });
      // Close more popover when a tool inside is clicked
      morePopover.querySelectorAll('.sai-tool-btn[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => morePopover.classList.remove('open'));
      });
    }

    // Color dot toggle popover
    const colorDot = container.querySelector('#sai-color-dot') as HTMLElement;
    const popover = container.querySelector('#sai-color-popover') as HTMLElement;
    let colorJustOpened = false;
    colorDot?.addEventListener('click', () => {
      const willOpen = !popover.classList.contains('open');
      morePopover?.classList.remove('open');
      popover.classList.toggle('open');
      if (willOpen) { colorJustOpened = true; setTimeout(() => colorJustOpened = false, 50); }
    });

    // Close popovers on outside click — listen on the shadow root container
    const saiContainer = this.root.shadowRoot!.querySelector('.sai-container') || this.root.shadowRoot!;
    saiContainer.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking the trigger buttons themselves (handled above)
      if (target.closest('#sai-more-btn') || target.closest('#sai-more-popover')) return;
      if (target.closest('#sai-color-dot') || target.closest('#sai-color-popover')) return;
      if (moreJustOpened || colorJustOpened) return;
      popover?.classList.remove('open');
      morePopover?.classList.remove('open');
    });

    // Color events
    container.querySelectorAll('.sai-pop-color').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.sai-pop-color').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const color = (btn as HTMLElement).dataset.color!;
        this.annotationCanvas?.setColor(color);
        colorDot.style.background = color;
      });
    });

    // Width events
    container.querySelectorAll('.sai-pop-width').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.sai-pop-width').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.annotationCanvas?.setLineWidth(Number((btn as HTMLElement).dataset.width));
      });
    });

    container.querySelector('#sai-close-btn')?.addEventListener('click', () => this.destroy());
  }

  // ============================================
  // CROP TOOL
  // ============================================
  private startCrop() {
    if (this.isCropping || !this.annotationCanvas) return;
    this.isCropping = true;
    this.preCropDataUrl = this.annotationCanvas.toDataUrl();

    const wrap = this.root.shadowRoot!.getElementById('sai-canvas-wrap');
    if (!wrap) return;

    const canvas = this.annotationCanvas.getCanvas();
    const rect = canvas.getBoundingClientRect();

    // Create crop overlay
    this.cropOverlay = document.createElement('div');
    this.cropOverlay.className = 'sai-crop-overlay';
    this.cropOverlay.style.width = rect.width + 'px';
    this.cropOverlay.style.height = rect.height + 'px';

    // Crop box starts at 20% inset
    const inset = 0.2;
    let cx = rect.width * inset, cy = rect.height * inset;
    let cw = rect.width * (1 - 2 * inset), ch = rect.height * (1 - 2 * inset);

    const updateUI = () => {
      const box = this.cropOverlay!.querySelector('.sai-crop-box') as HTMLElement;
      if (!box) return;
      box.style.left = cx + 'px'; box.style.top = cy + 'px';
      box.style.width = cw + 'px'; box.style.height = ch + 'px';
      // Update dark overlays
      const [top, right, bottom, left] = Array.from(this.cropOverlay!.querySelectorAll('.sai-crop-dim')) as HTMLElement[];
      top.style.cssText = `position:absolute;top:0;left:0;width:100%;height:${cy}px;background:rgba(0,0,0,0.5);pointer-events:none;`;
      bottom.style.cssText = `position:absolute;top:${cy + ch}px;left:0;width:100%;height:${rect.height - cy - ch}px;background:rgba(0,0,0,0.5);pointer-events:none;`;
      left.style.cssText = `position:absolute;top:${cy}px;left:0;width:${cx}px;height:${ch}px;background:rgba(0,0,0,0.5);pointer-events:none;`;
      right.style.cssText = `position:absolute;top:${cy}px;left:${cx + cw}px;width:${rect.width - cx - cw}px;height:${ch}px;background:rgba(0,0,0,0.5);pointer-events:none;`;
    };

    this.cropOverlay.innerHTML = `
      <div class="sai-crop-dim"></div><div class="sai-crop-dim"></div>
      <div class="sai-crop-dim"></div><div class="sai-crop-dim"></div>
      <div class="sai-crop-box">
        <div class="sai-crop-handle" data-pos="tl"></div>
        <div class="sai-crop-handle" data-pos="tr"></div>
        <div class="sai-crop-handle" data-pos="bl"></div>
        <div class="sai-crop-handle" data-pos="br"></div>
        <div class="sai-crop-handle sai-crop-edge" data-pos="t"></div>
        <div class="sai-crop-handle sai-crop-edge" data-pos="b"></div>
        <div class="sai-crop-handle sai-crop-edge" data-pos="l"></div>
        <div class="sai-crop-handle sai-crop-edge" data-pos="r"></div>
        <div class="sai-crop-actions">
          <button class="sai-crop-btn sai-crop-apply" id="sai-crop-apply">Appliquer</button>
          <button class="sai-crop-btn sai-crop-cancel" id="sai-crop-cancel">Annuler</button>
        </div>
      </div>
    `;

    wrap.appendChild(this.cropOverlay);
    updateUI();

    // Handle dragging
    let dragMode: string | null = null;
    let dragStartX = 0, dragStartY = 0;
    let origCx = cx, origCy = cy, origCw = cw, origCh = ch;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const pos = target.dataset.pos;
      if (pos) {
        dragMode = pos;
      } else if (target.closest('.sai-crop-box') && !target.closest('.sai-crop-handle')) {
        dragMode = 'move';
      } else {
        return;
      }
      dragStartX = e.clientX; dragStartY = e.clientY;
      origCx = cx; origCy = cy; origCw = cw; origCh = ch;
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragMode) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const minSize = 30;

      if (dragMode === 'move') {
        cx = Math.max(0, Math.min(rect.width - cw, origCx + dx));
        cy = Math.max(0, Math.min(rect.height - ch, origCy + dy));
      } else {
        if (dragMode.includes('l')) { cx = Math.min(origCx + dx, origCx + origCw - minSize); cw = origCw - (cx - origCx); }
        if (dragMode.includes('r')) { cw = Math.max(minSize, origCw + dx); }
        if (dragMode.includes('t')) { cy = Math.min(origCy + dy, origCy + origCh - minSize); ch = origCh - (cy - origCy); }
        if (dragMode.includes('b')) { ch = Math.max(minSize, origCh + dy); }
        // Clamp
        cx = Math.max(0, cx); cy = Math.max(0, cy);
        cw = Math.min(cw, rect.width - cx); ch = Math.min(ch, rect.height - cy);
      }
      updateUI();
    };

    const onMouseUp = () => { dragMode = null; };

    this.cropOverlay.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Apply
    this.cropOverlay.querySelector('#sai-crop-apply')?.addEventListener('click', () => {
      if (!this.annotationCanvas) return;
      const canvas = this.annotationCanvas.getCanvas();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const cropCanvas = document.createElement('canvas');
      const cropW = Math.round(cw * scaleX);
      const cropH = Math.round(ch * scaleY);
      cropCanvas.width = cropW; cropCanvas.height = cropH;
      const cropCtx = cropCanvas.getContext('2d')!;
      cropCtx.drawImage(canvas, cx * scaleX, cy * scaleY, cropW, cropH, 0, 0, cropW, cropH);
      const croppedUrl = cropCanvas.toDataURL('image/png');

      this.annotationCanvas.replaceBackground(croppedUrl);
      this.currentScreenshot = croppedUrl;
      this.endCrop(onMouseMove, onMouseUp);
    });

    // Cancel
    this.cropOverlay.querySelector('#sai-crop-cancel')?.addEventListener('click', () => {
      this.endCrop(onMouseMove, onMouseUp);
    });
  }

  private endCrop(moveHandler: (e: MouseEvent) => void, upHandler: () => void) {
    this.isCropping = false;
    this.cropOverlay?.remove();
    this.cropOverlay = null;
    document.removeEventListener('mousemove', moveHandler);
    document.removeEventListener('mouseup', upHandler);
  }

  // ============================================
  // OCR — Text extraction
  // ============================================
  private isOcrRunning = false;

  private async handleOCR() {
    if (this.isOcrRunning || !this.annotationCanvas) return;
    this.isOcrRunning = true;

    const shadow = this.root.shadowRoot!;

    // Show spinner popover
    shadow.querySelector('.sai-ocr-popover')?.remove();
    const popover = document.createElement('div');
    popover.className = 'sai-ocr-popover';
    popover.innerHTML = `
      <div class="sai-ocr-spinner-wrap">
        <div class="sai-ocr-spinner"></div>
        <span>Extraction du texte en cours...</span>
      </div>
    `;
    shadow.appendChild(popover);

    try {
      const dataUrl = this.annotationCanvas.toDataUrl();

      // Try Tauri Rust command first (uses tesseract CLI binary)
      const tauri = (window as any).__TAURI__;
      let text: string | null = null;

      if (tauri?.invoke) {
        try {
          text = await tauri.invoke('ocr_extract', { imageDataUrl: dataUrl });
        } catch {
          // Rust OCR not available, fall through to tesseract.js
        }
      }

      if (text === null) {
        // Use tesseract.js in browser
        const { createWorker } = await import('tesseract.js');
        const worker = await createWorker('eng+fra');
        const result = await worker.recognize(dataUrl);
        text = result.data.text;
        await worker.terminate();
      }

      const extractedText = (text || '').trim();

      // Show result popover
      popover.innerHTML = `
        <div class="sai-ocr-header">
          <span>Texte extrait (OCR)</span>
          <button class="sai-ocr-close" id="sai-ocr-close" title="Fermer">\u2715</button>
        </div>
        <div class="sai-ocr-body">
          ${extractedText
            ? `<pre class="sai-ocr-text">${this.escapeHtml(extractedText)}</pre>`
            : `<p class="sai-ocr-empty">Aucun texte detecte dans l'image.</p>`
          }
        </div>
        ${extractedText ? `<div class="sai-ocr-actions">
          <button class="sai-btn sai-btn-primary" id="sai-ocr-copy">Copier le texte</button>
        </div>` : ''}
      `;

      popover.querySelector('#sai-ocr-close')?.addEventListener('click', () => {
        popover.remove();
      });

      popover.querySelector('#sai-ocr-copy')?.addEventListener('click', () => {
        navigator.clipboard.writeText(extractedText).then(() => {
          const btn = popover.querySelector('#sai-ocr-copy') as HTMLElement;
          if (btn) { btn.textContent = 'Copie !'; setTimeout(() => { btn.textContent = 'Copier le texte'; }, 1500); }
        });
      });

    } catch (err: any) {
      popover.innerHTML = `
        <div class="sai-ocr-header">
          <span>Erreur OCR</span>
          <button class="sai-ocr-close" id="sai-ocr-close" title="Fermer">\u2715</button>
        </div>
        <div class="sai-ocr-body">
          <p class="sai-ocr-empty">${this.escapeHtml(err.message || String(err))}</p>
        </div>
      `;
      popover.querySelector('#sai-ocr-close')?.addEventListener('click', () => popover.remove());
    } finally {
      this.isOcrRunning = false;
    }
  }

  // ============================================
  // CANVAS (center - screenshot + annotations)
  // ============================================
  private buildCanvas(container: HTMLElement) {
    const img = new Image();
    img.src = this.currentScreenshot;
    img.onload = () => {
      const dpr = window.devicePixelRatio || 1;
      console.log(`[ScreenAI] Image: ${img.width}x${img.height}, viewport: ${window.innerWidth}x${window.innerHeight}, devicePixelRatio: ${dpr}`);
      this.annotationCanvas = new AnnotationCanvas(
        container,
        this.currentScreenshot,
        img.width,
        img.height
      );

      // Wire up color picker callback
      this.annotationCanvas!.onColorPicked = (hex, r, g, b) => {
        // Update toolbar color buttons — deselect all, show picked color
        if (this.toolbarContainer) {
          this.toolbarContainer.querySelectorAll('.sai-color-btn').forEach(b => b.classList.remove('active'));
        }
        this.showColorInfo(hex, r, g, b);
      };
    };
  }

  private showColorInfo(hex: string, r: number, g: number, b: number) {
    // Remove existing popover
    this.root.shadowRoot!.querySelector('.sai-color-info')?.remove();

    const rgbStr = `${r}, ${g}, ${b}`;
    const panel = this.root.shadowRoot!.getElementById('sai-panel')!;
    const popover = document.createElement('div');
    popover.className = 'sai-color-info';
    popover.style.cssText = 'position:absolute;bottom:12px;left:12px;right:12px;background:#1a1a2e;border:1px solid #2a2a4a;border-radius:10px;padding:12px;z-index:10;';
    popover.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <div style="width:36px;height:36px;border-radius:8px;background:${hex};border:2px solid rgba(255,255,255,0.2);"></div>
        <div style="font-size:11px;color:#888;">Couleur selectionnee</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;font-size:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="color:#888;">HEX</span>
          <span style="color:#e0e0e0;font-family:monospace;cursor:pointer;" data-copy="${hex}">${hex}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="color:#888;">RGB</span>
          <span style="color:#e0e0e0;font-family:monospace;cursor:pointer;" data-copy="rgb(${rgbStr})">rgb(${rgbStr})</span>
        </div>
      </div>
      <div style="margin-top:8px;display:flex;gap:6px;">
        <button class="sai-btn sai-btn-primary" id="sai-use-color" style="flex:1;padding:6px;font-size:11px;">Utiliser cette couleur</button>
        <button class="sai-btn" id="sai-close-color" style="padding:6px 10px;font-size:11px;background:rgba(255,255,255,0.06);color:#ccc;">\u2715</button>
      </div>
    `;

    panel.style.position = 'relative';
    panel.appendChild(popover);

    // Copy on click
    popover.querySelectorAll('[data-copy]').forEach(el => {
      el.addEventListener('click', () => {
        navigator.clipboard.writeText((el as HTMLElement).dataset.copy!);
        (el as HTMLElement).textContent = 'Copie !';
        setTimeout(() => { (el as HTMLElement).textContent = (el as HTMLElement).dataset.copy!; }, 1500);
      });
    });

    popover.querySelector('#sai-use-color')?.addEventListener('click', () => {
      this.annotationCanvas?.setColor(hex);
      this.annotationCanvas?.setTool('pointer');
      this.updateToolbarActive('pointer');
      popover.remove();
    });

    popover.querySelector('#sai-close-color')?.addEventListener('click', () => {
      popover.remove();
    });
  }

  // ============================================
  // ACTION BAR (bottom of canvas — copy, save, share, drag)
  // ============================================
  private buildActionBar(container: HTMLElement) {
    container.innerHTML = `
      <div class="sai-ab-left">
        <button class="sai-ab-btn" id="sai-copy-btn" title="Copier dans le presse-papier (Ctrl+C)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Copier
        </button>
        <div class="sai-save-split" id="sai-save-split">
          <button class="sai-ab-btn sai-save-main" id="sai-save-btn" title="Enregistrer (Ctrl+S)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Enregistrer
          </button>
          <button class="sai-ab-btn sai-save-arrow" id="sai-save-arrow" title="Choisir le format">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="sai-format-dropdown" id="sai-format-dropdown" style="display:none;">
            <button class="sai-format-opt" data-fmt="png">Image PNG <span class="sai-fmt-ext">.png</span></button>
            <button class="sai-format-opt" data-fmt="jpg">Image JPEG <span class="sai-fmt-ext">.jpg</span></button>
            <button class="sai-format-opt" data-fmt="pdf">Document PDF <span class="sai-fmt-ext">.pdf</span></button>
          </div>
        </div>
        <button class="sai-ab-btn" id="sai-share-btn" title="Partager via le dialogue natif de l'OS">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Partager
        </button>
      </div>
      <div class="sai-ab-right">
        <button class="sai-ab-btn sai-drag-btn" id="sai-drag-btn" title="Ouvrir dans l'explorateur pour glisser vers une autre app">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
          Glisser
        </button>
        ${this.onAttach ? `<button class="sai-ab-btn sai-ab-send" id="sai-send-ai-btn" title="Envoyer la capture annotee a l'IA">
          Envoyer a l'IA
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </button>` : ''}
      </div>
    `;

    // Copy to clipboard
    container.querySelector('#sai-copy-btn')?.addEventListener('click', () => this.handleCopyCapture());

    // Save — default PNG
    container.querySelector('#sai-save-btn')?.addEventListener('click', () => this.handleSaveCapture());

    // Save dropdown toggle
    const arrow = container.querySelector('#sai-save-arrow')!;
    const dropdown = container.querySelector('#sai-format-dropdown') as HTMLElement;
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
    });

    // Format options
    container.querySelectorAll('.sai-format-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        const fmt = (btn as HTMLElement).dataset.fmt!;
        dropdown.style.display = 'none';
        this.handleSaveCapture(fmt as 'png' | 'jpg' | 'pdf');
      });
    });

    // Close dropdown on outside click
    container.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('#sai-save-split')) {
        dropdown.style.display = 'none';
      }
    });

    // Share (native OS dialog)
    container.querySelector('#sai-share-btn')?.addEventListener('click', () => this.handleShareNative());

    // Drag to external app
    container.querySelector('#sai-drag-btn')?.addEventListener('click', () => this.handleDragExternal());

    // Send to AI button (only present when onAttach is set)
    container.querySelector('#sai-send-ai-btn')?.addEventListener('click', () => {
      const annotated = this.annotationCanvas?.toDataUrl() || this.currentScreenshot;
      this.onAttach?.(annotated);
      this.destroy();
    });
  }

  private async handleShareNative() {
    if (!this.annotationCanvas) return;
    const tauri = (window as any).__TAURI__;
    if (!tauri?.invoke) {
      this.showToast('Partage natif disponible uniquement dans l\'application');
      return;
    }
    try {
      const dataUrl = this.annotationCanvas.toDataUrl();
      const base64 = dataUrl.split(',')[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const filePath: string = await tauri.invoke('save_temp_capture', { data: Array.from(bytes) });
      await tauri.invoke('share_native', { filePath });
    } catch (err) {
      console.error('Share failed:', err);
      this.showToast('Erreur lors du partage');
    }
  }

  private showToast(msg: string) {
    const shadow = this.root.shadowRoot!;
    shadow.querySelector('.sai-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'sai-toast';
    toast.textContent = msg;
    shadow.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  private async handleCopyCapture() {
    if (!this.annotationCanvas) return;
    try {
      const dataUrl = this.annotationCanvas.toDataUrl();
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      this.showToast('Image copiee dans le presse-papier');
    } catch {
      this.showToast('Erreur: impossible de copier');
    }
  }

  private async makeImageBytes(format: 'png' | 'jpg' | 'pdf'): Promise<Uint8Array> {
    if (format === 'pdf') {
      const dataUrl = this.annotationCanvas!.toDataUrl();
      const img = new Image();
      await new Promise<void>((resolve) => { img.onload = () => resolve(); img.src = dataUrl; });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d')!.drawImage(img, 0, 0);
      const pdfBlob = await generatePdfBlob(c);
      return new Uint8Array(await pdfBlob.arrayBuffer());
    }
    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const dataUrl = this.annotationCanvas!.toDataUrl(mime);
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    return new Uint8Array(await blob.arrayBuffer());
  }

  private async handleSaveCapture(format: 'png' | 'jpg' | 'pdf' = 'png') {
    if (!this.annotationCanvas) return;
    const tauri = (window as any).__TAURI__;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = format === 'jpg' ? 'jpg' : format;
    const defaultName = `ScreenAI_${ts}.${ext}`;

    if (tauri?.dialog?.save) {
      // Desktop Tauri — native save dialog
      try {
        const filters = format === 'pdf'
          ? [{ name: 'PDF', extensions: ['pdf'] }]
          : format === 'jpg'
          ? [{ name: 'JPEG', extensions: ['jpg', 'jpeg'] }]
          : [{ name: 'PNG', extensions: ['png'] }];

        const filePath = await tauri.dialog.save({ defaultPath: defaultName, filters });
        if (!filePath) return;

        const bytes = await this.makeImageBytes(format);
        await tauri.invoke('write_file_bytes', { path: filePath, data: Array.from(bytes) });
        const fname = filePath.split(/[/\\]/).pop() || filePath;
        this.showToast(`Enregistre : ${fname}`);
      } catch (err: any) {
        this.showToast(`Erreur: ${err.message || err}`);
      }
    } else {
      // Browser — download link
      try {
        if (format === 'pdf') {
          const bytes = await this.makeImageBytes('pdf');
          const blob = new Blob([bytes], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = defaultName; a.click();
          URL.revokeObjectURL(url);
        } else {
          const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
          const dataUrl = this.annotationCanvas.toDataUrl(mime);
          const a = document.createElement('a');
          a.href = dataUrl; a.download = defaultName; a.click();
        }
        this.showToast(`Telecharge : ${defaultName}`);
      } catch (err: any) {
        this.showToast(`Erreur: ${err.message || err}`);
      }
    }
  }

  private async handleDragExternal() {
    if (!this.annotationCanvas) return;
    const tauri = (window as any).__TAURI__;

    try {
      // Get annotated image as bytes
      const dataUrl = this.annotationCanvas.toDataUrl();
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());

      if (tauri?.invoke) {
        // Desktop: save temp file + reveal in Explorer
        const tempPath: string = await tauri.invoke('save_temp_capture', { data: Array.from(bytes) });
        await tauri.invoke('reveal_in_explorer', { path: tempPath });
        // Also copy to clipboard
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        this.showToast('Fichier ouvert dans l\'explorateur — glissez-le vers votre app (aussi copie dans le presse-papier)');
      } else {
        // Browser: copy to clipboard as fallback
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        this.showToast('Image copiee — collez-la (Ctrl+V) dans votre application');
      }
    } catch (err: any) {
      this.showToast(`Erreur: ${err.message || err}`);
    }
  }

  // ============================================
  // CONVERSATION PICKER (right panel)
  // ============================================
  private showConversationPicker() {
    const panel = this.root.shadowRoot!.getElementById('sai-panel')!;
    const provider = this.settings?.defaultProvider || 'claude';

    let html = `
      <div class="sai-panel-header">
        <h2>💬 Conversation</h2>
        <button class="sai-icon-btn" id="sai-settings-btn" title="Settings">⚙️</button>
      </div>
      <div class="sai-panel-body">
        <button class="sai-btn sai-btn-primary sai-full-width" id="sai-new-convo">
          ＋ New conversation
        </button>
    `;

    if (this.conversations.length > 0) {
      html += '<div class="sai-divider"><span>or attach to</span></div>';
      html += '<div class="sai-convo-list">';
      for (const c of this.conversations.slice(0, 20)) {
        const date = new Date(c.updatedAt).toLocaleDateString('en-US', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        const msgCount = c.messages.length;
        html += `
          <button class="sai-convo-item" data-id="${c.id}">
            <div class="sai-convo-title">${this.escapeHtml(c.title)}</div>
            <div class="sai-convo-meta">${PROVIDER_LABELS[c.provider]} · ${msgCount} msg · ${date}</div>
          </button>
        `;
      }
      html += '</div>';
    }

    html += '</div>';
    panel.innerHTML = html;

    // Events
    panel.querySelector('#sai-new-convo')?.addEventListener('click', async () => {
      const convo = await conversationStore.create(provider, this.settings!.providers[provider].model);
      this.activeConvo = convo;
      this.showChat();
    });

    panel.querySelectorAll('.sai-convo-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id!;
        this.activeConvo = (await conversationStore.get(id)) || null;
        if (this.activeConvo) this.showChat();
      });
    });

    panel.querySelector('#sai-settings-btn')?.addEventListener('click', () => this.showSettings());
  }

  // ============================================
  // CHAT VIEW (right panel)
  // ============================================
  private showChat() {
    const panel = this.root.shadowRoot!.getElementById('sai-panel')!;
    if (!this.activeConvo) return;

    const provider = this.activeConvo.provider;
    const providerLabel = PROVIDER_LABELS[provider] || provider;

    let html = `
      <div class="sai-panel-header">
        <button class="sai-icon-btn" id="sai-back-btn" title="Back">←</button>
        <div class="sai-chat-title">
          <h3>${this.escapeHtml(this.activeConvo.title)}</h3>
          <span class="sai-provider-badge">${providerLabel}</span>
        </div>
        <button class="sai-icon-btn" id="sai-settings-btn2" title="Settings">⚙️</button>
      </div>
      <div class="sai-messages" id="sai-messages"></div>
      <div class="sai-input-area">
        <div class="sai-input-row">
          <textarea class="sai-input" id="sai-input" placeholder="Describe your problem or ask a question..." rows="2"></textarea>
          <button class="sai-btn sai-btn-send" id="sai-send-btn" title="Send">
            <span id="sai-send-icon">➤</span>
          </button>
        </div>
        <div class="sai-input-hint">
          The annotated capture will be sent with your message
        </div>
      </div>
    `;

    panel.innerHTML = html;
    this.renderMessages();

    // Events
    panel.querySelector('#sai-back-btn')?.addEventListener('click', () => {
      this.showConversationPicker();
    });

    panel.querySelector('#sai-settings-btn2')?.addEventListener('click', () => this.showSettings());

    const input = panel.querySelector('#sai-input') as HTMLTextAreaElement;
    const sendBtn = panel.querySelector('#sai-send-btn')!;

    const send = () => {
      if (this.isStreaming) return;
      const text = input.value.trim();
      if (!text && !this.currentScreenshot) return;
      input.value = '';
      this.sendMessage(text);
    };

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    // Auto-focus
    input.focus();
  }

  private renderMessages() {
    const container = this.root.shadowRoot!.getElementById('sai-messages');
    if (!container || !this.activeConvo) return;

    let html = '';
    for (const msg of this.activeConvo.messages) {
      const isUser = msg.role === 'user';
      html += `<div class="sai-msg ${isUser ? 'sai-msg-user' : 'sai-msg-ai'}">`;

      if (isUser && msg.screenshot?.annotatedDataUrl) {
        html += `<img class="sai-msg-screenshot" src="${msg.screenshot.annotatedDataUrl}" alt="capture">`;
      } else if (isUser && msg.screenshot?.dataUrl) {
        html += `<img class="sai-msg-screenshot" src="${msg.screenshot.dataUrl}" alt="capture">`;
      }

      if (msg.content) {
        html += `<div class="sai-msg-content">${isUser ? this.escapeHtml(msg.content) : renderMarkdown(msg.content)}</div>`;
      }

      html += '</div>';
    }

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
  }

  // ============================================
  // SEND MESSAGE
  // ============================================
  private async sendMessage(text: string) {
    if (!this.activeConvo || !this.settings) return;

    const provider = this.activeConvo.provider;
    const config = this.settings.providers[provider];

    if (!config.apiKey && provider !== 'ollama') {
      this.showError('API key missing. Configure it in settings.');
      return;
    }

    // Create screenshot data
    const annotatedUrl = this.annotationCanvas?.toDataUrl() || this.currentScreenshot;
    const screenshot: Screenshot = {
      dataUrl: this.currentScreenshot,
      annotations: this.annotationCanvas?.getAnnotations() || [],
      annotatedDataUrl: annotatedUrl,
      timestamp: Date.now(),
    };

    // User message
    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: text || 'Help me with what you see on screen.',
      screenshot,
      timestamp: Date.now(),
      provider,
      model: config.model,
    };

    this.activeConvo = await conversationStore.addMessage(this.activeConvo.id, userMsg);
    this.renderMessages();

    // AI response
    const aiMsg: Message = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      provider,
      model: config.model,
    };

    // Add empty AI message for streaming
    this.activeConvo!.messages.push(aiMsg);
    this.renderMessages();
    this.isStreaming = true;
    this.updateSendButton(true);

    try {
      const connector = createConnector(config);

      // Build system prompt with language preference
      const langPrompt = this.settings?.language && this.settings.language !== 'auto'
        ? ` ${LANGUAGE_PROMPTS[this.settings.language]}`
        : ' Respond in the user\'s language.';
      const fullPrompt = (this.settings?.systemPrompt || DEFAULT_SYSTEM_PROMPT) + langPrompt;

      await connector.send(this.activeConvo!.messages.slice(0, -1), fullPrompt, (chunk: string, done: boolean) => {
        aiMsg.content += chunk;

        // Update the displayed message
        const messagesEl = this.root.shadowRoot!.getElementById('sai-messages');
        if (messagesEl) {
          const lastMsg = messagesEl.querySelector('.sai-msg:last-child .sai-msg-content');
          if (lastMsg) {
            lastMsg.innerHTML = renderMarkdown(aiMsg.content);
          }
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        if (done) {
          this.isStreaming = false;
          this.updateSendButton(false);
          // Save to DB
          conversationStore.addMessage(this.activeConvo!.id, aiMsg).then((updated: Conversation) => {
            // Remove the temporary message and use the saved one
            this.activeConvo = updated;
          });
        }
      });
    } catch (err: any) {
      aiMsg.content = `❌ Error: ${err.message || 'Could not reach the AI'}`;
      this.isStreaming = false;
      this.updateSendButton(false);
      this.renderMessages();
    }
  }

  private updateSendButton(streaming: boolean) {
    const icon = this.root.shadowRoot!.getElementById('sai-send-icon');
    if (icon) {
      icon.textContent = streaming ? '⏳' : '➤';
    }
  }

  private showError(msg: string) {
    const messagesEl = this.root.shadowRoot!.getElementById('sai-messages');
    if (messagesEl) {
      messagesEl.innerHTML += `<div class="sai-msg sai-msg-error"><div class="sai-msg-content">⚠️ ${msg}</div></div>`;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // ============================================
  // SETTINGS VIEW
  // ============================================
  private showSettings() {
    const panel = this.root.shadowRoot!.getElementById('sai-panel')!;
    if (!this.settings) return;

    let html = `
      <div class="sai-panel-header">
        <button class="sai-icon-btn" id="sai-back-settings" title="Back">←</button>
        <h2>⚙️ Settings</h2>
      </div>
      <div class="sai-panel-body sai-settings-body">
        <div class="sai-setting-group">
          <label class="sai-label">Default AI</label>
          <select class="sai-select" id="sai-default-provider">
    `;

    for (const [key, label] of Object.entries(PROVIDER_LABELS)) {
      const selected = key === this.settings.defaultProvider ? 'selected' : '';
      html += `<option value="${key}" ${selected}>${label}</option>`;
    }

    html += `</select></div>`;

    // Provider configs
    for (const [key, config] of Object.entries(this.settings.providers)) {
      const label = PROVIDER_LABELS[key as AIProviderType];
      html += `
        <div class="sai-setting-group sai-provider-config">
          <div class="sai-provider-header">
            <h4>${label}</h4>
            <label class="sai-toggle">
              <input type="checkbox" data-provider="${key}" data-field="enabled" ${config.enabled ? 'checked' : ''}>
              <span class="sai-toggle-slider"></span>
            </label>
          </div>
          <input class="sai-input-field" type="password" placeholder="API Key" 
            data-provider="${key}" data-field="apiKey" value="${config.apiKey}">
          <input class="sai-input-field" type="text" placeholder="Model" 
            data-provider="${key}" data-field="model" value="${config.model}">
          ${key === 'ollama' ? `<input class="sai-input-field" type="text" placeholder="URL (http://localhost:11434)" 
            data-provider="${key}" data-field="baseUrl" value="${config.baseUrl || ''}">` : ''}
        </div>
      `;
    }

    html += `
      <button class="sai-btn sai-btn-primary sai-full-width" id="sai-save-settings">
        Save
      </button>
    </div>`;

    panel.innerHTML = html;

    // Events
    panel.querySelector('#sai-back-settings')?.addEventListener('click', () => {
      if (this.activeConvo) this.showChat();
      else this.showConversationPicker();
    });

    panel.querySelector('#sai-save-settings')?.addEventListener('click', async () => {
      const select = panel.querySelector('#sai-default-provider') as HTMLSelectElement;
      this.settings!.defaultProvider = select.value as AIProviderType;

      // Collect all provider settings
      panel.querySelectorAll('.sai-input-field').forEach((input) => {
        const el = input as HTMLInputElement;
        const provider = el.dataset.provider as AIProviderType;
        const field = el.dataset.field!;
        (this.settings!.providers[provider] as any)[field] = el.value;
      });

      panel.querySelectorAll('input[type="checkbox"]').forEach((input) => {
        const el = input as HTMLInputElement;
        const provider = el.dataset.provider as AIProviderType;
        this.settings!.providers[provider].enabled = el.checked;
      });

      await settingsStore.save(this.settings!);

      // Show saved feedback
      const btn = panel.querySelector('#sai-save-settings')!;
      btn.textContent = '✓ Saved';
      setTimeout(() => { btn.textContent = 'Save'; }, 1500);
    });
  }

  // ============================================
  // ATTACH PANEL (simplified — annotation only, no chat)
  // ============================================
  private showAttachPanel() {
    const panel = this.root.shadowRoot!.getElementById('sai-panel')!;
    panel.innerHTML = `
      <div class="sai-panel-header">
        <h2>&#128247; Annoter la capture</h2>
      </div>
      <div class="sai-panel-body" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;">
        <p style="color:#aaa;font-size:13px;">Utilisez les outils a gauche pour annoter, puis cliquez sur Attacher.</p>
        <button class="sai-btn sai-btn-primary sai-full-width" id="sai-attach-btn">&#128206; Attacher au message</button>
        <button class="sai-btn sai-full-width" id="sai-attach-cancel" style="background:rgba(255,255,255,0.06);color:#ccc;">Annuler</button>
      </div>
    `;
    panel.querySelector('#sai-attach-btn')?.addEventListener('click', () => {
      const annotated = this.annotationCanvas?.toDataUrl() || this.currentScreenshot;
      this.onAttach?.(annotated);
      this.destroy();
    });
    panel.querySelector('#sai-attach-cancel')?.addEventListener('click', () => {
      this.destroy();
    });
  }

  // ============================================
  // DESTROY
  // ============================================
  destroy() {
    if (this.handleKeydown) {
      document.removeEventListener('keydown', this.handleKeydown);
    }
    this.annotationCanvas?.destroy();
    this.root.remove();
    this.onClose?.();
  }

  // ============================================
  // UTILITIES
  // ============================================
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================
  // STYLES
  // ============================================
  private getStyles(): string {
    return `
      :host {
        all: initial;
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        --ac: #a78bfa;
        --ac-bg: rgba(167,139,250,0.12);
        --bg: #0d0d0d;
        --bg2: #151520;
        --bg3: #1a1a2e;
        --bd: rgba(255,255,255,0.08);
        --t1: #e0e0e0;
        --t2: rgba(255,255,255,0.55);
        --r: 10px;
        --shadow-sm: 0 2px 8px rgba(0,0,0,0.3);
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }

      .sai-container {
        display: flex;
        width: 100vw;
        height: 100vh;
        background: var(--bg);
      }

      /* ---- TOOLBAR: vertical left side ---- */
      .sai-toolbar {
        width: 52px;
        min-width: 52px;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 10px 6px;
        background: var(--bg2);
        border-right: 1px solid var(--bd);
        box-shadow: var(--shadow-sm);
        gap: 2px;
        overflow-y: auto;
        overflow-x: visible;
      }

      .sai-tools {
        display: flex;
        flex-direction: column;
        gap: 2px;
        width: 100%;
        align-items: center;
      }

      .sai-sep-h {
        width: 28px;
        height: 1px;
        background: var(--bd);
        margin: 6px 0;
        flex-shrink: 0;
      }

      .sai-tool-btn {
        width: 38px;
        height: 38px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid transparent;
        border-radius: var(--r);
        cursor: pointer;
        color: var(--t2);
        transition: all 0.15s;
        position: relative;
      }

      .sai-tool-btn:hover {
        background: rgba(255,255,255,0.06);
        color: var(--t1);
      }

      .sai-tool-btn.active {
        background: var(--ac-bg);
        color: var(--ac);
        border-color: transparent;
      }

      .sai-close-tool {
        color: rgba(255,100,100,0.6);
      }
      .sai-close-tool:hover {
        background: rgba(255,60,60,0.15);
        color: #ff6b6b;
      }

      /* Color dot trigger */
      .sai-color-trigger-wrap {
        position: relative;
        display: flex;
        justify-content: center;
      }

      .sai-color-dot {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid rgba(255,255,255,0.2);
        cursor: pointer;
        transition: all 0.15s;
      }
      .sai-color-dot:hover {
        border-color: rgba(255,255,255,0.5);
        transform: scale(1.1);
      }

      /* Color popover */
      .sai-color-popover {
        position: absolute;
        left: 100%;
        top: 50%;
        transform: translateY(-50%);
        margin-left: 8px;
        background: var(--bg3);
        border: 1px solid var(--bd);
        border-radius: var(--r);
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        padding: 10px;
        display: none;
        flex-direction: column;
        gap: 10px;
        z-index: 200;
        min-width: 180px;
      }
      .sai-color-popover.open { display: flex; }

      .sai-popover-colors {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .sai-pop-color {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        transition: all 0.15s;
      }
      .sai-pop-color:hover { transform: scale(1.15); }
      .sai-pop-color.active { border-color: white; box-shadow: 0 0 6px rgba(255,255,255,0.3); }

      .sai-popover-widths {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .sai-pop-label {
        font-size: 10px;
        color: var(--t2);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .sai-pop-width-row {
        display: flex;
        gap: 4px;
      }

      .sai-pop-width {
        width: 36px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 6px;
        cursor: pointer;
        color: var(--t2);
        transition: all 0.15s;
      }
      .sai-pop-width:hover { background: rgba(255,255,255,0.06); color: var(--t1); }
      .sai-pop-width.active { background: var(--ac-bg); color: var(--ac); border-color: transparent; }

      .sai-toolbar-spacer { flex: 1; }

      /* "More" tools button + popover */
      .sai-more-wrap {
        position: relative;
        display: flex;
        justify-content: center;
      }
      .sai-more-btn {
        color: var(--t3) !important;
      }
      .sai-more-popover {
        display: none;
        position: fixed;
        background: var(--bg2);
        border: 1px solid var(--bd);
        border-radius: 10px;
        padding: 6px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        z-index: 9999;
        flex-direction: column;
        gap: 2px;
        min-width: 150px;
      }
      .sai-more-popover.open { display: flex; }
      .sai-more-popover .sai-tool-btn {
        width: 100%;
        height: 34px;
        justify-content: flex-start;
        gap: 8px;
        padding: 0 10px;
        border-radius: 6px;
      }
      .sai-more-label {
        font-size: 12px;
        white-space: nowrap;
      }

      /* Compact mode for small windows */
      @media (max-height: 700px) {
        .sai-toolbar { padding: 6px 4px; gap: 1px; }
        .sai-tool-btn { width: 32px; height: 32px; }
        .sai-tool-btn svg { width: 16px; height: 16px; }
        .sai-sep-h { margin: 3px 0; }
        .sai-color-dot { width: 20px; height: 20px; }
      }

      /* ---- CENTER: Canvas + ActionBar ---- */
      .sai-center {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .sai-canvas-wrap {
        flex: 1;
        position: relative;
        overflow: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #111;
      }

      .sai-canvas-wrap canvas {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        position: relative;
      }

      /* ---- Crop overlay ---- */
      .sai-crop-overlay {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 60;
      }

      .sai-crop-box {
        position: absolute;
        border: 2px solid var(--ac);
        cursor: move;
        z-index: 61;
      }

      .sai-crop-handle {
        position: absolute;
        width: 10px;
        height: 10px;
        background: white;
        border: 2px solid var(--ac);
        border-radius: 2px;
        z-index: 62;
      }

      .sai-crop-handle[data-pos="tl"] { top: -5px; left: -5px; cursor: nwse-resize; }
      .sai-crop-handle[data-pos="tr"] { top: -5px; right: -5px; cursor: nesw-resize; }
      .sai-crop-handle[data-pos="bl"] { bottom: -5px; left: -5px; cursor: nesw-resize; }
      .sai-crop-handle[data-pos="br"] { bottom: -5px; right: -5px; cursor: nwse-resize; }
      .sai-crop-edge[data-pos="t"] { top: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
      .sai-crop-edge[data-pos="b"] { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
      .sai-crop-edge[data-pos="l"] { left: -5px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
      .sai-crop-edge[data-pos="r"] { right: -5px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }

      .sai-crop-actions {
        position: absolute;
        bottom: -40px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 6px;
        z-index: 63;
      }

      .sai-crop-btn {
        padding: 6px 16px;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
      }
      .sai-crop-apply { background: var(--ac); color: #0d0d0d; }
      .sai-crop-apply:hover { background: #b89dff; }
      .sai-crop-cancel { background: rgba(255,255,255,0.1); color: #ccc; }
      .sai-crop-cancel:hover { background: rgba(255,255,255,0.18); }

      /* ---- OCR Popover ---- */
      .sai-ocr-popover {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--bg3);
        border: 1px solid var(--bd);
        border-radius: var(--r);
        box-shadow: 0 12px 40px rgba(0,0,0,0.6);
        z-index: 300;
        min-width: 380px;
        max-width: 520px;
        max-height: 70vh;
        display: flex;
        flex-direction: column;
      }
      .sai-ocr-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--bd);
        font-size: 13px;
        font-weight: 600;
        color: var(--t1);
      }
      .sai-ocr-close {
        background: none;
        border: none;
        color: var(--t2);
        cursor: pointer;
        font-size: 16px;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .sai-ocr-close:hover { background: rgba(255,255,255,0.08); color: var(--t1); }
      .sai-ocr-body {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
      }
      .sai-ocr-text {
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 12.5px;
        line-height: 1.6;
        color: var(--t1);
        font-family: 'Consolas', 'Courier New', monospace;
        background: rgba(0,0,0,0.2);
        border-radius: 6px;
        padding: 12px;
        max-height: 40vh;
        overflow-y: auto;
      }
      .sai-ocr-empty {
        color: var(--t2);
        font-size: 13px;
        text-align: center;
        padding: 20px 0;
      }
      .sai-ocr-actions {
        padding: 12px 16px;
        border-top: 1px solid var(--bd);
        display: flex;
        justify-content: flex-end;
      }
      .sai-ocr-spinner-wrap {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 24px 28px;
        color: var(--t2);
        font-size: 13px;
      }
      .sai-ocr-spinner {
        width: 22px;
        height: 22px;
        border: 2.5px solid var(--bd);
        border-top-color: var(--ac);
        border-radius: 50%;
        animation: sai-spin 0.7s linear infinite;
      }
      @keyframes sai-spin { to { transform: rotate(360deg); } }

      /* ---- RIGHT: Panel ---- */
      .sai-right {
        width: 400px;
        min-width: 400px;
        display: flex;
        flex-direction: column;
        background: var(--bg2);
        border-left: 1px solid var(--bd);
      }

      .sai-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      .sai-panel-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px;
        background: var(--bg3);
        border-bottom: 1px solid var(--bd);
      }

      .sai-panel-header h2, .sai-panel-header h3 {
        color: var(--t1);
        font-size: 15px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .sai-chat-title { flex: 1; min-width: 0; }
      .sai-chat-title h3 { font-size: 13px; }

      .sai-provider-badge {
        font-size: 10px;
        color: var(--ac);
        background: var(--ac-bg);
        padding: 2px 8px;
        border-radius: 10px;
        display: inline-block;
        margin-top: 2px;
      }

      .sai-panel-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
      }

      /* ---- Buttons ---- */
      .sai-btn {
        padding: 8px 16px;
        border-radius: var(--r);
        border: none;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.15s;
      }

      .sai-btn-primary {
        background: var(--ac);
        color: var(--bg);
        font-weight: 600;
      }

      .sai-btn-primary:hover {
        background: #b89dff;
        box-shadow: 0 4px 15px rgba(167,139,250,0.3);
      }

      .sai-icon-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        font-size: 18px;
        padding: 4px;
        border-radius: 6px;
        transition: background 0.15s;
      }
      .sai-icon-btn:hover { background: rgba(255,255,255,0.1); }

      .sai-full-width { width: 100%; }

      /* ---- Conversation List ---- */
      .sai-divider {
        display: flex; align-items: center; margin: 16px 0; color: #666; font-size: 12px;
      }
      .sai-divider::before, .sai-divider::after { content: ''; flex: 1; height: 1px; background: var(--bd); }
      .sai-divider span { padding: 0 10px; }

      .sai-convo-list { display: flex; flex-direction: column; gap: 6px; }

      .sai-convo-item {
        display: block; width: 100%; text-align: left; padding: 10px 12px;
        background: rgba(255,255,255,0.03); border: 1px solid var(--bd);
        border-radius: var(--r); cursor: pointer; transition: all 0.15s;
      }
      .sai-convo-item:hover { background: var(--ac-bg); border-color: rgba(167,139,250,0.2); }

      .sai-convo-title { color: var(--t1); font-size: 13px; font-weight: 500; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sai-convo-meta { color: #666; font-size: 11px; }

      /* ---- Chat Messages ---- */
      .sai-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }

      .sai-msg { max-width: 95%; border-radius: 12px; padding: 10px 14px; font-size: 13px; line-height: 1.5; word-wrap: break-word; }
      .sai-msg-user { align-self: flex-end; background: #1e3a5f; color: var(--t1); border-bottom-right-radius: 4px; }
      .sai-msg-ai { align-self: flex-start; background: #1e1e3a; color: #d0d0d0; border-bottom-left-radius: 4px; }
      .sai-msg-error { align-self: center; background: rgba(255,60,60,0.15); color: #ff6b6b; }
      .sai-msg-screenshot { display: block; max-width: 100%; max-height: 150px; border-radius: 8px; margin-bottom: 8px; border: 1px solid var(--bd); }
      .sai-msg-content { color: inherit; }
      .sai-msg-content p { margin-bottom: 8px; }
      .sai-msg-content p:last-child { margin-bottom: 0; }
      .sai-msg-content .sai-code-block { background: #0d0d1a; border-radius: 8px; padding: 10px 12px; overflow-x: auto; font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 12px; margin: 8px 0; border: 1px solid var(--bd); }
      .sai-msg-content .sai-inline-code { background: var(--ac-bg); padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 12px; }
      .sai-msg-content .sai-list { padding-left: 18px; margin: 6px 0; }
      .sai-msg-content strong { color: var(--ac); }

      /* ---- Input Area ---- */
      .sai-input-area { padding: 12px; border-top: 1px solid var(--bd); background: var(--bg3); }
      .sai-input-row { display: flex; gap: 8px; }

      .sai-input {
        flex: 1; padding: 10px 14px; background: var(--bg); border: 1px solid var(--bd);
        border-radius: var(--r); color: var(--t1); font-size: 13px; font-family: inherit;
        resize: none; outline: none; transition: border-color 0.15s;
      }
      .sai-input:focus { border-color: var(--ac); }
      .sai-input::placeholder { color: #555; }

      .sai-btn-send {
        width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
        background: var(--ac); color: var(--bg); border: none; border-radius: var(--r);
        cursor: pointer; font-size: 18px; transition: all 0.15s; padding: 0;
      }
      .sai-btn-send:hover { background: #b89dff; box-shadow: 0 4px 15px rgba(167,139,250,0.3); }

      .sai-input-hint { font-size: 11px; color: #555; margin-top: 6px; padding-left: 4px; }

      /* ---- Settings ---- */
      .sai-settings-body { display: flex; flex-direction: column; gap: 16px; }
      .sai-setting-group { display: flex; flex-direction: column; gap: 6px; }
      .sai-label { font-size: 12px; color: #888; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }

      .sai-select, .sai-input-field {
        padding: 8px 12px; background: var(--bg); border: 1px solid var(--bd);
        border-radius: 8px; color: var(--t1); font-size: 13px; outline: none; transition: border-color 0.15s;
      }
      .sai-select:focus, .sai-input-field:focus { border-color: var(--ac); }

      .sai-provider-config { background: rgba(255,255,255,0.02); padding: 12px; border-radius: var(--r); border: 1px solid var(--bd); }
      .sai-provider-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .sai-provider-header h4 { color: #ccc; font-size: 13px; }

      /* Toggle switch */
      .sai-toggle { position: relative; display: inline-block; width: 40px; height: 22px; }
      .sai-toggle input { opacity: 0; width: 0; height: 0; }
      .sai-toggle-slider { position: absolute; inset: 0; background: #333; border-radius: 22px; cursor: pointer; transition: 0.2s; }
      .sai-toggle-slider::before { content: ''; position: absolute; width: 16px; height: 16px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.2s; }
      .sai-toggle input:checked + .sai-toggle-slider { background: var(--ac); }
      .sai-toggle input:checked + .sai-toggle-slider::before { transform: translateX(18px); }

      /* ---- Action Bar ---- */
      .sai-action-bar {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 12px; background: var(--bg3); border-top: 1px solid var(--bd);
      }
      .sai-ab-left, .sai-ab-right {
        display: flex; align-items: center; gap: 6px;
      }

      .sai-ab-btn {
        display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px;
        background: rgba(255,255,255,0.04); color: var(--t2); border: 1px solid var(--bd);
        border-radius: 8px; font-size: 11px; font-weight: 500; cursor: pointer;
        transition: all 0.15s; white-space: nowrap;
      }
      .sai-ab-btn:hover { background: rgba(255,255,255,0.1); color: var(--t1); border-color: rgba(255,255,255,0.15); }
      .sai-ab-btn svg { flex-shrink: 0; }

      .sai-ab-close {
        color: rgba(255,100,100,0.6); border-color: rgba(255,100,100,0.15);
      }
      .sai-ab-close:hover {
        background: rgba(255,60,60,0.15); color: #ff6b6b; border-color: rgba(255,60,60,0.3);
      }

      .sai-ab-send {
        background: var(--ac) !important; color: #fff !important;
        border-color: var(--ac) !important; font-weight: 600; padding: 8px 18px;
        font-size: 12px;
      }
      .sai-ab-send:hover {
        background: #9270f0 !important; border-color: #9270f0 !important;
      }

      .sai-save-split { display: inline-flex; position: relative; }
      .sai-save-split .sai-save-main { border-radius: 8px 0 0 8px; border-right: none; }
      .sai-save-split .sai-save-arrow { padding: 6px 5px; border-radius: 0 8px 8px 0; border-left: 1px solid rgba(255,255,255,0.06); min-width: 0; }

      .sai-format-dropdown {
        position: absolute; bottom: 100%; left: 0; margin-bottom: 4px;
        display: flex; flex-direction: column; background: var(--bg3); border: 1px solid var(--bd);
        border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); overflow: hidden; min-width: 170px; z-index: 100;
      }

      .sai-format-opt {
        display: flex; align-items: center; gap: 8px; padding: 9px 14px; font-size: 12px;
        color: #ccc; background: none; border: none; cursor: pointer; text-align: left; transition: background 0.1s;
      }
      .sai-format-opt:hover { background: var(--ac-bg); color: #fff; }
      .sai-fmt-ext { margin-left: auto; color: #666; font-size: 11px; font-weight: 500; }

      .sai-drag-btn { cursor: grab; }
      .sai-drag-btn:active { cursor: grabbing; }

      /* Toast */
      .sai-toast {
        position: fixed; bottom: 70px; left: 50%; transform: translateX(-50%);
        background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); color: #fff;
        font-size: 13px; padding: 10px 20px; border-radius: var(--r);
        border: 1px solid var(--bd); z-index: 9999; animation: saiToastIn 0.2s ease; pointer-events: none;
      }

      @keyframes saiToastIn {
        from { opacity: 0; transform: translateX(-50%) translateY(8px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }

      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: #555; }
    `;
  }
}
