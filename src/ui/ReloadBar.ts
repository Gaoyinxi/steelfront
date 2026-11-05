export interface AmmoSlotView {
  key: string;
  name: string;
  type: string;
  count: number;
}

export interface WeaponFrame {
  slots: AmmoSlotView[];
  loadedSlot: number | null;
  loadingSlot: number;
  /** 0..1 reload progress; 1 when loaded. */
  reloadProgress: number;
  reloadRemaining: number;
}

/** Ammo selector with per-slot counts, plus the reload progress bar. */
export class ReloadBar {
  private readonly root: HTMLDivElement;
  private readonly slotEls: HTMLDivElement[] = [];
  private readonly fill: HTMLDivElement;
  private readonly label: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-panel hud-weapon';
    const slots = document.createElement('div');
    slots.className = 'slots';
    this.root.appendChild(slots);
    const bar = document.createElement('div');
    bar.className = 'reload';
    this.fill = document.createElement('div');
    this.fill.className = 'fill';
    bar.appendChild(this.fill);
    this.label = document.createElement('div');
    this.label.className = 'label';
    this.root.append(bar, this.label);
    parent.appendChild(this.root);
  }

  update(f: WeaponFrame): void {
    const slots = this.root.querySelector('.slots') as HTMLDivElement;
    while (this.slotEls.length < f.slots.length) {
      const el = document.createElement('div');
      el.className = 'slot';
      slots.appendChild(el);
      this.slotEls.push(el);
    }
    f.slots.forEach((s, i) => {
      const el = this.slotEls[i];
      const html = `<span class="key">${s.key}</span><span class="type t-${s.type}">${s.type}</span><span class="count">${s.count}</span>`;
      if (el.innerHTML !== html) el.innerHTML = html;
      el.classList.toggle('loaded', f.loadedSlot === i);
      el.classList.toggle('loading', f.loadedSlot === null && f.loadingSlot === i);
      el.classList.toggle('empty', s.count === 0 && f.loadedSlot !== i);
      el.title = s.name;
    });
    const loaded = f.loadedSlot !== null;
    this.fill.style.width = `${Math.round(f.reloadProgress * 100)}%`;
    this.fill.classList.toggle('ready', loaded);
    this.label.textContent = loaded
      ? `已装填 · ${f.slots[f.loadedSlot!].name}`
      : `装填中 ${f.reloadRemaining.toFixed(1)} s · ${f.slots[f.loadingSlot]?.name ?? ''}`;
  }
}
