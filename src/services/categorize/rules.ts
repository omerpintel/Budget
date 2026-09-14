import type { CategorizationSource, WalletScope } from '@/data/types';
import { merchantPrefixKey } from './normalize';

export interface KnownMerchant {
  id: string;
  normalized_name: string;
  default_category_id: string | null;
  default_wallet: WalletScope | null;
}

export interface MerchantRuleLike {
  id: string;
  match_type: 'exact' | 'contains' | 'regex';
  pattern: string;
  priority: number;
  category_id: string | null;
  wallet: WalletScope | null;
  is_enabled: number;
}

export interface CategorizationContext {
  byName: Map<string, KnownMerchant>;
  byPrefix: Map<string, KnownMerchant[]>;
  rules: MerchantRuleLike[];
}

export interface Categorization {
  merchantId: string | null;
  categoryId: string | null;
  wallet: WalletScope | null;
  source: CategorizationSource;
}

export function buildContext(
  merchants: KnownMerchant[],
  rules: MerchantRuleLike[],
): CategorizationContext {
  const byName = new Map<string, KnownMerchant>();
  const byPrefix = new Map<string, KnownMerchant[]>();

  for (const merchant of merchants) {
    byName.set(merchant.normalized_name, merchant);
    const key = merchantPrefixKey(merchant.normalized_name);
    const bucket = byPrefix.get(key);
    if (bucket) bucket.push(merchant);
    else byPrefix.set(key, [merchant]);
  }

  const enabled = rules
    .filter((r) => r.is_enabled === 1)
    .sort((a, b) => a.priority - b.priority);

  return { byName, byPrefix, rules: enabled };
}

// User-authored regexes run against untrusted-length input; cap both to avoid pathological backtracking.
const MAX_PATTERN_LENGTH = 200;
const MAX_SUBJECT_LENGTH = 300;

function ruleMatches(rule: MerchantRuleLike, normalized: string, raw: string): boolean {
  const pattern = rule.pattern.trim().toLowerCase();
  if (pattern === '' || pattern.length > MAX_PATTERN_LENGTH) return false;
  const subjects = [normalized, raw.toLowerCase().slice(0, MAX_SUBJECT_LENGTH)];

  switch (rule.match_type) {
    case 'exact':
      return subjects.some((s) => s === pattern);
    case 'contains':
      return subjects.some((s) => s.includes(pattern));
    case 'regex':
      try {
        const re = new RegExp(rule.pattern, 'i');
        return subjects.some((s) => re.test(s));
      } catch {
        return false;
      }
  }
}

/**
 * Resolution order: a merchant seen before, then user rules, then an unambiguous
 * family of branches. Anything unresolved is left for the local model in M4.
 */
export function categorize(
  rawDescription: string,
  normalized: string,
  ctx: CategorizationContext,
): Categorization {
  const exact = ctx.byName.get(normalized);
  if (exact?.default_category_id) {
    return {
      merchantId: exact.id,
      categoryId: exact.default_category_id,
      wallet: exact.default_wallet,
      source: 'exact',
    };
  }

  for (const rule of ctx.rules) {
    if (!ruleMatches(rule, normalized, rawDescription)) continue;
    return {
      merchantId: exact?.id ?? null,
      categoryId: rule.category_id,
      wallet: rule.wallet,
      source: 'rule',
    };
  }

  const family = ctx.byPrefix.get(merchantPrefixKey(normalized))?.filter((m) => m.default_category_id);
  if (family && family.length > 0) {
    const categories = new Set(family.map((m) => m.default_category_id));
    const wallets = new Set(family.map((m) => m.default_wallet));
    // Only borrow from the family when every known branch agrees.
    if (categories.size === 1) {
      return {
        merchantId: exact?.id ?? null,
        categoryId: family[0].default_category_id,
        wallet: wallets.size === 1 ? family[0].default_wallet : null,
        source: 'exact',
      };
    }
  }

  return { merchantId: exact?.id ?? null, categoryId: null, wallet: null, source: 'default' };
}
