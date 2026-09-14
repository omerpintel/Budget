export type SqlParam = string | number | null | Uint8Array;

export interface ExecuteResult {
  rowsAffected: number;
}

/**
 * Storage contract shared by the SQLite-WASM worker (browser dev) and the
 * future Tauri `tauri-plugin-sql` adapter. Keep it minimal so both can satisfy it.
 */
export interface SqlDriver {
  open(): Promise<void>;
  select<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  execute(sql: string, params?: SqlParam[]): Promise<ExecuteResult>;
  /** Runs statements sequentially inside a single transaction. */
  batch(statements: Array<{ sql: string; params?: SqlParam[] }>): Promise<void>;
  exportDb(): Promise<Uint8Array>;
  importDb(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export async function selectOne<T = Record<string, unknown>>(
  driver: SqlDriver,
  sql: string,
  params?: SqlParam[],
): Promise<T | null> {
  const rows = await driver.select<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}
