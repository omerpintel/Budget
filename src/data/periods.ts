import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import type { BudgetPeriod } from './types';

export interface PeriodRef {
  year: number;
  month: number;
}

/**
 * Cash-flow rule: a statement belongs to the period in which the bank was actually
 * debited, regardless of when the individual purchases were made.
 */
export function periodForDebitDate(debitDate: string): PeriodRef {
  const [year, month] = debitDate.split('-').map(Number);
  return { year, month };
}

/** The debit date of the statement a card is billing in the given period. */
export function debitDateFor(period: PeriodRef, debitDay: number): string {
  const lastDay = new Date(period.year, period.month, 0).getDate();
  const day = Math.min(debitDay, lastDay);
  return `${period.year}-${String(period.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export async function listPeriods(): Promise<BudgetPeriod[]> {
  return getDb().select<BudgetPeriod>('SELECT * FROM budget_periods ORDER BY year DESC, month DESC');
}

export async function findPeriod(ref: PeriodRef): Promise<BudgetPeriod | null> {
  const rows = await getDb().select<BudgetPeriod>(
    'SELECT * FROM budget_periods WHERE year = ? AND month = ?',
    [ref.year, ref.month],
  );
  return rows[0] ?? null;
}

export async function ensurePeriod(ref: PeriodRef): Promise<BudgetPeriod> {
  const existing = await findPeriod(ref);
  if (existing) return existing;

  const ts = nowIso();
  await getDb().execute(
    `INSERT INTO budget_periods (id, year, month, status, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?)`,
    [uuid(), ref.year, ref.month, ts, ts],
  );
  const created = await findPeriod(ref);
  if (!created) throw new Error('Failed to create budget period');
  return created;
}
