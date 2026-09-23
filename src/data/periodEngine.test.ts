import { describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import { setAllowance, setBudgetLine } from './budget';
import { getWalletByKind } from './wallets';
import {
  addTransfer,
  buildPeriodInput,
  commitPeriod,
  listTransfers,
  reopenPeriod,
  recomputeFrom,
  removeTransfer,
} from './periodEngine';
import { findCategory, makeIncome, makeManualAccount, makePeriod, makeTransaction, seedHousehold } from '@/test/factories';
import { useTestDb } from '@/test/harness';
import type { Wallet } from './types';

async function ledgerFor(periodId: string) {
  return getDb().select<{
    wallet_id: string;
    opening: number;
    inflow: number;
    outflow: number;
    delta: number;
    closing: number;
  }>('SELECT * FROM wallet_ledger WHERE period_id = ?', [periodId]);
}

async function insertSavingsFundedTx(opts: {
  periodId: string;
  accountId: string;
  categoryId: string;
  amount: number;
  fundingWalletId: string;
}) {
  const ts = nowIso();
  await getDb().execute(
    `INSERT INTO transactions
       (id, period_id, account_id, entry_mode, direction, transaction_date, debit_date, amount,
        raw_description, category_id, wallet, funding_wallet_id, dedupe_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'manual', 'out', '2026-01-15', '2026-01-15', ?, 'ריהוט', ?, 'joint', ?, ?, ?, ?)`,
    [
      uuid(),
      opts.periodId,
      opts.accountId,
      opts.amount,
      opts.categoryId,
      opts.fundingWalletId,
      `savings-funded:${uuid()}`,
      ts,
      ts,
    ],
  );
}

describe('buildPeriodInput', () => {
  useTestDb();

  it('assembles opening, actuals, and plan from real DB rows', async () => {
    const { people } = await seedHousehold({ jointBufferOpening: 10000 });
    const period = await makePeriod({ year: 2026, month: 1 });
    const rent = await findCategory('rent');
    const groceries = await findCategory('groceries');

    await makeIncome(period.id, 500000);
    await setBudgetLine(period.id, rent.id, 150000);
    await setAllowance(period.id, people[0].id, 20000);
    await makeTransaction({ periodId: period.id, amount: 8000, categoryId: groceries.id, wallet: 'joint' });
    await makeTransaction({
      periodId: period.id,
      amount: 3000,
      categoryId: groceries.id,
      wallet: 'personal',
      personId: people[0].id,
    });

    const wallets = await getDb().select<Wallet>('SELECT * FROM wallets');
    const input = await buildPeriodInput(period, wallets);

    expect(input.opening.joint).toBe(10000);
    expect(input.opening.savings).toBe(0);
    expect(input.actual.income).toBe(500000);
    expect(input.actual.jointFlexible).toBe(8000);
    expect(input.actual.personalSpent[people[0].id]).toBe(3000);
    expect(input.plan.allowances[people[0].id]).toBe(20000);
  });
});

describe('recomputeFrom cascade and opening chaining', () => {
  useTestDb();

  it('chains openings across N, N+1, N+2 and recomputes forward when an earlier month changes', async () => {
    await seedHousehold({ jointBufferOpening: 10000 });
    const jan = await makePeriod({ year: 2026, month: 1 });
    const feb = await makePeriod({ year: 2026, month: 2 });
    const mar = await makePeriod({ year: 2026, month: 3 });

    await makeIncome(jan.id, 100000);
    await recomputeFrom(jan.id);
    const jointId = (await getWalletByKind('joint_buffer'))!.id;
    let janLedger = (await ledgerFor(jan.id)).find((r) => r.wallet_id === jointId)!;
    expect(janLedger.opening).toBe(10000);
    expect(janLedger.closing).toBe(110000);

    await makeIncome(feb.id, 50000);
    await recomputeFrom(feb.id);
    let febJoint = (await ledgerFor(feb.id)).find((r) => r.wallet_id === jointId)!;
    expect(febJoint.opening).toBe(110000);
    expect(febJoint.closing).toBe(160000);

    await makeIncome(mar.id, 20000);
    await recomputeFrom(mar.id);
    let marJoint = (await ledgerFor(mar.id)).find((r) => r.wallet_id === jointId)!;
    expect(marJoint.opening).toBe(160000);
    expect(marJoint.closing).toBe(180000);

    // Now change January's income and recompute from January — February and March must shift too.
    await makeIncome(jan.id, 30000);
    await recomputeFrom(jan.id);

    janLedger = (await ledgerFor(jan.id)).find((r) => r.wallet_id === jointId)!;
    febJoint = (await ledgerFor(feb.id)).find((r) => r.wallet_id === jointId)!;
    marJoint = (await ledgerFor(mar.id)).find((r) => r.wallet_id === jointId)!;

    expect(janLedger.closing).toBe(140000);
    expect(febJoint.opening).toBe(140000);
    expect(febJoint.closing).toBe(190000);
    expect(marJoint.opening).toBe(190000);
    expect(marJoint.closing).toBe(210000);
  });

  it('every wallet_ledger row is internally consistent: delta == inflow-outflow, closing == opening+delta', async () => {
    await seedHousehold({ jointBufferOpening: 10000, savingsOpening: 5000 });
    const period = await makePeriod({ year: 2026, month: 1 });
    const rent = await findCategory('rent');
    await makeIncome(period.id, 200000);
    await makeTransaction({ periodId: period.id, amount: 50000, categoryId: rent.id, wallet: 'joint' });

    await recomputeFrom(period.id);
    const rows = await ledgerFor(period.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.delta).toBe(row.inflow - row.outflow);
      expect(row.closing).toBe(row.opening + row.delta);
    }
  });
});

