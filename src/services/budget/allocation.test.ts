import { describe, expect, it } from 'vitest';
import { coverDeficits, spreadByWeight, type AllocationTarget } from './engine';

const target = (id: string, planned: number, actual: number): AllocationTarget => ({
  id,
  planned,
  actual,
});

describe('coverDeficits', () => {
  it('raises each plan to what was actually spent', () => {
    const { assignments, used } = coverDeficits(
      [target('a', 10_000, 13_000), target('b', 5_000, 5_000)],
      100_000,
    );
    expect(assignments).toEqual({ a: 3_000 });
    expect(used).toBe(3_000);
  });

  it('ignores categories that came in under plan', () => {
    const { assignments, used } = coverDeficits([target('a', 20_000, 4_000)], 100_000);
    expect(assignments).toEqual({});
    expect(used).toBe(0);
  });

  it('closes the most categories it can when the pot runs short', () => {
    const { assignments, used } = coverDeficits(
      [target('big', 0, 90_000), target('small', 0, 1_000), target('mid', 0, 4_000)],
      6_000,
    );
    // Smallest gaps first: small and mid close fully, big takes the remainder.
    expect(assignments).toEqual({ small: 1_000, mid: 4_000, big: 1_000 });
    expect(used).toBe(6_000);
  });

  it('never spends more than is available', () => {
    const { assignments, used } = coverDeficits([target('a', 0, 50_000)], 12_345);
    expect(assignments.a).toBe(12_345);
    expect(used).toBe(12_345);
  });

  it('treats a negative pot as empty', () => {
    expect(coverDeficits([target('a', 0, 10_000)], -500)).toEqual({ assignments: {}, used: 0 });
  });
});

describe('spreadByWeight', () => {
  it('splits proportionally to weight', () => {
    const out = spreadByWeight(
      [
        { id: 'a', weight: 3 },
        { id: 'b', weight: 1 },
      ],
      40_000,
    );
    expect(out).toEqual({ a: 30_000, b: 10_000 });
  });

  it('always adds back up to the amount despite rounding', () => {
    const out = spreadByWeight(
      [
        { id: 'a', weight: 1 },
        { id: 'b', weight: 1 },
        { id: 'c', weight: 1 },
      ],
      100,
    );
    expect(out.a + out.b + out.c).toBe(100);
  });

  it('falls back to an even split when nothing has history', () => {
    const out = spreadByWeight(
      [
        { id: 'a', weight: 0 },
        { id: 'b', weight: 0 },
      ],
      1_000,
    );
    expect(out).toEqual({ a: 500, b: 500 });
  });

  it('returns nothing for an empty or non-positive amount', () => {
    expect(spreadByWeight([{ id: 'a', weight: 1 }], 0)).toEqual({});
    expect(spreadByWeight([], 5_000)).toEqual({});
  });
});
