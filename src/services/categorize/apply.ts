import { getDb } from '@/db';
import { nowIso } from '@/lib/utils';
import { listMerchants, recordSightings, setMerchantDefaults } from '@/data/merchants';
import { listRules } from '@/data/rules';
import { displayMerchant, normalizeMerchant } from './normalize';
import { buildContext, categorize } from './rules';
import type { WalletScope } from '@/data/types';

interface PendingRow {
  id: string;
  raw_description: string;
  transaction_date: string;
  normalized_merchant: string | null;
  account_owner_id: string | null;
}

export interface CategorizeSummary {
  scanned: number;
  matched: number;
  unresolved: number;
}

export interface CategorizeScope {
  periodId?: string | null;
  importBatchId?: string | null;
}

/**
 * Runs the deterministic cascade over every transaction the user has not reviewed.
 * Whatever is left unresolved is what the local model will be asked about in M4.
 */
export async function categorizePending(scope: CategorizeScope = {}): Promise<CategorizeSummary> {
  const db = getDb();
  const filters: string[] = [];
  const params: string[] = [];
  if (scope.periodId) {
    filters.push('AND t.period_id = ?');
    params.push(scope.periodId);
  }
  if (scope.importBatchId) {
    filters.push('AND t.import_batch_id = ?');
    params.push(scope.importBatchId);
  }

  const rows = await db.select<PendingRow>(
    `SELECT t.id, t.raw_description, t.transaction_date, t.normalized_merchant,
            a.owner_person_id AS account_owner_id
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     WHERE t.is_reviewed = 0
       AND t.categorization_source IN ('default', 'exact', 'rule')
       ${filters.join(' ')}`,
    params,
  );
  if (rows.length === 0) return { scanned: 0, matched: 0, unresolved: 0 };

  const normalized = rows.map((row) => ({
    row,
    normalized: row.normalized_merchant || normalizeMerchant(row.raw_description),
  }));

  const merchantIds = await recordSightings(
    normalized.map((n) => ({
      normalized: n.normalized,
      display: displayMerchant(n.row.raw_description),
      date: n.row.transaction_date,
    })),
  );

  const ctx = buildContext(await listMerchants(), await listRules());
  const ts = nowIso();
  let matched = 0;

  const statements = normalized.map(({ row, normalized: name }) => {
    const result = categorize(row.raw_description, name, ctx);
    const merchantId = merchantIds.get(name) ?? result.merchantId;
    const wallet = result.wallet ?? 'joint';
    const isPersonal = wallet === 'personal' && row.account_owner_id !== null;
    if (result.categoryId) matched += 1;

    return {
      sql: `UPDATE transactions SET
              normalized_merchant = ?, merchant_id = ?,
              category_id = COALESCE(?, category_id),
              wallet = ?, personal_person_id = ?, is_masked = ?,
              categorization_source = ?, updated_at = ?
            WHERE id = ?`,
      params: [
        name,
        merchantId,
        result.categoryId,
        isPersonal ? 'personal' : 'joint',
        isPersonal ? row.account_owner_id : null,
        isPersonal ? 1 : 0,
        result.categoryId ? result.source : 'default',
        ts,
        row.id,
      ],
    };
  });

  await db.batch(statements);
  return { scanned: rows.length, matched, unresolved: rows.length - matched };
}

export interface CorrectionInput {
  transactionId: string;
  categoryId: string | null;
  wallet: WalletScope;
  /** Required when wallet is personal; taken from the card owner. */
  personId: string | null;
  /** Teaches the merchant so future statements resolve without asking. */
  learn: boolean;
}

export async function applyCorrection(input: CorrectionInput): Promise<void> {
  const db = getDb();
  const rows = await db.select<{ merchant_id: string | null }>(
    'SELECT merchant_id FROM transactions WHERE id = ?',
    [input.transactionId],
  );
  const isPersonal = input.wallet === 'personal';

  await db.execute(
    `UPDATE transactions SET
       category_id = ?, wallet = ?, personal_person_id = ?, is_masked = ?,
       categorization_source = 'user', is_reviewed = 1, updated_at = ?
     WHERE id = ?`,
    [
      input.categoryId,
      input.wallet,
      isPersonal ? input.personId : null,
      isPersonal ? 1 : 0,
      nowIso(),
      input.transactionId,
    ],
  );

  const merchantId = rows[0]?.merchant_id;
  if (input.learn && merchantId) {
    await setMerchantDefaults(merchantId, input.categoryId, input.wallet);
  }
}
