import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import type { Account, AccountType } from './types';

export interface AccountInput {
  displayName: string;
  issuer: string;
  type: AccountType;
  last4?: string | null;
  ownerPersonId?: string | null;
  debitDay?: number | null;
}

export async function listAccounts(): Promise<Account[]> {
  return getDb().select<Account>('SELECT * FROM accounts ORDER BY sort_order, display_name');
}

export async function createAccount(input: AccountInput, sortOrder = 0): Promise<string> {
  const id = uuid();
  const ts = nowIso();
  await getDb().execute(
    `INSERT INTO accounts
       (id, display_name, issuer, type, last4, owner_person_id, debit_day, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      id,
      input.displayName,
      input.issuer,
      input.type,
      input.last4 ?? null,
      input.ownerPersonId ?? null,
      input.debitDay ?? null,
      sortOrder,
      ts,
      ts,
    ],
  );
  return id;
}

export async function updateAccount(id: string, input: AccountInput): Promise<void> {
  await getDb().execute(
    `UPDATE accounts SET display_name = ?, issuer = ?, type = ?, last4 = ?,
       owner_person_id = ?, debit_day = ?, updated_at = ? WHERE id = ?`,
    [
      input.displayName,
      input.issuer,
      input.type,
      input.last4 ?? null,
      input.ownerPersonId ?? null,
      input.debitDay ?? null,
      nowIso(),
      id,
    ],
  );
}

export async function deleteAccount(id: string): Promise<void> {
  await getDb().execute('DELETE FROM accounts WHERE id = ?', [id]);
}

/** Latest day of the month any card hits the bank — the earliest safe close day. */
export async function getLatestDebitDay(): Promise<number | null> {
  const rows = await getDb().select<{ max_day: number | null }>(
    `SELECT MAX(debit_day) AS max_day FROM accounts WHERE type = 'credit_card' AND is_active = 1`,
  );
  return rows[0]?.max_day ?? null;
}

/** Rent wires, cash and standing orders need an account that is not a card. */
export async function ensureManualAccount(): Promise<string> {
  const rows = await getDb().select<{ id: string }>(
    `SELECT id FROM accounts WHERE type = 'bank' AND issuer = 'manual' LIMIT 1`,
  );
  if (rows[0]) return rows[0].id;
  return createAccount(
    { displayName: 'Bank / Manual', issuer: 'manual', type: 'bank' },
    99,
  );
}
