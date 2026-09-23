import { describe, expect, it } from 'vitest';
import { useTestDb } from '@/test/harness';
import {
  findCategory,
  makeIncome,
  makePeriod,
  makeTransaction,
  seedHousehold,
} from '@/test/factories';
import { listBudgetLines, reconcilePeriod, seedPlanFromActuals, setBudgetLine } from './budget';
import { loadActuals, recomputeFrom } from './periodEngine';

describe('loadActuals bucketing', () => {
  useTestDb();

  it('nets a refund back against the category that paid', async () => {
    await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    const groceries = await findCategory('groceries');

    await makeTransaction({ periodId: period.id, amount: 50_000, categoryId: groceries.id });
    await makeTransaction({
      periodId: period.id,
      amount: 12_000,
      categoryId: groceries.id,
      direction: 'in',
      description: 'זיכוי',
    });

    const actuals = await loadActuals(period.id);
    expect(actuals.jointFlexible).toBe(38_000);
    expect(actuals.byCategory[groceries.id]).toBe(38_000);
  });

  it('never counts a salary deposit on top of the manually entered income', async () => {
    await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    const salary = await findCategory('salary');
    await makeIncome(period.id, 2_790_700);
    await makeTransaction({
      periodId: period.id,
      amount: 2_790_700,
      categoryId: salary.id,
      direction: 'in',
      description: 'משכורת',
    });

    const actuals = await loadActuals(period.id);
    expect(actuals.income).toBe(2_790_700);
    expect(actuals.jointFlexible).toBe(0);
  });

  it('ignores internal transfers in both directions', async () => {
    await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    const transfer = await findCategory('transfer');

    await makeTransaction({ periodId: period.id, amount: 100_000, categoryId: transfer.id });
    await makeTransaction({
      periodId: period.id,
      amount: 100_000,
      categoryId: transfer.id,
      direction: 'in',
      description: 'העברה נכנסת',
    });

    const actuals = await loadActuals(period.id);
    expect(actuals.jointFlexible).toBe(0);
    expect(actuals.fixed).toBe(0);
    expect(actuals.byCategory[transfer.id] ?? 0).toBe(0);
  });

  it('books a savings deposit as a contribution rather than flexible spending', async () => {
    await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    const savings = await findCategory('savings-contribution');

    await makeTransaction({ periodId: period.id, amount: 200_000, categoryId: savings.id });

    const actuals = await loadActuals(period.id);
    expect(actuals.savingsContribution).toBe(200_000);
    expect(actuals.jointFlexible).toBe(0);
  });

  it('charges the joint pot once when the savings deposit is also planned', async () => {
    await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    const savings = await findCategory('savings-contribution');
    await makeIncome(period.id, 1_000_000);
    await setBudgetLine(period.id, savings.id, 200_000);
    await makeTransaction({ periodId: period.id, amount: 200_000, categoryId: savings.id });

    const result = await recomputeFrom(period.id);
    expect(result.joint.closing).toBe(800_000);
    expect(result.savings.closing).toBe(200_000);
  });

  it('flags joint spending that has no category at all', async () => {
    await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    await makeTransaction({ periodId: period.id, amount: 30_000, categoryId: null });

    const actuals = await loadActuals(period.id);
    expect(actuals.uncategorized).toBe(30_000);
    expect(actuals.jointFlexible).toBe(30_000);
  });
});

describe('seedPlanFromActuals', () => {
  useTestDb();

  it('fills empty lines from what was actually spent', async () => {
    await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    const rent = await findCategory('rent');

    await makeTransaction({ periodId: period.id, amount: 520_000, categoryId: rent.id });
    await seedPlanFromActuals(period.id);

    const lines = await listBudgetLines(period.id);
    expect(lines.find((l) => l.category_id === rent.id)?.planned_amount).toBe(520_000);
  });

  it('leaves a line the user already set alone', async () => {
    await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    const rent = await findCategory('rent');

    await setBudgetLine(period.id, rent.id, 600_000);
    await makeTransaction({ periodId: period.id, amount: 520_000, categoryId: rent.id });
    await seedPlanFromActuals(period.id);

    const lines = await listBudgetLines(period.id);
    expect(lines.find((l) => l.category_id === rent.id)?.planned_amount).toBe(600_000);
  });

  it('is idempotent', async () => {
    await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    const rent = await findCategory('rent');

    await makeTransaction({ periodId: period.id, amount: 520_000, categoryId: rent.id });
    await seedPlanFromActuals(period.id);
    await seedPlanFromActuals(period.id);

    const lines = await listBudgetLines(period.id);
    expect(lines.filter((l) => l.category_id === rent.id)).toHaveLength(1);
    expect(lines.find((l) => l.category_id === rent.id)?.planned_amount).toBe(520_000);
  });

  it('balances a category whose refund exceeded its spend', async () => {
    await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    const groceries = await findCategory('groceries');

    await makeIncome(period.id, 1_000_000);
    await makeTransaction({ periodId: period.id, amount: 10_000, categoryId: groceries.id });
    await makeTransaction({
      periodId: period.id,
      amount: 25_000,
      categoryId: groceries.id,
      direction: 'in',
      description: 'זיכוי גדול',
    });
    await seedPlanFromActuals(period.id);
    await recomputeFrom(period.id);

    const lines = await listBudgetLines(period.id);
    expect(lines.find((l) => l.category_id === groceries.id)?.planned_amount).toBe(-15_000);

    // Without a negative plan line the remainder could never be cleared.
    const after = await reconcilePeriod(period.id);
    expect(after.unassignedActual).toBe(0);
    expect(after.balanced).toBe(true);
  });
});

describe('reconcilePeriod', () => {
  useTestDb();

  it('reports the unassigned actuals that made שיוך look untouched', async () => {
    await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    const rent = await findCategory('rent');
    const groceries = await findCategory('groceries');

    await makeIncome(period.id, 2_790_700);
    await makeTransaction({ periodId: period.id, amount: 520_000, categoryId: rent.id });
    await makeTransaction({ periodId: period.id, amount: 1_333_500, categoryId: groceries.id });
    await recomputeFrom(period.id);

    const before = await reconcilePeriod(period.id);
    expect(before.left).toBe(2_790_700);
    expect(before.jointClosing).toBe(937_200);
    expect(before.unassignedActual).toBe(1_853_500);
    expect(before.balanced).toBe(false);
  });

  it('meets the joint closing balance once the plan is filled from actuals', async () => {
    await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    const rent = await findCategory('rent');
    const groceries = await findCategory('groceries');

    await makeIncome(period.id, 2_790_700);
    await makeTransaction({ periodId: period.id, amount: 520_000, categoryId: rent.id });
    await makeTransaction({ periodId: period.id, amount: 1_333_500, categoryId: groceries.id });
    await seedPlanFromActuals(period.id);
    await recomputeFrom(period.id);

    const after = await reconcilePeriod(period.id);
    expect(after.unassignedActual).toBe(0);
    expect(after.balanced).toBe(true);
    expect(after.left).toBe(after.jointClosing);
    expect(after.left).toBe(937_200);
  });
});
