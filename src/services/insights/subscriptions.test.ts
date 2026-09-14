import { describe, expect, it } from 'vitest';
import { annualCost, detectSubscriptions, type Charge } from './subscriptions';

const REF = { referenceDate: '2026-09-14' };

function monthly(merchant: string, amount: number, months: string[], jitter = 0): Charge[] {
  return months.map((date, i) => ({ merchant, date, amount: amount + i * jitter }));
}

describe('detectSubscriptions', () => {
  it('finds a steady monthly charge', () => {
    const subs = detectSubscriptions(
      monthly('נטפליקס', 5490, ['2026-06-18', '2026-07-18', '2026-08-18']),
      REF,
    );
    expect(subs).toHaveLength(1);
    // Gaps are 30 and 31 days, so the median interval is 31.
    expect(subs[0]).toMatchObject({
      merchant: 'נטפליקס',
      cadence: 'monthly',
      expectedAmount: 5490,
      occurrences: 3,
      status: 'active',
      nextExpected: '2026-09-18',
    });
  });

  it('needs at least three charges before calling something a subscription', () => {
    expect(detectSubscriptions(monthly('ספוטיפיי', 1990, ['2026-07-01', '2026-08-01']), REF)).toEqual(
      [],
    );
  });

  it('tolerates a few days of billing drift', () => {
    const subs = detectSubscriptions(
      monthly('ספוטיפיי', 1990, ['2026-06-01', '2026-07-03', '2026-08-02']),
      REF,
    );
    expect(subs).toHaveLength(1);
    expect(subs[0].cadence).toBe('monthly');
  });

  it('tolerates a small price rise', () => {
    const subs = detectSubscriptions(
      [
        { merchant: 'יס', date: '2026-06-10', amount: 20000 },
        { merchant: 'יס', date: '2026-07-10', amount: 20000 },
        { merchant: 'יס', date: '2026-08-10', amount: 21000 },
      ],
      REF,
    );
    expect(subs).toHaveLength(1);
  });

  it('ignores a merchant whose amounts swing wildly', () => {
    const subs = detectSubscriptions(
      [
        { merchant: 'שופרסל', date: '2026-06-10', amount: 12000 },
        { merchant: 'שופרסל', date: '2026-07-10', amount: 48000 },
        { merchant: 'שופרסל', date: '2026-08-10', amount: 25000 },
      ],
      REF,
    );
    expect(subs).toEqual([]);
  });

  it('ignores irregular visits even at a steady price', () => {
    const subs = detectSubscriptions(
      [
        { merchant: 'ארומה', date: '2026-06-01', amount: 3200 },
        { merchant: 'ארומה', date: '2026-06-04', amount: 3200 },
        { merchant: 'ארומה', date: '2026-08-20', amount: 3200 },
      ],
      REF,
    );
    expect(subs).toEqual([]);
  });

  it('recognises annual and quarterly rhythms', () => {
    const annual = detectSubscriptions(
      monthly('ביטוח', 120000, ['2024-03-01', '2025-03-01', '2026-03-01']),
      REF,
    );
    expect(annual[0].cadence).toBe('annual');

    const quarterly = detectSubscriptions(
      monthly('ארנונה', 90000, ['2026-01-05', '2026-04-05', '2026-07-05']),
      REF,
    );
    expect(quarterly[0].cadence).toBe('quarterly');
  });

  it('marks a subscription cancelled after a full cycle of silence', () => {
    const subs = detectSubscriptions(
      monthly('גיים פס', 4000, ['2026-01-10', '2026-02-10', '2026-03-10']),
      REF,
    );
    expect(subs[0].status).toBe('cancelled');
  });

  it('marks a charge overdue before declaring it dead', () => {
    // Expected around 2026-09-10, so by the 14th it is late but not yet a missed cycle.
    const subs = detectSubscriptions(
      monthly('אינטרנט', 9900, ['2026-06-10', '2026-07-10', '2026-08-10']),
      REF,
    );
    expect(subs[0].status).toBe('watch');
  });

  it('carries the masked flag so personal subscriptions stay hidden', () => {
    const subs = detectSubscriptions(
      [
        { merchant: 'x', date: '2026-06-18', amount: 5000, isMasked: true },
        { merchant: 'x', date: '2026-07-18', amount: 5000 },
        { merchant: 'x', date: '2026-08-18', amount: 5000 },
      ],
      REF,
    );
    expect(subs[0].isMasked).toBe(true);
  });

  it('reports what has been paid so far', () => {
    const subs = detectSubscriptions(
      monthly('נטפליקס', 5000, ['2026-06-18', '2026-07-18', '2026-08-18']),
      REF,
    );
    expect(subs[0].totalPaid).toBe(15000);
  });

  it('handles an empty ledger', () => {
    expect(detectSubscriptions([], REF)).toEqual([]);
  });
});

describe('annualCost', () => {
  it('projects a year of active subscriptions and ignores cancelled ones', () => {
    const subs = [
      ...detectSubscriptions(monthly('a', 5000, ['2026-06-18', '2026-07-18', '2026-08-18']), REF),
      ...detectSubscriptions(monthly('b', 4000, ['2026-01-10', '2026-02-10', '2026-03-10']), REF),
    ];
    expect(subs.find((s) => s.merchant === 'b')?.status).toBe('cancelled');
    expect(annualCost(subs)).toBe(5000 * 12);
  });
});
