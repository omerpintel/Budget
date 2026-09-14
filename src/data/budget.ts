import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';

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
export async function seedPlanFromPrevious(periodId: string): Promise<number> {
  const db = getDb();
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
