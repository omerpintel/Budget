import { getDb } from '@/db';
import { nowIso } from '@/lib/utils';
import { setMerchantDefaults } from './merchants';
import { splitTriage, type TriageRow, type TriageSplit } from './triageModel';
import type { WalletScope } from './types';

export type { TriageRow, TriageSplit };
export { isAutoApplied, splitTriage } from './triageModel';

export async function loadTriage(periodId: string | null, threshold: number): Promise<TriageSplit> {
  const rows = await getDb().select<TriageRow>(
    `SELECT t.id, t.transaction_date, t.raw_description, t.normalized_merchant, t.merchant_id,
            t.amount, t.direction, t.category_id, c.name AS category_name,
            t.categorization_source, t.llm_confidence, t.wallet, t.personal_person_id,
            a.display_name AS account_name, a.owner_person_id AS account_owner_id,
            p.name AS account_owner_name,
            t.installment_current, t.installment_total, t.funding_wallet_id, t.is_excluded,
            (SELECT COUNT(*) FROM transactions s
              WHERE s.is_reviewed = 0
                AND s.id <> t.id
                AND s.normalized_merchant IS NOT NULL
                AND s.normalized_merchant = t.normalized_merchant) AS siblings
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN people p ON p.id = a.owner_person_id
     WHERE t.is_reviewed = 0 ${periodId ? 'AND t.period_id = ?' : ''}
     ORDER BY t.transaction_date DESC`,
    periodId ? [periodId] : [],
  );
  return splitTriage(rows, threshold);
}

export interface TriageDecision {
  categoryId: string | null;
  wallet: WalletScope;
  personId: string | null;
  fundingWalletId: string | null;
  excluded: boolean;
}

function decisionStatement(id: string, decision: TriageDecision, ts: string) {
  const isPersonal = decision.wallet === 'personal';
  return {
    sql: `UPDATE transactions SET
            category_id = ?, wallet = ?, personal_person_id = ?, is_masked = ?,
            funding_wallet_id = ?, is_excluded = ?, categorization_source = 'user',
            is_reviewed = 1, updated_at = ?
          WHERE id = ?`,
    params: [
      decision.categoryId,
      decision.wallet,
      isPersonal ? decision.personId : null,
      isPersonal ? 1 : 0,
      decision.fundingWalletId,
      decision.excluded ? 1 : 0,
      ts,
      id,
    ] as Array<string | number | null>,
  };
}

/** Confirming a row teaches its merchant, which is what removes it from next month's queue. */
export async function commitDecision(
  row: TriageRow,
  decision: TriageDecision,
  applyToMerchant: boolean,
): Promise<number> {
  const ts = nowIso();
  const db = getDb();
  const ids = [row.id];

  if (applyToMerchant && row.normalized_merchant) {
    const siblings = await db.select<{ id: string }>(
      `SELECT id FROM transactions
       WHERE is_reviewed = 0 AND id <> ? AND normalized_merchant = ?`,
      [row.id, row.normalized_merchant],
    );
    ids.push(...siblings.map((s) => s.id));
  }

  await db.batch(ids.map((id) => decisionStatement(id, decision, ts)));

  if (row.merchant_id && !decision.excluded) {
    await setMerchantDefaults(row.merchant_id, decision.categoryId, decision.wallet);
  }
  return ids.length;
}

/** Accepts the auto-applied group wholesale and promotes each merchant's defaults. */
export async function acceptAutoApplied(rows: TriageRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const ts = nowIso();
  const db = getDb();

  await db.batch(
    rows.map((row) => ({
      sql: `UPDATE transactions SET is_reviewed = 1, categorization_source = 'user', updated_at = ?
            WHERE id = ?`,
      params: [ts, row.id],
    })),
  );

  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.merchant_id || seen.has(row.merchant_id)) continue;
    seen.add(row.merchant_id);
    await setMerchantDefaults(row.merchant_id, row.category_id, row.wallet);
  }
  return rows.length;
}

export async function undoReview(transactionId: string): Promise<void> {
  await getDb().execute(
    `UPDATE transactions SET is_reviewed = 0, updated_at = ? WHERE id = ?`,
    [nowIso(), transactionId],
  );
}

/** Lets a user correct an auto-applied row's category without dropping it back into the manual queue. */
export async function setTriageCategory(transactionId: string, categoryId: string | null): Promise<void> {
  await getDb().execute(
    `UPDATE transactions SET category_id = ?, categorization_source = 'user', updated_at = ? WHERE id = ?`,
    [categoryId, nowIso(), transactionId],
  );
}

/** Lets a user move an auto-applied row between the joint wallet and a personal one. */
export async function setTriageWallet(
  transactionId: string,
  wallet: WalletScope,
  personId: string | null,
): Promise<void> {
  const isPersonal = wallet === 'personal';
  await getDb().execute(
    `UPDATE transactions SET wallet = ?, personal_person_id = ?, is_masked = ?, updated_at = ? WHERE id = ?`,
    [wallet, isPersonal ? personId : null, isPersonal ? 1 : 0, nowIso(), transactionId],
  );
}

/** Categories ordered by how often they have actually been used, for the number keys. */
export async function getQuickCategories(limit = 9): Promise<Array<{ id: string; name: string }>> {
  return getDb().select<{ id: string; name: string }>(
    `SELECT c.id, c.name
     FROM categories c
     LEFT JOIN transactions t ON t.category_id = c.id AND t.is_reviewed = 1
     WHERE c.is_archived = 0 AND c.kind IN ('fixed', 'flexible', 'savings') AND c.slug <> 'uncategorized'
     GROUP BY c.id
     ORDER BY COUNT(t.id) DESC,
              -- Before any history exists, day-to-day spending is the useful default.
              CASE c.kind WHEN 'flexible' THEN 0 WHEN 'fixed' THEN 1 ELSE 2 END,
              c.sort_order
     LIMIT ?`,
    [limit],
  );
}
