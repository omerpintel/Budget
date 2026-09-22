import type { SqlDriver } from './driver';
import { nowIso, uuid } from '@/lib/utils';
import type { CategoryKind } from '@/data/types';

interface SeedCategory {
  slug: string;
  name: string;
  kind: CategoryKind;
  isSystem?: boolean;
}

/** Deliberately few: a two-person household never reliably sorts into more. */
export const DEFAULT_CATEGORIES: SeedCategory[] = [
  { slug: 'salary', name: 'משכורת', kind: 'income', isSystem: true },
  { slug: 'other-income', name: 'הכנסה אחרת', kind: 'income' },

  { slug: 'rent', name: 'דיור', kind: 'fixed' },
  { slug: 'utilities', name: 'חשבונות הבית', kind: 'fixed' },
  { slug: 'insurance', name: 'ביטוח ובריאות', kind: 'fixed' },
  { slug: 'vehicle-fixed', name: 'רכב', kind: 'fixed' },
  { slug: 'loans', name: 'התחייבויות וחינוך', kind: 'fixed' },

  { slug: 'groceries', name: 'סופר ומכולת', kind: 'flexible' },
  { slug: 'restaurants', name: 'אוכל בחוץ', kind: 'flexible' },
  { slug: 'fuel', name: 'תחבורה ודלק', kind: 'flexible' },
  { slug: 'home', name: 'קניות ובית', kind: 'flexible' },
  { slug: 'entertainment', name: 'פנאי ומנויים', kind: 'flexible' },
  { slug: 'misc', name: 'שונות', kind: 'flexible' },
  { slug: 'uncategorized', name: 'ללא קטגוריה', kind: 'flexible', isSystem: true },

  { slug: 'savings-contribution', name: 'הפקדה לחיסכון', kind: 'savings', isSystem: true },
  { slug: 'personal-allowance', name: 'דמי כיס אישיים', kind: 'personal', isSystem: true },
  { slug: 'transfer', name: 'העברה פנימית', kind: 'transfer', isSystem: true },
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
