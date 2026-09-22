import type { ExecuteResult, SqlDriver, SqlParam } from './driver';

type Invoke = <T>(cmd: string, args?: unknown) => Promise<T>;

/** Desktop adapter: real SQLite file managed by the Rust side. */
export class TauriSqlDriver implements SqlDriver {
  private invoke: Invoke | null = null;

  /** Absolute path of the database file, shown in Settings. */
  path = '';

  readonly persistent = true;

  async open(): Promise<void> {
    if (this.invoke) return;
    const { invoke } = await import('@tauri-apps/api/core');
    this.invoke = invoke as Invoke;
    const info = await this.invoke<{ path: string }>('db_open');
    this.path = info.path;
  }

  private require(): Invoke {
    if (!this.invoke) throw new Error('Driver not opened. Call open() first.');
    return this.invoke;
  }

  select<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.require()<T[]>('db_select', { sql, params: toArgs(params) });
  }

  execute(sql: string, params: SqlParam[] = []): Promise<ExecuteResult> {
    return this.require()<ExecuteResult>('db_execute', { sql, params: toArgs(params) });
  }

  batch(statements: Array<{ sql: string; params?: SqlParam[] }>): Promise<void> {
    return this.require()<void>('db_batch', {
      statements: statements.map((s) => ({ sql: s.sql, params: toArgs(s.params ?? []) })),
    });
  }

  async exportDb(): Promise<Uint8Array> {
    const buffer = await this.require()<ArrayBuffer>('db_export');
    return new Uint8Array(buffer);
  }

  async importDb(bytes: Uint8Array): Promise<void> {
    await this.require()<void>('db_import', bytes);
  }

  async close(): Promise<void> {
    await this.require()<void>('db_close');
    this.invoke = null;
  }
}

/** Blobs have no JSON form, so they cross the IPC boundary as byte arrays. */
function toArgs(params: SqlParam[]): Array<string | number | null | number[]> {
  return params.map((p) => (p instanceof Uint8Array ? Array.from(p) : p));
}
