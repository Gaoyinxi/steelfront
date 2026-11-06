import './ui/hud.css';
import { Game } from './game/Game';

const menu = document.getElementById('menu')!;
const status = menu.querySelector('.status') as HTMLElement;
const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button[data-skill]')];

function showError(err: unknown): void {
  console.error(err);
  menu.classList.remove('hidden');
  status.style.color = '#ff8a6a';
  status.textContent = `启动失败：${err instanceof Error ? err.message : String(err)}`;
}

async function start(aiSkill: string): Promise<void> {
  const app = document.getElementById('app');
  const hud = document.getElementById('hud');
  if (!app || !hud) throw new Error('Missing #app / #hud containers');
  buttons.forEach((b) => (b.disabled = true));
  status.textContent = '正在生成战场…';
  // Let the status repaint before the (synchronous) world generation.
  await new Promise((r) => setTimeout(r, 30));
  const game = await Game.create(app, hud, { mapId: 'meadow_01', aiSkill });
  menu.classList.add('hidden');
  game.start();
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
}

buttons.forEach((b) => {
  b.disabled = false;
  b.addEventListener('click', () => start(b.dataset.skill!).catch(showError));
});
status.textContent = '选择难度开始';
