import { describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import { availableToAssign, setAllowance, setBudgetLine } from '@/data/budget';
import { archiveCategory, createCategory } from '@/data/categories';
import { loadActuals, recomputeFrom } from '@/data/periodEngine';
import { findCategory, makeIncome, makeManualAccount, makePeriod, makeTransaction, seedHousehold } from '@/test/factories';
import { useTestDb } from '@/test/harness';

describe('degenerate inputs', () => {
  useTestDb();

  it('recomputeFrom on a period with no people, wallets, income, or transactions returns an all-zero result without throwing', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const result = await recomputeFrom(period.id);
    expect(result.joint).toEqual({ opening: 0, inflow: 0, outflow: 0, delta: 0, closing: 0 });
    expect(result.savings).toEqual({ opening: 0, inflow: 0, outflow: 0, delta: 0, closing: 0 });
    expect(result.personal).toEqual({});
    expect(result.shortfall).toBe(0);
  });

  it('loadActuals on an empty period returns all-zero totals', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const actuals = await loadActuals(period.id);
    expect(actuals).toEqual({
      income: 0,
      fixed: 0,
      jointFlexible: 0,
      savingsFunded: 0,
      savingsContribution: 0,
      uncategorized: 0,
      personalSpent: {},
      byCategory: {},
    });
  });
});

describe('over-allocation boundary', () => {
  useTestDb();

  it('is exactly zero left at the boundary, and exactly -1 one agora over', async () => {
    await seedHousehold({ jointBufferOpening: 0 });
    const rent = await findCategory('rent');
    const period = await makePeriod({ year: 2026, month: 1 });
    await makeIncome(period.id, 1000);
    await setBudgetLine(period.id, rent.id, 1000);

    let available = await availableToAssign(period.id);
    expect(available.pool).toBe(1000);
    expect(available.assigned).toBe(1000);
    expect(available.left).toBe(0);

    await setBudgetLine(period.id, rent.id, 1001);
    available = await availableToAssign(period.id);
    expect(available.left).toBe(-1);
  });

  it('an allowance alone can push a period over-allocated with no budget lines at all', async () => {
    const { people } = await seedHousehold({ jointBufferOpening: 0 });
    const period = await makePeriod({ year: 2026, month: 1 });
    await makeIncome(period.id, 500);
    await setAllowance(period.id, people[0].id, 600);

    const available = await availableToAssign(period.id);
    expect(available.left).toBe(-100);
  });
});

describe('batch() rollback on failure', () => {
  useTestDb();

  it('rolls back every statement in the batch when one of them fails', async () => {
    const db = getDb();
    const okId = uuid();
    const ts = nowIso();

    await expect(
      db.batch([
        {
          sql: `INSERT INTO categories (id, slug, name, kind, sort_order, created_at, updated_at)
                VALUES (?, 'rollback-test', 'טסט', 'flexible', 999, ?, ?)`,
          params: [okId, ts, ts],
        },
        // Second statement violates the categories.kind CHECK constraint.
        {
          sql: `INSERT INTO categories (id, slug, name, kind, sort_order, created_at, updated_at)
                VALUES (?, 'rollback-test-2', 'טסט 2', 'not-a-real-kind', 999, ?, ?)`,
          params: [uuid(), ts, ts],
        },
      ]),
    ).rejects.toThrow();

    const rows = await db.select('SELECT * FROM categories WHERE id = ?', [okId]);
    expect(rows).toHaveLength(0); // the first, valid insert must not have survived either
  });
});

describe('category archival while referenced', () => {
  useTestDb();

  it('archiving a category leaves existing budget lines and transactions intact and still resolvable', async () => {
    const categoryId = await createCategory('קטגוריה זמנית', 'flexible', 'temp-category');
    const period = await makePeriod({ year: 2026, month: 1 });
    await setBudgetLine(period.id, categoryId, 10000);
    await makeTransaction({ periodId: period.id, amount: 4000, categoryId, wallet: 'joint' });

    await archiveCategory(categoryId);

    const categories = await getDb().select<{ slug: string }>('SELECT slug FROM categories WHERE is_archived = 0');
    expect(categories.some((c) => c.slug === 'temp-category')).toBe(false);

    // The historical rows still reference the archived category by id and remain queryable.
    const [budgetLine] = await getDb().select<{ planned_amount: number }>(
      'SELECT planned_amount FROM budget_lines WHERE period_id = ? AND category_id = ?',
      [period.id, categoryId],
    );
    expect(budgetLine.planned_amount).toBe(10000);

    const actuals = await loadActuals(period.id);
    expect(actuals.byCategory[categoryId]).toBe(4000);
    expect(actuals.jointFlexible).toBe(4000);
  });
});

describe('personal wallet with no allowance', () => {
  useTestDb();

  it('goes negative when the person spends without ever being funded', async () => {
    const { people } = await seedHousehold();
    const groceries = await findCategory('groceries');
    const period = await makePeriod({ year: 2026, month: 1 });
    await makeManualAccount();
    await makeTransaction({
      periodId: period.id,
      amount: 5000,
      categoryId: groceries.id,
      wallet: 'personal',
      personId: people[0].id,
    });

    const result = await recomputeFrom(period.id);
    expect(result.personal[people[0].id].closing).toBe(-5000);
    expect(result.personal[people[1].id].closing).toBe(0);
  });
});

describe('money edge cases at the DB layer', () => {
  useTestDb();

  it('accepts a zero-amount manual transaction (a $0 charge, e.g. a declined/refunded auth)', async () => {
    const groceries = await findCategory('groceries');
    const period = await makePeriod({ year: 2026, month: 1 });
    await makeManualAccount();
    const id = await makeTransaction({ periodId: period.id, amount: 0, categoryId: groceries.id });
    expect(id).toBeTruthy();
    const actuals = await loadActuals(period.id);
    expect(actuals.jointFlexible).toBe(0);
  });

  it('rejects a negative amount at the CHECK constraint (amount >= 0)', async () => {
    const groceries = await findCategory('groceries');
    const period = await makePeriod({ year: 2026, month: 1 });
    const accountId = await makeManualAccount();
    await expect(
      getDb().execute(
        `INSERT INTO transactions
           (id, period_id, account_id, entry_mode, direction, transaction_date, debit_date, amount,
            raw_description, category_id, wallet, dedupe_hash, created_at, updated_at)
         VALUES (?, ?, ?, 'manual', 'out', '2026-01-01', '2026-01-01', -100, 'x', ?, 'joint', 'neg-1', datetime('now'), datetime('now'))`,
        [uuid(), period.id, accountId, groceries.id],
      ),
    ).rejects.toThrow();
  });

  it('handles a very large transaction amount (> 2^31 agorot) without overflow or precision loss', async () => {
    await seedHousehold({ jointBufferOpening: 0 });
    const groceries = await findCategory('groceries');
    const period = await makePeriod({ year: 2026, month: 1 });
    await makeManualAccount();
    const huge = 3_000_000_000;
    await makeTransaction({ periodId: period.id, amount: huge, categoryId: groceries.id });

    const actuals = await loadActuals(period.id);
    expect(actuals.jointFlexible).toBe(huge);

    const result = await recomputeFrom(period.id);
    expect(result.joint.closing).toBe(-huge);
  });
});
