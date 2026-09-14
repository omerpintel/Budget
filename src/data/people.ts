import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import type { Person } from './types';

export async function listPeople(): Promise<Person[]> {
  return getDb().select<Person>('SELECT * FROM people ORDER BY sort_order, name');
}

export async function createPerson(name: string, color: string, sortOrder: number): Promise<string> {
  const id = uuid();
  const ts = nowIso();
  await getDb().execute(
    `INSERT INTO people (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name, color, sortOrder, ts, ts],
  );
  return id;
}

export async function renamePerson(id: string, name: string): Promise<void> {
  await getDb().execute('UPDATE people SET name = ?, updated_at = ? WHERE id = ?', [name, nowIso(), id]);
}
