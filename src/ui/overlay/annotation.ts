// ============================================
// ScreenAI — Annotation Canvas
// ============================================

import type { Annotation } from '../../types';

export type AnnotationTool = 'arrow' | 'rectangle' | 'highlight' | 'freehand' | 'text' | 'pointer';

export class AnnotationCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private annotations: Annotation[] = [];
  private currentTool: AnnotationTool = 'pointer';
  private currentColor = '#FF3B30';
  private lineWidth = 3;
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private currentPoints: { x: number; y: number }[] = [];
  private imageData: ImageData | null = null;
  private bgImage: HTMLImageElement;
  private scale = 1;

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
    this.canvas.style.cursor = tool === 'pointer' ? 'default' :
      tool === 'text' ? 'text' : 'crosshair';
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

  undo() {
    this.annotations.pop();
    this.redraw();
  }

  clear() {
    this.annotations = [];
    this.redraw();
  }

  // Get merged screenshot + annotations as dataUrl
  toDataUrl(): string {
    return this.canvas.toDataURL('image/png');
  }

  private getCanvasCoords(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  private bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.currentTool === 'pointer') return;

      const { x, y } = this.getCanvasCoords(e);
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

      this.annotations.push({
        type: this.currentTool as Annotation['type'],
        points: [...this.currentPoints],
        color: this.currentColor,
        lineWidth: this.lineWidth,
      });

      this.redraw();
    });
  }

  private promptText(x: number, y: number) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Texte...';
    input.style.cssText = `
      position: fixed;
      left: ${(x / this.canvas.width) * this.canvas.getBoundingClientRect().width + this.canvas.getBoundingClientRect().left}px;
      top: ${(y / this.canvas.height) * this.canvas.getBoundingClientRect().height + this.canvas.getBoundingClientRect().top}px;
      z-index: 2147483647;
      font-size: 16px;
      padding: 4px 8px;
      border: 2px solid ${this.currentColor};
      background: rgba(0,0,0,0.8);
      color: white;
      border-radius: 4px;
      outline: none;
      min-width: 120px;
    `;

    document.body.appendChild(input);
    input.focus();

    const commit = () => {
      if (input.value.trim()) {
        this.annotations.push({
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
      this.drawShape(ann.type, ann.points, ann.color, ann.lineWidth, true, ann.text);
    }
  }

  private drawShape(
    type: string,
    points: { x: number; y: number }[],
    color: string,
    lineWidth: number,
    final: boolean,
    text?: string
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
        const w = end.x - start.x;
        const h = end.y - start.y;
        ctx.strokeRect(start.x, start.y, w, h);
        break;
      }

      case 'highlight': {
        if (points.length < 2) break;
        const start = points[0];
        const end = points[points.length - 1];
        const w = end.x - start.x;
        const h = end.y - start.y;
        ctx.globalAlpha = 0.3;
        ctx.fillRect(start.x, start.y, w, h);
        ctx.globalAlpha = 1;
        break;
      }

      case 'arrow': {
        if (points.length < 2) break;
        const start = points[0];
        const end = points[points.length - 1];

        // Line
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        // Arrowhead
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLen = 15 + lineWidth * 2;
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
          end.x - headLen * Math.cos(angle - Math.PI / 6),
          end.y - headLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          end.x - headLen * Math.cos(angle + Math.PI / 6),
          end.y - headLen * Math.sin(angle + Math.PI / 6)
        );
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

      case 'text': {
        if (!text || points.length < 1) break;
        const fontSize = 18 + lineWidth * 2;
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;

        // Background
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

        // Text
        ctx.fillStyle = color;
        ctx.fillText(text, points[0].x, points[0].y);
        break;
      }
    }

    ctx.restore();
  }

  destroy() {
    this.canvas.remove();
  }
}
