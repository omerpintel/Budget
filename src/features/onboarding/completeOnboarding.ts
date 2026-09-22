import { getDb } from '@/db';
import { nowIso, uuid } from '@/lib/utils';
import { SETTING_KEYS } from '@/data/settings';

export interface OnboardingDraft {
  people: Array<{ name: string; color: string }>;
  cards: Array<{
    displayName: string;
    issuer: string;
    last4: string | null;
    ownerIndex: number;
    debitDay: number;
  }>;
  jointBufferOpening: number;
  savingsOpening: number;
  closeDay: number;
}

/**
 * Runs as one transaction and clears any partial prior attempt first, so an
 * abandoned or failed run can simply be retried without tripping unique constraints.
 */
export async function completeOnboarding(draft: OnboardingDraft): Promise<void> {
  const ts = nowIso();
  const personIds = draft.people.map(() => uuid());
  const statements: Array<{ sql: string; params?: Array<string | number | null> }> = [
    { sql: 'DELETE FROM accounts' },
    { sql: 'DELETE FROM wallets' },
    { sql: 'DELETE FROM people' },
  ];

  draft.people.forEach((person, i) => {
    statements.push({
      sql: `INSERT INTO people (id, name, color, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      params: [personIds[i], person.name, person.color, i, ts, ts],
    });
  });

  const wallet = (kind: string, name: string, personId: string | null, opening: number) => ({
    sql: `INSERT INTO wallets (id, kind, person_id, name, opening_balance, seeded_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [uuid(), kind, personId, name, opening, ts, ts, ts] as Array<string | number | null>,
  });

  statements.push(wallet('joint_buffer', 'כרית משותפת', null, draft.jointBufferOpening));
  statements.push(wallet('savings', 'חיסכון', null, draft.savingsOpening));
  draft.people.forEach((person, i) => {
    statements.push(wallet('personal', `הארנק של ${person.name}`, personIds[i], 0));
  });

  draft.cards.forEach((card, i) => {
    statements.push({
      sql: `INSERT INTO accounts
              (id, display_name, issuer, type, last4, owner_person_id, debit_day,
               is_active, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, 'credit_card', ?, ?, ?, 1, ?, ?, ?)`,
      params: [
        uuid(),
        card.displayName,
        card.issuer,
        card.last4,
        personIds[card.ownerIndex],
        card.debitDay,
        i,
        ts,
        ts,
      ],
    });
  });

  for (const [key, value] of [
    [SETTING_KEYS.closeDay, String(draft.closeDay)],
    [SETTING_KEYS.onboardingComplete, '1'],
  ] as const) {
    statements.push({
      sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      params: [key, value, ts],
    });
  }

  await getDb().batch(statements);
}
