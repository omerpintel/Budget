/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { ExecuteResult, SqlParam } from './driver';

const DB_PATH = '/budget.db';
const POOL_DIR = '.budget-db';

let sqlite3: Sqlite3Static | null = null;
let db: Database | null = null;
// Only set when OPFS is available; in-memory fallback cannot import/export through the pool.
let poolUtil: Awaited<ReturnType<Sqlite3Static['installOpfsSAHPoolVfs']>> | null = null;

function requireDb(): Database {
  if (!db) throw new Error('Database not opened');
  return db;
}

const api = {
  async open(): Promise<{ persistent: boolean }> {
    if (db) return { persistent: poolUtil !== null };
    sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: console.error });

    try {
      poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: 'budget-pool', directory: POOL_DIR });
      db = new poolUtil.OpfsSAHPoolDb(DB_PATH);
    } catch (err) {
      console.warn('OPFS unavailable, falling back to in-memory database.', err);
      poolUtil = null;
      db = new sqlite3.oo1.DB(':memory:', 'c');
    }

    db.exec('PRAGMA foreign_keys = ON;');
    return { persistent: poolUtil !== null };
  },

  async select<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return requireDb().exec({
      sql,
      bind: params,
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as T[];
  },

  async execute(sql: string, params: SqlParam[] = []): Promise<ExecuteResult> {
    const handle = requireDb();
    handle.exec({ sql, bind: params });
    return { rowsAffected: handle.changes() };
  },

  async batch(statements: Array<{ sql: string; params?: SqlParam[] }>): Promise<void> {
    const handle = requireDb();
    handle.exec('BEGIN');
    try {
      for (const stmt of statements) {
        handle.exec({ sql: stmt.sql, bind: stmt.params ?? [] });
      }
      handle.exec('COMMIT');
    } catch (err) {
      handle.exec('ROLLBACK');
      throw err;
    }
  },

  async exportDb(): Promise<Uint8Array> {
    if (!sqlite3) throw new Error('Database not opened');
    return sqlite3.capi.sqlite3_js_db_export(requireDb());
  },

  async importDb(bytes: Uint8Array): Promise<void> {
    if (!poolUtil) throw new Error('Restore requires persistent storage (OPFS).');
    requireDb().close();
    db = null;
    await poolUtil.importDb(DB_PATH, bytes);
    db = new poolUtil.OpfsSAHPoolDb(DB_PATH);
    db.exec('PRAGMA foreign_keys = ON;');
  },

  async close(): Promise<void> {
    db?.close();
    db = null;
  },
};

export type SqliteWorkerApi = typeof api;

Comlink.expose(api);
