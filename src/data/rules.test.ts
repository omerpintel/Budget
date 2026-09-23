import { describe, expect, it } from 'vitest';
import { useTestDb } from '@/test/harness';
import { findCategory } from '@/test/factories';
import { createRule, deleteRule, listRules, setRuleEnabled } from './rules';

describe('rules', () => {
  useTestDb();

  it('creates and lists rules ordered by priority then pattern', async () => {
    const groceries = await findCategory('groceries');
    await createRule({ matchType: 'contains', pattern: 'ZZZ', categoryId: groceries.id, wallet: 'joint', priority: 50 });
    await createRule({ matchType: 'exact', pattern: 'AAA', categoryId: groceries.id, wallet: 'joint', priority: 50 });

    const rules = await listRules();
    expect(rules.map((r) => r.pattern)).toEqual(['AAA', 'ZZZ']);
    expect(rules[0].source).toBe('user');
    expect(rules[0].is_enabled).toBe(1);
  });

  it('defaults priority to 100 when not given', async () => {
    const groceries = await findCategory('groceries');
    await createRule({ matchType: 'exact', pattern: 'X', categoryId: groceries.id, wallet: null });
    const [rule] = await listRules();
    expect(rule.priority).toBe(100);
  });

  it('setRuleEnabled toggles is_enabled', async () => {
    const groceries = await findCategory('groceries');
    const id = await createRule({ matchType: 'exact', pattern: 'X', categoryId: groceries.id, wallet: null });
    await setRuleEnabled(id, false);
    expect((await listRules())[0].is_enabled).toBe(0);
    await setRuleEnabled(id, true);
    expect((await listRules())[0].is_enabled).toBe(1);
  });

  it('deleteRule removes the row', async () => {
    const groceries = await findCategory('groceries');
    const id = await createRule({ matchType: 'exact', pattern: 'X', categoryId: groceries.id, wallet: null });
    await deleteRule(id);
    expect(await listRules()).toHaveLength(0);
  });

  it('rejects an unknown match_type (CHECK constraint)', async () => {
    const groceries = await findCategory('groceries');
    await expect(
      createRule({ matchType: 'fuzzy' as never, pattern: 'X', categoryId: groceries.id, wallet: null }),
    ).rejects.toThrow();
  });
});
