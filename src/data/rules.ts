import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import type { WalletScope } from './types';
import type { MerchantRuleLike } from '@/services/categorize/rules';

export interface MerchantRule extends MerchantRuleLike {
  source: 'user' | 'llm';
  created_at: string;
}

export async function listRules(): Promise<MerchantRule[]> {
  return getDb().select<MerchantRule>('SELECT * FROM merchant_rules ORDER BY priority, pattern');
}

export interface RuleInput {
  matchType: 'exact' | 'contains' | 'regex';
  pattern: string;
  categoryId: string | null;
  wallet: WalletScope | null;
  priority?: number;
}

export async function createRule(input: RuleInput): Promise<string> {
  const id = uuid();
  const ts = nowIso();
  await getDb().execute(
    `INSERT INTO merchant_rules
       (id, match_type, pattern, priority, category_id, wallet, is_enabled, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'user', ?, ?)`,
    [id, input.matchType, input.pattern, input.priority ?? 100, input.categoryId, input.wallet, ts, ts],
  );
  return id;
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<void> {
  await getDb().execute('UPDATE merchant_rules SET is_enabled = ?, updated_at = ? WHERE id = ?', [
    enabled ? 1 : 0,
    nowIso(),
    id,
  ]);
}

export async function deleteRule(id: string): Promise<void> {
  await getDb().execute('DELETE FROM merchant_rules WHERE id = ?', [id]);
}
