import { describe, expect, it } from 'vitest';
import { buildCategoryList, buildMessages, buildResponseSchema } from './prompt';

describe('buildCategoryList', () => {
  it('formats one line per category, including the optional hint', () => {
    const text = buildCategoryList([
      { slug: 'groceries', name: 'סופר ומכולת' },
      { slug: 'fuel', name: 'תחבורה ודלק', hint: 'דלק, חניה, תחבורה ציבורית' },
    ]);
    expect(text).toBe(
      '- groceries: סופר ומכולת\n- fuel: תחבורה ודלק (דלק, חניה, תחבורה ציבורית)',
    );
  });

  it('returns an empty string for no categories', () => {
    expect(buildCategoryList([])).toBe('');
  });
});

describe('buildMessages', () => {
  it('produces a system + user message pair with the merchant payload embedded as JSON', () => {
    const messages = buildMessages(
      [{ slug: 'groceries', name: 'סופר ומכולת' }],
      [{ merchant: 'שופרסל', typicalAmount: 150 }],
    );
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('groceries');
    expect(messages[1].content).toContain('שופרסל');
    expect(messages[1].content).toContain('"typical_amount_ils": 150');
  });

  it('includes the issuer hint only when present', () => {
    const withHint = buildMessages([], [{ merchant: 'x', typicalAmount: 1, issuerHint: 'מסעדות' }]);
    expect(withHint[1].content).toContain('issuer_hint');

    const withoutHint = buildMessages([], [{ merchant: 'x', typicalAmount: 1 }]);
    expect(withoutHint[1].content).not.toContain('issuer_hint');
  });
});

describe('buildResponseSchema', () => {
  it('constrains category_slug to exactly the given list, making an invented slug impossible', () => {
    const schema = buildResponseSchema(['groceries', 'fuel', 'uncategorized']);
    expect(schema.properties.results.items.properties.category_slug.enum).toEqual([
      'groceries',
      'fuel',
      'uncategorized',
    ]);
    expect(schema.properties.results.items.required).toEqual(['merchant', 'category_slug', 'confidence']);
    expect(schema.required).toEqual(['results']);
  });

  it('produces an empty enum for an empty slug list rather than an unconstrained string', () => {
    const schema = buildResponseSchema([]);
    expect(schema.properties.results.items.properties.category_slug.enum).toEqual([]);
  });
});
