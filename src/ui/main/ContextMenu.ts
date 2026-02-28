// ============================================
// ScreenAI — Context Menu (clic-droit)
// ============================================

export interface ContextMenuItem {
  label: string;
  danger?: boolean;
  action: () => void;
}

export class ContextMenu {
  private el: HTMLDivElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'ctx';
    document.body.appendChild(this.el);

    // Fermer au clic exterieur
    document.addEventListener('click', () => this.close());
    document.addEventListener('contextmenu', () => this.close());
    window.addEventListener('blur', () => this.close());
  }

  show(x: number, y: number, items: ContextMenuItem[]) {
    this.el.innerHTML = items.map(item =>
      `<button class="ctx-i${item.danger ? ' dng' : ''}">${item.label}</button>`
    ).join('');

    // Attacher les handlers
    this.el.querySelectorAll('.ctx-i').forEach((btn, i) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        items[i].action();
        this.close();
      });
    });

    // Positionner (eviter le debordement)
    this.el.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
    this.el.style.top = `${Math.min(y, window.innerHeight - items.length * 36 - 16)}px`;
    this.el.classList.add('op');
  }

  close() {
    this.el.classList.remove('op');
  }

  destroy() {
    this.el.remove();
  }
}
