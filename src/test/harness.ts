import { afterEach, beforeEach } from 'vitest';
import { setDbForTests } from '@/db';
import { MemorySqlDriver } from '@/db/testDriver';
import { runMigrations } from '@/db/migrate';
import { seedCategories } from '@/db/seed';
import type { SqlDriver } from '@/db/driver';

/** Fresh, migrated, seeded in-memory database for a single test. */
export async function createTestDb(): Promise<SqlDriver> {
  const driver = new MemorySqlDriver();
  await driver.open();
  await runMigrations(driver);
  await seedCategories(driver);
  setDbForTests(driver);
  return driver;
}

/**
 * Call once at the top of a data-layer test file: gives every test in the file
 * its own fresh database, wired into `getDb()` via `setDbForTests`.
 */
export function useTestDb(): void {
  beforeEach(async () => {
    await createTestDb();
  });

  afterEach(async () => {
    const { getDb } = await import('@/db');
    try {
      await getDb().close();
    } finally {
      setDbForTests(null);
    }
  });
}
