import type { World } from './World';

/**
 * A system runs simulation logic at the fixed tick rate.
 * Rendering-side code does NOT implement this interface; it lives in
 * `src/render` and reads the world in the variable-rate render pass.
 */
export interface System {
  readonly name: string;
  fixedUpdate(world: World, dt: number, tick: number): void;
}
