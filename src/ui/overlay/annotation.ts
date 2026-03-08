// ============================================
// ScreenAI — Annotation Canvas (v2)
// Object-based annotations, undo/redo, extended tools
// ============================================

import type { Annotation } from '../../types';

export type AnnotationTool =
  | 'pointer' | 'arrow' | 'rectangle' | 'circle' | 'line'
  | 'highlight' | 'highlighter' | 'freehand' | 'text'
  | 'number' | 'blur' | 'eraser' | 'pipette' | 'crop';

type HandlePos = 'tl' | 'tr' | 'bl' | 'br';

interface AnnBounds { x: number; y: number; w: number; h: number; }

export class AnnotationCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private annotations: Annotation[] = [];
  private redoStack: Annotation[][] = [];
  private currentTool: AnnotationTool = 'pointer';
  private currentColor = '#FF3B30';
  private lineWidth = 3;
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private currentPoints: { x: number; y: number }[] = [];
  private imageData: ImageData | null = null;
  private bgImage: HTMLImageElement;
  private nextNumber = 1;

  public onToolChange: ((tool: AnnotationTool) => void) | null = null;
  public onColorPicked: ((hex: string, r: number, g: number, b: number) => void) | null = null;
  public onAnnotationSelected: ((ann: Annotation | null, index: number) => void) | null = null;
  private cropHistory: { bgSrc: string; width: number; height: number; annotations: Annotation[]; nextNumber: number }[] = [];
  private selectedIndex: number = -1;

  // Pointer drag state
  private pointerDrag: {
    type: 'move' | HandlePos;
    origPoints: { x: number; y: number }[];
    origBounds: AnnBounds;
    startX: number;
    startY: number;
  } | null = null;

  private handleSize = 8; // half-size of corner handle squares

  constructor(
    private container: HTMLElement,
    private screenshotUrl: string,
    private width: number,
    private height: number
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.cssText = 'display:block;max-width:100%;max-height:100%;cursor:default;image-rendering:-webkit-optimize-contrast;image-rendering:crisp-edges;';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.bgImage = new Image();
    this.bgImage.src = screenshotUrl;

    this.bgImage.onload = () => {
      this.redraw();
    };

    container.appendChild(this.canvas);
    this.bindEvents();
  }

  setTool(tool: AnnotationTool) {
    this.currentTool = tool;
    this.canvas.style.cursor =
      tool === 'pointer' ? 'default' :
      tool === 'text' ? 'text' :
      tool === 'eraser' ? 'not-allowed' :
      tool === 'number' ? 'copy' :
      tool === 'pipette' ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M2 22l1-1h3l9-9'/%3E%3Cpath d='M3 21l9-9'/%3E%3Ccircle cx='18' cy='6' r='3'/%3E%3C/svg%3E") 2 22, crosshair` :
      'default';
  }

  setColor(color: string) {
    this.currentColor = color;
  }

  setLineWidth(w: number) {
    this.lineWidth = w;
  }

  getAnnotations(): Annotation[] {
    return [...this.annotations];
  }

  canUndo(): boolean { return this.annotations.length > 0 || this.cropHistory.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  undo() {
    if (!this.annotations.length) {
      if (this.cropHistory.length > 0) {
        const prev = this.cropHistory.pop()!;
        const img = new Image();
        img.onload = () => {
          this.bgImage = img;
          this.canvas.width = prev.width;
          this.canvas.height = prev.height;
          this.width = prev.width;
          this.height = prev.height;
          this.annotations = prev.annotations;
          this.nextNumber = prev.nextNumber;
          this.redoStack = [];
          this.screenshotUrl = prev.bgSrc;
          this.redraw();
        };
        img.src = prev.bgSrc;
      }
      return;
    }
    const removed = this.annotations.pop()!;
    if (removed.type === 'number') {
      this.nextNumber = Math.max(1, this.nextNumber - 1);
    }
    this.redoStack.push([removed]);
    this.selectedIndex = -1;
    this.redraw();
  }

  redo() {
    if (!this.redoStack.length) return;
    const items = this.redoStack.pop()!;
    for (const item of items) {
      this.annotations.push(item);
      if (item.type === 'number') {
        this.nextNumber = (item.number || 0) + 1;
      }
    }
    this.selectedIndex = -1;
    this.redraw();
  }

  clear() {
    if (!this.annotations.length) return;
    this.redoStack.push([...this.annotations]);
    this.annotations = [];
    this.nextNumber = 1;
    this.selectedIndex = -1;
    this.redraw();
  }

  toDataUrl(mimeType: string = 'image/png'): string {
    // Temporarily hide selection for export
    const prevSel = this.selectedIndex;
    this.selectedIndex = -1;
    this.redraw();
    const url = this.canvas.toDataURL(mimeType);
    this.selectedIndex = prevSel;
    this.redraw();
    return url;
  }

  getWidth(): number { return this.canvas.width; }
  getHeight(): number { return this.canvas.height; }

  // ---- Bounds helpers ----

  private getAnnBounds(ann: Annotation): AnnBounds {
    const pts = ann.points;
    if (ann.type === 'number') {
      const p = pts[0];
      return { x: p.x - 14, y: p.y - 14, w: 28, h: 28 };
    }
    if (ann.type === 'text') {
      const fontSize = 18 + ann.lineWidth * 2;
      this.ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      const tw = this.ctx.measureText(ann.text || '').width;
      return { x: pts[0].x, y: pts[0].y - fontSize, w: tw, h: fontSize };
    }
    if (ann.type === 'freehand' || ann.type === 'highlighter') {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    if (pts.length >= 2) {
      const start = pts[0], end = pts[pts.length - 1];
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      return { x, y, w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
    }
    return { x: pts[0]?.x || 0, y: pts[0]?.y || 0, w: 0, h: 0 };
  }

  private hitTestHandle(ann: Annotation, x: number, y: number): HandlePos | null {
    const b = this.getAnnBounds(ann);
    const hs = this.handleSize + 2; // extra margin
    const corners: [HandlePos, number, number][] = [
      ['tl', b.x, b.y],
      ['tr', b.x + b.w, b.y],
      ['bl', b.x, b.y + b.h],
      ['br', b.x + b.w, b.y + b.h],
    ];
    for (const [pos, cx, cy] of corners) {
      if (Math.abs(x - cx) <= hs && Math.abs(y - cy) <= hs) return pos;
    }
    return null;
  }

  // ---- Coordinate helpers ----

  private getCanvasCoords(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  private pushAnnotation(ann: Annotation) {
    this.annotations.push(ann);
    this.redoStack = [];
  }

  // ---- Events ----

  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  private bindEvents() {
    // Keyboard: Delete selected annotation
    this.keyHandler = (e: KeyboardEvent) => {
      if (this.selectedIndex < 0) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        this.deleteSelected();
      }
    };
    document.addEventListener('keydown', this.keyHandler);

    this.canvas.addEventListener('mousedown', (e) => {
      // ===== POINTER TOOL =====
      if (this.currentTool === 'pointer') {
        const { x, y } = this.getCanvasCoords(e);

        // Check if clicking a resize handle of the selected annotation
        if (this.selectedIndex >= 0) {
          const selAnn = this.annotations[this.selectedIndex];
          const handle = this.hitTestHandle(selAnn, x, y);
          if (handle) {
            this.pointerDrag = {
              type: handle,
              origPoints: selAnn.points.map(p => ({ ...p })),
              origBounds: this.getAnnBounds(selAnn),
              startX: x, startY: y,
            };
            return;
          }
        }

        // Check if clicking on an annotation body
        let found = -1;
        for (let i = this.annotations.length - 1; i >= 0; i--) {
          if (this.hitTest(this.annotations[i], x, y)) { found = i; break; }
        }

        if (found >= 0) {
          this.selectedIndex = found;
          const ann = this.annotations[found];
          this.pointerDrag = {
            type: 'move',
            origPoints: ann.points.map(p => ({ ...p })),
            origBounds: this.getAnnBounds(ann),
            startX: x, startY: y,
          };
          this.redraw();
          this.onAnnotationSelected?.(ann, found);
        } else {
          // Click on empty area → deselect
          if (this.selectedIndex >= 0) {
            this.selectedIndex = -1;
            this.pointerDrag = null;
            this.redraw();
            this.onAnnotationSelected?.(null, -1);
          }
        }
        return;
      }

      const { x, y } = this.getCanvasCoords(e);

      // Eraser
      if (this.currentTool === 'eraser') {
        this.eraseAt(x, y);
        return;
      }

      // Pipette
      if (this.currentTool === 'pipette') {
        const pixel = this.ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, '0')).join('');
        this.currentColor = hex;
        this.onColorPicked?.(hex, pixel[0], pixel[1], pixel[2]);
        return;
      }

      // Number badge
      if (this.currentTool === 'number') {
        const num = this.nextNumber++;
        this.pushAnnotation({
          type: 'number',
          points: [{ x, y }],
          color: this.currentColor,
          lineWidth: this.lineWidth,
          number: num,
        });
        this.redraw();
        return;
      }

      this.isDrawing = true;
      this.startX = x;
      this.startY = y;
      this.currentPoints = [{ x, y }];

      this.imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

      if (this.currentTool === 'text') {
        this.isDrawing = false;
        this.promptText(x, y);
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      // ===== POINTER DRAG =====
      if (this.currentTool === 'pointer' && this.pointerDrag && this.selectedIndex >= 0) {
        const { x, y } = this.getCanvasCoords(e);
        const dx = x - this.pointerDrag.startX;
        const dy = y - this.pointerDrag.startY;
        const ann = this.annotations[this.selectedIndex];

        if (this.pointerDrag.type === 'move') {
          // Move: translate all points
          for (let i = 0; i < ann.points.length; i++) {
            ann.points[i].x = this.pointerDrag.origPoints[i].x + dx;
            ann.points[i].y = this.pointerDrag.origPoints[i].y + dy;
          }
        } else {
          // Resize via handle
          this.resizeAnnotation(ann, this.pointerDrag, dx, dy);
        }
        this.redraw();
        // Notify overlay to reposition popover
        this.onAnnotationSelected?.(ann, this.selectedIndex);
        return;
      }

      // ===== POINTER HOVER CURSOR =====
      if (this.currentTool === 'pointer' && !this.pointerDrag) {
        const { x, y } = this.getCanvasCoords(e);
        // Check handle hover
        if (this.selectedIndex >= 0) {
          const handle = this.hitTestHandle(this.annotations[this.selectedIndex], x, y);
          if (handle) {
            this.canvas.style.cursor = (handle === 'tl' || handle === 'br') ? 'nwse-resize' : 'nesw-resize';
            return;
          }
        }
        // Check body hover
        let over = false;
        for (let i = this.annotations.length - 1; i >= 0; i--) {
          if (this.hitTest(this.annotations[i], x, y)) { over = true; break; }
        }
        this.canvas.style.cursor = over ? 'move' : 'default';
        return;
      }

      if (!this.isDrawing || this.currentTool === 'pointer') return;

      const { x, y } = this.getCanvasCoords(e);
      this.currentPoints.push({ x, y });

      if (this.imageData) {
        this.ctx.putImageData(this.imageData, 0, 0);
      }
      this.drawShape(this.currentTool, this.currentPoints, this.currentColor, this.lineWidth, false);
    });

    this.canvas.addEventListener('mouseup', () => {
      // ===== POINTER DROP =====
      if (this.currentTool === 'pointer' && this.pointerDrag) {
        this.pointerDrag = null;
        return;
      }

      if (!this.isDrawing || this.currentTool === 'pointer') return;
      this.isDrawing = false;

      this.pushAnnotation({
        type: this.currentTool as Annotation['type'],
        points: [...this.currentPoints],
        color: this.currentColor,
        lineWidth: this.lineWidth,
      });

      this.redraw();
    });
  }

  // ---- Resize logic ----

  private resizeAnnotation(
    ann: Annotation,
    drag: NonNullable<typeof this.pointerDrag>,
    dx: number,
    dy: number
  ) {
    const ob = drag.origBounds;
    if (ob.w < 1 && ob.h < 1) return; // can't resize a point

    // Compute new bounds based on handle
    let nx = ob.x, ny = ob.y, nw = ob.w, nh = ob.h;
    const handle = drag.type as HandlePos;
    if (handle === 'tl') { nx = ob.x + dx; ny = ob.y + dy; nw = ob.w - dx; nh = ob.h - dy; }
    else if (handle === 'tr') { ny = ob.y + dy; nw = ob.w + dx; nh = ob.h - dy; }
    else if (handle === 'bl') { nx = ob.x + dx; nw = ob.w - dx; nh = ob.h + dy; }
    else if (handle === 'br') { nw = ob.w + dx; nh = ob.h + dy; }

    // Prevent flipping (minimum 10px)
    if (nw < 10) { nw = 10; if (handle === 'tl' || handle === 'bl') nx = ob.x + ob.w - 10; }
    if (nh < 10) { nh = 10; if (handle === 'tl' || handle === 'tr') ny = ob.y + ob.h - 10; }

    const sx = nw / ob.w;
    const sy = nh / ob.h;

    // Scale all points relative to original bounds
    for (let i = 0; i < ann.points.length; i++) {
      const op = drag.origPoints[i];
      ann.points[i].x = nx + (op.x - ob.x) * sx;
      ann.points[i].y = ny + (op.y - ob.y) * sy;
    }
  }

  // ---- Erase ----

  private eraseAt(x: number, y: number) {
    for (let i = this.annotations.length - 1; i >= 0; i--) {
      const ann = this.annotations[i];
      if (this.hitTest(ann, x, y)) {
        const removed = this.annotations.splice(i, 1);
        this.redoStack = [];
        if (removed[0].type === 'number') {
          this.nextNumber = 1;
          for (const a of this.annotations) {
            if (a.type === 'number' && a.number && a.number >= this.nextNumber) {
              this.nextNumber = a.number + 1;
            }
          }
        }
        this.redraw();
        return;
      }
    }
  }

  // ---- Hit test ----

  private hitTest(ann: Annotation, x: number, y: number): boolean {
    const margin = 12;
    const pts = ann.points;
    if (!pts.length) return false;

    if (ann.type === 'number') {
      const p = pts[0];
      const r = 16 + margin;
      return Math.hypot(x - p.x, y - p.y) <= r;
    }

    if (ann.type === 'text') {
      const p = pts[0];
      const fontSize = 18 + ann.lineWidth * 2;
      const textWidth = (ann.text?.length || 0) * fontSize * 0.6;
      return x >= p.x - margin && x <= p.x + textWidth + margin &&
             y >= p.y - fontSize - margin && y <= p.y + margin;
    }

    if (ann.type === 'freehand' || ann.type === 'highlighter') {
      for (let i = 1; i < pts.length; i++) {
        if (this.distToSegment(x, y, pts[i - 1], pts[i]) < margin + ann.lineWidth) {
          return true;
        }
      }
      return false;
    }

    if (pts.length >= 2) {
      const start = pts[0];
      const end = pts[pts.length - 1];
      const minX = Math.min(start.x, end.x) - margin;
      const maxX = Math.max(start.x, end.x) + margin;
      const minY = Math.min(start.y, end.y) - margin;
      const maxY = Math.max(start.y, end.y) + margin;
      return x >= minX && x <= maxX && y >= minY && y <= maxY;
    }

    return false;
  }

  private distToSegment(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - a.x, py - a.y);
    let t = ((px - a.x) * dx + (py - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }

  // ---- Text prompt ----

  private promptText(x: number, y: number) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Texte...';

    const rect = this.canvas.getBoundingClientRect();
    const pixelLeft = (x / this.canvas.width) * rect.width;
    const pixelTop = (y / this.canvas.height) * rect.height;

    input.style.cssText = `
      position: absolute;
      left: ${pixelLeft}px;
      top: ${pixelTop}px;
      z-index: 200;
      font-size: 16px;
      padding: 4px 8px;
      border: 2px solid ${this.currentColor};
      background: rgba(0,0,0,0.8);
      color: white;
      border-radius: 4px;
      outline: none;
      min-width: 120px;
      pointer-events: auto;
    `;

    this.canvas.style.pointerEvents = 'none';

    this.container.appendChild(input);
    requestAnimationFrame(() => input.focus());

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      if (input.value.trim()) {
        this.pushAnnotation({
          type: 'text',
          points: [{ x, y }],
          color: this.currentColor,
          lineWidth: this.lineWidth,
          text: input.value.trim(),
        });
        this.redraw();
      }
      input.remove();
      this.canvas.style.pointerEvents = 'auto';
    };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') { committed = true; input.remove(); this.canvas.style.pointerEvents = 'auto'; }
    });
    input.addEventListener('blur', commit);
  }

  // ---- Drawing ----

  private redraw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.bgImage.complete) {
      this.ctx.drawImage(this.bgImage, 0, 0, this.canvas.width, this.canvas.height);
    }

    for (let i = 0; i < this.annotations.length; i++) {
      const ann = this.annotations[i];
      this.drawShape(ann.type, ann.points, ann.color, ann.lineWidth, true, ann.text, ann.number);

      if (i === this.selectedIndex) {
        this.drawSelectionHandles(ann);
      }
    }
  }

  private drawShape(
    type: string,
    points: { x: number; y: number }[],
    color: string,
    lineWidth: number,
    final: boolean,
    text?: string,
    number?: number,
  ) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (type) {
      case 'rectangle': {
        if (points.length < 2) break;
        const start = points[0], end = points[points.length - 1];
        ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
        break;
      }
      case 'circle': {
        if (points.length < 2) break;
        const start = points[0], end = points[points.length - 1];
        const rx = Math.abs(end.x - start.x) / 2;
        const ry = Math.abs(end.y - start.y) / 2;
        const cx = start.x + (end.x - start.x) / 2;
        const cy = start.y + (end.y - start.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'line': {
        if (points.length < 2) break;
        const start = points[0], end = points[points.length - 1];
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        break;
      }
      case 'highlight': {
        if (points.length < 2) break;
        const start = points[0], end = points[points.length - 1];
        ctx.globalAlpha = 0.3;
        ctx.fillRect(start.x, start.y, end.x - start.x, end.y - start.y);
        ctx.globalAlpha = 1;
        break;
      }
      case 'highlighter': {
        if (points.length < 2) break;
        ctx.globalCompositeOperation = 'multiply';
        ctx.strokeStyle = color;
        ctx.lineWidth = 20;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        break;
      }
      case 'arrow': {
        if (points.length < 2) break;
        const start = points[0], end = points[points.length - 1];
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLen = 15 + lineWidth * 2;
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'freehand': {
        if (points.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.stroke();
        break;
      }
      case 'blur': {
        if (points.length < 2) break;
        const start = points[0], end = points[points.length - 1];
        const bx = Math.min(start.x, end.x);
        const by = Math.min(start.y, end.y);
        const bw = Math.abs(end.x - start.x);
        const bh = Math.abs(end.y - start.y);
        if (bw < 2 || bh < 2) break;
        this.pixelateRegion(bx, by, bw, bh, 10);
        break;
      }
      case 'number': {
        if (!points.length || number == null) break;
        const p = points[0];
        const radius = 14;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(number), p.x, p.y);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
        break;
      }
      case 'text': {
        if (!text || points.length < 1) break;
        const fontSize = 18 + lineWidth * 2;
        ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeText(text, points[0].x, points[0].y);
        ctx.fillStyle = color;
        ctx.fillText(text, points[0].x, points[0].y);
        break;
      }
    }

    ctx.restore();
  }

  // ---- Selection handles ----

  private drawSelectionHandles(ann: Annotation) {
    const ctx = this.ctx;
    const b = this.getAnnBounds(ann);
    const hs = this.handleSize;

    // Dashed outline
    ctx.save();
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    ctx.setLineDash([]);

    // Corner handles
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 2;
    const corners: [number, number][] = [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x, b.y + b.h],
      [b.x + b.w, b.y + b.h],
    ];
    for (const [cx, cy] of corners) {
      ctx.fillRect(cx - hs, cy - hs, hs * 2, hs * 2);
      ctx.strokeRect(cx - hs, cy - hs, hs * 2, hs * 2);
    }
    ctx.restore();
  }

  // ---- Pixelate ----

  private pixelateRegion(x: number, y: number, w: number, h: number, pixelSize: number) {
    const ctx = this.ctx;
    const sx = Math.max(0, Math.round(x));
    const sy = Math.max(0, Math.round(y));
    const sw = Math.min(Math.round(w), this.canvas.width - sx);
    const sh = Math.min(Math.round(h), this.canvas.height - sy);
    if (sw <= 0 || sh <= 0) return;

    const imageData = ctx.getImageData(sx, sy, sw, sh);
    for (let py = 0; py < sh; py += pixelSize) {
      for (let px = 0; px < sw; px += pixelSize) {
        const i = (py * sw + px) * 4;
        const r = imageData.data[i];
        const g = imageData.data[i + 1];
        const b = imageData.data[i + 2];
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(sx + px, sy + py, pixelSize, pixelSize);
      }
    }
  }

  // ---- Public selection API ----

  getSelectedIndex(): number { return this.selectedIndex; }

  getSelectedAnnotation(): Annotation | null {
    return this.selectedIndex >= 0 ? this.annotations[this.selectedIndex] : null;
  }

  selectAnnotation(idx: number) {
    if (idx >= 0 && idx < this.annotations.length) {
      this.selectedIndex = idx;
      this.redraw();
      this.onAnnotationSelected?.(this.annotations[idx], idx);
    }
  }

  updateSelectedColor(color: string) {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.annotations.length) {
      this.annotations[this.selectedIndex].color = color;
      this.redraw();
    }
  }

  updateSelectedLineWidth(w: number) {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.annotations.length) {
      this.annotations[this.selectedIndex].lineWidth = w;
      this.redraw();
    }
  }

  deleteSelected() {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.annotations.length) {
      const removed = this.annotations.splice(this.selectedIndex, 1);
      this.selectedIndex = -1;
      this.redoStack = [];
      if (removed[0].type === 'number') {
        this.nextNumber = 1;
        for (const a of this.annotations) {
          if (a.type === 'number' && a.number && a.number >= this.nextNumber) {
            this.nextNumber = a.number + 1;
          }
        }
      }
      this.redraw();
      this.onAnnotationSelected?.(null, -1);
    }
  }

  clearSelection() {
    if (this.selectedIndex >= 0) {
      this.selectedIndex = -1;
      this.pointerDrag = null;
      this.redraw();
    }
  }

  /** Get bounding box in CSS pixels (for positioning popover) */
  getSelectedBoundsCSS(): { cx: number; cy: number; top: number } | null {
    if (this.selectedIndex < 0) return null;
    const ann = this.annotations[this.selectedIndex];
    const b = this.getAnnBounds(ann);
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width / this.canvas.width;
    const sy = rect.height / this.canvas.height;
    return {
      cx: rect.left + (b.x + b.w / 2) * sx,
      cy: rect.top + (b.y + b.h / 2) * sy,
      top: rect.top + b.y * sy,
    };
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /** Replace the background image and resize the canvas (used by crop) */
  replaceBackground(newDataUrl: string) {
    this.cropHistory.push({
      bgSrc: this.bgImage.src,
      width: this.width,
      height: this.height,
      annotations: [...this.annotations],
      nextNumber: this.nextNumber,
    });
    const img = new Image();
    img.onload = () => {
      this.bgImage = img;
      this.canvas.width = img.width;
      this.canvas.height = img.height;
      this.width = img.width;
      this.height = img.height;
      this.annotations = [];
      this.redoStack = [];
      this.nextNumber = 1;
      this.selectedIndex = -1;
      this.redraw();
    };
    img.src = newDataUrl;
  }

  getBackgroundDataUrl(): string {
    return this.screenshotUrl;
  }

  destroy() {
    if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler);
    this.canvas.remove();
  }
}
