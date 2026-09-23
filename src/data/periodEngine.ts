import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import { computePeriod, type PeriodInput, type PeriodResult, type Transfer } from '@/services/budget/engine';
import type { BudgetPeriod, Wallet } from './types';

export interface PeriodTotals {
  income: number;
  fixed: number;
  jointFlexible: number;
  savingsFunded: number;
  /** Real money moved into the savings buffer this month. */
  savingsContribution: number;
  /** Joint spending with no category yet — already inside `jointFlexible`. */
  uncategorized: number;
  personalSpent: Record<string, number>;
  byCategory: Record<string, number>;
}

/**
 * Actuals for a period. Excluded rows never count, and anything drawn from the
 * savings buffer is kept out of joint flexible so it cannot distort the month.
 * Income is manual entry only (`period_incomes`) — imported credit transactions
 * are not added on top, so a salary typed in the בנק step and its matching bank
 * deposit are never double-counted.
 *
 * Credits other than salary (refunds, chargebacks) are netted back against the
 * bucket they came from, and `transfer` categories are ignored entirely because
 * moving your own money between accounts is not spending.
 */
export async function loadActuals(periodId: string): Promise<PeriodTotals> {
  const db = getDb();

  const rows = await db.select<{
    kind: string | null;
    category_id: string | null;
    wallet: string;
    personal_person_id: string | null;
    direction: string;
    funded_from_savings: number;
    total: number;
  }>(
    `SELECT c.kind AS kind, t.category_id, t.wallet, t.personal_person_id, t.direction,
            CASE WHEN t.funding_wallet_id IS NULL THEN 0 ELSE 1 END AS funded_from_savings,
            SUM(t.amount) AS total
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.period_id = ? AND t.is_excluded = 0
     GROUP BY c.kind, t.category_id, t.wallet, t.personal_person_id, t.direction, funded_from_savings`,
    [periodId],
  );

  const manualIncome = await db.select<{ total: number | null }>(
    'SELECT SUM(amount) AS total FROM period_incomes WHERE period_id = ?',
    [periodId],
  );

  const totals: PeriodTotals = {
    income: manualIncome[0]?.total ?? 0,
    fixed: 0,
    jointFlexible: 0,
    savingsFunded: 0,
    savingsContribution: 0,
    uncategorized: 0,
    personalSpent: {},
    byCategory: {},
  };

  for (const row of rows) {
    // Moving money between your own accounts is not spending, in either direction.
    if (row.kind === 'transfer') continue;
    // Salary is typed manually in the בנק step; counting the deposit too would double it.
    if (row.direction === 'in' && row.kind === 'income') continue;

    // A credit is a refund: it gives back to whichever bucket originally paid.
    const amount = row.direction === 'in' ? -row.total : row.total;

    if (row.funded_from_savings === 1) {
      totals.savingsFunded += amount;
      continue;
    }
    if (row.wallet === 'personal' && row.personal_person_id) {
      totals.personalSpent[row.personal_person_id] =
        (totals.personalSpent[row.personal_person_id] ?? 0) + amount;
      continue;
    }
    if (row.kind === 'savings') {
      totals.savingsContribution += amount;
    } else if (row.kind === 'fixed') {
      totals.fixed += amount;
    } else {
      totals.jointFlexible += amount;
      if (!row.kind) totals.uncategorized += amount;
    }

    // Only rows that actually leave the joint pot, so a plan built from these
    // totals adds back up to the joint wallet's movement exactly.
    if (row.category_id) {
      totals.byCategory[row.category_id] = (totals.byCategory[row.category_id] ?? 0) + amount;
    }
  }

  return totals;
}

export async function loadPlan(periodId: string): Promise<{
  lines: Array<{ categoryId: string; planned: number; kind: string }>;
  allowances: Record<string, number>;
  savings: number;
}> {
  const db = getDb();
  const lines = await db.select<{ categoryId: string; planned: number; kind: string }>(
    `SELECT b.category_id AS categoryId, b.planned_amount AS planned, c.kind
     FROM budget_lines b JOIN categories c ON c.id = b.category_id
     WHERE b.period_id = ?`,
    [periodId],
  );
  const allowanceRows = await db.select<{ person_id: string; allowance: number }>(
    'SELECT person_id, allowance FROM personal_budgets WHERE period_id = ?',
    [periodId],
  );

  return {
    lines,
    allowances: Object.fromEntries(allowanceRows.map((r) => [r.person_id, r.allowance])),
    savings: lines.filter((l) => l.kind === 'savings').reduce((s, l) => s + l.planned, 0),
  };
}

async function loadTransfers(periodId: string, wallets: Wallet[]): Promise<Transfer[]> {
  const rows = await getDb().select<{ from_wallet_id: string; to_wallet_id: string; amount: number }>(
    'SELECT from_wallet_id, to_wallet_id, amount FROM wallet_transfers WHERE period_id = ?',
    [periodId],
  );
  const keyOf = (id: string): Transfer['from'] | null => {
    const wallet = wallets.find((w) => w.id === id);
    if (!wallet) return null;
    if (wallet.kind === 'joint_buffer') return 'joint';
    if (wallet.kind === 'savings') return 'savings';
    return wallet.person_id ? { personal: wallet.person_id } : null;
  };

  return rows
    .map((r) => ({ from: keyOf(r.from_wallet_id), to: keyOf(r.to_wallet_id), amount: r.amount }))
    .filter((t): t is Transfer => t.from !== null && t.to !== null);
}

