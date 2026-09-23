import { describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { findCategory } from '@/test/factories';
import { useTestDb } from '@/test/harness';
import { listMerchants, recordSightings, setMerchantDefaults } from './merchants';

describe('merchants', () => {
  useTestDb();

  it('recordSightings inserts unseen merchants and counts occurrences', async () => {
    const map = await recordSightings([
      { normalized: 'shufersal', display: 'שופרסל', date: '2026-01-01' },
      { normalized: 'shufersal', display: 'שופרסל', date: '2026-01-05' },
      { normalized: 'aroma', display: 'ארומה', date: '2026-01-02' },
    ]);
    expect(map.size).toBe(2);

    const merchants = await listMerchants();
    const shufersal = merchants.find((m) => m.normalized_name === 'shufersal')!;
    expect(shufersal.times_seen).toBe(2);
    expect(shufersal.first_seen).toBe('2026-01-01');
    expect(shufersal.last_seen).toBe('2026-01-05');
  });

  it('recordSightings accumulates times_seen across separate calls', async () => {
    await recordSightings([{ normalized: 'shufersal', display: 'שופרסל', date: '2026-01-01' }]);
    await recordSightings([{ normalized: 'shufersal', display: 'שופרסל', date: '2026-02-01' }]);

    const [merchant] = await listMerchants();
    expect(merchant.times_seen).toBe(2);
    expect(merchant.first_seen).toBe('2026-01-01');
    expect(merchant.last_seen).toBe('2026-02-01');
  });

  it('recordSightings ignores empty normalized names and an empty list', async () => {
    expect((await recordSightings([])).size).toBe(0);
    expect((await recordSightings([{ normalized: '', display: 'x', date: '2026-01-01' }])).size).toBe(0);
    expect(await listMerchants()).toHaveLength(0);
  });

  it('listMerchants orders by times_seen desc', async () => {
    await recordSightings([
      { normalized: 'a', display: 'A', date: '2026-01-01' },
      { normalized: 'b', display: 'B', date: '2026-01-01' },
      { normalized: 'b', display: 'B', date: '2026-01-02' },
    ]);
    const merchants = await listMerchants();
    expect(merchants[0].normalized_name).toBe('b');
  });

  it('setMerchantDefaults sets the default category and wallet', async () => {
    const groceries = await findCategory('groceries');
    const map = await recordSightings([{ normalized: 'shufersal', display: 'שופרסל', date: '2026-01-01' }]);
    const merchantId = map.get('shufersal')!;

    await setMerchantDefaults(merchantId, groceries.id, 'joint');
    const merchant = (
      await getDb().select<{ default_category_id: string; default_wallet: string }>(
        'SELECT default_category_id, default_wallet FROM merchants WHERE id = ?',
        [merchantId],
      )
    )[0];
    expect(merchant.default_category_id).toBe(groceries.id);
    expect(merchant.default_wallet).toBe('joint');
  });
});
