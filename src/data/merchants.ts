import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import type { WalletScope } from './types';
import type { KnownMerchant } from '@/services/categorize/rules';

export interface Merchant extends KnownMerchant {
  display_name: string;
  times_seen: number;
  first_seen: string | null;
  last_seen: string | null;
}

export async function listMerchants(): Promise<Merchant[]> {
  return getDb().select<Merchant>('SELECT * FROM merchants ORDER BY times_seen DESC, display_name');
}

export interface MerchantSighting {
  normalized: string;
  display: string;
  date: string;
}

/** Inserts unseen merchants and refreshes sighting counters for the rest. */
export async function recordSightings(sightings: MerchantSighting[]): Promise<Map<string, string>> {
  const grouped = new Map<string, { display: string; count: number; first: string; last: string }>();
  for (const s of sightings) {
    if (s.normalized === '') continue;
    const entry = grouped.get(s.normalized);
    if (entry) {
      entry.count += 1;
      if (s.date < entry.first) entry.first = s.date;
      if (s.date > entry.last) entry.last = s.date;
    } else {
      grouped.set(s.normalized, { display: s.display, count: 1, first: s.date, last: s.date });
    }
  }
  if (grouped.size === 0) return new Map();

  const ts = nowIso();
  await getDb().batch(
    [...grouped.entries()].map(([normalized, info]) => ({
      sql: `INSERT INTO merchants
              (id, normalized_name, display_name, times_seen, first_seen, last_seen, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(normalized_name) DO UPDATE SET
              times_seen = times_seen + excluded.times_seen,
              first_seen = MIN(COALESCE(first_seen, excluded.first_seen), excluded.first_seen),
              last_seen  = MAX(COALESCE(last_seen, excluded.last_seen), excluded.last_seen),
              updated_at = excluded.updated_at`,
      params: [uuid(), normalized, info.display, info.count, info.first, info.last, ts, ts],
    })),
  );

  const rows = await getDb().select<{ id: string; normalized_name: string }>(
    'SELECT id, normalized_name FROM merchants',
  );
  return new Map(rows.map((r) => [r.normalized_name, r.id]));
}

export async function setMerchantDefaults(
  merchantId: string,
  categoryId: string | null,
  wallet: WalletScope | null,
): Promise<void> {
  await getDb().execute(
    `UPDATE merchants SET default_category_id = ?, default_wallet = ?, updated_at = ? WHERE id = ?`,
    [categoryId, wallet, nowIso(), merchantId],
  );
}
