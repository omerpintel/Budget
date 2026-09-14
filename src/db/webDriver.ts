import * as Comlink from 'comlink';
import type { ExecuteResult, SqlDriver, SqlParam } from './driver';
import type { SqliteWorkerApi } from './sqlite.worker';

/**
 * Browser adapter: SQLite-WASM in a worker, persisted to OPFS.
 * Swap for a `tauri-plugin-sql` adapter without touching callers.
 */
export class WebSqlDriver implements SqlDriver {
  private worker: Worker | null = null;
  private remote: Comlink.Remote<SqliteWorkerApi> | null = null;
  private openPromise: Promise<void> | null = null;

  /** False when OPFS was unavailable and data lives only in memory. */
  persistent = false;

  async open(): Promise<void> {
    if (this.openPromise) return this.openPromise;
    this.openPromise = (async () => {
      this.worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' });
      this.remote = Comlink.wrap<SqliteWorkerApi>(this.worker);
      const { persistent } = await this.remote.open();
      this.persistent = persistent;
    })();
    return this.openPromise;
  }

  private require(): Comlink.Remote<SqliteWorkerApi> {
    if (!this.remote) throw new Error('Driver not opened. Call open() first.');
    return this.remote;
  }

  select<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.require().select(sql, params) as Promise<T[]>;
  }

  execute(sql: string, params: SqlParam[] = []): Promise<ExecuteResult> {
    return this.require().execute(sql, params);
  }

  batch(statements: Array<{ sql: string; params?: SqlParam[] }>): Promise<void> {
    return this.require().batch(statements);
  }

  exportDb(): Promise<Uint8Array> {
    return this.require().exportDb() as Promise<Uint8Array>;
  }

  importDb(bytes: Uint8Array): Promise<void> {
    return this.require().importDb(bytes);
  }

  async close(): Promise<void> {
    await this.remote?.close();
    this.worker?.terminate();
    this.worker = null;
    this.remote = null;
    this.openPromise = null;
  }
}
