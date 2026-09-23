import { describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import { createAccount } from '@/data/accounts';
import { createRule } from '@/data/rules';
import { findCategory, makeManualAccount, makePeriod, seedHousehold } from '@/test/factories';
import { useTestDb } from '@/test/harness';
import { normalizeMerchant } from './normalize';
import { applyCorrection, categorizePending } from './apply';

async function insertPending(opts: {
  accountId: string;
  periodId?: string | null;
  description: string;
  amount?: number;
  importBatchId?: string | null;
}): Promise<string> {
  const id = uuid();
  const ts = nowIso();
  await getDb().execute(
    `INSERT INTO transactions
       (id, period_id, account_id, import_batch_id, entry_mode, direction, transaction_date, debit_date,
        amount, raw_description, wallet, categorization_source, is_reviewed, dedupe_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'imported', 'out', '2026-01-05', '2026-01-05', ?, ?, 'joint', 'default', 0, ?, ?, ?)`,
    [
      id,
      opts.periodId ?? null,
      opts.accountId,
      opts.importBatchId ?? null,
      opts.amount ?? 5000,
      opts.description,
      `pending:${id}`,
      ts,
      ts,
    ],
  );
  return id;
}

async function txRow(id: string) {
  const [row] = await getDb().select<{
    category_id: string | null;
    wallet: string;
    personal_person_id: string | null;
    is_masked: number;
    categorization_source: string;
    merchant_id: string | null;
  }>(
    'SELECT category_id, wallet, personal_person_id, is_masked, categorization_source, merchant_id FROM transactions WHERE id = ?',
    [id],
  );
  return row;
}

describe('categorizePending', () => {
  useTestDb();

  it('resolves a pending transaction via a matching user rule', async () => {
    const accountId = await makeManualAccount();
    const groceries = await findCategory('groceries');
    await createRule({ matchType: 'contains', pattern: 'שופרסל', categoryId: groceries.id, wallet: 'joint' });

    const id1 = await insertPending({ accountId, description: 'שופרסל דיל דיזנגוף' });
    const id2 = await insertPending({ accountId, description: 'שופרסל אונליין' });

    const summary = await categorizePending();
    expect(summary).toEqual({ scanned: 2, matched: 2, unresolved: 0 });

    const row1 = await txRow(id1);
    expect(row1.category_id).toBe(groceries.id);
    expect(row1.categorization_source).toBe('rule');
    expect(row1.wallet).toBe('joint');
    const row2 = await txRow(id2);
    expect(row2.category_id).toBe(groceries.id);
  });

  it('resolves via a merchant seen before (exact) and learns the normalized merchant', async () => {
    const accountId = await makeManualAccount();
    const groceries = await findCategory('groceries');
    const normalized = normalizeMerchant('ארומה קפה');
    const ts = nowIso();
    await getDb().execute(
      `INSERT INTO merchants (id, normalized_name, display_name, default_category_id, default_wallet, times_seen, created_at, updated_at)
       VALUES (?, ?, 'ארומה', ?, 'joint', 3, ?, ?)`,
      [uuid(), normalized, groceries.id, ts, ts],
    );

    const id = await insertPending({ accountId, description: 'ארומה קפה' });
    const summary = await categorizePending();
    expect(summary.matched).toBe(1);

    const row = await txRow(id);
    expect(row.category_id).toBe(groceries.id);
    expect(row.categorization_source).toBe('exact');
  });

  it('leaves an unmatched merchant unresolved with categorization_source staying "default"', async () => {
    const accountId = await makeManualAccount();
    const id = await insertPending({ accountId, description: 'עסק לא ידוע ומוזר' });

    const summary = await categorizePending();
    expect(summary).toEqual({ scanned: 1, matched: 0, unresolved: 1 });

    const row = await txRow(id);
    expect(row.category_id).toBeNull();
    expect(row.categorization_source).toBe('default');
  });

  it('scopes to a single period when periodId is given', async () => {
    const accountId = await makeManualAccount();
    const groceries = await findCategory('groceries');
    await createRule({ matchType: 'contains', pattern: 'שופרסל', categoryId: groceries.id, wallet: 'joint' });
    const period1 = await makePeriod({ year: 2026, month: 1 });
    const period2 = await makePeriod({ year: 2026, month: 2 });

    const inScope = await insertPending({ accountId, periodId: period1.id, description: 'שופרסל' });
    const outOfScope = await insertPending({ accountId, periodId: period2.id, description: 'שופרסל' });

    const summary = await categorizePending({ periodId: period1.id });
    expect(summary).toEqual({ scanned: 1, matched: 1, unresolved: 0 });
    expect((await txRow(inScope)).category_id).toBe(groceries.id);
    expect((await txRow(outOfScope)).category_id).toBeNull();
  });

  it('routes to the personal wallet and masks the description when the merchant defaults to personal', async () => {
    const { people } = await seedHousehold();
    const groceries = await findCategory('groceries');
    const cardId = await createAccount({
      displayName: 'ויזה',
      issuer: 'ויזה',
      type: 'credit_card',
      ownerPersonId: people[0].id,
      debitDay: 10,
    });
    const normalized = normalizeMerchant('חנות פרטית');
    const ts = nowIso();
    await getDb().execute(
      `INSERT INTO merchants (id, normalized_name, display_name, default_category_id, default_wallet, times_seen, created_at, updated_at)
       VALUES (?, ?, 'חנות פרטית', ?, 'personal', 1, ?, ?)`,
      [uuid(), normalized, groceries.id, ts, ts],
    );

    const id = await insertPending({ accountId: cardId, description: 'חנות פרטית' });
    await categorizePending();

    const row = await txRow(id);
    expect(row.wallet).toBe('personal');
    expect(row.personal_person_id).toBe(people[0].id);
    expect(row.is_masked).toBe(1);
  });
});

describe('applyCorrection', () => {
  useTestDb();

  it('marks the row reviewed and user-categorized', async () => {
    const accountId = await makeManualAccount();
    const groceries = await findCategory('groceries');
    const id = await insertPending({ accountId, description: 'משהו' });

    await applyCorrection({ transactionId: id, categoryId: groceries.id, wallet: 'joint', personId: null, learn: false });

    const [row] = await getDb().select<{ category_id: string; is_reviewed: number; categorization_source: string }>(
      'SELECT category_id, is_reviewed, categorization_source FROM transactions WHERE id = ?',
      [id],
    );
    expect(row.category_id).toBe(groceries.id);
    expect(row.is_reviewed).toBe(1);
    expect(row.categorization_source).toBe('user');
  });

  it('teaches the merchant default when learn is true and the row already has a merchant', async () => {
    const accountId = await makeManualAccount();
    const groceries = await findCategory('groceries');
    const merchantId = uuid();
    const ts = nowIso();
    await getDb().execute(
      `INSERT INTO merchants (id, normalized_name, display_name, times_seen, created_at, updated_at)
       VALUES (?, 'private-shop', 'Private Shop', 1, ?, ?)`,
      [merchantId, ts, ts],
    );
    const id = await insertPending({ accountId, description: 'private shop' });
    await getDb().execute('UPDATE transactions SET merchant_id = ? WHERE id = ?', [merchantId, id]);

    await applyCorrection({ transactionId: id, categoryId: groceries.id, wallet: 'joint', personId: null, learn: true });

    const [merchant] = await getDb().select<{ default_category_id: string; default_wallet: string }>(
      'SELECT default_category_id, default_wallet FROM merchants WHERE id = ?',
      [merchantId],
    );
    expect(merchant.default_category_id).toBe(groceries.id);
    expect(merchant.default_wallet).toBe('joint');
  });

  it('does not touch the merchant when learn is false', async () => {
    const accountId = await makeManualAccount();
    const groceries = await findCategory('groceries');
    const merchantId = uuid();
    const ts = nowIso();
    await getDb().execute(
      `INSERT INTO merchants (id, normalized_name, display_name, times_seen, created_at, updated_at)
       VALUES (?, 'private-shop-2', 'Private Shop 2', 1, ?, ?)`,
      [merchantId, ts, ts],
    );
    const id = await insertPending({ accountId, description: 'private shop 2' });
    await getDb().execute('UPDATE transactions SET merchant_id = ? WHERE id = ?', [merchantId, id]);

    await applyCorrection({ transactionId: id, categoryId: groceries.id, wallet: 'joint', personId: null, learn: false });

    const [merchant] = await getDb().select<{ default_category_id: string | null }>(
      'SELECT default_category_id FROM merchants WHERE id = ?',
      [merchantId],
    );
    expect(merchant.default_category_id).toBeNull();
  });
});
