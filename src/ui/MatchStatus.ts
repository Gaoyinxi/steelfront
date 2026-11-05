export type MatchOutcome = 'victory' | 'defeat';

/** Remaining-enemies counter and the end-of-match banner. */
export class MatchStatus {
  private readonly counter: HTMLDivElement;
  private readonly banner: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.counter = document.createElement('div');
    this.counter.className = 'hud-panel hud-match';
    this.banner = document.createElement('div');
    this.banner.className = 'hud-result';
    parent.append(this.counter, this.banner);
  }

  update(remaining: number, total: number): void {
    const text = `敌方剩余 ${remaining} / ${total}`;
    if (this.counter.textContent !== text) this.counter.textContent = text;
  }

  showResult(result: MatchOutcome): void {
    this.banner.innerHTML =
      result === 'victory'
        ? '<div class="title win">胜利</div><div class="sub">敌方坦克全部被击毁 · 按 R 重新开始</div>'
        : '<div class="title lose">战败</div><div class="sub">本车被击毁 · 按 R 重新开始</div>';
    this.banner.classList.add('on');
  }
}
