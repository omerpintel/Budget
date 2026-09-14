import { getDb } from '@/db';
import { getSetting, setSetting } from './settings';

const DIR = 'backups';
const KEEP = 7;
const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_SNAPSHOT_KEY = 'last_snapshot_at';

export interface Snapshot {
  name: string;
  size: number;
  createdAt: string;
}

function supported(): boolean {
  return typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage;
}

async function backupsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

function snapshotName(date = new Date()): string {
  return `budget-${date.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.sqlite3`;
}

export async function listSnapshots(): Promise<Snapshot[]> {
  if (!supported()) return [];
  const dir = await backupsDir();
  const found: Snapshot[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.sqlite3')) continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    found.push({ name, size: file.size, createdAt: new Date(file.lastModified).toISOString() });
  }
  return found.sort((a, b) => b.name.localeCompare(a.name));
}

export async function createSnapshot(): Promise<Snapshot | null> {
  if (!supported()) return null;
  const bytes = await getDb().exportDb();
  const dir = await backupsDir();
  const name = snapshotName();

  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(bytes as BufferSource);
  await writable.close();

  const stale = (await listSnapshots()).slice(KEEP);
  for (const snapshot of stale) await dir.removeEntry(snapshot.name);

  await setSetting(LAST_SNAPSHOT_KEY, new Date().toISOString());
  return { name, size: bytes.byteLength, createdAt: new Date().toISOString() };
}

/** Takes at most one snapshot a day, on launch, so it never interrupts anything. */
export async function autoSnapshot(): Promise<void> {
  if (!supported()) return;
  const last = await getSetting(LAST_SNAPSHOT_KEY);
  if (last && Date.now() - Date.parse(last) < SNAPSHOT_INTERVAL_MS) return;

  const hasData = await getDb().select<{ total: number }>(
    'SELECT COUNT(*) AS total FROM transactions',
  );
  if ((hasData[0]?.total ?? 0) === 0) return;

  try {
    await createSnapshot();
  } catch (err) {
    console.warn('Automatic snapshot failed', err);
  }
}

export async function readSnapshot(name: string): Promise<Uint8Array> {
  const dir = await backupsDir();
  const handle = await dir.getFileHandle(name);
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

export async function downloadSnapshot(name: string): Promise<void> {
  const bytes = await readSnapshot(name);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.sqlite3' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function restoreSnapshot(name: string): Promise<void> {
  await getDb().importDb(await readSnapshot(name));
}

export async function deleteSnapshot(name: string): Promise<void> {
  const dir = await backupsDir();
  await dir.removeEntry(name);
}
