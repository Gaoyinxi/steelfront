import { describe, expect, it } from 'vitest';
import { defineComponent, World } from './World';

const A = defineComponent<{ v: number }>('A');
const B = defineComponent<{ s: string }>('B');

describe('World', () => {
  it('queries entities by component intersection', () => {
    const w = new World();
    const e1 = w.create();
    const e2 = w.create();
    w.add(e1, A, { v: 1 });
    w.add(e1, B, { s: 'x' });
    w.add(e2, A, { v: 2 });
    expect(w.query(A)).toEqual([e1, e2]);
    expect(w.query(A, B)).toEqual([e1]);
    expect(w.get(e2, A)?.v).toBe(2);
  });

  it('defers destruction until flush', () => {
    const w = new World();
    const e = w.create();
    w.add(e, A, { v: 1 });
    w.destroy(e);
    expect(w.query(A)).toEqual([]);
    expect(w.has(e, A)).toBe(true);
    expect(w.flush()).toEqual([e]);
    expect(w.has(e, A)).toBe(false);
    expect(w.isAlive(e)).toBe(false);
  });
});
