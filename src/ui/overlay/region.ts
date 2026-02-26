// ============================================
// ScreenAI — Region Selector
// ============================================

export class RegionSelector {
  private overlay: HTMLDivElement;
  private isSelecting = false;
  private startX = 0;
  private startY = 0;
  private selection: HTMLDivElement;

  constructor(
    private container: HTMLElement,
    private screenshotUrl: string,
    private onSelect: (region: { x: number; y: number; w: number; h: number }) => void,
    private onCancel: () => void
  ) {
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483640;
      background: url('${screenshotUrl}') no-repeat center/cover;
      cursor: crosshair;
    `;

    // Dark overlay
    const dimmer = document.createElement('div');
    dimmer.style.cssText = `
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.5);
      pointer-events: none;
    `;
    this.overlay.appendChild(dimmer);

    // Instructions
    const hint = document.createElement('div');
    hint.textContent = 'Select a region — Esc to cancel';
    hint.style.cssText = `
      position: absolute; top: 20px; left: 50%; transform: translateX(-50%);
      background: rgba(0,0,0,0.8); color: white; padding: 8px 20px;
      border-radius: 8px; font: 14px -apple-system, sans-serif;
      pointer-events: none; z-index: 10;
    `;
    this.overlay.appendChild(hint);

    // Selection box
    this.selection = document.createElement('div');
    this.selection.style.cssText = `
      position: absolute; border: 2px solid #a78bfa;
      box-shadow: 0 0 0 9999px rgba(0,0,0,0.5);
      display: none; z-index: 5;
    `;
    this.overlay.appendChild(this.selection);

    container.appendChild(this.overlay);
    this.bindEvents();
  }

  private bindEvents() {
    this.overlay.addEventListener('mousedown', (e) => {
      this.isSelecting = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.selection.style.display = 'block';
      this.updateSelection(e.clientX, e.clientY);
    });

    this.overlay.addEventListener('mousemove', (e) => {
      if (!this.isSelecting) return;
      this.updateSelection(e.clientX, e.clientY);
    });

    this.overlay.addEventListener('mouseup', (e) => {
      if (!this.isSelecting) return;
      this.isSelecting = false;

      const x = Math.min(this.startX, e.clientX);
      const y = Math.min(this.startY, e.clientY);
      const w = Math.abs(e.clientX - this.startX);
      const h = Math.abs(e.clientY - this.startY);

      if (w > 20 && h > 20) {
        this.destroy();
        this.onSelect({ x, y, w, h });
      }
    });

    document.addEventListener('keydown', this.handleKey);
  }

  private handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.destroy();
      this.onCancel();
    }
  };

  private updateSelection(curX: number, curY: number) {
    const x = Math.min(this.startX, curX);
    const y = Math.min(this.startY, curY);
    const w = Math.abs(curX - this.startX);
    const h = Math.abs(curY - this.startY);

    this.selection.style.left = x + 'px';
    this.selection.style.top = y + 'px';
    this.selection.style.width = w + 'px';
    this.selection.style.height = h + 'px';
  }

  destroy() {
    document.removeEventListener('keydown', this.handleKey);
    this.overlay.remove();
  }
}

// Utility: crop a screenshot dataUrl to a region
export function cropScreenshot(
  dataUrl: string,
  region: { x: number; y: number; w: number; h: number },
  viewportWidth: number,
  viewportHeight: number
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scaleX = img.width / viewportWidth;
      const scaleY = img.height / viewportHeight;

      const canvas = document.createElement('canvas');
      canvas.width = region.w * scaleX;
      canvas.height = region.h * scaleY;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(
        img,
        region.x * scaleX, region.y * scaleY,
        region.w * scaleX, region.h * scaleY,
        0, 0,
        canvas.width, canvas.height
      );
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = dataUrl;
  });
}
