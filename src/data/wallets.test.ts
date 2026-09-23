import { describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import { useTestDb } from '@/test/harness';
import { createPerson } from './people';
import { createWallet, getWalletBalances, getWalletByKind, listWallets, setOpeningBalance } from './wallets';

describe('wallets', () => {
  useTestDb();

  it('creates and lists wallets with joint_buffer first, then savings, then personal', async () => {
    const personId = await createPerson('עומר', 'omer', 0);
    await createWallet({ kind: 'personal', name: 'z-wallet', personId, openingBalance: 0 });
    await createWallet({ kind: 'savings', name: 'savings', openingBalance: 0 });
    await createWallet({ kind: 'joint_buffer', name: 'joint', openingBalance: 0 });

    const wallets = await listWallets();
    expect(wallets.map((w) => w.kind)).toEqual(['joint_buffer', 'savings', 'personal']);
  });

  it('getWalletByKind finds the singleton joint_buffer / savings wallet', async () => {
    await createWallet({ kind: 'joint_buffer', name: 'joint', openingBalance: 500 });
    const wallet = await getWalletByKind('joint_buffer');
    expect(wallet?.opening_balance).toBe(500);
    expect(await getWalletByKind('savings')).toBeNull();
  });

  it('setOpeningBalance updates the balance', async () => {
    const id = await createWallet({ kind: 'joint_buffer', name: 'joint', openingBalance: 0 });
    await setOpeningBalance(id, 1000);
    const wallets = await listWallets();
    expect(wallets[0].opening_balance).toBe(1000);
  });

  it('getWalletBalances returns opening_balance when there is no ledger history', async () => {
    const id = await createWallet({ kind: 'joint_buffer', name: 'joint', openingBalance: 750 });
    const balances = await getWalletBalances();
    expect(balances.get(id)).toBe(750);
  });

  it('getWalletBalances folds every period ledger delta on top of the opening balance, without double-counting transfers (F4 regression)', async () => {
    const jointId = await createWallet({ kind: 'joint_buffer', name: 'joint', openingBalance: 1000 });
    const savingsId = await createWallet({ kind: 'savings', name: 'savings', openingBalance: 0 });

    const ts = nowIso();
    const periodId = uuid();
    await getDb().execute(
      `INSERT INTO budget_periods (id, year, month, status, created_at, updated_at) VALUES (?, 2026, 1, 'draft', ?, ?)`,
      [periodId, ts, ts],
    );

    // A transfer of 200 from joint to savings should show up exactly once in each wallet's
    // ledger delta (inflow for savings, outflow for joint) — never added again on top.
    await getDb().execute(
      `INSERT INTO wallet_transfers (id, period_id, from_wallet_id, to_wallet_id, amount, created_at)
       VALUES (?, ?, ?, ?, 200, ?)`,
      [uuid(), periodId, jointId, savingsId, ts],
    );
    await getDb().execute(
      `INSERT INTO wallet_ledger (id, period_id, wallet_id, opening, inflow, outflow, delta, closing, computed_at)
       VALUES (?, ?, ?, 1000, 0, 200, -200, 800, ?)`,
      [uuid(), periodId, jointId, ts],
    );
    await getDb().execute(
      `INSERT INTO wallet_ledger (id, period_id, wallet_id, opening, inflow, outflow, delta, closing, computed_at)
       VALUES (?, ?, ?, 0, 200, 0, 200, 200, ?)`,
      [uuid(), periodId, savingsId, ts],
    );

    const balances = await getWalletBalances();
    expect(balances.get(jointId)).toBe(800);
    expect(balances.get(savingsId)).toBe(200);
  });

  it('getWalletBalances sums deltas across multiple periods', async () => {
    const id = await createWallet({ kind: 'joint_buffer', name: 'joint', openingBalance: 0 });
    const ts = nowIso();
    for (const [year, month, delta] of [
      [2026, 1, 100],
      [2026, 2, -30],
    ] as const) {
      const periodId = uuid();
      await getDb().execute(
        `INSERT INTO budget_periods (id, year, month, status, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?)`,
        [periodId, year, month, ts, ts],
      );
      await getDb().execute(
        `INSERT INTO wallet_ledger (id, period_id, wallet_id, opening, inflow, outflow, delta, closing, computed_at)
         VALUES (?, ?, ?, 0, 0, 0, ?, 0, ?)`,
        [uuid(), periodId, id, delta, ts],
      );
    }
    const balances = await getWalletBalances();
    expect(balances.get(id)).toBe(70);
  });
});
