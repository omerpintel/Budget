import { describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { makePeriod } from '@/test/factories';
import { useTestDb } from '@/test/harness';
import { ensureManualAccount } from './accounts';
import {
  commitImport,
  deleteImportBatch,
  getUncategorizedCategoryId,
  isFileAlreadyImported,
  listImportHistory,
  stageRows,
  type StagedRow,
} from './imports';
import type { ParsedRow } from '@/services/import/parseFile';

function row(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    rowIndex: 0,
    transactionDate: '2026-01-10',
    description: 'שופרסל',
    amount: 100,
    direction: 'out',
    originalAmount: null,
    originalCurrency: null,
    installment: null,
    issuerCategory: null,
    notes: null,
    ...overrides,
  };
}

describe('imports', () => {
  useTestDb();

  it('stageRows marks nothing as duplicate on a first import', async () => {
    const accountId = await ensureManualAccount();
    const staged = await stageRows(accountId, [row(), row({ rowIndex: 1, description: 'other' })]);
    expect(staged.every((r) => !r.isDuplicate)).toBe(true);
    expect(new Set(staged.map((r) => r.dedupeHash)).size).toBe(2);
  });

  it('two identical same-day charges get distinct hashes (both survive)', async () => {
    const accountId = await ensureManualAccount();
    const staged = await stageRows(accountId, [row(), row({ rowIndex: 1 })]);
    expect(staged[0].dedupeHash).not.toBe(staged[1].dedupeHash);
    expect(staged.every((r) => !r.isDuplicate)).toBe(true);
  });

  it('re-staging the same file after commit marks every row a duplicate', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const accountId = await ensureManualAccount();
    const rows = [row(), row({ rowIndex: 1 })];
    const staged = await stageRows(accountId, rows);

    await commitImport({
      accountId,
      periodId: period.id,
      debitDate: '2026-01-10',
      fileName: 'statement.csv',
      fileHash: 'hash1',
      rows: staged,
      defaultCategoryId: null,
    });

    const restaged = await stageRows(accountId, rows);
    expect(restaged.every((r) => r.isDuplicate)).toBe(true);
  });

  it('isFileAlreadyImported reflects import_batches.file_sha256', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const accountId = await ensureManualAccount();
    expect(await isFileAlreadyImported('hash1')).toBe(false);

    const staged = await stageRows(accountId, [row()]);
    await commitImport({
      accountId,
      periodId: period.id,
      debitDate: '2026-01-10',
      fileName: 'statement.csv',
      fileHash: 'hash1',
      rows: staged,
      defaultCategoryId: null,
    });

    expect(await isFileAlreadyImported('hash1')).toBe(true);
  });

  it('commitImport inserts only the fresh rows and records duplicatesSkipped', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const accountId = await ensureManualAccount();
    const staged: StagedRow[] = [
      { ...row(), dedupeHash: 'a', isDuplicate: false },
      { ...row({ rowIndex: 1 }), dedupeHash: 'b', isDuplicate: true },
    ];

    const result = await commitImport({
      accountId,
      periodId: period.id,
      debitDate: '2026-01-10',
      fileName: 'statement.csv',
      fileHash: 'hash1',
      rows: staged,
      defaultCategoryId: null,
    });

    expect(result.inserted).toBe(1);
    expect(result.duplicatesSkipped).toBe(1);

    const txCount = await getDb().select<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
    expect(txCount[0].n).toBe(1);
  });

  it('getUncategorizedCategoryId resolves the seeded uncategorized category', async () => {
    const id = await getUncategorizedCategoryId();
    expect(id).not.toBeNull();
    const category = (
      await getDb().select<{ slug: string }>('SELECT slug FROM categories WHERE id = ?', [id])
    )[0];
    expect(category.slug).toBe('uncategorized');
  });

  it('listImportHistory reports live and reviewed counts', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const accountId = await ensureManualAccount();
    const staged = await stageRows(accountId, [row(), row({ rowIndex: 1 })]);
    const { batchId } = await commitImport({
      accountId,
      periodId: period.id,
      debitDate: '2026-01-10',
      fileName: 'statement.csv',
      fileHash: 'hash1',
      rows: staged,
      defaultCategoryId: null,
    });

    const history = await listImportHistory(period.id);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(batchId);
    expect(history[0].live_count).toBe(2);
    expect(history[0].reviewed_count).toBe(0);
  });

  it('deleteImportBatch (undo) removes its transactions and returns the target period', async () => {
    const period = await makePeriod({ year: 2026, month: 1 });
    const accountId = await ensureManualAccount();
    const staged = await stageRows(accountId, [row(), row({ rowIndex: 1 })]);
    const { batchId } = await commitImport({
      accountId,
      periodId: period.id,
      debitDate: '2026-01-10',
      fileName: 'statement.csv',
      fileHash: 'hash1',
      rows: staged,
      defaultCategoryId: null,
    });

    const targetPeriodId = await deleteImportBatch(batchId);
    expect(targetPeriodId).toBe(period.id);

    const txCount = await getDb().select<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
    expect(txCount[0].n).toBe(0);
    expect(await listImportHistory(period.id)).toHaveLength(0);
  });

  it('deleteImportBatch returns null for an unknown batch id', async () => {
    expect(await deleteImportBatch('nonexistent')).toBeNull();
  });
});
