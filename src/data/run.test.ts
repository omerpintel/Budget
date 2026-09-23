import { describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { setBudgetLine } from './budget';
import { findCategory, makeIncome, makeManualAccount, makePeriod, makeTransaction } from '@/test/factories';
import { useTestDb } from '@/test/harness';
import { commitPeriod } from './periodEngine';
import { getRunStatus, listManualOutflows, materializeRecurring } from './run';
import { createRecurringEntry } from './categories';

describe('getRunStatus', () => {
  useTestDb();

  it('reports a fresh, empty period as incomplete and not overallocated', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const status = await getRunStatus(period.id);
    expect(status).toEqual({
      hasIncome: false,
      importedBatches: 0,
      unreviewed: 0,
      committed: false,
      overAllocated: false,
      unassignedActual: 0,
      uncategorized: 0,
    });
  });

  it('reflects income, unreviewed transactions, and over-allocation', async () => {
    const groceries = await findCategory('groceries');
    const period = await makePeriod({ year: 2026, month: 1 });
    await makeIncome(period.id, 1000);
    await setBudgetLine(period.id, groceries.id, 5000);
    const accountId = await makeManualAccount();

    await getDb().execute(
      `INSERT INTO transactions
         (id, period_id, account_id, entry_mode, direction, transaction_date, debit_date, amount,
          raw_description, category_id, wallet, is_reviewed, dedupe_hash, created_at, updated_at)
       VALUES ('tx-unrev', ?, ?, 'imported', 'out', '2026-01-05',
               '2026-01-05', 200, 'x', ?, 'joint', 0, 'h1', datetime('now'), datetime('now'))`,
      [period.id, accountId, groceries.id],
    );

    const status = await getRunStatus(period.id);
    expect(status.hasIncome).toBe(true);
    expect(status.unreviewed).toBe(1);
    expect(status.overAllocated).toBe(true);
    expect(status.committed).toBe(false);
  });

  it('reflects committed status after commitPeriod', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    await makeIncome(period.id, 1000);
    await commitPeriod(period.id);
    const status = await getRunStatus(period.id);
    expect(status.committed).toBe(true);
  });
});

describe('materializeRecurring', () => {
  useTestDb();

  it('creates one period_income row per active "in" recurring entry', async () => {
    await createRecurringEntry({ name: 'משכורת', direction: 'in', defaultAmount: 10000 });
    const period = await makePeriod({ year: 2026, month: 1 });

    const result = await materializeRecurring(period.id, 2026, 1);
    expect(result).toEqual({ incomesAdded: 1, expensesAdded: 0 });

    const incomes = await getDb().select('SELECT * FROM period_incomes WHERE period_id = ?', [period.id]);
    expect(incomes).toHaveLength(1);
  });

  it('creates a manual outflow transaction on the correct day for "out" entries, clamped to month length', async () => {
    const groceries = await findCategory('groceries');
    await createRecurringEntry({
      name: 'שכירות',
      direction: 'out',
      defaultAmount: 5000,
      categoryId: groceries.id,
      dayOfMonth: 31,
    });
    const period = await makePeriod({ year: 2026, month: 2 }); // Feb has 28 days in 2026

    const result = await materializeRecurring(period.id, 2026, 2);
    expect(result).toEqual({ incomesAdded: 0, expensesAdded: 1 });

    const [tx] = await getDb().select<{ transaction_date: string; amount: number }>(
      'SELECT transaction_date, amount FROM transactions WHERE period_id = ?',
      [period.id],
    );
    expect(tx.transaction_date).toBe('2026-02-28');
    expect(tx.amount).toBe(5000);
  });

  it('is idempotent: running twice does not duplicate incomes or expenses', async () => {
    await createRecurringEntry({ name: 'משכורת', direction: 'in', defaultAmount: 10000 });
    await createRecurringEntry({ name: 'שכירות', direction: 'out', defaultAmount: 5000, dayOfMonth: 1 });
    const period = await makePeriod({ year: 2026, month: 1 });

    await materializeRecurring(period.id, 2026, 1);
    const second = await materializeRecurring(period.id, 2026, 1);

    expect(second).toEqual({ incomesAdded: 0, expensesAdded: 0 });
    expect(await getDb().select('SELECT * FROM period_incomes WHERE period_id = ?', [period.id])).toHaveLength(1);
    expect(await getDb().select('SELECT * FROM transactions WHERE period_id = ?', [period.id])).toHaveLength(1);
  });

  it('returns zero counts when there are no active recurring entries', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    expect(await materializeRecurring(period.id, 2026, 1)).toEqual({ incomesAdded: 0, expensesAdded: 0 });
  });
});

describe('listManualOutflows', () => {
  useTestDb();

  it('returns only manual, outflow transactions for the period, ordered by date', async () => {
    const groceries = await findCategory('groceries');
    const period = await makePeriod({ year: 2026, month: 1 });
    await makeTransaction({ periodId: period.id, amount: 300, categoryId: groceries.id, date: '2026-01-10' });
    await makeTransaction({ periodId: period.id, amount: 100, categoryId: groceries.id, date: '2026-01-02' });

    // an imported (non-manual) row should be excluded
    const accountId = await makeManualAccount();
    await getDb().execute(
      `INSERT INTO transactions
         (id, period_id, account_id, entry_mode, direction, transaction_date, debit_date, amount,
          raw_description, category_id, wallet, is_reviewed, dedupe_hash, created_at, updated_at)
       VALUES ('tx-imported', ?, ?, 'imported', 'out', '2026-01-05',
               '2026-01-05', 400, 'y', ?, 'joint', 1, 'h2', datetime('now'), datetime('now'))`,
      [period.id, accountId, groceries.id],
    );

    const rows = await listManualOutflows(period.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.transaction_date)).toEqual(['2026-01-02', '2026-01-10']);
    expect(rows[0].category_name).toBeTruthy();
  });
});