/** Opening balances come from the previous period's ledger, or the seeded values. */
async function loadOpening(
  period: BudgetPeriod,
  wallets: Wallet[],
): Promise<PeriodInput['opening']> {
  const previous = await getDb().select<{ wallet_id: string; closing: number }>(
    `SELECT l.wallet_id, l.closing
     FROM wallet_ledger l
     JOIN budget_periods p ON p.id = l.period_id
     WHERE (p.year * 12 + p.month) < (? * 12 + ?)
     ORDER BY (p.year * 12 + p.month) DESC`,
    [period.year, period.month],
  );

  const latest = new Map<string, number>();
  for (const row of previous) {
    if (!latest.has(row.wallet_id)) latest.set(row.wallet_id, row.closing);
  }

  const opening: PeriodInput['opening'] = { joint: 0, savings: 0, personal: {} };
  for (const wallet of wallets) {
    const value = latest.get(wallet.id) ?? wallet.opening_balance;
    if (wallet.kind === 'joint_buffer') opening.joint = value;
    else if (wallet.kind === 'savings') opening.savings = value;
    else if (wallet.person_id) opening.personal[wallet.person_id] = value;
  }
  return opening;
}

export async function buildPeriodInput(
  period: BudgetPeriod,
  wallets: Wallet[],
): Promise<PeriodInput> {
  const [opening, actuals, plan, transfers] = await Promise.all([
    loadOpening(period, wallets),
    loadActuals(period.id),
    loadPlan(period.id),
    loadTransfers(period.id, wallets),
  ]);

  return {
    opening,
    actual: {
      income: actuals.income,
      fixed: actuals.fixed,
      jointFlexible: actuals.jointFlexible,
      personalSpent: actuals.personalSpent,
      savingsFunded: actuals.savingsFunded,
      savingsContribution: actuals.savingsContribution,
    },
    plan: { allowances: plan.allowances, savings: plan.savings },
    transfers,
  };
}

function ledgerStatements(
  periodId: string,
  wallets: Wallet[],
  result: PeriodResult,
  ts: string,
): Array<{ sql: string; params: Array<string | number | null> }> {
  const movementFor = (wallet: Wallet) => {
    if (wallet.kind === 'joint_buffer') return result.joint;
    if (wallet.kind === 'savings') return result.savings;
    return wallet.person_id ? result.personal[wallet.person_id] : undefined;
  };

  return wallets.flatMap((wallet) => {
    const m = movementFor(wallet);
    if (!m) return [];
    return [
      {
        sql: `INSERT INTO wallet_ledger
                (id, period_id, wallet_id, opening, inflow, outflow, delta, closing, computed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(period_id, wallet_id) DO UPDATE SET
                opening = excluded.opening, inflow = excluded.inflow, outflow = excluded.outflow,
                delta = excluded.delta, closing = excluded.closing, computed_at = excluded.computed_at`,
        params: [
          uuid(),
          periodId,
          wallet.id,
          m.opening,
          m.inflow,
          m.outflow,
          m.delta,
          m.closing,
          ts,
        ] as Array<string | number | null>,
      },
    ];
  });
}

/**
 * Recomputes the given period and every later one, because a change to an early
 * month shifts every opening balance that follows it.
 */
export async function recomputeFrom(periodId: string): Promise<PeriodResult> {
  const db = getDb();
  const wallets = await db.select<Wallet>('SELECT * FROM wallets');
  const target = (
    await db.select<BudgetPeriod>('SELECT * FROM budget_periods WHERE id = ?', [periodId])
  )[0];
  if (!target) throw new Error('Period not found');

  const later = await db.select<BudgetPeriod>(
    `SELECT * FROM budget_periods
     WHERE (year * 12 + month) >= (? * 12 + ?)
     ORDER BY year, month`,
    [target.year, target.month],
  );

  let result: PeriodResult | null = null;
  const ts = nowIso();
  for (const period of later) {
    const input = await buildPeriodInput(period, wallets);
    const computed = computePeriod(input);
    await db.batch(ledgerStatements(period.id, wallets, computed, ts));
    if (period.id === periodId) result = computed;
  }

  if (!result) throw new Error('Period not found in recompute chain');
  return result;
}

export async function addTransfer(input: {
  periodId: string;
  fromWalletId: string;
  toWalletId: string;
  amount: number;
  reason: string | null;
}): Promise<void> {
  await getDb().execute(
    `INSERT INTO wallet_transfers (id, period_id, from_wallet_id, to_wallet_id, amount, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), input.periodId, input.fromWalletId, input.toWalletId, input.amount, input.reason, nowIso()],
  );
  await recomputeFrom(input.periodId);
}

export async function listTransfers(periodId: string) {
  return getDb().select<{
    id: string;
    from_wallet_id: string;
    to_wallet_id: string;
    amount: number;
    reason: string | null;
  }>(
    'SELECT id, from_wallet_id, to_wallet_id, amount, reason FROM wallet_transfers WHERE period_id = ? ORDER BY created_at',
    [periodId],
  );
}

export async function removeTransfer(id: string, periodId: string): Promise<void> {
  await getDb().execute('DELETE FROM wallet_transfers WHERE id = ?', [id]);
  await recomputeFrom(periodId);
}

export async function commitPeriod(periodId: string): Promise<PeriodResult> {
  const result = await recomputeFrom(periodId);
  await getDb().execute(
    `UPDATE budget_periods SET status = 'committed', committed_at = ?, snapshot = ?, updated_at = ?
     WHERE id = ?`,
    [nowIso(), JSON.stringify(result), nowIso(), periodId],
  );
  return result;
}

export async function reopenPeriod(periodId: string): Promise<void> {
  await getDb().execute(
    `UPDATE budget_periods SET status = 'draft', committed_at = NULL, updated_at = ? WHERE id = ?`,
    [nowIso(), periodId],
  );
  await recomputeFrom(periodId);
}
