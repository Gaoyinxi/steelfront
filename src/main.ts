import { Game } from './game/Game';

async function bootstrap(): Promise<void> {
  const app = document.getElementById('app');
  const hud = document.getElementById('hud');
  if (!app || !hud) throw new Error('Missing #app / #hud containers');
  const game = await Game.create(app, hud, { mapId: 'meadow_01', playerVehicleId: 'kestrel_mk1' });
  game.start();
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
}

bootstrap().catch((err: unknown) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="position:fixed;inset:16px;color:#f88;white-space:pre-wrap">${String(err)}</pre>`,
  );
});
