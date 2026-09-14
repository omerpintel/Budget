import type { SqlDriver } from './driver';
import { nowIso, uuid } from '@/lib/utils';
import type { CategoryKind } from '@/data/types';

interface SeedCategory {
  slug: string;
  name: string;
  kind: CategoryKind;
  isSystem?: boolean;
}

/** Defaults tuned for an Israeli household; fully editable in Settings. */
export const DEFAULT_CATEGORIES: SeedCategory[] = [
  { slug: 'salary', name: 'Salary', kind: 'income', isSystem: true },
  { slug: 'other-income', name: 'Other Income', kind: 'income' },
  { slug: 'refund', name: 'Refunds & Reimbursements', kind: 'income' },

  { slug: 'rent', name: 'Rent', kind: 'fixed' },
  { slug: 'mortgage', name: 'Mortgage', kind: 'fixed' },
  { slug: 'arnona', name: 'Arnona', kind: 'fixed' },
  { slug: 'utilities', name: 'Electricity, Water & Gas', kind: 'fixed' },
  { slug: 'internet-tv', name: 'Internet & TV', kind: 'fixed' },
  { slug: 'mobile', name: 'Mobile', kind: 'fixed' },
  { slug: 'insurance', name: 'Insurance', kind: 'fixed' },
  { slug: 'health', name: 'Health & Kupat Holim', kind: 'fixed' },
  { slug: 'vehicle-fixed', name: 'Vehicle Fixed Costs', kind: 'fixed' },
  { slug: 'education', name: 'Education & Childcare', kind: 'fixed' },
  { slug: 'loans', name: 'Loan Repayments', kind: 'fixed' },

  { slug: 'groceries', name: 'Groceries', kind: 'flexible' },
  { slug: 'restaurants', name: 'Restaurants & Cafes', kind: 'flexible' },
  { slug: 'fuel', name: 'Fuel', kind: 'flexible' },
  { slug: 'transport', name: 'Transport & Parking', kind: 'flexible' },
  { slug: 'pharmacy', name: 'Pharmacy & Toiletries', kind: 'flexible' },
  { slug: 'home', name: 'Home & Furnishing', kind: 'flexible' },
  { slug: 'clothing', name: 'Clothing', kind: 'flexible' },
  { slug: 'entertainment', name: 'Entertainment & Culture', kind: 'flexible' },
  { slug: 'subscriptions', name: 'Subscriptions & Digital', kind: 'flexible' },
  { slug: 'travel', name: 'Travel & Vacation', kind: 'flexible' },
  { slug: 'gifts', name: 'Gifts & Events', kind: 'flexible' },
  { slug: 'pets', name: 'Pets', kind: 'flexible' },
  { slug: 'sport', name: 'Sport & Fitness', kind: 'flexible' },
  { slug: 'kids', name: 'Kids', kind: 'flexible' },
  { slug: 'misc', name: 'Miscellaneous', kind: 'flexible' },
  { slug: 'uncategorized', name: 'Uncategorized', kind: 'flexible', isSystem: true },

  { slug: 'savings-contribution', name: 'Savings Contribution', kind: 'savings', isSystem: true },
  { slug: 'personal-allowance', name: 'Personal Allowance', kind: 'personal', isSystem: true },
  { slug: 'transfer', name: 'Internal Transfer', kind: 'transfer', isSystem: true },
];

export async function seedCategories(driver: SqlDriver): Promise<void> {
  const existing = await driver.select<{ slug: string }>('SELECT slug FROM categories');
  const known = new Set(existing.map((r) => r.slug));
  const missing = DEFAULT_CATEGORIES.filter((c) => !known.has(c.slug));
  if (missing.length === 0) return;

  const ts = nowIso();
  await driver.batch(
    missing.map((c, i) => ({
      sql: `INSERT INTO categories (id, slug, name, kind, sort_order, is_system, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [uuid(), c.slug, c.name, c.kind, known.size + i, c.isSystem ? 1 : 0, ts, ts],
    })),
  );
}
