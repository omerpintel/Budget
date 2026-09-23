import { describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { availableToAssign, setAllowance, setBudgetLines } from './budget';
import { ensureManualAccount } from './accounts';
import { commitImport, deleteImportBatch, stageRows } from './imports';
import { loadTriage, commitDecision } from './triage';
import { commitPeriod, recomputeFrom, reopenPeriod } from './periodEngine';
import { getRunStatus } from './run';
import { deriveStep, FINAL_STEP } from './runModel';
import { getWalletByKind, getWalletBalances } from './wallets';
import { findCategory, makeIncome, makePeriod, seedHousehold } from '@/test/factories';
import { useTestDb } from '@/test/harness';
import type { ParsedRow } from '@/services/import/parseFile';

function row(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    rowIndex: 0,
    transactionDate: '2026-01-10',
    description: 'שופרסל',
    amount: 3000,
    direction: 'out',
    originalAmount: null,
    originalCurrency: null,
    installment: null,
    issuerCategory: null,
    notes: null,
    ...overrides,
  };
}

describe('onboarding is safe to run twice', () => {
  useTestDb();

  it('leaves no orphans: exactly the same people/wallet counts after a second run', async () => {
    await seedHousehold();
    await seedHousehold();

    const people = await getDb().select('SELECT * FROM people');
    const wallets = await getDb().select('SELECT * FROM wallets');
    expect(people).toHaveLength(2);
    expect(wallets).toHaveLength(4); // joint_buffer + savings + 2 personal
  });
});

describe('full monthly run', () => {
  useTestDb();

  it('advances the step wizard correctly at each stage and lands on correct wallet balances', async () => {
    const { people } = await seedHousehold({ jointBufferOpening: 0 });
    const groceries = await findCategory('groceries');
    const period = await makePeriod({ year: 2026, month: 1 });

    expect(deriveStep(await getRunStatus(period.id))).toBe(0); // no income yet

    await makeIncome(period.id, 100000);
    expect(deriveStep(await getRunStatus(period.id))).toBe(1); // no imports yet

    const accountId = await ensureManualAccount();
    const staged = await stageRows(accountId, [row({ amount: 3000 }), row({ rowIndex: 1, amount: 2000 })]);
    await commitImport({
      accountId,
      periodId: period.id,
      debitDate: '2026-01-10',
      fileName: 'jan.csv',
      fileHash: 'hash-jan',
      rows: staged,
      defaultCategoryId: null,
    });
    expect(deriveStep(await getRunStatus(period.id))).toBe(2); // unreviewed rows waiting

    const { queue } = await loadTriage(period.id, 0.8);
    for (const item of [...queue]) {
      await commitDecision(
        item,
        { categoryId: groceries.id, wallet: 'joint', personId: null, fundingWalletId: null, excluded: false },
        false,
      );
    }
    expect(deriveStep(await getRunStatus(period.id))).toBe(3); // ready to allocate

    await setBudgetLines(period.id, { [groceries.id]: 5000 });
    await setAllowance(period.id, people[0].id, 10000);
    expect((await getRunStatus(period.id)).overAllocated).toBe(false);

    const result = await commitPeriod(period.id);
    const status = await getRunStatus(period.id);
    expect(deriveStep(status)).toBe(FINAL_STEP);
    expect(status.committed).toBe(true);

    // income 100000 - spend 5000 - allowance 10000 = 85000
    expect(result.joint.closing).toBe(85000);
    const balances = await getWalletBalances();
    const joint = (await getWalletByKind('joint_buffer'))!;
    expect(balances.get(joint.id)).toBe(85000);
  });
});

