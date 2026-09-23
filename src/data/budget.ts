import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import { leftToAssign, type PlanLine } from '@/services/budget/engine';
import { loadActuals } from './periodEngine';

export interface BudgetLineRow {
  id: string;
  category_id: string;
  category_name: string;
  kind: string;
  planned_amount: number;
}

export async function listBudgetLines(periodId: string): Promise<BudgetLineRow[]> {
  return getDb().select<BudgetLineRow>(
    `SELECT b.id, b.category_id, c.name AS category_name, c.kind, b.planned_amount
     FROM budget_lines b JOIN categories c ON c.id = b.category_id
     WHERE b.period_id = ?
     ORDER BY c.kind, c.sort_order`,
    [periodId],
  );
}

/**
 * Every spendable category, whether or not it has been given a plan yet. The plan
 * screen shows all of them so nothing has to be hunted for in a dropdown first.
 */
export async function listAllocationLines(periodId: string): Promise<BudgetLineRow[]> {
  return getDb().select<BudgetLineRow>(
    `SELECT COALESCE(b.id, c.id) AS id, c.id AS category_id, c.name AS category_name, c.kind,
            COALESCE(b.planned_amount, 0) AS planned_amount
     FROM categories c
     LEFT JOIN budget_lines b ON b.category_id = c.id AND b.period_id = ?
     WHERE c.is_archived = 0
       AND c.kind IN ('fixed', 'flexible', 'savings')
     ORDER BY c.kind, c.sort_order, c.name`,
    [periodId],
  );
}

export interface AvailableToAssign {
  income: number;
  /** Cash already sitting in the joint buffer from previous months. */
  carryover: number;
  /** income + carryover — the true zero-based pool. */
  pool: number;
  assigned: number;
  left: number;
}

/**
 * The real number to check zero-based planning against: this month's income plus
 * whatever the joint buffer is already carrying, minus everything already planned.
 */
export async function availableToAssign(periodId: string): Promise<AvailableToAssign> {
  const db = getDb();
  const period = (
    await db.select<{ year: number; month: number }>(
      'SELECT year, month FROM budget_periods WHERE id = ?',
      [periodId],
    )
  )[0];
  if (!period) throw new Error('Period not found');

  const [incomes, lines, allowanceRows, previousClosing, jointWallet] = await Promise.all([
    listIncomes(periodId),
    listBudgetLines(periodId),
    listPersonalBudgets(periodId),
    db.select<{ closing: number }>(
      `SELECT l.closing
       FROM wallet_ledger l
       JOIN wallets w ON w.id = l.wallet_id
       JOIN budget_periods p ON p.id = l.period_id
       WHERE w.kind = 'joint_buffer' AND (p.year * 12 + p.month) < (? * 12 + ?)
       ORDER BY (p.year * 12 + p.month) DESC
       LIMIT 1`,
      [period.year, period.month],
    ),
    db.select<{ opening_balance: number }>(`SELECT opening_balance FROM wallets WHERE kind = 'joint_buffer'`),
  ]);

  const income = incomes.reduce((s, i) => s + i.amount, 0);
  const carryover = previousClosing[0]?.closing ?? jointWallet[0]?.opening_balance ?? 0;

  const planLines: PlanLine[] = lines.map((l) => ({ categoryId: l.category_id, planned: l.planned_amount }));
  const allowances = Object.fromEntries(allowanceRows.map((a) => [a.person_id, a.allowance]));
  const assigned =
    planLines.reduce((s, l) => s + l.planned, 0) + Object.values(allowances).reduce((s, a) => s + a, 0);

  return {
    income,
    carryover,
    pool: income + carryover,
    assigned,
    left: leftToAssign(income, planLines, allowances, carryover),
  };
}

export async function setBudgetLine(
  periodId: string,
  categoryId: string,
  planned: number,
): Promise<void> {
  const ts = nowIso();
  await getDb().execute(
    `INSERT INTO budget_lines (id, period_id, category_id, planned_amount, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(period_id, category_id) DO UPDATE SET
       planned_amount = excluded.planned_amount, updated_at = excluded.updated_at`,
    [uuid(), periodId, categoryId, planned, ts, ts],
  );
}

