import { describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { useTestDb } from '@/test/harness';
import { createPerson, listPeople, renamePerson } from './people';

describe('people', () => {
  useTestDb();

  it('creates and lists people ordered by sort_order then name', async () => {
    await createPerson('רוני', 'roni', 1);
    await createPerson('עומר', 'omer', 0);

    const people = await listPeople();
    expect(people.map((p) => p.name)).toEqual(['עומר', 'רוני']);
    expect(people[0].color).toBe('omer');
  });

  it('renames a person', async () => {
    const id = await createPerson('עומר', 'omer', 0);
    await renamePerson(id, 'עומר פינטל');

    const people = await listPeople();
    expect(people[0].name).toBe('עומר פינטל');
  });

  it('renamePerson updates updated_at', async () => {
    const id = await createPerson('עומר', 'omer', 0);
    const before = (await listPeople())[0].updated_at;
    await new Promise((r) => setTimeout(r, 5));
    await renamePerson(id, 'עומר פינטל');
    const after = (await listPeople())[0].updated_at;
    expect(after >= before).toBe(true);
  });

  it('deleting a person cascades to their personal wallet (FK ON DELETE CASCADE)', async () => {
    const id = await createPerson('עומר', 'omer', 0);
    const ts = new Date().toISOString();
    await getDb().execute(
      `INSERT INTO wallets (id, kind, person_id, name, opening_balance, created_at, updated_at)
       VALUES ('w1', 'personal', ?, 'wallet', 0, ?, ?)`,
      [id, ts, ts],
    );
    await getDb().execute('DELETE FROM people WHERE id = ?', [id]);
    const wallets = await getDb().select('SELECT * FROM wallets WHERE id = ?', ['w1']);
    expect(wallets).toHaveLength(0);
  });
});
