import type { SqlDriver } from './driver';
import { WebSqlDriver } from './webDriver';
import { runMigrations } from './migrate';
import { seedCategories } from './seed';

let driver: SqlDriver | null = null;
let initPromise: Promise<SqlDriver> | null = null;

export function getDb(): SqlDriver {
  if (!driver) throw new Error('Database not initialised. Call initDb() first.');
  return driver;
}

export function initDb(): Promise<SqlDriver> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const instance = new WebSqlDriver();
    await instance.open();
    await runMigrations(instance);
    await seedCategories(instance);
    driver = instance;
    return instance;
  })();
  return initPromise;
}

export * from './driver';
