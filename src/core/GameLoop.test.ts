import { describe, expect, it } from 'vitest';
import { planSteps } from './GameLoop';

const DT = 1 / 60;

describe('planSteps', () => {
  it('runs one step for one frame of exactly fixedDt', () => {
    const p = planSteps(0, DT, DT, 5);
    expect(p.steps).toBe(1);
    expect(p.accumulator).toBeCloseTo(0, 9);
  });

  it('accumulates partial frames and reports alpha', () => {
    const p = planSteps(0, DT * 0.5, DT, 5);
    expect(p.steps).toBe(0);
    expect(p.alpha).toBeCloseTo(0.5, 9);
    const p2 = planSteps(p.accumulator, DT * 0.75, DT, 5);
    expect(p2.steps).toBe(1);
    expect(p2.alpha).toBeCloseTo(0.25, 6);
  });

  it('caps steps after a long stall and discards backlog', () => {
    const p = planSteps(0, 2.0, DT, 5);
    expect(p.steps).toBe(5);
    expect(p.accumulator).toBeLessThan(DT);
  });
});
