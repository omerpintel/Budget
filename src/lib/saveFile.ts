import { isDesktop } from '@/lib/platform';

/**
 * Writes bytes to wherever the user wants them: a native save dialog on the
 * desktop, a browser download otherwise. Returns false if the user cancelled.
 */
export async function saveBytes(bytes: Uint8Array, fileName: string): Promise<boolean> {
  if (isDesktop()) {
    const [{ save }, { writeFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const path = await save({
      defaultPath: fileName,
      filters: [{ name: 'SQLite database', extensions: ['sqlite3'] }],
    });
    if (!path) return false;
    await writeFile(path, bytes);
    return true;
  }

  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.sqlite3' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}
