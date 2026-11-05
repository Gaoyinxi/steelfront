/** Screen-centre aim cross + marker showing where the gun actually points. */
export class Crosshair {
  private readonly cross: HTMLDivElement;
  private readonly marker: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.cross = document.createElement('div');
    this.cross.className = 'hud-crosshair';
    this.marker = document.createElement('div');
    this.marker.className = 'hud-gunmarker';
    root.append(this.cross, this.marker);
  }

  /**
   * @param gunScreen projected gun aim point in CSS pixels, or null if behind camera.
   * @param showCross hide the centre cross while looking through the sight.
   */
  update(gunScreen: { x: number; y: number } | null, showCross: boolean, blocked: boolean): void {
    this.cross.style.display = showCross ? 'block' : 'none';
    if (!gunScreen) {
      this.marker.style.display = 'none';
      return;
    }
    this.marker.style.display = 'block';
    this.marker.style.left = `${gunScreen.x}px`;
    this.marker.style.top = `${gunScreen.y}px`;
    this.marker.classList.toggle('blocked', blocked);
  }
}
