import { getDb } from '@/db';

/** Every table except the migration log; categories are re-seeded on next launch. */
const TABLES_IN_DELETE_ORDER = [
  'transactions',
  'import_batches',
  'wallet_ledger',
  'wallet_transfers',
  'insights',
  'subscriptions',
  'budget_lines',
  'personal_budgets',
  'period_incomes',
  'budget_periods',
  'merchant_rules',
  'merchants',
  'recurring_entries',
  'accounts',
  'parser_profiles',
  'wallets',
  'people',
  'categories',
  'settings',
];

export async function resetAllData(): Promise<void> {
  await getDb().batch(TABLES_IN_DELETE_ORDER.map((table) => ({ sql: `DELETE FROM ${table}` })));
}

export interface DataCounts {
  transactions: number;
  periods: number;
  accounts: number;
}

export async function getDataCounts(): Promise<DataCounts> {
  const rows = await getDb().select<DataCounts>(
    `SELECT
       (SELECT COUNT(*) FROM transactions)   AS transactions,
       (SELECT COUNT(*) FROM budget_periods) AS periods,
       (SELECT COUNT(*) FROM accounts)       AS accounts`,
  );
  return rows[0];
}
