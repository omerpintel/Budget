import { describe, expect, it } from 'vitest';
import {
  computePeriod,
  computeVariance,
  leftToAssign,
  nextOpening,
  type PeriodInput,
  type PeriodResult,
} from './engine';

/** Deterministic PRNG so a failing property test is reproducible. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const OMER = 'p-omer';
const RONI = 'p-roni';

function baseInput(overrides: Partial<PeriodInput> = {}): PeriodInput {
  return {
    opening: { joint: 1_500_000, savings: 2_500_000, personal: { [OMER]: 0, [RONI]: 0 } },
    actual: {
      income: 3_000_000,
      fixed: 1_200_000,
      jointFlexible: 800_000,
      personalSpent: { [OMER]: 0, [RONI]: 0 },
      savingsFunded: 0,
    },
    plan: { allowances: { [OMER]: 100_000, [RONI]: 100_000 }, savings: 200_000 },
    transfers: [],
    ...overrides,
  };
}

function totalClosing(r: PeriodResult): number {
  return (
    r.joint.closing +
    r.savings.closing +
    Object.values(r.personal).reduce((s, m) => s + m.closing, 0)
  );
}

function totalOpening(i: PeriodInput): number {
  return (
    i.opening.joint +
    i.opening.savings +
    Object.values(i.opening.personal).reduce((s, v) => s + v, 0)
  );
}

describe('computePeriod invariants', () => {
  it('keeps delta and closing consistent for every wallet', () => {
    const r = computePeriod(baseInput());
    for (const m of [r.joint, r.savings, ...Object.values(r.personal)]) {
      expect(m.delta).toBe(m.inflow - m.outflow);
      expect(m.closing).toBe(m.opening + m.delta);
    }
  });

  it('conserves cash: allowances, savings contributions and transfers are internal moves', () => {
    const random = rng(20260910);
    for (let i = 0; i < 300; i++) {
      const amount = () => Math.round(random() * 500_000);
      const input = baseInput({
        opening: {
          joint: amount(),
          savings: amount(),
          personal: { [OMER]: amount(), [RONI]: amount() },
        },
        actual: {
          income: amount(),
          fixed: amount(),
          jointFlexible: amount(),
          personalSpent: { [OMER]: amount(), [RONI]: amount() },
          savingsFunded: amount(),
        },
        plan: {
          allowances: { [OMER]: amount(), [RONI]: amount() },
          savings: amount(),
        },
        transfers: [
          { from: 'savings', to: 'joint', amount: amount() },
          { from: { personal: OMER }, to: 'joint', amount: amount() },
        ],
      });

      const r = computePeriod(input);
      const spent =
        input.actual.fixed +
        input.actual.jointFlexible +
        input.actual.personalSpent[OMER] +
        input.actual.personalSpent[RONI] +
        input.actual.savingsFunded;

      expect(totalClosing(r)).toBe(totalOpening(input) + input.actual.income - spent);
    }
  });

  it('is deterministic', () => {
    const input = baseInput();
    expect(computePeriod(input)).toEqual(computePeriod(input));
  });

  it('nets transfers to zero across wallets', () => {
    const withTransfer = computePeriod(
      baseInput({ transfers: [{ from: 'savings', to: 'joint', amount: 300_000 }] }),
    );
    const without = computePeriod(baseInput());
    expect(totalClosing(withTransfer)).toBe(totalClosing(without));
    expect(withTransfer.joint.closing).toBe(without.joint.closing + 300_000);
    expect(withTransfer.savings.closing).toBe(without.savings.closing - 300_000);
  });

  it('ignores non-positive transfers', () => {
    const r = computePeriod(baseInput({ transfers: [{ from: 'savings', to: 'joint', amount: 0 }] }));
    expect(r).toEqual(computePeriod(baseInput()));
  });
});

describe('wallet behaviour', () => {
  it('funds an allowance whether or not it is spent', () => {
    const unspent = computePeriod(baseInput());
    const spent = computePeriod(
      baseInput({
        actual: { ...baseInput().actual, personalSpent: { [OMER]: 100_000, [RONI]: 0 } },
      }),
    );
    // The joint pot loses the allowance either way.
    expect(spent.joint.closing).toBe(unspent.joint.closing);
    expect(unspent.personal[OMER].closing).toBe(100_000);
    expect(spent.personal[OMER].closing).toBe(0);
  });

  it('rolls unspent personal money forward for ever without a cap', () => {
    let opening: PeriodInput['opening'] = {
      joint: 0,
      savings: 0,
      personal: { [OMER]: 0, [RONI]: 0 },
    };
    for (let month = 0; month < 24; month++) {
      const r = computePeriod(baseInput({ opening }));
      opening = nextOpening(r);
    }
    expect(opening.personal[OMER]).toBe(24 * 100_000);
  });

  it('never claws personal money back into the joint pot', () => {
    const r = computePeriod(
      baseInput({ opening: { joint: 0, savings: 0, personal: { [OMER]: 5_000_000, [RONI]: 0 } } }),
    );
    expect(r.personal[OMER].closing).toBe(5_000_000 + 100_000);
  });

  it('draws a savings-funded expense from savings, not from joint flexible', () => {
    const plain = computePeriod(baseInput());
    const funded = computePeriod(
      baseInput({ actual: { ...baseInput().actual, savingsFunded: 900_000 } }),
    );
    expect(funded.joint.closing).toBe(plain.joint.closing);
    expect(funded.savings.closing).toBe(plain.savings.closing - 900_000);
  });

  it('moves the monthly savings contribution from joint into savings', () => {
    const r = computePeriod(baseInput());
    expect(r.savings.inflow).toBe(200_000);
    expect(r.joint.outflow).toBe(1_200_000 + 800_000 + 200_000 + 200_000);
  });
});

describe('negative joint buffer', () => {
  it('reports a shortfall and carries the deficit forward', () => {
    const r = computePeriod(
      baseInput({
        opening: { joint: 0, savings: 0, personal: { [OMER]: 0, [RONI]: 0 } },
        actual: { ...baseInput().actual, income: 1_000_000 },
      }),
    );
    expect(r.joint.closing).toBeLessThan(0);
    expect(r.shortfall).toBe(-r.joint.closing);
    expect(nextOpening(r).joint).toBe(r.joint.closing);
  });

  it('clears the shortfall when covered by a transfer', () => {
    const broke = baseInput({
      opening: { joint: 0, savings: 1_000_000, personal: { [OMER]: 0, [RONI]: 0 } },
      actual: { ...baseInput().actual, income: 2_300_000 },
    });
    const before = computePeriod(broke);
    expect(before.shortfall).toBeGreaterThan(0);

    const after = computePeriod({
      ...broke,
      transfers: [{ from: 'savings', to: 'joint', amount: before.shortfall }],
    });
    expect(after.shortfall).toBe(0);
    expect(after.joint.closing).toBe(0);
  });

  it('reports no shortfall when the buffer is exactly zero', () => {
    // Outflow is 1,200,000 fixed + 800,000 flexible + 200,000 allowances + 200,000 savings.
    const r = computePeriod(
      baseInput({
        opening: { joint: 0, savings: 0, personal: { [OMER]: 0, [RONI]: 0 } },
        actual: { ...baseInput().actual, income: 2_400_000 },
      }),
    );
    expect(r.joint.closing).toBe(0);
    expect(r.shortfall).toBe(0);
  });
});

describe('period chaining', () => {
  it('carries every closing into the next opening across a year', () => {
    const random = rng(7);
    let opening: PeriodInput['opening'] = {
      joint: 500_000,
      savings: 1_000_000,
      personal: { [OMER]: 0, [RONI]: 0 },
    };
    const openings = [opening];
    const closings: number[] = [];

    for (let month = 0; month < 12; month++) {
      const input = baseInput({
        opening,
        actual: {
          income: 2_500_000 + Math.round(random() * 1_000_000),
          fixed: 1_100_000,
          jointFlexible: Math.round(random() * 1_200_000),
          personalSpent: {
            [OMER]: Math.round(random() * 100_000),
            [RONI]: Math.round(random() * 100_000),
          },
          savingsFunded: 0,
        },
      });
      const r = computePeriod(input);
      closings.push(r.joint.closing);
      opening = nextOpening(r);
      openings.push(opening);
    }

    for (let i = 0; i < 12; i++) {
      expect(openings[i + 1].joint).toBe(closings[i]);
    }
  });

  it('produces identical results when a period is recomputed', () => {
    const input = baseInput();
    const first = computePeriod(input);
    const second = computePeriod(input);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('keeps integer agorot with no fractional drift', () => {
    const random = rng(99);
    for (let i = 0; i < 200; i++) {
      const r = computePeriod(
        baseInput({
          actual: {
            income: Math.round(random() * 999_999),
            fixed: Math.round(random() * 333_333),
            jointFlexible: Math.round(random() * 111_111),
            personalSpent: { [OMER]: Math.round(random() * 7_777), [RONI]: 0 },
            savingsFunded: 0,
          },
        }),
      );
      for (const m of [r.joint, r.savings, ...Object.values(r.personal)]) {
        expect(Number.isInteger(m.closing)).toBe(true);
      }
    }
  });
});

describe('zero-based planning', () => {
  it('reaches zero only when every shekel has a job', () => {
    const lines = [
      { categoryId: 'rent', planned: 600_000 },
      { categoryId: 'groceries', planned: 250_000 },
      { categoryId: 'savings', planned: 100_000 },
    ];
    const allowances = { [OMER]: 25_000, [RONI]: 25_000 };
    expect(leftToAssign(1_000_000, lines, allowances)).toBe(0);
    expect(leftToAssign(1_100_000, lines, allowances)).toBe(100_000);
    expect(leftToAssign(900_000, lines, allowances)).toBe(-100_000);
  });
});

describe('variance', () => {
  it('reports overspending as a negative delta', () => {
    const v = computeVariance(
      [
        { categoryId: 'groceries', planned: 200_000 },
        { categoryId: 'fuel', planned: 100_000 },
      ],
      { groceries: 240_000, fuel: 60_000 },
    );
    expect(v.find((x) => x.categoryId === 'groceries')?.delta).toBe(-40_000);
    expect(v.find((x) => x.categoryId === 'fuel')?.delta).toBe(40_000);
  });

  it('includes categories that were spent but never planned', () => {
    const v = computeVariance([], { surprise: 50_000 });
    expect(v).toEqual([{ categoryId: 'surprise', planned: 0, actual: 50_000, delta: -50_000 }]);
  });
});
