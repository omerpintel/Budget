import type { SqlDriver } from './driver';
import { migrations } from './migrations';
import { nowIso } from '@/lib/utils';

export async function runMigrations(driver: SqlDriver): Promise<number[]> {
  await driver.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`,
  );

  const rows = await driver.select<{ version: number }>('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  const ran: number[] = [];

  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue;
    await driver.batch([
      ...migration.statements.map((sql) => ({ sql })),
      {
        sql: 'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        params: [migration.version, migration.name, nowIso()],
      },
    ]);
    ran.push(migration.version);
  }

  return ran;
}
