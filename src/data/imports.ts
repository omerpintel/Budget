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

export interface ImportBatchSummary {
  id: string;
  file_name: string;
  debit_date: string;
  imported_at: string;
  row_count: number;
  duplicates_skipped: number;
  account_name: string;
  target_period_id: string | null;
  year: number | null;
  month: number | null;
  /** Rows still present; diverges from row_count once transactions are deleted individually. */
  live_count: number;
  reviewed_count: number;
}

export async function listImportHistory(periodId?: string): Promise<ImportBatchSummary[]> {
  const scoped = periodId ? 'WHERE b.target_period_id = ?' : '';
  return getDb().select<ImportBatchSummary>(
    `SELECT b.id, b.file_name, b.debit_date, b.imported_at, b.row_count, b.duplicates_skipped,
            b.target_period_id, a.display_name AS account_name, p.year, p.month,
            (SELECT COUNT(*) FROM transactions t WHERE t.import_batch_id = b.id) AS live_count,
            (SELECT COUNT(*) FROM transactions t
              WHERE t.import_batch_id = b.id AND t.is_reviewed = 1) AS reviewed_count
     FROM import_batches b
     JOIN accounts a ON a.id = b.account_id
     LEFT JOIN budget_periods p ON p.id = b.target_period_id
     ${scoped}
     ORDER BY b.imported_at DESC`,
    periodId ? [periodId] : [],
  );
}

/**
 * Removes an upload and everything it brought in. Transactions cascade from the
 * batch row, so the period totals must be recomputed by the caller afterwards.
 * Returns the period the batch belonged to, if any.
 */
export async function deleteImportBatch(batchId: string): Promise<string | null> {
  const rows = await getDb().select<{ target_period_id: string | null }>(
    'SELECT target_period_id FROM import_batches WHERE id = ?',
    [batchId],
  );
  if (rows.length === 0) return null;

  await getDb().batch([
    { sql: 'DELETE FROM transactions WHERE import_batch_id = ?', params: [batchId] },
    { sql: 'DELETE FROM import_batches WHERE id = ?', params: [batchId] },
  ]);
  return rows[0].target_period_id;
}
