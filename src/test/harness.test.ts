import { describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { useTestDb } from './harness';
import { seedHousehold, makePeriod, makeIncome, findCategory, makeTransaction } from './factories';

describe('test harness', () => {
  useTestDb();

  it('runs all migrations and seeds the default categories', async () => {
    const versions = await getDb().select<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4]);

    const categories = await getDb().select<{ slug: string }>('SELECT slug FROM categories');
    expect(categories.length).toBe(17);
  });

  it('gives every test a clean database', async () => {
    const rows = await getDb().select('SELECT * FROM people');
    expect(rows).toHaveLength(0);
  });

  it('supports the standard household + period + income + transaction factories', async () => {
    const { people, wallets } = await seedHousehold();
    expect(people).toHaveLength(2);
    expect(wallets.map((w) => w.kind).sort()).toEqual(['joint_buffer', 'personal', 'personal', 'savings']);

    const period = await makePeriod({ year: 2026, month: 1 });
    await makeIncome(period.id, 1_000_000);

    const groceries = await findCategory('groceries');
    await makeTransaction({ periodId: period.id, amount: 5_000, categoryId: groceries.id });

    const incomeRows = await getDb().select<{ total: number }>(
      'SELECT SUM(amount) AS total FROM period_incomes WHERE period_id = ?',
      [period.id],
    );
    expect(incomeRows[0].total).toBe(1_000_000);

    const txRows = await getDb().select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM transactions WHERE period_id = ?',
      [period.id],
    );
    expect(txRows[0].n).toBe(1);
  });

  it('enforces schema CHECK constraints via foreign_keys/pragma-backed SQLite', async () => {
    await expect(
      getDb().execute(
        `INSERT INTO wallets (id, kind, person_id, name, opening_balance, created_at, updated_at)
         VALUES ('x', 'joint_buffer', 'should-be-null', 'bad', 0, 'now', 'now')`,
      ),
    ).rejects.toThrow();
  });
});
