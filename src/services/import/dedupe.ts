import type { ParsedRow } from './parseFile';

async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hashFile(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}

/**
 * Two identical charges on the same day are legitimate (two coffees), so the
 * occurrence index is part of the key. Re-importing the same statement still
 * produces identical hashes and is skipped.
 */
export async function buildDedupeHashes(
  accountId: string,
  rows: ParsedRow[],
): Promise<string[]> {
  const seen = new Map<string, number>();
  return Promise.all(
    rows.map((row) => {
      const key = [
        accountId,
        row.transactionDate,
        row.direction,
        row.amount,
        row.description,
      ].join('|');
      const occurrence = seen.get(key) ?? 0;
      seen.set(key, occurrence + 1);
      return sha256Hex(`${key}|${occurrence}`);
    }),
  );
}
