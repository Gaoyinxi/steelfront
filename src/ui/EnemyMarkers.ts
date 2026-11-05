export interface MarkerView {
  /** Screen position (CSS px) of the point above the vehicle. */
  x: number;
  y: number;
  distance: number;
}

/** Red markers above enemies the crew can see, with range. */
export class EnemyMarkers {
  private readonly root: HTMLDivElement;
  private readonly pool: HTMLDivElement[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-markers';
    parent.appendChild(this.root);
  }

  update(markers: readonly MarkerView[]): void {
    while (this.pool.length < markers.length) {
      const el = document.createElement('div');
      el.className = 'hud-marker';
      this.root.appendChild(el);
      this.pool.push(el);
    }
    this.pool.forEach((el, i) => {
      const m = markers[i];
      if (!m) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      el.style.left = `${m.x}px`;
      el.style.top = `${m.y}px`;
      const text = `<span class="arrow">▼</span><span class="range">${Math.round(m.distance)} m</span>`;
      if (el.innerHTML !== text) el.innerHTML = text;
    });
  }
}
