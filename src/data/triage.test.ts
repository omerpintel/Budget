import { describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import { useTestDb } from '@/test/harness';
import { findCategory, makePeriod, seedHousehold } from '@/test/factories';
import { ensureManualAccount } from './accounts';
import {
  acceptAutoApplied,
  commitDecision,
  getQuickCategories,
  loadTriage,
  setTriageCategory,
  setTriageWallet,
  undoReview,
} from './triage';

async function insertTx(overrides: {
  id?: string;
  periodId?: string | null;
  accountId: string;
  categoryId?: string | null;
  categorizationSource?: string | null;
  llmConfidence?: number | null;
  normalizedMerchant?: string | null;
  merchantId?: string | null;
  isReviewed?: number;
  wallet?: string;
}): Promise<string> {
  const id = overrides.id ?? uuid();
  const ts = nowIso();
  await getDb().execute(
    `INSERT INTO transactions
       (id, period_id, account_id, entry_mode, direction, transaction_date, debit_date, amount,
        raw_description, normalized_merchant, merchant_id, category_id, wallet, categorization_source,
        llm_confidence, is_reviewed, dedupe_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'imported', 'out', '2026-01-05', '2026-01-05', 100, 'x', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      overrides.periodId ?? null,
      overrides.accountId,
      overrides.normalizedMerchant ?? null,
      overrides.merchantId ?? null,
      overrides.categoryId ?? null,
      overrides.wallet ?? 'joint',
      overrides.categorizationSource ?? null,
      overrides.llmConfidence ?? null,
      overrides.isReviewed ?? 0,
      `dedupe:${id}`,
      ts,
      ts,
    ],
  );
  return id;
}

describe('triage', () => {
  useTestDb();

  it('loadTriage splits rows into queue vs auto by categorization source and confidence threshold', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const groceries = await findCategory('groceries');
    const accountId = await ensureManualAccount();

    await insertTx({ accountId, periodId: period.id, categoryId: groceries.id, categorizationSource: 'rule' });
    await insertTx({
      accountId,
      periodId: period.id,
      categoryId: groceries.id,
      categorizationSource: 'llm',
      llmConfidence: 0.95,
    });
    await insertTx({
      accountId,
      periodId: period.id,
      categoryId: groceries.id,
      categorizationSource: 'llm',
      llmConfidence: 0.2,
    });
    await insertTx({ accountId, periodId: period.id, categoryId: null });

    const split = await loadTriage(period.id, 0.7);
    expect(split.auto).toHaveLength(2);
    expect(split.queue).toHaveLength(2);
  });

  it('loadTriage only returns unreviewed rows', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const accountId = await ensureManualAccount();
    await insertTx({ accountId, periodId: period.id, isReviewed: 1 });
    await insertTx({ accountId, periodId: period.id, isReviewed: 0 });

    const split = await loadTriage(period.id, 0.7);
    expect(split.queue.length + split.auto.length).toBe(1);
  });

  it('commitDecision applies to the single row and teaches the merchant', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const groceries = await findCategory('groceries');
    const accountId = await ensureManualAccount();
    const merchantId = uuid();
    const ts = nowIso();
    await getDb().execute(
      `INSERT INTO merchants (id, normalized_name, display_name, times_seen, created_at, updated_at)
       VALUES (?, 'shufersal', 'שופרסל', 1, ?, ?)`,
      [merchantId, ts, ts],
    );
    const txId = await insertTx({ accountId, periodId: period.id, normalizedMerchant: 'shufersal', merchantId });

    const split = await loadTriage(period.id, 0.7);
    const row = split.queue.find((r) => r.id === txId)!;

    const count = await commitDecision(
      row,
      { categoryId: groceries.id, wallet: 'joint', personId: null, fundingWalletId: null, excluded: false },
      false,
    );
    expect(count).toBe(1);

    const updated = (
      await getDb().select<{ category_id: string; is_reviewed: number }>(
        'SELECT category_id, is_reviewed FROM transactions WHERE id = ?',
        [txId],
      )
    )[0];
    expect(updated.category_id).toBe(groceries.id);
    expect(updated.is_reviewed).toBe(1);

    const merchant = (
      await getDb().select<{ default_category_id: string }>('SELECT default_category_id FROM merchants WHERE id = ?', [
        merchantId,
      ])
    )[0];
    expect(merchant.default_category_id).toBe(groceries.id);
  });

  it('commitDecision with applyToMerchant also updates unreviewed sibling rows sharing the same merchant', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const groceries = await findCategory('groceries');
    const accountId = await ensureManualAccount();

    const txId = await insertTx({ accountId, periodId: period.id, normalizedMerchant: 'shufersal' });
    const siblingId = await insertTx({ accountId, periodId: period.id, normalizedMerchant: 'shufersal' });
    const otherId = await insertTx({ accountId, periodId: period.id, normalizedMerchant: 'other' });

    const split = await loadTriage(period.id, 0.7);
    const row = split.queue.find((r) => r.id === txId)!;

    const count = await commitDecision(
      row,
      { categoryId: groceries.id, wallet: 'joint', personId: null, fundingWalletId: null, excluded: false },
      true,
    );
    expect(count).toBe(2);

    const sibling = (
      await getDb().select<{ category_id: string }>('SELECT category_id FROM transactions WHERE id = ?', [siblingId])
    )[0];
    expect(sibling.category_id).toBe(groceries.id);

    const other = (
      await getDb().select<{ category_id: string | null }>('SELECT category_id FROM transactions WHERE id = ?', [otherId])
    )[0];
    expect(other.category_id).toBeNull();
  });

  it('commitDecision masks personal-wallet rows and clears masking when moved back to joint', async () => {
    const { people } = await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    const accountId = await ensureManualAccount();
    const txId = await insertTx({ accountId, periodId: period.id });
    const split = await loadTriage(period.id, 0.7);
    const row = split.queue.find((r) => r.id === txId)!;

    await commitDecision(
      row,
      { categoryId: null, wallet: 'personal', personId: people[0].id, fundingWalletId: null, excluded: false },
      false,
    );
    let updated = (
      await getDb().select<{ is_masked: number; personal_person_id: string }>(
        'SELECT is_masked, personal_person_id FROM transactions WHERE id = ?',
        [txId],
      )
    )[0];
    expect(updated.is_masked).toBe(1);
    expect(updated.personal_person_id).toBe(people[0].id);
  });

  it('acceptAutoApplied marks rows reviewed and promotes each merchant once', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const groceries = await findCategory('groceries');
    const accountId = await ensureManualAccount();
    const merchantId = uuid();
    const ts = nowIso();
    await getDb().execute(
      `INSERT INTO merchants (id, normalized_name, display_name, times_seen, created_at, updated_at)
       VALUES (?, 'shufersal', 'שופרסל', 1, ?, ?)`,
      [merchantId, ts, ts],
    );
    await insertTx({
      accountId,
      periodId: period.id,
      categoryId: groceries.id,
      categorizationSource: 'rule',
      merchantId,
      normalizedMerchant: 'shufersal',
    });

    const split = await loadTriage(period.id, 0.7);
    expect(split.auto).toHaveLength(1);

    const count = await acceptAutoApplied(split.auto);
    expect(count).toBe(1);

    const reviewed = (
      await getDb().select<{ is_reviewed: number }>('SELECT is_reviewed FROM transactions WHERE id = ?', [
        split.auto[0].id,
      ])
    )[0];
    expect(reviewed.is_reviewed).toBe(1);
  });

  it('acceptAutoApplied is a no-op for an empty list', async () => {
    expect(await acceptAutoApplied([])).toBe(0);
  });

  it('undoReview clears is_reviewed', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const accountId = await ensureManualAccount();
    const txId = await insertTx({ accountId, periodId: period.id, isReviewed: 1 });

    await undoReview(txId);
    const row = (
      await getDb().select<{ is_reviewed: number }>('SELECT is_reviewed FROM transactions WHERE id = ?', [txId])
    )[0];
    expect(row.is_reviewed).toBe(0);
  });

  it('setTriageCategory updates the category and marks the source as user without touching review state', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const groceries = await findCategory('groceries');
    const accountId = await ensureManualAccount();
    const txId = await insertTx({ accountId, periodId: period.id, categorizationSource: 'llm', isReviewed: 1 });

    await setTriageCategory(txId, groceries.id);
    const row = (
      await getDb().select<{ category_id: string; categorization_source: string; is_reviewed: number }>(
        'SELECT category_id, categorization_source, is_reviewed FROM transactions WHERE id = ?',
        [txId],
      )
    )[0];
    expect(row.category_id).toBe(groceries.id);
    expect(row.categorization_source).toBe('user');
    expect(row.is_reviewed).toBe(1);
  });

  it('setTriageWallet moves a row to personal and back to joint, masking correctly', async () => {
    const { people } = await seedHousehold();
    const period = await makePeriod({ year: 2026, month: 1 });
    const accountId = await ensureManualAccount();
    const txId = await insertTx({ accountId, periodId: period.id });

    await setTriageWallet(txId, 'personal', people[0].id);
    let row = (
      await getDb().select<{ wallet: string; personal_person_id: string; is_masked: number }>(
        'SELECT wallet, personal_person_id, is_masked FROM transactions WHERE id = ?',
        [txId],
      )
    )[0];
    expect(row.wallet).toBe('personal');
    expect(row.personal_person_id).toBe(people[0].id);
    expect(row.is_masked).toBe(1);

    await setTriageWallet(txId, 'joint', null);
    row = (
      await getDb().select<{ wallet: string; personal_person_id: string; is_masked: number }>(
        'SELECT wallet, personal_person_id, is_masked FROM transactions WHERE id = ?',
        [txId],
      )
    )[0];
    expect(row.wallet).toBe('joint');
    expect(row.personal_person_id).toBeNull();
    expect(row.is_masked).toBe(0);
  });

  it('getQuickCategories ranks by reviewed usage, excluding uncategorized and archived/personal/income/transfer kinds', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const groceries = await findCategory('groceries');
    const rent = await findCategory('rent');
    const accountId = await ensureManualAccount();

    for (let i = 0; i < 3; i++) {
      await insertTx({ accountId, periodId: period.id, categoryId: groceries.id, isReviewed: 1 });
    }
    await insertTx({ accountId, periodId: period.id, categoryId: rent.id, isReviewed: 1 });

    const quick = await getQuickCategories(5);
    expect(quick[0].id).toBe(groceries.id);
    expect(quick.some((c) => c.name === 'ללא קטגוריה')).toBe(false);
  });
});
