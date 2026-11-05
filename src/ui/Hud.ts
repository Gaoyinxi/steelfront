import { Crosshair } from './Crosshair';
import { HitFeedback, type HitKind } from './HitFeedback';
import { ReloadBar, type WeaponFrame } from './ReloadBar';

export interface HudFrame {
  speedKmh: number;
  /** Turret yaw relative to hull (radians). */
  turretYaw: number;
  sight: boolean;
  zoomX: number;
  gunScreen: { x: number; y: number } | null;
  gunBlocked: boolean;
  pointerLocked: boolean;
  fps: number;
  weapon: WeaponFrame;
}

const SIGHT_SVG = `
<svg viewBox="-100 -100 200 200" fill="none" stroke="#e9edd8" stroke-width="0.6">
  <line x1="-100" y1="0" x2="-8" y2="0"/><line x1="8" y1="0" x2="100" y2="0"/>
  <line x1="0" y1="8" x2="0" y2="100"/>
  <path d="M0 0 L-4 7 M0 0 L4 7" stroke-width="0.8"/>
  ${[-40, -30, -20, -10, 10, 20, 30, 40].map((x) => `<line x1="${x}" y1="-2" x2="${x}" y2="2"/>`).join('')}
  ${[15, 30, 45, 60].map((y) => `<line x1="-3" y1="${y}" x2="3" y2="${y}"/>`).join('')}
</svg>`;

/** DOM overlay; receives a plain data snapshot each frame and never reads the ECS. */
export class Hud {
  private readonly crosshair: Crosshair;
  private readonly sight: HTMLDivElement;
  private readonly zoom: HTMLDivElement;
  private readonly speed: HTMLDivElement;
  private readonly turretIcon: SVGGElement;
  private readonly fps: HTMLDivElement;
  private readonly start: HTMLDivElement;
  private readonly reload: ReloadBar;
  private readonly hits: HitFeedback;

  constructor(root: HTMLElement) {
    this.sight = el('div', 'hud-sight');
    this.sight.innerHTML = SIGHT_SVG;
    this.zoom = el('div', 'zoom');
    this.sight.appendChild(this.zoom);
    root.appendChild(this.sight);

    this.crosshair = new Crosshair(root);

    const status = el('div', 'hud-panel hud-status');
    this.speed = el('div', 'speed');
    status.appendChild(this.speed);
    status.insertAdjacentHTML(
      'beforeend',
      `<svg width="46" height="56" viewBox="-23 -28 46 56">
         <rect x="-12" y="-22" width="24" height="44" rx="3" fill="none" stroke="#e9edd8" stroke-width="2"/>
         <g class="turret"><circle r="8" fill="#e9edd8"/><rect x="-1.5" y="-26" width="3" height="20" fill="#e9edd8"/></g>
       </svg>`,
    );
    this.turretIcon = status.querySelector('g.turret') as SVGGElement;
    root.appendChild(status);

    this.reload = new ReloadBar(root);
    this.hits = new HitFeedback(root);

    const help = el('div', 'hud-panel hud-help');
    help.innerHTML = [
      '<b>W/S</b> 前进 / 倒车',
      '<b>A/D</b> 转向',
      '<b>鼠标</b> 瞄准（炮塔跟随）',
      '<b>左键</b> 开火',
      '<b>1 / 2</b> 选择弹种（AP / HE）',
      '<b>右键按住</b> 炮镜视角',
      '<b>滚轮</b> 视距 / 炮镜倍率',
      '<b>Esc</b> 释放鼠标',
    ].join('<br>');
    root.appendChild(help);

    this.fps = el('div', 'hud-panel hud-fps');
    root.appendChild(this.fps);

    this.start = el('div', 'hud-start');
    this.start.textContent = '点击画面开始（锁定鼠标）';
    root.appendChild(this.start);
  }

  update(f: HudFrame): void {
    this.speed.innerHTML = `${Math.round(f.speedKmh)} <small>km/h</small>`;
    // Icon is drawn nose-up; positive yaw is counter-clockwise -> negative SVG rotation.
    this.turretIcon.setAttribute('transform', `rotate(${(-f.turretYaw * 180) / Math.PI})`);
    this.sight.classList.toggle('on', f.sight);
    this.zoom.textContent = `${f.zoomX.toFixed(1)}×`;
    this.crosshair.update(f.gunScreen, !f.sight, f.gunBlocked);
    this.fps.textContent = `${Math.round(f.fps)} FPS`;
    this.start.classList.toggle('hidden', f.pointerLocked);
    this.reload.update(f.weapon);
  }

  showHit(text: string, kind: HitKind, detail?: string): void {
    this.hits.show(text, kind, detail);
  }
}

function el(tag: 'div', className: string): HTMLDivElement {
  const d = document.createElement(tag);
  d.className = className;
  return d;
}
