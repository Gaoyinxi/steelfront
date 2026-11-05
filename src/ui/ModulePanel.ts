import type { VehicleDef } from '../data/schema';
import { CREW_SHORT, moduleLabel } from './labels';

export type ModuleCondition = 'ok' | 'damaged' | 'destroyed';

const COLORS: Record<ModuleCondition, string> = {
  ok: 'rgba(143, 209, 106, 0.85)',
  damaged: 'rgba(242, 193, 78, 0.95)',
  destroyed: 'rgba(224, 87, 63, 0.95)',
};

/**
 * Top-down schematic of the player's vehicle generated from its definition:
 * hull outline, turret ring, and every module coloured by condition.
 */
export class ModulePanel {
  private readonly root: HTMLDivElement;
  private readonly shapes: SVGElement[] = [];
  private readonly status: HTMLDivElement;
  private last = '';

  constructor(parent: HTMLElement, def: VehicleDef) {
    this.root = document.createElement('div');
    this.root.className = 'hud-panel hud-modules';
    const hx = def.hull.half.x;
    const hz = def.hull.half.z;
    const pad = 0.3;
    const S = 22; // px per metre
    const w = (2 * hx + 2 * pad) * S;
    const h = (2 * hz + 2 * pad) * S;
    const X = (x: number) => (x + hx + pad) * S;
    const Z = (z: number) => (z + hz + pad) * S; // sim -Z (forward) maps to the top
    const parts: string[] = [];
    parts.push(
      `<rect x="${X(-hx)}" y="${Z(-hz)}" width="${2 * hx * S}" height="${2 * hz * S}" rx="6" fill="rgba(233,237,216,0.06)" stroke="rgba(233,237,216,0.55)" stroke-width="1.5"/>`,
    );
    const t = def.turret;
    parts.push(
      `<rect x="${X(t.offset.x - t.half.x)}" y="${Z(t.offset.z - t.half.z)}" width="${2 * t.half.x * S}" height="${2 * t.half.z * S}" rx="4" fill="none" stroke="rgba(233,237,216,0.35)" stroke-dasharray="3 3"/>`,
    );
    def.modules.forEach((m, i) => {
      const cx = m.part === 'turret' ? t.offset.x + m.pos.x : m.pos.x;
      const cz = m.part === 'turret' ? t.offset.z + m.pos.z : m.pos.z;
      const title = `<title>${moduleLabel(m.type, m.role)}</title>`;
      if (m.type === 'crew' && m.role) {
        parts.push(
          `<g data-i="${i}"><circle cx="${X(cx)}" cy="${Z(cz)}" r="9"/>${title}<text x="${X(cx)}" y="${Z(cz) + 4}" text-anchor="middle" font-size="11" fill="#11140f">${CREW_SHORT[m.role]}</text></g>`,
        );
      } else {
        parts.push(
          `<rect data-i="${i}" x="${X(cx - m.half.x)}" y="${Z(cz - m.half.z)}" width="${2 * m.half.x * S}" height="${2 * m.half.z * S}" rx="2" opacity="0.75">${title}</rect>`,
        );
      }
    });
    this.root.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`;
    this.root.querySelectorAll<SVGElement>('[data-i]').forEach((el) => {
      this.shapes[Number(el.getAttribute('data-i'))] = el.tagName === 'g' ? (el.firstElementChild as SVGElement) : el;
    });
    this.status = document.createElement('div');
    this.status.className = 'status';
    this.root.appendChild(this.status);
    parent.appendChild(this.root);
  }

  update(conditions: ModuleCondition[], statusText: string): void {
    const key = conditions.join(',') + statusText;
    if (key === this.last) return;
    this.last = key;
    conditions.forEach((c, i) => this.shapes[i]?.setAttribute('fill', COLORS[c]));
    this.status.textContent = statusText;
    this.status.classList.toggle('bad', statusText !== '');
  }
}
