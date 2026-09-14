import type { CategorizationSource, Direction, WalletScope } from './types';

export interface TriageRow {
  id: string;
  transaction_date: string;
  raw_description: string;
  normalized_merchant: string | null;
  merchant_id: string | null;
  amount: number;
  direction: Direction;
  category_id: string | null;
  category_name: string | null;
  categorization_source: CategorizationSource | null;
  llm_confidence: number | null;
  wallet: WalletScope;
  personal_person_id: string | null;
  account_name: string;
  account_owner_id: string | null;
  account_owner_name: string | null;
  installment_current: number | null;
  installment_total: number | null;
  funding_wallet_id: string | null;
  is_excluded: number;
  siblings: number;
}

export interface TriageSplit {
  queue: TriageRow[];
  auto: TriageRow[];
}

/**
 * A row is auto-applied when history or a rule resolved it, or when the model was
 * confident enough. Everything else needs a human decision.
 */
export function isAutoApplied(row: TriageRow, threshold: number): boolean {
  if (!row.category_id) return false;
  switch (row.categorization_source) {
    case 'exact':
    case 'rule':
    case 'user':
      return true;
    case 'llm':
      return (row.llm_confidence ?? 0) >= threshold;
    default:
      return false;
  }
}

export function splitTriage(rows: TriageRow[], threshold: number): TriageSplit {
  const queue: TriageRow[] = [];
  const auto: TriageRow[] = [];
  for (const row of rows) {
    (isAutoApplied(row, threshold) ? auto : queue).push(row);
  }
  // Least certain first: unknown merchants before low-confidence guesses.
  queue.sort((a, b) => confidenceOf(a) - confidenceOf(b));
  return { queue, auto };
}

function confidenceOf(row: TriageRow): number {
  if (!row.category_id) return -1;
  return row.llm_confidence ?? 0;
}