describe('cash conservation', () => {
  useTestDb();

  it('sum of closings equals sum of openings plus income minus fixed, jointFlexible, personalSpent, and savingsFunded', async () => {
    const { people } = await seedHousehold({ jointBufferOpening: 100000, savingsOpening: 50000 });
    const period = await makePeriod({ year: 2026, month: 1 });
    const rent = await findCategory('rent');
    const groceries = await findCategory('groceries');
    const savingsCat = await findCategory('savings-contribution');
    const accountId = await makeManualAccount();
    const savingsWallet = (await getWalletByKind('savings'))!;

    await makeIncome(period.id, 500000);
    await setBudgetLine(period.id, savingsCat.id, 30000);
    await setAllowance(period.id, people[0].id, 20000);
    await makeTransaction({ periodId: period.id, amount: 15000, categoryId: rent.id, wallet: 'joint' });
    await makeTransaction({ periodId: period.id, amount: 8000, categoryId: groceries.id, wallet: 'joint' });
    await makeTransaction({
      periodId: period.id,
      amount: 3000,
      categoryId: groceries.id,
      wallet: 'personal',
      personId: people[0].id,
    });
    await insertSavingsFundedTx({
      periodId: period.id,
      accountId,
      categoryId: groceries.id,
      amount: 12000,
      fundingWalletId: savingsWallet.id,
    });

    await recomputeFrom(period.id);
    const rows = await ledgerFor(period.id);
    const sumOpenings = rows.reduce((s, r) => s + r.opening, 0);
    const sumClosings = rows.reduce((s, r) => s + r.closing, 0);

    const income = 500000;
    const fixed = 15000;
    const jointFlexible = 8000;
    const personalSpent = 3000;
    const savingsFunded = 12000;

    expect(sumClosings).toBe(sumOpenings + income - fixed - jointFlexible - personalSpent - savingsFunded);
  });
});

describe('savings-funded transactions', () => {
  useTestDb();

  it('are excluded from jointFlexible and charged only to the savings wallet', async () => {
    const groceries = await findCategory('groceries');
    await seedHousehold({ savingsOpening: 100000 });
    const period = await makePeriod({ year: 2026, month: 1 });
    const accountId = await makeManualAccount();
    const savingsWallet = (await getWalletByKind('savings'))!;
    const jointWallet = (await getWalletByKind('joint_buffer'))!;

    await makeTransaction({ periodId: period.id, amount: 8000, categoryId: groceries.id, wallet: 'joint' });
    await insertSavingsFundedTx({
      periodId: period.id,
      accountId,
      categoryId: groceries.id,
      amount: 25000,
      fundingWalletId: savingsWallet.id,
    });

    const result = await recomputeFrom(period.id);
    expect(result.joint.outflow).toBe(8000);
    expect(result.savings.outflow).toBe(25000);

    const rows = await ledgerFor(period.id);
    expect(rows.find((r) => r.wallet_id === jointWallet.id)!.outflow).toBe(8000);
    expect(rows.find((r) => r.wallet_id === savingsWallet.id)!.outflow).toBe(25000);
  });
});

