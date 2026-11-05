/**
 * Fixed-timestep game loop with render interpolation
 * ("Fix Your Timestep", G. Fiedler).
 *
 * - Simulation advances in constant `fixedDt` increments (default 1/60 s).
 * - Rendering runs once per animation frame and receives `alpha` in [0,1)
 *   for interpolating between the previous and current simulation states.
 * - Steps per frame are capped to avoid the "spiral of death" after stalls.
 */

export interface LoopCallbacks {
  fixedUpdate(dt: number, tick: number): void;
  render(alpha: number, frameDt: number): void;
}

export interface StepPlan {
  steps: number;
  accumulator: number;
  alpha: number;
}

/** Pure scheduling function, exported for unit testing. */
export function planSteps(
  accumulator: number,
  frameDt: number,
  fixedDt: number,
  maxSteps: number,
): StepPlan {
  let acc = accumulator + Math.min(frameDt, fixedDt * maxSteps * 2);
  let steps = 0;
  while (acc >= fixedDt && steps < maxSteps) {
    acc -= fixedDt;
    steps++;
  }
  // Drop remaining backlog if we hit the cap, so we never fall further behind.
  if (steps === maxSteps && acc >= fixedDt) acc = acc % fixedDt;
  return { steps, accumulator: acc, alpha: acc / fixedDt };
}

export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;
  private tick = 0;

  constructor(
    private readonly callbacks: LoopCallbacks,
    readonly fixedDt = 1 / 60,
    private readonly maxStepsPerFrame = 5,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const frameDt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      const plan = planSteps(this.accumulator, frameDt, this.fixedDt, this.maxStepsPerFrame);
      for (let i = 0; i < plan.steps; i++) {
        this.callbacks.fixedUpdate(this.fixedDt, this.tick++);
      }
      this.accumulator = plan.accumulator;
      this.callbacks.render(plan.alpha, frameDt);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
