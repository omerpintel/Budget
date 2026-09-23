import { describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import { useTestDb } from '@/test/harness';
import { findCategory, makePeriod, makeTransaction, seedHousehold } from '@/test/factories';
import {
  addIncome,
  averageSpendByCategory,
  availableToAssign,
  listAllocationLines,
  listBudgetLines,
  listIncomes,
  listPersonalBudgets,
  removeIncome,
  seedPlanFromPrevious,
  setAllowance,
  setBudgetLine,
  setBudgetLines,
  updateIncome,
} from './budget';

describe('budget lines', () => {
  useTestDb();

  it('setBudgetLine inserts then updates on conflict (upsert)', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const groceries = await findCategory('groceries');

    await setBudgetLine(period.id, groceries.id, 1000);
    await setBudgetLine(period.id, groceries.id, 1500);

    const lines = await listBudgetLines(period.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].planned_amount).toBe(1500);
  });

  it('setBudgetLines writes a whole batch atomically', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const groceries = await findCategory('groceries');
    const rent = await findCategory('rent');

    await setBudgetLines(period.id, { [groceries.id]: 500, [rent.id]: 5000 });

    const lines = await listBudgetLines(period.id);
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.category_id === rent.id)?.planned_amount).toBe(5000);
  });

  it('setBudgetLines is a no-op for an empty object', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    await expect(setBudgetLines(period.id, {})).resolves.toBeUndefined();
    expect(await listBudgetLines(period.id)).toHaveLength(0);
  });

  it('listAllocationLines returns every spendable category, planned or not', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const groceries = await findCategory('groceries');
    await setBudgetLine(period.id, groceries.id, 500);

    const lines = await listAllocationLines(period.id);
    // fixed + flexible + savings kinds only, income/personal/transfer excluded
    expect(lines.every((l) => ['fixed', 'flexible', 'savings'].includes(l.kind))).toBe(true);
    const groceriesLine = lines.find((l) => l.category_id === groceries.id);
    expect(groceriesLine?.planned_amount).toBe(500);
    const rentLine = lines.find((l) => l.category_id !== groceries.id);
    expect(rentLine?.planned_amount).toBe(0);
  });
});

describe('income (period_incomes)', () => {
  useTestDb();

  it('adds, lists, updates and removes incomes', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    await addIncome({ periodId: period.id, personId: null, label: 'משכורת', amount: 10000 });

    const incomes = await listIncomes(period.id);
    expect(incomes).toHaveLength(1);
    expect(incomes[0].amount).toBe(10000);

    await updateIncome(incomes[0].id, 12000);
    expect((await listIncomes(period.id))[0].amount).toBe(12000);

    await removeIncome(incomes[0].id);
    expect(await listIncomes(period.id)).toHaveLength(0);
  });
});

describe('personal allowances', () => {
  useTestDb();

  it('setAllowance upserts per (period, person)', async () => {
    const { people } = await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });

    await setAllowance(period.id, people[0].id, 1000);
    await setAllowance(period.id, people[0].id, 1500);

    const rows = await listPersonalBudgets(period.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].allowance).toBe(1500);
  });
});

describe('availableToAssign', () => {
  useTestDb();

  it('pool = income + carryover from the joint wallet opening balance when there is no prior period', async () => {
    const ts = nowIso();
    await getDb().execute(
      `INSERT INTO wallets (id, kind, person_id, name, opening_balance, created_at, updated_at)
       VALUES (?, 'joint_buffer', NULL, 'joint', 2000, ?, ?)`,
      [uuid(), ts, ts],
    );
    const period = await makePeriod({ year: 2026, month: 1 });
    await addIncome({ periodId: period.id, personId: null, label: 'משכורת', amount: 8000 });

    const result = await availableToAssign(period.id);
    expect(result.income).toBe(8000);
    expect(result.carryover).toBe(2000);
    expect(result.pool).toBe(10000);
    expect(result.assigned).toBe(0);
    expect(result.left).toBe(10000);
  });

  it('carryover comes from the previous period\'s joint wallet_ledger.closing when one exists', async () => {
    const ts = nowIso();
    const jointId = uuid();
    await getDb().execute(
      `INSERT INTO wallets (id, kind, person_id, name, opening_balance, created_at, updated_at)
       VALUES (?, 'joint_buffer', NULL, 'joint', 999, ?, ?)`,
      [jointId, ts, ts],
    );
    const previousPeriod = await makePeriod({ year: 2025, month: 12 });
    await getDb().execute(
      `INSERT INTO wallet_ledger (id, period_id, wallet_id, opening, inflow, outflow, delta, closing, computed_at)
       VALUES (?, ?, ?, 0, 0, 0, 0, 3000, ?)`,
      [uuid(), previousPeriod.id, jointId, ts],
    );

    const period = await makePeriod({ year: 2026, month: 1 });
    const result = await availableToAssign(period.id);
    expect(result.carryover).toBe(3000);
  });

  it('assigned includes both budget lines and personal allowances; left goes negative when over-allocated', async () => {
    const { people } = await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    const groceries = await findCategory('groceries');

    await addIncome({ periodId: period.id, personId: null, label: 'משכורת', amount: 1000 });
    await setBudgetLine(period.id, groceries.id, 800);
    await setAllowance(period.id, people[0].id, 400);

    const result = await availableToAssign(period.id);
    expect(result.pool).toBe(1000);
    expect(result.assigned).toBe(1200);
    expect(result.left).toBe(-200);
  });

  it('throws for a period that does not exist', async () => {
    await expect(availableToAssign('nonexistent')).rejects.toThrow('Period not found');
  });
});

