import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import type { Wallet, WalletKind } from './types';

export async function listWallets(): Promise<Wallet[]> {
  return getDb().select<Wallet>(
    `SELECT * FROM wallets ORDER BY CASE kind
       WHEN 'joint_buffer' THEN 0 WHEN 'savings' THEN 1 ELSE 2 END, name`,
  );
}

export async function getWalletByKind(kind: Exclude<WalletKind, 'personal'>): Promise<Wallet | null> {
  const rows = await getDb().select<Wallet>('SELECT * FROM wallets WHERE kind = ?', [kind]);
  return rows[0] ?? null;
}

export async function createWallet(input: {
  kind: WalletKind;
  name: string;
  personId?: string | null;
  openingBalance: number;
}): Promise<string> {
  const id = uuid();
  const ts = nowIso();
  await getDb().execute(
    `INSERT INTO wallets (id, kind, person_id, name, opening_balance, seeded_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.kind, input.personId ?? null, input.name, input.openingBalance, ts, ts, ts],
  );
  return id;
}

export async function setOpeningBalance(id: string, openingBalance: number): Promise<void> {
  await getDb().execute('UPDATE wallets SET opening_balance = ?, updated_at = ? WHERE id = ?', [
    openingBalance,
    nowIso(),
    id,
  ]);
}

/**
 * Current balance = seeded opening + every period's ledger delta. Transfers are not
 * added again here: `computePeriod` already folds transfer in/out into each wallet's
 * ledger delta, so summing `wallet_transfers` on top would double-count them.
 */
export async function getWalletBalances(): Promise<Map<string, number>> {
  const rows = await getDb().select<{ wallet_id: string; balance: number }>(
    `SELECT w.id AS wallet_id,
            w.opening_balance
              + COALESCE((SELECT SUM(l.delta) FROM wallet_ledger l WHERE l.wallet_id = w.id), 0)
            AS balance
     FROM wallets w`,
  );
  return new Map(rows.map((r) => [r.wallet_id, r.balance]));
}