/** Applies a whole allocation pass at once, so a half-written plan is impossible. */
export async function setBudgetLines(
  periodId: string,
  amounts: Record<string, number>,
): Promise<void> {
  const entries = Object.entries(amounts);
  if (entries.length === 0) return;
  const ts = nowIso();
  await getDb().batch(
    entries.map(([categoryId, planned]) => ({
      sql: `INSERT INTO budget_lines (id, period_id, category_id, planned_amount, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(period_id, category_id) DO UPDATE SET
              planned_amount = excluded.planned_amount, updated_at = excluded.updated_at`,
      params: [uuid(), periodId, categoryId, planned, ts, ts],
    })),
  );
}

export interface PersonalBudgetRow {
  person_id: string;
  allowance: number;
  rollover_in: number;
  spent: number;
  rollover_out: number;
}

export async function listPersonalBudgets(periodId: string): Promise<PersonalBudgetRow[]> {
  return getDb().select<PersonalBudgetRow>(
    'SELECT person_id, allowance, rollover_in, spent, rollover_out FROM personal_budgets WHERE period_id = ?',
    [periodId],
  );
}

/**
 * Average monthly outflow per category over recent closed months, used to weight
 * an automatic split. Months before the category existed are not counted.
 */
export async function averageSpendByCategory(
  excludePeriodId: string,
  months = 3,
): Promise<Record<string, number>> {
  const rows = await getDb().select<{ category_id: string; total: number; periods: number }>(
    `SELECT t.category_id, SUM(t.amount) AS total, COUNT(DISTINCT t.period_id) AS periods
     FROM transactions t
     WHERE t.direction = 'out'
       AND t.is_excluded = 0
       AND t.category_id IS NOT NULL
       AND t.period_id IS NOT NULL
       AND t.period_id != ?
       AND t.period_id IN (
         SELECT id FROM budget_periods
         WHERE id != ?
         ORDER BY year DESC, month DESC
         LIMIT ?
       )
     GROUP BY t.category_id`,
    [excludePeriodId, excludePeriodId, months],
  );

  return Object.fromEntries(
    rows.map((r) => [r.category_id, Math.round(r.total / Math.max(r.periods, 1))]),
  );
}

export async function setAllowance(
  periodId: string,
  personId: string,
  allowance: number,
): Promise<void> {
  const ts = nowIso();
  await getDb().execute(
    `INSERT INTO personal_budgets (id, period_id, person_id, allowance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(period_id, person_id) DO UPDATE SET
       allowance = excluded.allowance, updated_at = excluded.updated_at`,
    [uuid(), periodId, personId, allowance, ts, ts],
  );
}

export interface IncomeRow {
  id: string;
  person_id: string | null;
  label: string;
  amount: number;
}

export async function listIncomes(periodId: string): Promise<IncomeRow[]> {
  return getDb().select<IncomeRow>(
    'SELECT id, person_id, label, amount FROM period_incomes WHERE period_id = ? ORDER BY created_at',
    [periodId],
  );
}

