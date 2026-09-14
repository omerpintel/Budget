import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import type { Category, CategoryKind, Direction, RecurringEntry } from './types';

export async function listCategories(): Promise<Category[]> {
  return getDb().select<Category>(
    'SELECT * FROM categories WHERE is_archived = 0 ORDER BY kind, sort_order, name',
  );
}

export async function listCategoriesByKind(kind: CategoryKind): Promise<Category[]> {
  return getDb().select<Category>(
    'SELECT * FROM categories WHERE kind = ? AND is_archived = 0 ORDER BY sort_order, name',
    [kind],
  );
}

export async function createCategory(name: string, kind: CategoryKind, slug: string): Promise<string> {
  const id = uuid();
  const ts = nowIso();
  await getDb().execute(
    `INSERT INTO categories (id, slug, name, kind, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 999, ?, ?)`,
    [id, slug, name, kind, ts, ts],
  );
  return id;
}

export async function archiveCategory(id: string): Promise<void> {
  await getDb().execute(
    'UPDATE categories SET is_archived = 1, updated_at = ? WHERE id = ? AND is_system = 0',
    [nowIso(), id],
  );
}

export async function listRecurringEntries(): Promise<RecurringEntry[]> {
  return getDb().select<RecurringEntry>(
    'SELECT * FROM recurring_entries WHERE is_active = 1 ORDER BY direction DESC, sort_order, name',
  );
}

export interface RecurringInput {
  name: string;
  direction: Direction;
  categoryId?: string | null;
  personId?: string | null;
  defaultAmount: number;
  dayOfMonth?: number | null;
}

export async function createRecurringEntry(input: RecurringInput, sortOrder = 0): Promise<string> {
  const id = uuid();
  const ts = nowIso();
  await getDb().execute(
    `INSERT INTO recurring_entries
       (id, name, direction, category_id, person_id, default_amount, day_of_month, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      id,
      input.name,
      input.direction,
      input.categoryId ?? null,
      input.personId ?? null,
      input.defaultAmount,
      input.dayOfMonth ?? null,
      sortOrder,
      ts,
      ts,
    ],
  );
  return id;
}

export async function deleteRecurringEntry(id: string): Promise<void> {
  await getDb().execute('UPDATE recurring_entries SET is_active = 0, updated_at = ? WHERE id = ?', [
    nowIso(),
    id,
  ]);
}
