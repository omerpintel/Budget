import { describe, expect, it } from 'vitest';
import { isAutoApplied, splitTriage, type TriageRow } from './triageModel';

const row = (partial: Partial<TriageRow>): TriageRow => ({
  id: 'id',
  transaction_date: '2026-08-01',
  raw_description: 'x',
  normalized_merchant: 'x',
  merchant_id: 'm',
  amount: 1000,
  direction: 'out',
  category_id: 'cat',
  category_name: 'Cat',
  categorization_source: 'llm',
  llm_confidence: 0.95,
  wallet: 'joint',
  personal_person_id: null,
  account_name: 'Card',
  account_owner_id: 'p1',
  account_owner_name: 'Omer',
  installment_current: null,
  installment_total: null,
  funding_wallet_id: null,
  is_excluded: 0,
  siblings: 0,
  ...partial,
});

describe('isAutoApplied', () => {
  it('trusts history and rules unconditionally', () => {
    expect(isAutoApplied(row({ categorization_source: 'exact', llm_confidence: null }), 0.9)).toBe(true);
    expect(isAutoApplied(row({ categorization_source: 'rule', llm_confidence: null }), 0.9)).toBe(true);
  });

  it('trusts the model only at or above the threshold', () => {
    expect(isAutoApplied(row({ llm_confidence: 0.9 }), 0.9)).toBe(true);
    expect(isAutoApplied(row({ llm_confidence: 0.89 }), 0.9)).toBe(false);
  });

  it('never auto-applies a row without a category', () => {
    expect(isAutoApplied(row({ category_id: null, categorization_source: 'exact' }), 0.9)).toBe(false);
  });

  it('never auto-applies an untouched row', () => {
    expect(isAutoApplied(row({ categorization_source: 'default', category_id: null }), 0.9)).toBe(false);
  });

  it('respects a stricter threshold', () => {
    expect(isAutoApplied(row({ llm_confidence: 0.95 }), 0.99)).toBe(false);
  });
});

describe('splitTriage', () => {
  it('separates confident rows from those needing a decision', () => {
    const { queue, auto } = splitTriage(
      [
        row({ id: 'a', categorization_source: 'exact' }),
        row({ id: 'b', llm_confidence: 0.4 }),
        row({ id: 'c', category_id: null, categorization_source: 'default' }),
      ],
      0.9,
    );
    expect(auto.map((r) => r.id)).toEqual(['a']);
    expect(queue.map((r) => r.id)).toEqual(['c', 'b']);
  });

  it('puts unknown merchants ahead of low-confidence guesses', () => {
    const { queue } = splitTriage(
      [
        row({ id: 'guess', llm_confidence: 0.5 }),
        row({ id: 'unknown', category_id: null, categorization_source: 'default' }),
      ],
      0.9,
    );
    expect(queue[0].id).toBe('unknown');
  });

  it('handles an empty ledger', () => {
    expect(splitTriage([], 0.9)).toEqual({ queue: [], auto: [] });
  });
});