describe('addTransfer / removeTransfer', () => {
  useTestDb();

  it('moves exactly the stated amount and removing it restores the prior state exactly', async () => {
    await seedHousehold({ jointBufferOpening: 100000, savingsOpening: 50000 });
    const period = await makePeriod({ year: 2026, month: 1 });
    const joint = (await getWalletByKind('joint_buffer'))!;
    const savings = (await getWalletByKind('savings'))!;

    await addTransfer({ periodId: period.id, fromWalletId: joint.id, toWalletId: savings.id, amount: 20000, reason: 'test' });

    let rows = await ledgerFor(period.id);
    expect(rows.find((r) => r.wallet_id === joint.id)!.closing).toBe(80000);
    expect(rows.find((r) => r.wallet_id === savings.id)!.closing).toBe(70000);

    const [transfer] = await listTransfers(period.id);
    expect(transfer.amount).toBe(20000);

    await removeTransfer(transfer.id, period.id);

    expect(await listTransfers(period.id)).toHaveLength(0);
    rows = await ledgerFor(period.id);
    expect(rows.find((r) => r.wallet_id === joint.id)!.closing).toBe(100000);
    expect(rows.find((r) => r.wallet_id === savings.id)!.closing).toBe(50000);
  });
});

describe('commitPeriod / reopenPeriod', () => {
  useTestDb();

  it('commit stores a status and snapshot; committing twice is safe', async () => {
    await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    await makeIncome(period.id, 100000);

    const result = await commitPeriod(period.id);
    let row = (
      await getDb().select<{ status: string; committed_at: string | null; snapshot: string }>(
        'SELECT status, committed_at, snapshot FROM budget_periods WHERE id = ?',
        [period.id],
      )
    )[0];
    expect(row.status).toBe('committed');
    expect(row.committed_at).not.toBeNull();
    expect(JSON.parse(row.snapshot).joint.closing).toBe(result.joint.closing);

    await expect(commitPeriod(period.id)).resolves.toBeTruthy();
    const [after] = await getDb().select<{ status: string }>(
      'SELECT status FROM budget_periods WHERE id = ?',
      [period.id],
    );
    expect(after.status).toBe('committed');
  });

  it('reopen clears committed status and recomputes forward', async () => {
    await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    await makeIncome(period.id, 100000);
    await commitPeriod(period.id);

    await reopenPeriod(period.id);
    const row = (
      await getDb().select<{ status: string; committed_at: string | null }>(
        'SELECT status, committed_at FROM budget_periods WHERE id = ?',
        [period.id],
      )
    )[0];
    expect(row.status).toBe('draft');
    expect(row.committed_at).toBeNull();

    const joint = (await getWalletByKind('joint_buffer'))!;
    const rows = await ledgerFor(period.id);
    expect(rows.find((r) => r.wallet_id === joint.id)!.closing).toBe(100000);
  });
});

describe('negative joint buffer', () => {
  useTestDb();

  it('is permitted and reported as a shortfall', async () => {
    const rent = await findCategory('rent');
    await seedHousehold({ jointBufferOpening: 0 });
    const period = await makePeriod({ year: 2026, month: 1 });
    await makeIncome(period.id, 100000);
    await makeTransaction({ periodId: period.id, amount: 500000, categoryId: rent.id, wallet: 'joint' });

    const result = await recomputeFrom(period.id);
    expect(result.joint.closing).toBe(-400000);
    expect(result.shortfall).toBe(400000);

    const joint = (await getWalletByKind('joint_buffer'))!;
    const rows = await ledgerFor(period.id);
    expect(rows.find((r) => r.wallet_id === joint.id)!.closing).toBe(-400000);
  });
});
