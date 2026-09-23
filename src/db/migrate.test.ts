import { describe, expect, it } from 'vitest';
import { nowIso, uuid } from '@/lib/utils';
import { getDb } from './index';
import { MemorySqlDriver } from './testDriver';
import { runMigrations } from './migrate';
import { migrations } from './migrations';
import { DEFAULT_CATEGORIES, seedCategories } from './seed';
import { useTestDb } from '@/test/harness';

describe('runMigrations', () => {
  it('applies all four migrations to a fresh database', async () => {
    const driver = new MemorySqlDriver();
    await driver.open();
    const applied = await runMigrations(driver);
    expect(applied).toEqual([1, 2, 3, 4]);

    const rows = await driver.select<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4]);
    await driver.close();
  });

  it('is idempotent — running twice applies nothing the second time', async () => {
    const driver = new MemorySqlDriver();
    await driver.open();
    await runMigrations(driver);
    const second = await runMigrations(driver);
    expect(second).toEqual([]);
    await driver.close();
  });
});

describe('seedCategories', () => {
  useTestDb();

  it('yields exactly the 17 expected default categories', async () => {
    const rows = await getDb().select<{ slug: string }>('SELECT slug FROM categories');
    expect(rows).toHaveLength(17);
    expect(rows.map((r) => r.slug).sort()).toEqual([...DEFAULT_CATEGORIES.map((c) => c.slug)].sort());
  });

  it('is idempotent', async () => {
    await seedCategories(getDb());
    const rows = await getDb().select('SELECT slug FROM categories');
    expect(rows).toHaveLength(17);
  });
});

