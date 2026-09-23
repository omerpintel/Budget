import { describe, expect, it } from 'vitest';
import { useTestDb } from '@/test/harness';
import { debitDateFor, ensurePeriod, findPeriod, listPeriods, periodForDebitDate } from './periods';

describe('periodForDebitDate / debitDateFor (pure)', () => {
  it('round-trips a normal debit day', () => {
    const ref = periodForDebitDate('2026-03-15');
    expect(ref).toEqual({ year: 2026, month: 3 });
    expect(debitDateFor(ref, 15)).toBe('2026-03-15');
  });

  it('clamps a debit day past the end of a short month (Feb 31 -> Feb 28)', () => {
    expect(debitDateFor({ year: 2026, month: 2 }, 31)).toBe('2026-02-28');
  });

  it('clamps to Feb 29 in a leap year', () => {
    expect(debitDateFor({ year: 2024, month: 2 }, 31)).toBe('2024-02-29');
  });

  it('handles a December -> January period rollover', () => {
    const ref = periodForDebitDate('2026-01-05');
    expect(ref).toEqual({ year: 2026, month: 1 });
  });
});

describe('ensurePeriod / findPeriod / listPeriods', () => {
  useTestDb();

  it('creates a period on first call and reuses it on subsequent calls (idempotent)', async () => {
    const first = await ensurePeriod({ year: 2026, month: 1 });
    const second = await ensurePeriod({ year: 2026, month: 1 });
    expect(second.id).toBe(first.id);

    const periods = await listPeriods();
    expect(periods).toHaveLength(1);
  });

  it('findPeriod returns null for a period that does not exist', async () => {
    expect(await findPeriod({ year: 2026, month: 1 })).toBeNull();
  });

  it('lists periods newest first', async () => {
    await ensurePeriod({ year: 2025, month: 12 });
    await ensurePeriod({ year: 2026, month: 1 });
    await ensurePeriod({ year: 2026, month: 2 });

    const periods = await listPeriods();
    expect(periods.map((p) => `${p.year}-${p.month}`)).toEqual(['2026-2', '2026-1', '2025-12']);
  });

  it('new periods start as draft', async () => {
    const period = await ensurePeriod({ year: 2026, month: 1 });
    expect(period.status).toBe('draft');
    expect(period.committed_at).toBeNull();
  });
});
