import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import { ensureManualAccount } from './accounts';
import { normalizeMerchant } from '@/services/categorize/normalize';
import type { RunStatus } from './runModel';

export type { RunStatus };
export { RUN_STEPS, deriveStep, isStepComplete } from './runModel';

export async function getRunStatus(periodId: string): Promise<RunStatus> {
  const rows = await getDb().select<{
    incomes: number;
    batches: number;
    unreviewed: number;
    committed: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM period_incomes WHERE period_id = ?)                        AS incomes,
       (SELECT COUNT(*) FROM import_batches WHERE target_period_id = ?)                 AS batches,
       (SELECT COUNT(*) FROM transactions WHERE period_id = ? AND is_reviewed = 0)      AS unreviewed,
       (SELECT CASE WHEN status = 'committed' THEN 1 ELSE 0 END
          FROM budget_periods WHERE id = ?)                                             AS committed`,
    [periodId, periodId, periodId, periodId],
  );
  const row = rows[0];
  return {
    hasIncome: row.incomes > 0,
    importedBatches: row.batches,
    unreviewed: row.unreviewed,
    committed: row.committed === 1,
  };
}

export interface MaterializeResult {
  incomesAdded: number;
  expensesAdded: number;
}

function dayInMonth(year: number, month: number, day: number): string {
  const last = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/**
 * Pre-fills the period from the recurring templates. Safe to run repeatedly: incomes
 * are keyed by template and expenses by a deterministic dedupe hash.
 */
export async function materializeRecurring(
  periodId: string,
  year: number,
  month: number,
): Promise<MaterializeResult> {
  const db = getDb();
  const entries = await db.select<{
    id: string;
    name: string;
    direction: 'in' | 'out';
    category_id: string | null;
    person_id: string | null;
    default_amount: number;
    day_of_month: number | null;
  }>('SELECT * FROM recurring_entries WHERE is_active = 1 ORDER BY sort_order, name');
  if (entries.length === 0) return { incomesAdded: 0, expensesAdded: 0 };

  const accountId = await ensureManualAccount();
  const ts = nowIso();
  const statements: Array<{ sql: string; params: Array<string | number | null> }> = [];
  let incomesAdded = 0;
  let expensesAdded = 0;

  for (const entry of entries) {
    if (entry.direction === 'in') {
      const existing = await db.select<{ id: string }>(
        'SELECT id FROM period_incomes WHERE period_id = ? AND recurring_entry_id = ?',
        [periodId, entry.id],
      );
      if (existing.length > 0) continue;
      incomesAdded += 1;
      statements.push({
        sql: `INSERT INTO period_incomes
                (id, period_id, person_id, label, amount, recurring_entry_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          uuid(),
          periodId,
          entry.person_id,
          entry.name,
          entry.default_amount,
          entry.id,
          ts,
          ts,
        ],
      });
      continue;
    }

    const date = dayInMonth(year, month, entry.day_of_month ?? 1);
    const dedupeHash = `recurring:${entry.id}:${periodId}`;
    const existing = await db.select<{ id: string }>(
      'SELECT id FROM transactions WHERE dedupe_hash = ?',
      [dedupeHash],
    );
    if (existing.length > 0) continue;
    expensesAdded += 1;
    statements.push({
      sql: `INSERT INTO transactions
              (id, period_id, account_id, entry_mode, direction, transaction_date, debit_date,
               amount, raw_description, normalized_merchant, category_id, wallet, is_masked,
               categorization_source, is_reviewed, is_excluded, dedupe_hash, created_at, updated_at)
            VALUES (?, ?, ?, 'manual', 'out', ?, ?, ?, ?, ?, ?, 'joint', 0, 'user', 1, 0, ?, ?, ?)`,
      params: [
        uuid(),
        periodId,
        accountId,
        date,
        date,
        entry.default_amount,
        entry.name,
        normalizeMerchant(entry.name),
        entry.category_id,
        dedupeHash,
        ts,
        ts,
      ],
    });
  }

  if (statements.length > 0) await db.batch(statements);
  return { incomesAdded, expensesAdded };
}

export interface PeriodManualRow {
  id: string;
  transaction_date: string;
  raw_description: string;
  amount: number;
  category_name: string | null;
}

/** Bank-side outflows for the period: rent wires, standing orders, cash. */
export async function listManualOutflows(periodId: string): Promise<PeriodManualRow[]> {
  return getDb().select<PeriodManualRow>(
    `SELECT t.id, t.transaction_date, t.raw_description, t.amount, c.name AS category_name
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.period_id = ? AND t.entry_mode = 'manual' AND t.direction = 'out'
     ORDER BY t.transaction_date`,
    [periodId],
  );
}
