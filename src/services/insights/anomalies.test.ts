import { describe, expect, it } from 'vitest';
import {
  detectAnomalies,
  installmentPlans,
  totalOutstanding,
  type CategoryHistory,
} from './anomalies';

const history = (partial: Partial<CategoryHistory>): CategoryHistory => ({
  categoryId: 'c1',
  categoryName: 'Groceries',
  previous: [100_000, 100_000, 100_000],
  current: 100_000,
  ...partial,
});

describe('detectAnomalies', () => {
  it('says nothing when spending matches the average', () => {
    expect(detectAnomalies([history({})])).toEqual([]);
  });

  it('flags overspending above the threshold', () => {
    const [anomaly] = detectAnomalies([history({ current: 150_000 })]);
    expect(anomaly).toMatchObject({ kind: 'over', deviation: 0.5, difference: 50_000 });
  });

  it('flags underspending too', () => {
    const [anomaly] = detectAnomalies([history({ current: 60_000 })]);
    expect(anomaly.kind).toBe('under');
    expect(anomaly.difference).toBe(-40_000);
  });

  it('stays quiet on small absolute differences even at a big percentage', () => {
    const tiny = history({ previous: [2_000, 2_000, 2_000], current: 6_000 });
    expect(detectAnomalies([tiny])).toEqual([]);
  });

  it('escalates a large overspend to a warning but not a large saving', () => {
    const over = detectAnomalies([history({ current: 200_000 })])[0];
    const under = detectAnomalies([history({ current: 20_000 })])[0];
    expect(over.severity).toBe('warning');
    expect(under.severity).toBe('info');
  });

  it('stays silent when one prior month is all the history there is', () => {
    expect(detectAnomalies([history({ previous: [100_000], current: 500_000 })])).toEqual([]);
  });

  it('reports a brand-new material category', () => {
    const [anomaly] = detectAnomalies([history({ previous: [], current: 80_000 })]);
    expect(anomaly).toMatchObject({ kind: 'new', average: 0, current: 80_000 });
  });

  it('ignores a brand-new trivial category', () => {
    expect(detectAnomalies([history({ previous: [], current: 500 })])).toEqual([]);
  });

  it('reports a category that stopped', () => {
    const [anomaly] = detectAnomalies([history({ current: 0 })]);
    expect(anomaly).toMatchObject({ kind: 'stopped', current: 0, average: 100_000 });
  });

  it('sorts by how much money is involved', () => {
    const result = detectAnomalies([
      history({ categoryId: 'small', current: 130_000 }),
      history({ categoryId: 'big', current: 300_000 }),
    ]);
    expect(result.map((a) => a.categoryId)).toEqual(['big', 'small']);
  });

  it('ignores zero-spend months when averaging', () => {
    const [anomaly] = detectAnomalies([
      history({ previous: [100_000, 0, 100_000], current: 150_000 }),
    ]);
    expect(anomaly.average).toBe(100_000);
  });
});

describe('installmentPlans', () => {
  const sofa = {
    merchant: 'איקאה',
    amount: 50_000,
    total: 12,
    date: '2026-08-25',
  };

  it('computes what is still owed from the latest payment', () => {
    const [plan] = installmentPlans([
      { ...sofa, current: 1, date: '2026-06-25' },
      { ...sofa, current: 2, date: '2026-07-25' },
      { ...sofa, current: 3 },
    ]);
    expect(plan).toMatchObject({
      merchant: 'איקאה',
      paid: 3,
      total: 12,
      remaining: 9,
      outstanding: 450_000,
      finalPayment: '2027-05-25',
    });
  });

  it('does not double count the same plan across statements', () => {
    const plans = installmentPlans([
      { ...sofa, current: 1 },
      { ...sofa, current: 2 },
      { ...sofa, current: 3 },
    ]);
    expect(plans).toHaveLength(1);
  });

  it('drops finished plans', () => {
    expect(installmentPlans([{ ...sofa, current: 12 }])).toEqual([]);
  });

  it('ignores single payments and nonsense rows', () => {
    expect(
      installmentPlans([
        { ...sofa, total: 1, current: 1 },
        { ...sofa, current: 0 },
        { ...sofa, current: 13 },
      ]),
    ).toEqual([]);
  });

  it('keeps separate plans from the same merchant apart', () => {
    const plans = installmentPlans([
      { ...sofa, current: 3 },
      { ...sofa, amount: 20_000, total: 6, current: 1 },
    ]);
    expect(plans).toHaveLength(2);
    expect(totalOutstanding(plans)).toBe(450_000 + 100_000);
  });

  it('sums to zero when there is nothing outstanding', () => {
    expect(totalOutstanding([])).toBe(0);
  });
});
