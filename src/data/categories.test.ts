import { describe, expect, it } from 'vitest';
import { useTestDb } from '@/test/harness';
import {
  archiveCategory,
  createCategory,
  createRecurringEntry,
  deleteRecurringEntry,
  listCategories,
  listCategoriesByKind,
  listRecurringEntries,
} from './categories';

describe('categories', () => {
  useTestDb();

  it('lists non-archived categories ordered by kind, sort_order, name', async () => {
    const categories = await listCategories();
    expect(categories.length).toBe(17);
    expect(categories.every((c) => c.is_archived === 0)).toBe(true);
  });

  it('listCategoriesByKind filters correctly', async () => {
    const flexible = await listCategoriesByKind('flexible');
    expect(flexible.every((c) => c.kind === 'flexible')).toBe(true);
    expect(flexible.length).toBeGreaterThan(0);
  });

  it('createCategory adds a new category', async () => {
    await createCategory('חדש', 'flexible', 'new-category');
    const categories = await listCategories();
    expect(categories.some((c) => c.slug === 'new-category')).toBe(true);
  });

  it('rejects a duplicate slug (UNIQUE constraint)', async () => {
    await createCategory('א', 'flexible', 'dup-slug');
    await expect(createCategory('ב', 'flexible', 'dup-slug')).rejects.toThrow();
  });

  it('archiveCategory hides a user category from listCategories', async () => {
    const id = await createCategory('חדש', 'flexible', 'new-category');
    await archiveCategory(id);
    const categories = await listCategories();
    expect(categories.some((c) => c.slug === 'new-category')).toBe(false);
  });

  it('archiveCategory refuses to archive a system category', async () => {
    const categories = await listCategories();
    const system = categories.find((c) => c.is_system === 1)!;
    await archiveCategory(system.id);
    const stillThere = (await listCategories()).find((c) => c.id === system.id);
    expect(stillThere).toBeDefined();
  });
});

describe('recurring entries', () => {
  useTestDb();

  it('creates and lists active recurring entries ordered by direction desc (out before in)', async () => {
    await createRecurringEntry({ name: 'שכירות', direction: 'out', defaultAmount: 5000 });
    await createRecurringEntry({ name: 'משכורת', direction: 'in', defaultAmount: 10000 });

    const entries = await listRecurringEntries();
    expect(entries.map((e) => e.direction)).toEqual(['out', 'in']);
  });

  it('deleteRecurringEntry soft-deletes (is_active = 0) rather than removing the row', async () => {
    const id = await createRecurringEntry({ name: 'x', direction: 'out', defaultAmount: 100 });
    await deleteRecurringEntry(id);
    expect(await listRecurringEntries()).toHaveLength(0);
  });
});