describe('import → undo', () => {
  useTestDb();

  it('deleting an import batch and recomputing restores every wallet balance', async () => {
    await seedHousehold({ jointBufferOpening: 100000 });
    const period = await makePeriod({ year: 2026, month: 1 });
    await makeIncome(period.id, 50000);
    await recomputeFrom(period.id);

    const joint = (await getWalletByKind('joint_buffer'))!;
    const before = (await getWalletBalances()).get(joint.id);

    const accountId = await ensureManualAccount();
    const staged = await stageRows(accountId, [row({ amount: 3000 }), row({ rowIndex: 1, amount: 2000 })]);
    const { batchId } = await commitImport({
      accountId,
      periodId: period.id,
      debitDate: '2026-01-10',
      fileName: 'jan.csv',
      fileHash: 'hash-jan',
      rows: staged,
      defaultCategoryId: null,
    });
    await recomputeFrom(period.id);
    expect((await getWalletBalances()).get(joint.id)).toBe(before! - 5000);

    const targetPeriodId = await deleteImportBatch(batchId);
    expect(targetPeriodId).toBe(period.id);
    await recomputeFrom(period.id);

    expect((await getWalletBalances()).get(joint.id)).toBe(before);
    expect(await getDb().select('SELECT * FROM transactions WHERE import_batch_id = ?', [batchId])).toHaveLength(0);
  });
});

describe('two-month carryover via availableToAssign', () => {
  useTestDb();

  it('the second month opens with the first month’s locked-in surplus', async () => {
    await seedHousehold({ jointBufferOpening: 10000 });
    const jan = await makePeriod({ year: 2026, month: 1 });
    const feb = await makePeriod({ year: 2026, month: 2 });

    await makeIncome(jan.id, 100000);
    await recomputeFrom(jan.id); // establishes jan's wallet_ledger closing (110000)

    await makeIncome(feb.id, 50000);
    const available = await availableToAssign(feb.id);

    expect(available.income).toBe(50000);
    expect(available.carryover).toBe(110000);
    expect(available.pool).toBe(160000);
    expect(available.left).toBe(160000);
  });
});

describe('reopen a locked month, change the plan, re-lock', () => {
  useTestDb();

  it('later committed months recompute from the new numbers without losing their own committed status', async () => {
    const { people } = await seedHousehold({ jointBufferOpening: 0 });
    const jan = await makePeriod({ year: 2026, month: 1 });
    const feb = await makePeriod({ year: 2026, month: 2 });

    await makeIncome(jan.id, 100000);
    await commitPeriod(jan.id);
    await makeIncome(feb.id, 50000);
    await commitPeriod(feb.id);

    let febJoint = (
      await getDb().select<{ closing: number }>(
        `SELECT l.closing FROM wallet_ledger l JOIN wallets w ON w.id = l.wallet_id
         WHERE w.kind = 'joint_buffer' AND l.period_id = ?`,
        [feb.id],
      )
    )[0];
    expect(febJoint.closing).toBe(150000); // 100000 (jan) + 50000 (feb)

    await reopenPeriod(jan.id);
    await setAllowance(jan.id, people[0].id, 20000);
    await commitPeriod(jan.id);

    const janJoint = (
      await getDb().select<{ closing: number }>(
        `SELECT l.closing FROM wallet_ledger l JOIN wallets w ON w.id = l.wallet_id
         WHERE w.kind = 'joint_buffer' AND l.period_id = ?`,
        [jan.id],
      )
    )[0];
    expect(janJoint.closing).toBe(80000); // 100000 - 20000 allowance

    febJoint = (
      await getDb().select<{ closing: number; opening: number }>(
        `SELECT l.closing, l.opening FROM wallet_ledger l JOIN wallets w ON w.id = l.wallet_id
         WHERE w.kind = 'joint_buffer' AND l.period_id = ?`,
        [feb.id],
      )
    )[0] as { closing: number };
    expect(febJoint.closing).toBe(130000); // opening now 80000 + 50000

    const febRow = (
      await getDb().select<{ status: string }>('SELECT status FROM budget_periods WHERE id = ?', [feb.id])
    )[0];
    expect(febRow.status).toBe('committed'); // untouched by the cascade
  });
});
