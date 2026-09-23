import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import { normalizeMerchant } from '@/services/categorize/normalize';
import type { Direction, WalletScope } from './types';

export interface LedgerRow {
  id: string;
  transaction_date: string;
  debit_date: string;
  description: string;
  amount: number;
  direction: Direction;
  category_id: string | null;
  category_name: string | null;
  wallet: WalletScope;
  personal_person_id: string | null;
  person_name: string | null;
  account_name: string;
  entry_mode: 'imported' | 'manual';
  is_masked: number;
  is_reviewed: number;
  categorization_source: string | null;
  installment_current: number | null;
  installment_total: number | null;
  period_id: string | null;
}

export interface LedgerFilters {
  periodId?: string | null;
  /** Personal vendor names stay hidden unless the owner explicitly reveals them. */
  reveal?: boolean;
  unreviewedOnly?: boolean;
}

export async function listTransactions(filters: LedgerFilters = {}): Promise<LedgerRow[]> {
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (filters.periodId) {
    where.push('t.period_id = ?');
    params.push(filters.periodId);
  }
  if (filters.unreviewedOnly) where.push('t.is_reviewed = 0');

  // Reads go through the masking expression unless the user asked to reveal.
  const description = filters.reveal
    ? 't.raw_description'
    : `CASE WHEN t.is_masked = 1 THEN 'הוצאה אישית' ELSE t.raw_description END`;

  return getDb().select<LedgerRow>(
    `SELECT t.id, t.transaction_date, t.debit_date, ${description} AS description,
            t.amount, t.direction, t.category_id, c.name AS category_name,
            t.wallet, t.personal_person_id, p.name AS person_name,
            a.display_name AS account_name, t.entry_mode, t.is_masked, t.is_reviewed,
            t.categorization_source, t.installment_current, t.installment_total, t.period_id
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN people p ON p.id = t.personal_person_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.transaction_date DESC, t.created_at DESC`,
    params,
  );
}

export interface ManualTransactionInput {
  accountId: string;
  periodId: string | null;
  date: string;
  description: string;
  amount: number;
  direction: Direction;
  categoryId: string | null;
  wallet: WalletScope;
  personId: string | null;
  note: string | null;
  /** Savings wallet id when the expense is drawn from the buffer instead of the joint pot. */
  fundingWalletId?: string | null;
}

export async function createManualTransaction(input: ManualTransactionInput): Promise<string> {
  const id = uuid();
  const ts = nowIso();
  const isPersonal = input.wallet === 'personal';
  const normalized = normalizeMerchant(input.description);

  await getDb().execute(
    `INSERT INTO transactions
       (id, period_id, account_id, entry_mode, direction, transaction_date, debit_date,
        amount, raw_description, normalized_merchant, category_id, wallet, personal_person_id,
        is_masked, categorization_source, is_reviewed, is_excluded, funding_wallet_id, note,
        dedupe_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', 1, 0, ?, ?, ?, ?, ?)`,
    [
      id,
      input.periodId,
      input.accountId,
      input.direction,
      input.date,
      input.date,
      input.amount,
      input.description,
      normalized,
      input.categoryId,
      input.wallet,
      isPersonal ? input.personId : null,
      isPersonal ? 1 : 0,
      input.fundingWalletId ?? null,
      input.note,
      `manual:${id}`,
      ts,
      ts,
    ],
  );
  return id;
}

/** Drawing an expense from savings keeps it out of the joint flexible total. */
export async function setFundingWallet(id: string, walletId: string | null): Promise<void> {
  await getDb().execute(
    'UPDATE transactions SET funding_wallet_id = ?, updated_at = ? WHERE id = ?',
    [walletId, nowIso(), id],
  );
}

export async function deleteTransaction(id: string): Promise<void> {
  await getDb().execute('DELETE FROM transactions WHERE id = ?', [id]);
}

export async function setExcluded(id: string, excluded: boolean): Promise<void> {
  await getDb().execute('UPDATE transactions SET is_excluded = ?, updated_at = ? WHERE id = ?', [
    excluded ? 1 : 0,
    nowIso(),
    id,
  ]);
}
