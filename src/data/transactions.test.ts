import { describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { useTestDb } from '@/test/harness';
import { findCategory, makePeriod, makeTransaction, seedHousehold } from '@/test/factories';
import { ensureManualAccount } from './accounts';
import { createManualTransaction, deleteTransaction, listTransactions, setExcluded } from './transactions';

describe('transactions', () => {
  useTestDb();

  it('creates a manual transaction and lists it', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const groceries = await findCategory('groceries');
    const accountId = await ensureManualAccount();

    const id = await createManualTransaction({
      accountId,
      periodId: period.id,
      date: '2026-01-10',
      description: 'שופרסל',
      amount: 250,
      direction: 'out',
      categoryId: groceries.id,
      wallet: 'joint',
      personId: null,
      note: null,
    });

    const rows = await listTransactions({ periodId: period.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].description).toBe('שופרסל');
    expect(rows[0].category_name).toBe(groceries.name);
  });

  it('masks personal wallet descriptions unless revealed', async () => {
    const { people } = await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    const accountId = await ensureManualAccount();

    await createManualTransaction({
      accountId,
      periodId: period.id,
      date: '2026-01-10',
      description: 'משהו פרטי',
      amount: 100,
      direction: 'out',
      categoryId: null,
      wallet: 'personal',
      personId: people[0].id,
      note: null,
    });

    const masked = await listTransactions({ periodId: period.id });
    expect(masked[0].description).toBe('הוצאה אישית');

    const revealed = await listTransactions({ periodId: period.id, reveal: true });
    expect(revealed[0].description).toBe('משהו פרטי');
  });

  it('rejects a personal transaction with no personal_person_id (CHECK constraint)', async () => {
    const accountId = await ensureManualAccount();
    await expect(
      createManualTransaction({
        accountId,
        periodId: null,
        date: '2026-01-10',
        description: 'x',
        amount: 100,
        direction: 'out',
        categoryId: null,
        wallet: 'personal',
        personId: null,
        note: null,
      }),
    ).rejects.toThrow();
  });

  it('filters to unreviewed only', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const accountId = await ensureManualAccount();
    const ts = new Date().toISOString();
    // createManualTransaction always marks entries as reviewed, so simulate an imported
    // (unreviewed) row directly to exercise the filter.
    await getDb().execute(
      `INSERT INTO transactions
         (id, period_id, account_id, entry_mode, direction, transaction_date, debit_date, amount,
          raw_description, wallet, is_reviewed, dedupe_hash, created_at, updated_at)
       VALUES ('imported-1', ?, ?, 'imported', 'out', '2026-01-05', '2026-01-05', 100, 'x', 'joint', 0, 'dedupe-1', ?, ?)`,
      [period.id, accountId, ts, ts],
    );
    const reviewedId = await makeTransaction({ periodId: period.id, amount: 200 });

    const rows = await listTransactions({ periodId: period.id, unreviewedOnly: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('imported-1');
    expect(rows[0].id).not.toBe(reviewedId);
  });

  it('deletes a transaction', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const id = await makeTransaction({ periodId: period.id, amount: 100 });
    await deleteTransaction(id);
    expect(await listTransactions({ periodId: period.id })).toHaveLength(0);
  });

  it('setExcluded toggles is_excluded', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const id = await makeTransaction({ periodId: period.id, amount: 100 });

    await setExcluded(id, true);
    let row = (await getDb().select<{ is_excluded: number }>('SELECT is_excluded FROM transactions WHERE id = ?', [id]))[0];
    expect(row.is_excluded).toBe(1);

    await setExcluded(id, false);
    row = (await getDb().select<{ is_excluded: number }>('SELECT is_excluded FROM transactions WHERE id = ?', [id]))[0];
    expect(row.is_excluded).toBe(0);
  });

  it('rejects two transactions with the same dedupe_hash', async () => {
    const accountId = await ensureManualAccount();
    const ts = new Date().toISOString();
    await getDb().execute(
      `INSERT INTO transactions
         (id, account_id, entry_mode, direction, transaction_date, debit_date, amount,
          raw_description, wallet, dedupe_hash, created_at, updated_at)
       VALUES ('t1', ?, 'manual', 'out', '2026-01-05', '2026-01-05', 100, 'x', 'joint', 'dup', ?, ?)`,
      [accountId, ts, ts],
    );
    await expect(
      getDb().execute(
        `INSERT INTO transactions
           (id, account_id, entry_mode, direction, transaction_date, debit_date, amount,
            raw_description, wallet, dedupe_hash, created_at, updated_at)
         VALUES ('t2', ?, 'manual', 'out', '2026-01-06', '2026-01-06', 100, 'y', 'joint', 'dup', ?, ?)`,
        [accountId, ts, ts],
      ),
    ).rejects.toThrow();
  });
});
