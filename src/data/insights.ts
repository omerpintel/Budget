import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import { getSetting, setSetting, SETTING_KEYS } from './settings';
import {
  detectSubscriptions,
  annualCost,
  type Charge,
  type Subscription,
} from '@/services/insights/subscriptions';
import {
  detectAnomalies,
  installmentPlans,
  totalOutstanding,
  type Anomaly,
  type CategoryHistory,
  type InstallmentPlan,
} from '@/services/insights/anomalies';

export interface InsightBundle {
  subscriptions: Subscription[];
  annualSubscriptionCost: number;
  dismissedCount: number;
  anomalies: Anomaly[];
  installments: InstallmentPlan[];
  installmentOutstanding: number;
  /** How many periods of history the anomaly pass had to work with. */
  historyDepth: number;
}

const HISTORY_PERIODS = 3;

/** Regular habits can look identical to a subscription, so a merchant can be silenced. */
export async function getDismissedSubscriptions(): Promise<string[]> {
  try {
    const raw = await getSetting(SETTING_KEYS.dismissedSubscriptions);
    const parsed: unknown = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export async function setSubscriptionDismissed(merchant: string, dismissed: boolean): Promise<void> {
  const current = new Set(await getDismissedSubscriptions());
  if (dismissed) current.add(merchant);
  else current.delete(merchant);
  await setSetting(SETTING_KEYS.dismissedSubscriptions, JSON.stringify([...current]));
}

export async function buildInsights(periodId: string): Promise<InsightBundle> {
  const db = getDb();

  // Instalment plans have their own section, so they must not be reported as subscriptions.
  const charges = await db.select<Charge & { is_masked: number }>(
    `SELECT t.transaction_date AS date, t.amount, t.is_masked,
            COALESCE(t.normalized_merchant, t.raw_description) AS merchant
     FROM transactions t
     WHERE t.direction = 'out' AND t.is_excluded = 0 AND t.installment_total IS NULL
     ORDER BY t.transaction_date`,
  );

  const detected = detectSubscriptions(
    charges.map((c) => ({ ...c, isMasked: c.is_masked === 1 })),
    { referenceDate: new Date().toISOString().slice(0, 10) },
  );
  const dismissed = new Set(await getDismissedSubscriptions());
  const subscriptions = detected.filter((s) => !dismissed.has(s.merchant));

  const period = (
    await db.select<{ year: number; month: number }>(
      'SELECT year, month FROM budget_periods WHERE id = ?',
      [periodId],
    )
  )[0];

  const anomalies = period ? await buildAnomalies(periodId, period) : [];
  const historyDepth = period ? await countHistory(period) : 0;

  const installmentRows = await db.select<{
    merchant: string;
    amount: number;
    current: number;
    total: number;
    date: string;
  }>(
    `SELECT COALESCE(t.normalized_merchant, t.raw_description) AS merchant,
            t.amount, t.installment_current AS current, t.installment_total AS total,
            t.transaction_date AS date
     FROM transactions t
     WHERE t.installment_total IS NOT NULL AND t.is_excluded = 0`,
  );
  const installments = installmentPlans(installmentRows);

  return {
    subscriptions,
    annualSubscriptionCost: annualCost(subscriptions),
    dismissedCount: detected.length - subscriptions.length,
    anomalies,
    installments,
    installmentOutstanding: totalOutstanding(installments),
    historyDepth,
  };
}

async function countHistory(period: { year: number; month: number }): Promise<number> {
  const rows = await getDb().select<{ total: number }>(
    `SELECT COUNT(*) AS total FROM budget_periods
     WHERE (year * 12 + month) < (? * 12 + ?)`,
    [period.year, period.month],
  );
  return rows[0]?.total ?? 0;
}

async function buildAnomalies(
  periodId: string,
  period: { year: number; month: number },
): Promise<Anomaly[]> {
  const db = getDb();

  const previousPeriods = await db.select<{ id: string }>(
    `SELECT id FROM budget_periods
     WHERE (year * 12 + month) < (? * 12 + ?)
     ORDER BY (year * 12 + month) DESC
     LIMIT ?`,
    [period.year, period.month, HISTORY_PERIODS],
  );

  const totals = await db.select<{ period_id: string; category_id: string; name: string; total: number }>(
    `SELECT t.period_id, t.category_id, c.name, SUM(t.amount) AS total
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     WHERE t.direction = 'out' AND t.is_excluded = 0 AND c.kind = 'flexible'
       AND t.period_id IN (${[periodId, ...previousPeriods.map((p) => p.id)].map(() => '?').join(',')})
     GROUP BY t.period_id, t.category_id`,
    [periodId, ...previousPeriods.map((p) => p.id)],
  );

  const byCategory = new Map<string, { name: string; current: number; previous: number[] }>();
  for (const row of totals) {
    const entry = byCategory.get(row.category_id) ?? { name: row.name, current: 0, previous: [] };
    if (row.period_id === periodId) entry.current = row.total;
    else entry.previous.push(row.total);
    byCategory.set(row.category_id, entry);
  }

  const histories: CategoryHistory[] = [...byCategory.entries()].map(([categoryId, entry]) => ({
    categoryId,
    categoryName: entry.name,
    current: entry.current,
    previous: entry.previous,
  }));

  return detectAnomalies(histories);
}

/** Persists detected subscriptions so they survive between sessions and can be dismissed. */
export async function saveSubscriptions(subscriptions: Subscription[]): Promise<void> {
  const db = getDb();
  const merchants = await db.select<{ id: string; normalized_name: string }>(
    'SELECT id, normalized_name FROM merchants',
  );
  const byName = new Map(merchants.map((m) => [m.normalized_name, m.id]));
  const ts = nowIso();

  const statements = subscriptions
    .map((sub) => ({ sub, merchantId: byName.get(sub.merchant) }))
    .filter((entry): entry is { sub: Subscription; merchantId: string } => Boolean(entry.merchantId))
    .map(({ sub, merchantId }) => ({
      sql: `INSERT INTO subscriptions
              (id, merchant_id, cadence, expected_amount, tolerance, last_charge_date,
               next_expected_date, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      params: [
        uuid(),
        merchantId,
        sub.cadence,
        sub.expectedAmount,
        sub.lastCharge,
        sub.nextExpected,
        sub.status,
        ts,
        ts,
      ] as Array<string | number | null>,
    }));

  if (statements.length === 0) return;
  await db.batch([{ sql: 'DELETE FROM subscriptions' }, ...statements]);
}