describe('averageSpendByCategory', () => {
  useTestDb();

  it('averages outflow per category across recent closed periods, excluding the current one', async () => {
    const groceries = await findCategory('groceries');
    const p1 = await makePeriod({ year: 2025, month: 11 });
    const p2 = await makePeriod({ year: 2025, month: 12 });
    const current = await makePeriod({ year: 2026, month: 1 });

    await makeTransaction({ periodId: p1.id, amount: 100, categoryId: groceries.id, date: '2025-11-10' });
    await makeTransaction({ periodId: p2.id, amount: 300, categoryId: groceries.id, date: '2025-12-10' });
    // A transaction in the current period must never leak into the average.
    await makeTransaction({ periodId: current.id, amount: 999999, categoryId: groceries.id, date: '2026-01-10' });

    const averages = await averageSpendByCategory(current.id, 3);
    expect(averages[groceries.id]).toBe(200);
  });

  it('excludes excluded transactions and income-direction rows', async () => {
    const groceries = await findCategory('groceries');
    const p1 = await makePeriod({ year: 2025, month: 12 });
    const current = await makePeriod({ year: 2026, month: 1 });

    const txId = await makeTransaction({ periodId: p1.id, amount: 500, categoryId: groceries.id, date: '2025-12-10' });
    await getDb().execute('UPDATE transactions SET is_excluded = 1 WHERE id = ?', [txId]);
    await makeTransaction({
      periodId: p1.id,
      amount: 999,
      categoryId: groceries.id,
      date: '2025-12-11',
      direction: 'in',
    });

    const averages = await averageSpendByCategory(current.id, 3);
    expect(averages[groceries.id]).toBeUndefined();
  });
});

describe('seedPlanFromPrevious', () => {
  useTestDb();

  it('copies budget lines and allowances forward from the immediately preceding period', async () => {
    const { people } = await seedHousehold();
    const groceries = await findCategory('groceries');
    const previous = await makePeriod({ year: 2025, month: 12 });
    await setBudgetLine(previous.id, groceries.id, 700);
    await setAllowance(previous.id, people[0].id, 300);

    const period = await makePeriod({ year: 2026, month: 1 });
    const count = await seedPlanFromPrevious(period.id);

    expect(count).toBe(2);
    const lines = await listBudgetLines(period.id);
    expect(lines[0].planned_amount).toBe(700);
    const allowances = await listPersonalBudgets(period.id);
    expect(allowances[0].allowance).toBe(300);
  });

  it('does not overwrite lines already set for the target period', async () => {
    const groceries = await findCategory('groceries');
    const previous = await makePeriod({ year: 2025, month: 12 });
    await setBudgetLine(previous.id, groceries.id, 700);

    const period = await makePeriod({ year: 2026, month: 1 });
    await setBudgetLine(period.id, groceries.id, 100);
    await seedPlanFromPrevious(period.id);

    const lines = await listBudgetLines(period.id);
    expect(lines.find((l) => l.category_id === groceries.id)?.planned_amount).toBe(100);
  });

  it('returns 0 when there is no previous period', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    expect(await seedPlanFromPrevious(period.id)).toBe(0);
  });

  it('returns 0 for a nonexistent period id', async () => {
    expect(await seedPlanFromPrevious('nonexistent')).toBe(0);
  });
});