describe('schema CHECK constraints', () => {
  useTestDb();

  it('rejects a joint_buffer wallet carrying a person_id', async () => {
    await expect(
      getDb().execute(
        `INSERT INTO wallets (id, kind, person_id, name, opening_balance, created_at, updated_at)
         VALUES (?, 'joint_buffer', ?, 'bad', 0, ?, ?)`,
        [uuid(), uuid(), nowIso(), nowIso()],
      ),
    ).rejects.toThrow();
  });

  it('rejects a personal wallet with no person_id', async () => {
    await expect(
      getDb().execute(
        `INSERT INTO wallets (id, kind, person_id, name, opening_balance, created_at, updated_at)
         VALUES (?, 'personal', NULL, 'bad', 0, ?, ?)`,
        [uuid(), nowIso(), nowIso()],
      ),
    ).rejects.toThrow();
  });

  it('rejects a budget_periods month outside 1..12', async () => {
    await expect(
      getDb().execute(
        `INSERT INTO budget_periods (id, year, month, status, created_at, updated_at)
         VALUES (?, 2026, 13, 'draft', ?, ?)`,
        [uuid(), nowIso(), nowIso()],
      ),
    ).rejects.toThrow();
  });

  it('rejects a wallet_transfers row where from equals to', async () => {
    const ts = nowIso();
    const periodId = uuid();
    const walletId = uuid();
    await getDb().execute(
      `INSERT INTO budget_periods (id, year, month, status, created_at, updated_at) VALUES (?, 2026, 1, 'draft', ?, ?)`,
      [periodId, ts, ts],
    );
    await getDb().execute(
      `INSERT INTO wallets (id, kind, person_id, name, opening_balance, created_at, updated_at)
       VALUES (?, 'joint_buffer', NULL, 'w', 0, ?, ?)`,
      [walletId, ts, ts],
    );
    await expect(
      getDb().execute(
        `INSERT INTO wallet_transfers (id, period_id, from_wallet_id, to_wallet_id, amount, created_at)
         VALUES (?, ?, ?, ?, 100, ?)`,
        [uuid(), periodId, walletId, walletId, ts],
      ),
    ).rejects.toThrow();
  });

  it('rejects a wallet_transfers row with a non-positive amount', async () => {
    const ts = nowIso();
    const periodId = uuid();
    const fromId = uuid();
    const toId = uuid();
    await getDb().execute(
      `INSERT INTO budget_periods (id, year, month, status, created_at, updated_at) VALUES (?, 2026, 1, 'draft', ?, ?)`,
      [periodId, ts, ts],
    );
    await getDb().execute(
      `INSERT INTO wallets (id, kind, person_id, name, opening_balance, created_at, updated_at)
       VALUES (?, 'joint_buffer', NULL, 'w1', 0, ?, ?)`,
      [fromId, ts, ts],
    );
    await getDb().execute(
      `INSERT INTO wallets (id, kind, person_id, name, opening_balance, created_at, updated_at)
       VALUES (?, 'savings', NULL, 'w2', 0, ?, ?)`,
      [toId, ts, ts],
    );
    await expect(
      getDb().execute(
        `INSERT INTO wallet_transfers (id, period_id, from_wallet_id, to_wallet_id, amount, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
        [uuid(), periodId, fromId, toId, ts],
      ),
    ).rejects.toThrow();
  });

  it('rejects a personal-wallet transaction with no personal_person_id', async () => {
    const ts = nowIso();
    const accountId = uuid();
    await getDb().execute(
      `INSERT INTO accounts (id, display_name, issuer, type, is_active, sort_order, created_at, updated_at)
       VALUES (?, 'acc', 'other', 'cash', 1, 0, ?, ?)`,
      [accountId, ts, ts],
    );
    const txId = uuid();
    await expect(
      getDb().execute(
        `INSERT INTO transactions
           (id, account_id, entry_mode, direction, transaction_date, debit_date, amount,
            raw_description, wallet, dedupe_hash, created_at, updated_at)
         VALUES (?, ?, 'manual', 'out', '2026-01-05', '2026-01-05', 100, 'x', 'personal', ?, ?, ?)`,
        [txId, accountId, `manual:${txId}`, ts, ts],
      ),
    ).rejects.toThrow();
  });
});

describe('unique indexes', () => {
  useTestDb();

  it('allows only one joint_buffer wallet', async () => {
    const ts = nowIso();
    await getDb().execute(
      `INSERT INTO wallets (id, kind, person_id, name, opening_balance, created_at, updated_at)
       VALUES (?, 'joint_buffer', NULL, 'w1', 0, ?, ?)`,
      [uuid(), ts, ts],
    );
    await expect(
      getDb().execute(
        `INSERT INTO wallets (id, kind, person_id, name, opening_balance, created_at, updated_at)
         VALUES (?, 'joint_buffer', NULL, 'w2', 0, ?, ?)`,
        [uuid(), ts, ts],
      ),
    ).rejects.toThrow();
  });

  it('allows only one personal wallet per person', async () => {
    const ts = nowIso();
    const personId = uuid();
    await getDb().execute(
      `INSERT INTO people (id, name, color, sort_order, created_at, updated_at) VALUES (?, 'p', 'omer', 0, ?, ?)`,
      [personId, ts, ts],
    );
    await getDb().execute(
      `INSERT INTO wallets (id, kind, person_id, name, opening_balance, created_at, updated_at)
       VALUES (?, 'personal', ?, 'w1', 0, ?, ?)`,
      [uuid(), personId, ts, ts],
    );
    await expect(
      getDb().execute(
        `INSERT INTO wallets (id, kind, person_id, name, opening_balance, created_at, updated_at)
         VALUES (?, 'personal', ?, 'w2', 0, ?, ?)`,
        [uuid(), personId, ts, ts],
      ),
    ).rejects.toThrow();
  });

  it('allows only one budget_line per (period, category)', async () => {
    const ts = nowIso();
    const periodId = uuid();
    const categoryId = (await getDb().select<{ id: string }>('SELECT id FROM categories LIMIT 1'))[0].id;
    await getDb().execute(
      `INSERT INTO budget_periods (id, year, month, status, created_at, updated_at) VALUES (?, 2026, 1, 'draft', ?, ?)`,
      [periodId, ts, ts],
    );
    await getDb().execute(
      `INSERT INTO budget_lines (id, period_id, category_id, planned_amount, created_at, updated_at)
       VALUES (?, ?, ?, 100, ?, ?)`,
      [uuid(), periodId, categoryId, ts, ts],
    );
    await expect(
      getDb().execute(
        `INSERT INTO budget_lines (id, period_id, category_id, planned_amount, created_at, updated_at)
         VALUES (?, ?, ?, 200, ?, ?)`,
        [uuid(), periodId, categoryId, ts, ts],
      ),
    ).rejects.toThrow();
  });

  it('allows only one transaction per dedupe_hash', async () => {
    const ts = nowIso();
    const accountId = uuid();
    await getDb().execute(
      `INSERT INTO accounts (id, display_name, issuer, type, is_active, sort_order, created_at, updated_at)
       VALUES (?, 'acc', 'other', 'cash', 1, 0, ?, ?)`,
      [accountId, ts, ts],
    );
    const insert = (id: string) =>
      getDb().execute(
        `INSERT INTO transactions
           (id, account_id, entry_mode, direction, transaction_date, debit_date, amount,
            raw_description, wallet, dedupe_hash, created_at, updated_at)
         VALUES (?, ?, 'manual', 'out', '2026-01-05', '2026-01-05', 100, 'x', 'joint', 'same-hash', ?, ?)`,
        [id, accountId, ts, ts],
      );
    await insert(uuid());
    await expect(insert(uuid())).rejects.toThrow();
  });
});

describe('consolidate_categories migration (v4)', () => {
  it('remaps referencing rows and archives merged categories without deleting them', async () => {
    const driver = new MemorySqlDriver();
    await driver.open();

    // Apply only v1 (schema), as if this were an existing install about to be upgraded.
    const v1 = migrations.find((m) => m.version === 1)!;
    const ts = nowIso();
    await driver.execute(
      `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`,
    );
    await driver.batch([
      ...v1.statements.map((sql) => ({ sql })),
      {
        sql: 'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        params: [1, v1.name, ts],
      },
    ]);

    // Seed a slice of the old (pre-consolidation) category set directly.
    const rent = { id: uuid(), slug: 'rent' };
    const mortgage = { id: uuid(), slug: 'mortgage' };
    const otherIncome = { id: uuid(), slug: 'other-income' };
    const refund = { id: uuid(), slug: 'refund' };
    for (const c of [rent, mortgage, otherIncome, refund]) {
      await driver.execute(
        `INSERT INTO categories (id, slug, name, kind, sort_order, is_system, created_at, updated_at)
         VALUES (?, ?, ?, 'fixed', 0, 0, ?, ?)`,
        [c.id, c.slug, c.slug, ts, ts],
      );
    }

    const personId = uuid();
    await driver.execute(
      `INSERT INTO people (id, name, color, sort_order, created_at, updated_at) VALUES (?, 'x', 'omer', 0, ?, ?)`,
      [personId, ts, ts],
    );
    const accountId = uuid();
    await driver.execute(
      `INSERT INTO accounts (id, display_name, issuer, type, is_active, sort_order, created_at, updated_at)
       VALUES (?, 'acc', 'other', 'cash', 1, 0, ?, ?)`,
      [accountId, ts, ts],
    );
    const periodId = uuid();
    await driver.execute(
      `INSERT INTO budget_periods (id, year, month, status, created_at, updated_at) VALUES (?, 2026, 1, 'draft', ?, ?)`,
      [periodId, ts, ts],
    );

    // Budget lines for both merge partners in the same period — amounts must fold together.
    await driver.execute(
      `INSERT INTO budget_lines (id, period_id, category_id, planned_amount, created_at, updated_at)
       VALUES (?, ?, ?, 1000, ?, ?)`,
      [uuid(), periodId, rent.id, ts, ts],
    );
    await driver.execute(
      `INSERT INTO budget_lines (id, period_id, category_id, planned_amount, created_at, updated_at)
       VALUES (?, ?, ?, 500, ?, ?)`,
      [uuid(), periodId, mortgage.id, ts, ts],
    );

    const txId = uuid();
    await driver.execute(
      `INSERT INTO transactions
         (id, period_id, account_id, entry_mode, direction, transaction_date, debit_date, amount,
          raw_description, category_id, wallet, dedupe_hash, created_at, updated_at)
       VALUES (?, ?, ?, 'manual', 'out', '2026-01-05', '2026-01-05', 100, 'x', ?, 'joint', ?, ?, ?)`,
      [txId, periodId, accountId, mortgage.id, `manual:${txId}`, ts, ts],
    );

    const merchantId = uuid();
    await driver.execute(
      `INSERT INTO merchants (id, normalized_name, display_name, default_category_id, times_seen, created_at, updated_at)
       VALUES (?, 'm', 'M', ?, 0, ?, ?)`,
      [merchantId, refund.id, ts, ts],
    );

    const ruleId = uuid();
    await driver.execute(
      `INSERT INTO merchant_rules (id, match_type, pattern, priority, category_id, is_enabled, source, created_at, updated_at)
       VALUES (?, 'exact', 'x', 100, ?, 1, 'user', ?, ?)`,
      [ruleId, refund.id, ts, ts],
    );

    const recId = uuid();
    await driver.execute(
      `INSERT INTO recurring_entries (id, name, direction, category_id, default_amount, is_active, sort_order, created_at, updated_at)
       VALUES (?, 'r', 'out', ?, 0, 1, 0, ?, ?)`,
      [recId, mortgage.id, ts, ts],
    );

    const applied = await runMigrations(driver);
    expect(applied).toEqual([2, 3, 4]);

    const rentLine = (
      await driver.select<{ planned_amount: number }>('SELECT planned_amount FROM budget_lines WHERE category_id = ?', [
        rent.id,
      ])
    )[0];
    expect(rentLine.planned_amount).toBe(1500);

    const mortgageLines = await driver.select('SELECT * FROM budget_lines WHERE category_id = ?', [mortgage.id]);
    expect(mortgageLines).toHaveLength(0);

    const tx = (
      await driver.select<{ category_id: string }>('SELECT category_id FROM transactions WHERE id = ?', [txId])
    )[0];
    expect(tx.category_id).toBe(rent.id);

    const merchant = (
      await driver.select<{ default_category_id: string }>(
        'SELECT default_category_id FROM merchants WHERE id = ?',
        [merchantId],
      )
    )[0];
    expect(merchant.default_category_id).toBe(otherIncome.id);

    const rule = (
      await driver.select<{ category_id: string }>('SELECT category_id FROM merchant_rules WHERE id = ?', [ruleId])
    )[0];
    expect(rule.category_id).toBe(otherIncome.id);

    const rec = (
      await driver.select<{ category_id: string }>('SELECT category_id FROM recurring_entries WHERE id = ?', [recId])
    )[0];
    expect(rec.category_id).toBe(rent.id);

    const mortgageCat = (
      await driver.select<{ is_archived: number }>('SELECT is_archived FROM categories WHERE id = ?', [mortgage.id])
    )[0];
    expect(mortgageCat.is_archived).toBe(1);

    const refundCat = (
      await driver.select<{ is_archived: number }>('SELECT is_archived FROM categories WHERE id = ?', [refund.id])
    )[0];
    expect(refundCat.is_archived).toBe(1);

    await driver.close();
  });
});
