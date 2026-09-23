import { DatabaseSync } from 'node:sqlite';
import type { ExecuteResult, SqlDriver, SqlParam } from './driver';

/**
 * In-memory driver for tests, backed by Node's built-in `node:sqlite`. Same
 * `SqlDriver` contract as the browser/desktop drivers, so data-layer code under
 * test never knows the difference.
 */
export class MemorySqlDriver implements SqlDriver {
  private db: DatabaseSync | null = null;

  private require(): DatabaseSync {
    if (!this.db) throw new Error('Driver not opened. Call open() first.');
    return this.db;
  }

  async open(): Promise<void> {
    if (this.db) return;
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  async select<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.require().prepare(sql).all(...params) as T[];
  }

  async execute(sql: string, params: SqlParam[] = []): Promise<ExecuteResult> {
    const info = this.require().prepare(sql).run(...params);
    return { rowsAffected: Number(info.changes) };
  }

  async batch(statements: Array<{ sql: string; params?: SqlParam[] }>): Promise<void> {
    const db = this.require();
    db.exec('BEGIN');
    try {
      for (const stmt of statements) {
        db.prepare(stmt.sql).run(...(stmt.params ?? []));
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  async exportDb(): Promise<Uint8Array> {
    throw new Error('exportDb is not supported by the in-memory test driver.');
  }

  async importDb(): Promise<void> {
    throw new Error('importDb is not supported by the in-memory test driver.');
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }
}
