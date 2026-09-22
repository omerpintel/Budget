import { getDb } from '@/db';
import { saveBytes } from '@/lib/saveFile';
import { setSetting, SETTING_KEYS } from './settings';

export async function downloadBackup(): Promise<string> {
  const bytes = await getDb().exportDb();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const fileName = `budget-backup-${stamp}.sqlite3`;

  if (!await saveBytes(bytes, fileName)) return '';

  await setSetting(SETTING_KEYS.lastBackupAt, new Date().toISOString());
  return fileName;
}

export async function restoreBackup(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = new TextDecoder().decode(bytes.slice(0, 15));
  if (header !== 'SQLite format 3') {
    throw new Error('That file is not a SQLite database.');
  }
  await getDb().importDb(bytes);
}
