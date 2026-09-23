import { describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import { findCategory, makePeriod, makeTransaction } from '@/test/factories';
import { useTestDb } from '@/test/harness';
import {
  buildInsights,
  getDismissedSubscriptions,
  saveSubscriptions,
  setSubscriptionDismissed,
} from './insights';
import type { Subscription } from '@/services/insights/subscriptions';

describe('dismissed subscriptions', () => {
  useTestDb();

  it('defaults to an empty list', async () => {
    expect(await getDismissedSubscriptions()).toEqual([]);
  });

  it('setSubscriptionDismissed adds and removes a merchant', async () => {
    await setSubscriptionDismissed('netflix', true);
    expect(await getDismissedSubscriptions()).toEqual(['netflix']);

    await setSubscriptionDismissed('spotify', true);
    expect(await getDismissedSubscriptions().then((d) => d.sort())).toEqual(['netflix', 'spotify']);

    await setSubscriptionDismissed('netflix', false);
    expect(await getDismissedSubscriptions()).toEqual(['spotify']);
  });
});

describe('saveSubscriptions', () => {
  useTestDb();

  function subscription(overrides: Partial<Subscription> = {}): Subscription {
    return {
      merchant: 'netflix',
      cadence: 'monthly',
      expectedAmount: 5000,
      intervalDays: 30,
      occurrences: 3,
      firstCharge: '2025-11-01',
      lastCharge: '2026-01-01',
      nextExpected: '2026-02-01',
      status: 'active',
      totalPaid: 15000,
      isMasked: false,
      ...overrides,
    };
  }

  it('persists only subscriptions whose merchant already exists', async () => {
    const ts = nowIso();
    await getDb().execute(
      `INSERT INTO merchants (id, normalized_name, display_name, times_seen, created_at, updated_at)
       VALUES (?, 'netflix', 'Netflix', 1, ?, ?)`,
      [uuid(), ts, ts],
    );

    await saveSubscriptions([subscription(), subscription({ merchant: 'unknown-merchant' })]);

    const rows = await getDb().select<{ cadence: string; expected_amount: number }>(
      'SELECT cadence, expected_amount FROM subscriptions',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cadence).toBe('monthly');
    expect(rows[0].expected_amount).toBe(5000);
  });

  it('replaces the whole table on each call rather than accumulating', async () => {
    const ts = nowIso();
    await getDb().execute(
      `INSERT INTO merchants (id, normalized_name, display_name, times_seen, created_at, updated_at)
       VALUES (?, 'netflix', 'Netflix', 1, ?, ?)`,
      [uuid(), ts, ts],
    );
    await saveSubscriptions([subscription()]);
    await saveSubscriptions([subscription({ expectedAmount: 6000 })]);

    const rows = await getDb().select('SELECT * FROM subscriptions');
    expect(rows).toHaveLength(1);
  });

  it('is a no-op when nothing matches a known merchant', async () => {
    await saveSubscriptions([subscription({ merchant: 'unknown' })]);
    expect(await getDb().select('SELECT * FROM subscriptions')).toHaveLength(0);
  });
});

describe('buildInsights', () => {
  useTestDb();

  it('returns empty results for a period with no history and no transactions', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const bundle = await buildInsights(period.id);

    expect(bundle.subscriptions).toEqual([]);
    expect(bundle.anomalies).toEqual([]);
    expect(bundle.installments).toEqual([]);
    expect(bundle.installmentOutstanding).toBe(0);
    expect(bundle.historyDepth).toBe(0);
  });

  it('historyDepth counts prior periods only', async () => {
    await makePeriod({ year: 2025, month: 11 });
    await makePeriod({ year: 2025, month: 12 });
    const current = await makePeriod({ year: 2026, month: 1 });

    const bundle = await buildInsights(current.id);
    expect(bundle.historyDepth).toBe(2);
  });

  it('excludes dismissed merchants from detected subscriptions', async () => {
    const groceries = await findCategory('groceries');
    const current = await makePeriod({ year: 2026, month: 1 });
    for (const date of ['2025-11-01', '2025-12-01', '2026-01-01']) {
      await makeTransaction({
        periodId: current.id,
        amount: 5000,
        categoryId: groceries.id,
        description: 'נטפליקס',
        date,
      });
    }

    const before = await buildInsights(current.id);
    expect(before.subscriptions.length).toBeGreaterThan(0);

    const merchant = before.subscriptions[0].merchant;
    await setSubscriptionDismissed(merchant, true);

    const after = await buildInsights(current.id);
    expect(after.subscriptions).toHaveLength(0);
    expect(after.dismissedCount).toBe(before.subscriptions.length);
  });

  it('surfaces installment plans separately from subscriptions and totals the outstanding balance', async () => {
    const groceries = await findCategory('groceries');
    const period = await makePeriod({ year: 2026, month: 1 });
    const { ensureManualAccount } = await import('./accounts');
    const acc = await ensureManualAccount();
    const ts = nowIso();
    await getDb().execute(
      `INSERT INTO transactions
         (id, period_id, account_id, entry_mode, direction, transaction_date, debit_date, amount,
          raw_description, category_id, wallet, installment_current, installment_total, dedupe_hash, created_at, updated_at)
       VALUES (?, ?, ?, 'manual', 'out', '2026-01-01', '2026-01-01', 300, 'מקרר', ?, 'joint', 1, 3, 'inst-1', ?, ?)`,
      [uuid(), period.id, acc, groceries.id, ts, ts],
    );

    const bundle = await buildInsights(period.id);
    expect(bundle.installments).toHaveLength(1);
    expect(bundle.installments[0].total).toBe(3);
    expect(bundle.installments[0].remaining).toBe(2);
    expect(bundle.installmentOutstanding).toBeGreaterThan(0);
    expect(bundle.subscriptions).toHaveLength(0);
  });
});
