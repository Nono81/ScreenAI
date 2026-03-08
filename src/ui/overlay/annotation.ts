// ============================================
// ScreenAI — Annotation Canvas (v2)
// Object-based annotations, undo/redo, extended tools
// ============================================

import type { Annotation } from '../../types';

export type AnnotationTool =
  | 'pointer' | 'arrow' | 'rectangle' | 'circle' | 'line'
  | 'highlight' | 'highlighter' | 'freehand' | 'text'
  | 'number' | 'blur' | 'eraser' | 'pipette' | 'crop';

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

  constructor(
    private container: HTMLElement,
    private screenshotUrl: string,
    private width: number,
    private height: number
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair;';
    this.ctx = this.canvas.getContext('2d')!;
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
      tool === 'pipette' ? 'crosshair' :
      'crosshair';
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

  canUndo(): boolean { return this.annotations.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  undo() {
    if (!this.annotations.length) return;
    const removed = this.annotations.pop()!;
    if (removed.type === 'number') {
      this.nextNumber = Math.max(1, this.nextNumber - 1);
    }
    this.redoStack.push([removed]);
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
    this.redraw();
  }

  clear() {
    if (!this.annotations.length) return;
    this.redoStack.push([...this.annotations]);
    this.annotations = [];
    this.nextNumber = 1;
    this.redraw();
  }

  toDataUrl(mimeType: string = 'image/png'): string {
    return this.canvas.toDataURL(mimeType);
  }

  getWidth(): number { return this.canvas.width; }
  getHeight(): number { return this.canvas.height; }

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
    this.redoStack = []; // new action clears redo
  }

  private bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.currentTool === 'pointer') return;

      const { x, y } = this.getCanvasCoords(e);

      // Eraser: find and remove annotation under cursor
      if (this.currentTool === 'eraser') {
        this.eraseAt(x, y);
        return;
      }

      // Pipette: pick color from pixel
      if (this.currentTool === 'pipette') {
        const pixel = this.ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, '0')).join('');
        this.currentColor = hex;
        this.onColorPicked?.(hex, pixel[0], pixel[1], pixel[2]);
        return;
      }

      // Number badge: place immediately
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

      // Save state for live preview
      this.imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

      if (this.currentTool === 'text') {
        this.isDrawing = false;
        this.promptText(x, y);
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.isDrawing || this.currentTool === 'pointer') return;

      const { x, y } = this.getCanvasCoords(e);
      this.currentPoints.push({ x, y });

      // Restore and draw preview
      if (this.imageData) {
        this.ctx.putImageData(this.imageData, 0, 0);
      }
      this.drawShape(this.currentTool, this.currentPoints, this.currentColor, this.lineWidth, false);
    });

    this.canvas.addEventListener('mouseup', (e) => {
      if (!this.isDrawing || this.currentTool === 'pointer') return;
      this.isDrawing = false;

      const { x, y } = this.getCanvasCoords(e);
      this.currentPoints.push({ x, y });

      this.pushAnnotation({
        type: this.currentTool as Annotation['type'],
        points: [...this.currentPoints],
        color: this.currentColor,
        lineWidth: this.lineWidth,
      });

      this.redraw();
    });
  }

  private eraseAt(x: number, y: number) {
    // Find the topmost annotation whose bounding box contains the click
    for (let i = this.annotations.length - 1; i >= 0; i--) {
      const ann = this.annotations[i];
      if (this.hitTest(ann, x, y)) {
        const removed = this.annotations.splice(i, 1);
        this.redoStack = []; // erase is a new action
        if (removed[0].type === 'number') {
          // Recalculate next number
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
      // Check proximity to any segment
      for (let i = 1; i < pts.length; i++) {
        if (this.distToSegment(x, y, pts[i - 1], pts[i]) < margin + ann.lineWidth) {
          return true;
        }
      }
      return false;
    }

    // For shapes using start/end points: rectangle, circle, highlight, blur, arrow, line
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
      z-index: 100;
      font-size: 16px;
      padding: 4px 8px;
      border: 2px solid ${this.currentColor};
      background: rgba(0,0,0,0.8);
      color: white;
      border-radius: 4px;
      outline: none;
      min-width: 120px;
    `;

    // Append to the canvas container (inside Shadow DOM) so it's visible above the overlay
    this.container.appendChild(input);
    input.focus();

    const commit = () => {
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
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') input.remove();
    });
    input.addEventListener('blur', commit);
  }

  private redraw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw background image
    if (this.bgImage.complete) {
      this.ctx.drawImage(this.bgImage, 0, 0, this.canvas.width, this.canvas.height);
    }

    // Draw all annotations
    for (const ann of this.annotations) {
      this.drawShape(ann.type, ann.points, ann.color, ann.lineWidth, true, ann.text, ann.number);
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
        const start = points[0];
        const end = points[points.length - 1];
        ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
        break;
      }

      case 'circle': {
        if (points.length < 2) break;
        const start = points[0];
        const end = points[points.length - 1];
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
        const start = points[0];
        const end = points[points.length - 1];
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        break;
      }

      case 'highlight': {
        if (points.length < 2) break;
        const start = points[0];
        const end = points[points.length - 1];
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
        const start = points[0];
        const end = points[points.length - 1];
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
        const start = points[0];
        const end = points[points.length - 1];
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
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
        const metrics = ctx.measureText(text);
        const padding = 6;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#000';
        ctx.fillRect(
          points[0].x - padding,
          points[0].y - fontSize - padding,
          metrics.width + padding * 2,
          fontSize + padding * 2
        );
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.fillText(text, points[0].x, points[0].y);
        break;
      }
    }

    ctx.restore();
  }

  private pixelateRegion(x: number, y: number, w: number, h: number, pixelSize: number) {
    const ctx = this.ctx;
    // Clamp to canvas bounds
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

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /** Replace the background image and resize the canvas (used by crop) */
  replaceBackground(newDataUrl: string) {
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
      this.redraw();
    };
    img.src = newDataUrl;
  }

  getBackgroundDataUrl(): string {
    return this.screenshotUrl;
  }

  destroy() {
    this.canvas.remove();
  }
}