export async function addIncome(input: {
  periodId: string;
  personId: string | null;
  label: string;
  amount: number;
}): Promise<void> {
  const ts = nowIso();
  await getDb().execute(
    `INSERT INTO period_incomes (id, period_id, person_id, label, amount, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), input.periodId, input.personId, input.label, input.amount, ts, ts],
  );
}

export async function updateIncome(id: string, amount: number): Promise<void> {
  await getDb().execute('UPDATE period_incomes SET amount = ?, updated_at = ? WHERE id = ?', [
    amount,
    nowIso(),
    id,
  ]);
}

export async function removeIncome(id: string): Promise<void> {
  await getDb().execute('DELETE FROM period_incomes WHERE id = ?', [id]);
}

/** Copies last period's plan forward so a new month starts from something sensible. */
export async function seedPlanFromPrevious(periodId: string): Promise<number> {  const db = getDb();
  const period = (
    await db.select<{ year: number; month: number }>(
      'SELECT year, month FROM budget_periods WHERE id = ?',
      [periodId],
    )
  )[0];
  if (!period) return 0;

  const previous = await db.select<{ id: string }>(
    `SELECT id FROM budget_periods
     WHERE (year * 12 + month) < (? * 12 + ?)
     ORDER BY (year * 12 + month) DESC LIMIT 1`,
    [period.year, period.month],
  );
  if (!previous[0]) return 0;

  const lines = await listBudgetLines(previous[0].id);
  const allowances = await listPersonalBudgets(previous[0].id);
  const ts = nowIso();

  await db.batch([
    ...lines.map((line) => ({
      sql: `INSERT INTO budget_lines (id, period_id, category_id, planned_amount, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(period_id, category_id) DO NOTHING`,
      params: [uuid(), periodId, line.category_id, line.planned_amount, ts, ts],
    })),
    ...allowances.map((a) => ({
      sql: `INSERT INTO personal_budgets (id, period_id, person_id, allowance, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(period_id, person_id) DO NOTHING`,
      params: [uuid(), periodId, a.person_id, a.allowance, ts, ts],
    })),
  ]);

  return lines.length + allowances.length;
}

/**
 * Fills the plan with what the month actually cost. The מחזור חודשי is
 * retrospective — by the time you reach שיוך the money is already gone — so a
 * plan of zeros just means "nothing assigned yet", which is what made נותר לשייך
 * show the entire income while the משותף buffer had long since been drained.
 *
 * Lines the user already touched are left alone; only untouched zeros are filled.
 */
export async function seedPlanFromActuals(periodId: string): Promise<number> {
  const [actuals, existing] = await Promise.all([
    loadActuals(periodId),
    listBudgetLines(periodId),
  ]);

  const edited = new Set(existing.filter((l) => l.planned_amount !== 0).map((l) => l.category_id));
  const amounts = Object.fromEntries(
    Object.entries(actuals.byCategory).filter(([categoryId, amount]) => {
      if (edited.has(categoryId)) return false;
      // Negatives are real: a refund can exceed the month's spend. Skipping them
      // would leave a residue no amount of pressing the button could clear.
      return amount !== 0;
    }),
  );

  await setBudgetLines(periodId, amounts);
  return Object.keys(amounts).length;
}

export interface PeriodReconciliation extends AvailableToAssign {
  /** Closing balance of the joint buffer — the real cash left in משותף. */
  jointClosing: number;
  transfersIn: number;
  transfersOut: number;
  /** Everything that left the joint pot this month, plan-independent. */
  jointOutflow: number;
  /** Joint spending no plan line covers yet. Zero means the month adds up. */
  unassignedActual: number;
  /** Joint spending still without a category, so it cannot be assigned at all. */
  uncategorized: number;
  balanced: boolean;
}

/**
 * Ties the שיוך screen to the משותף wallet. Once every shekel that left the joint
 * pot has a plan line, `left` and `jointClosing` are the same number — that is the
 * check that the month is closed honestly, not just that nothing went negative.
 */
export async function reconcilePeriod(periodId: string): Promise<PeriodReconciliation> {
  const db = getDb();
  const [available, actuals, allowanceRows, ledger, transferRows] = await Promise.all([
    availableToAssign(periodId),
    loadActuals(periodId),
    listPersonalBudgets(periodId),
    db.select<{ closing: number }>(
      `SELECT l.closing FROM wallet_ledger l
       JOIN wallets w ON w.id = l.wallet_id
       WHERE l.period_id = ? AND w.kind = 'joint_buffer'`,
      [periodId],
    ),
    db.select<{ direction: string; amount: number }>(
      `SELECT CASE WHEN f.kind = 'joint_buffer' THEN 'out' ELSE 'in' END AS direction, t.amount
       FROM wallet_transfers t
       LEFT JOIN wallets f ON f.id = t.from_wallet_id
       LEFT JOIN wallets tw ON tw.id = t.to_wallet_id
       WHERE t.period_id = ? AND (f.kind = 'joint_buffer' OR tw.kind = 'joint_buffer')`,
      [periodId],
    ),
  ]);

  const transfersIn = transferRows
    .filter((t) => t.direction === 'in')
    .reduce((s, t) => s + t.amount, 0);
  const transfersOut = transferRows
    .filter((t) => t.direction === 'out')
    .reduce((s, t) => s + t.amount, 0);

  const allowanceTotal = allowanceRows.reduce((s, a) => s + a.allowance, 0);
  const plannedSavings = (await listBudgetLines(periodId))
    .filter((l) => l.kind === 'savings')
    .reduce((s, l) => s + l.planned_amount, 0);
  const savingsMoved = actuals.savingsContribution || plannedSavings;

  const jointOutflow = actuals.fixed + actuals.jointFlexible + savingsMoved + allowanceTotal;
  const jointClosing =
    ledger[0]?.closing ??
    available.carryover + actuals.income + transfersIn - jointOutflow - transfersOut;

  return {
    ...available,
    jointClosing,
    transfersIn,
    transfersOut,
    jointOutflow,
    unassignedActual: jointOutflow - available.assigned,
    uncategorized: actuals.uncategorized,
    balanced: jointOutflow - available.assigned === 0,
  };
}
