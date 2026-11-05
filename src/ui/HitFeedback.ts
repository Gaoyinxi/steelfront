export type HitKind = 'hit' | 'penetration' | 'nonPenetration' | 'ricochet' | 'kill' | 'info';

/** Centre-screen combat messages that fade out ("击穿 / 未击穿 / 跳弹" in M4). */
export class HitFeedback {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-hits';
    parent.appendChild(this.root);
  }

  show(text: string, kind: HitKind, detail?: string): void {
    const el = document.createElement('div');
    el.className = `hit hit-${kind}`;
    el.innerHTML = detail ? `${text}<small>${detail}</small>` : text;
    this.root.prepend(el);
    while (this.root.children.length > 4) this.root.lastElementChild?.remove();
    setTimeout(() => el.classList.add('fade'), 1600);
    setTimeout(() => el.remove(), 2200);
  }
}
