import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import { buildDedupeHashes } from '@/services/import/dedupe';
import type { ParsedRow } from '@/services/import/parseFile';

export interface StagedRow extends ParsedRow {
  dedupeHash: string;
  isDuplicate: boolean;
}

export async function stageRows(accountId: string, rows: ParsedRow[]): Promise<StagedRow[]> {
  const hashes = await buildDedupeHashes(accountId, rows);
  const existing = await findExistingHashes(hashes);
  return rows.map((row, i) => ({
    ...row,
    dedupeHash: hashes[i],
    isDuplicate: existing.has(hashes[i]),
  }));
}

async function findExistingHashes(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const found = new Set<string>();
  // Chunked to stay well under SQLite's bound-parameter limit on large statements.
  for (let i = 0; i < hashes.length; i += 400) {
    const chunk = hashes.slice(i, i + 400);
    const rows = await getDb().select<{ dedupe_hash: string }>(
      `SELECT dedupe_hash FROM transactions WHERE dedupe_hash IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    );
    for (const row of rows) found.add(row.dedupe_hash);
  }
  return found;
}

export async function isFileAlreadyImported(fileHash: string): Promise<boolean> {
  const rows = await getDb().select<{ id: string }>(
    'SELECT id FROM import_batches WHERE file_sha256 = ? LIMIT 1',
    [fileHash],
  );
  return rows.length > 0;
}

export interface CommitImportInput {
  accountId: string;
  /** Null for historical backfill, which must not create or touch budget periods. */
  periodId: string | null;
  debitDate: string;
  fileName: string;
  fileHash: string;
  rows: StagedRow[];
  defaultCategoryId: string | null;
}

export interface CommitImportResult {
  batchId: string;
  inserted: number;
  duplicatesSkipped: number;
}

export async function commitImport(input: CommitImportInput): Promise<CommitImportResult> {
  const fresh = input.rows.filter((r) => !r.isDuplicate);
  const duplicatesSkipped = input.rows.length - fresh.length;
  const batchId = uuid();
  const ts = nowIso();

  const statements = [
    {
      sql: `INSERT INTO import_batches
              (id, account_id, target_period_id, file_name, file_sha256, debit_date,
               imported_at, row_count, duplicates_skipped, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        batchId,
        input.accountId,
        input.periodId,
        input.fileName,
        input.fileHash,
        input.debitDate,
        ts,
        fresh.length,
        duplicatesSkipped,
        ts,
        ts,
      ],
    },
    ...fresh.map((row) => ({
      sql: `INSERT INTO transactions
              (id, period_id, account_id, import_batch_id, entry_mode, direction,
               transaction_date, debit_date, amount, original_amount, original_currency,
               raw_description, category_id, wallet, is_masked, installment_current,
               installment_total, categorization_source, is_reviewed, is_excluded,
               note, dedupe_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'imported', ?, ?, ?, ?, ?, ?, ?, ?, 'joint', 0, ?, ?, 'default', 0, 0, ?, ?, ?, ?)`,
      params: [
        uuid(),
        input.periodId,
        input.accountId,
        batchId,
        row.direction,
        row.transactionDate,
        input.debitDate,
        row.amount,
        row.originalAmount,
        row.originalCurrency,
        row.description,
        input.defaultCategoryId,
        row.installment?.current ?? null,
        row.installment?.total ?? null,
        row.notes,
        row.dedupeHash,
        ts,
        ts,
      ],
    })),
  ];

  await getDb().batch(statements);
  return { batchId, inserted: fresh.length, duplicatesSkipped };
}

export async function getUncategorizedCategoryId(): Promise<string | null> {
  const rows = await getDb().select<{ id: string }>(
    "SELECT id FROM categories WHERE slug = 'uncategorized' LIMIT 1",
  );
  return rows[0]?.id ?? null;
}
