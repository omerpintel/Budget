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
  { slug: 'salary', name: 'משכורת', kind: 'income', isSystem: true },
  { slug: 'other-income', name: 'הכנסה אחרת', kind: 'income' },
  { slug: 'refund', name: 'זיכויים והחזרים', kind: 'income' },

  { slug: 'rent', name: 'שכר דירה', kind: 'fixed' },
  { slug: 'mortgage', name: 'משכנתא', kind: 'fixed' },
  { slug: 'arnona', name: 'ארנונה', kind: 'fixed' },
  { slug: 'utilities', name: 'חשמל, מים וגז', kind: 'fixed' },
  { slug: 'internet-tv', name: 'אינטרנט וטלוויזיה', kind: 'fixed' },
  { slug: 'mobile', name: 'סלולר', kind: 'fixed' },
  { slug: 'insurance', name: 'ביטוח', kind: 'fixed' },
  { slug: 'health', name: 'בריאות וקופת חולים', kind: 'fixed' },
  { slug: 'vehicle-fixed', name: 'הוצאות רכב קבועות', kind: 'fixed' },
  { slug: 'education', name: 'חינוך ומעונות', kind: 'fixed' },
  { slug: 'loans', name: 'החזרי הלוואות', kind: 'fixed' },

  { slug: 'groceries', name: 'סופר ומכולת', kind: 'flexible' },
  { slug: 'restaurants', name: 'מסעדות ובתי קפה', kind: 'flexible' },
  { slug: 'fuel', name: 'דלק', kind: 'flexible' },
  { slug: 'transport', name: 'תחבורה וחניה', kind: 'flexible' },
  { slug: 'pharmacy', name: 'פארם וטיפוח', kind: 'flexible' },
  { slug: 'home', name: 'בית וריהוט', kind: 'flexible' },
  { slug: 'clothing', name: 'ביגוד והנעלה', kind: 'flexible' },
  { slug: 'entertainment', name: 'בילויים ותרבות', kind: 'flexible' },
  { slug: 'subscriptions', name: 'מנויים ודיגיטל', kind: 'flexible' },
  { slug: 'travel', name: 'טיולים וחופשות', kind: 'flexible' },
  { slug: 'gifts', name: 'מתנות ואירועים', kind: 'flexible' },
  { slug: 'pets', name: 'חיות מחמד', kind: 'flexible' },
  { slug: 'sport', name: 'ספורט וכושר', kind: 'flexible' },
  { slug: 'kids', name: 'ילדים', kind: 'flexible' },
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
