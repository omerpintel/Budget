import { describe, expect, it } from 'vitest';
import { buildContext, categorize, type KnownMerchant, type MerchantRuleLike } from './rules';
import { normalizeMerchant } from './normalize';

const merchant = (
  normalized: string,
  category: string | null,
  wallet: 'joint' | 'personal' | null = 'joint',
): KnownMerchant => ({
  id: `m-${normalized}`,
  normalized_name: normalized,
  default_category_id: category,
  default_wallet: wallet,
});

const rule = (partial: Partial<MerchantRuleLike>): MerchantRuleLike => ({
  id: 'r1',
  match_type: 'contains',
  pattern: '',
  priority: 100,
  category_id: 'cat-rule',
  wallet: null,
  is_enabled: 1,
  ...partial,
});

function run(raw: string, merchants: KnownMerchant[], rules: MerchantRuleLike[] = []) {
  const normalized = normalizeMerchant(raw);
  return categorize(raw, normalized, buildContext(merchants, rules));
}

describe('categorize', () => {
  it('reuses a merchant seen before', () => {
    const result = run('שופרסל דיל תל אביב', [merchant('שופרסל דיל', 'cat-groceries')]);
    expect(result).toMatchObject({ categoryId: 'cat-groceries', source: 'exact', wallet: 'joint' });
  });

  it('prefers a known merchant over a rule', () => {
    const result = run(
      'שופרסל דיל תל אביב',
      [merchant('שופרסל דיל', 'cat-groceries')],
      [rule({ pattern: 'שופרסל', category_id: 'cat-wrong' })],
    );
    expect(result.categoryId).toBe('cat-groceries');
    expect(result.source).toBe('exact');
  });

  it('falls back to rules for an unknown merchant', () => {
    const result = run('סופרמרקט חדש', [], [rule({ pattern: 'סופרמרקט', category_id: 'cat-groceries' })]);
    expect(result).toMatchObject({ categoryId: 'cat-groceries', source: 'rule' });
  });

  it('applies rules in priority order', () => {
    const result = run(
      'נטפליקס',
      [],
      [
        rule({ id: 'low', pattern: 'נטפליקס', category_id: 'cat-late', priority: 200 }),
        rule({ id: 'high', pattern: 'נטפליקס', category_id: 'cat-early', priority: 10 }),
      ],
    );
    expect(result.categoryId).toBe('cat-early');
  });

  it('ignores disabled rules', () => {
    const result = run('נטפליקס', [], [rule({ pattern: 'נטפליקס', is_enabled: 0 })]);
    expect(result.source).toBe('default');
  });

  it('carries the personal wallet from a rule', () => {
    const result = run('steam', [], [rule({ pattern: 'steam', wallet: 'personal' })]);
    expect(result.wallet).toBe('personal');
  });

  it('borrows from a branch family when every branch agrees', () => {
    const result = run('סופר פארם דיזנגוף', [
      merchant('סופר פארם רמת אביב', 'cat-pharmacy'),
      merchant('סופר פארם הרצל', 'cat-pharmacy'),
    ]);
    expect(result).toMatchObject({ categoryId: 'cat-pharmacy', source: 'exact' });
  });

  it('refuses to guess when the family disagrees', () => {
    const result = run('סופר פארם דיזנגוף', [
      merchant('סופר פארם רמת אביב', 'cat-pharmacy'),
      merchant('סופר פארם הרצל', 'cat-cosmetics'),
    ]);
    expect(result.categoryId).toBeNull();
    expect(result.source).toBe('default');
  });

  it('drops the wallet when family branches disagree about it', () => {
    const result = run('סופר פארם דיזנגוף', [
      merchant('סופר פארם רמת אביב', 'cat-pharmacy', 'joint'),
      merchant('סופר פארם הרצל', 'cat-pharmacy', 'personal'),
    ]);
    expect(result.categoryId).toBe('cat-pharmacy');
    expect(result.wallet).toBeNull();
  });

  it('leaves unknown merchants for the model', () => {
    expect(run('חנות מוזרה כלשהי', [])).toMatchObject({ categoryId: null, source: 'default' });
  });

  it('survives an invalid user regex instead of throwing', () => {
    const result = run('נטפליקס', [], [rule({ match_type: 'regex', pattern: '([a-z' })]);
    expect(result.source).toBe('default');
  });

  it('rejects absurdly long regex patterns', () => {
    const result = run('נטפליקס', [], [rule({ match_type: 'regex', pattern: 'a'.repeat(300) })]);
    expect(result.source).toBe('default');
  });
});
