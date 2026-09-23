import { completeOnboarding } from '@/features/onboarding/completeOnboarding';
import { listPeople } from '@/data/people';
import { listWallets } from '@/data/wallets';
import { ensureManualAccount } from '@/data/accounts';
import { listCategories } from '@/data/categories';
import { ensurePeriod, type PeriodRef } from '@/data/periods';
import { addIncome } from '@/data/budget';
import { createManualTransaction, type ManualTransactionInput } from '@/data/transactions';
import type { BudgetPeriod, Category, Person, Wallet } from '@/data/types';

/** Standard two-person household, matching what the onboarding wizard creates. */
export async function seedHousehold(overrides: Partial<Parameters<typeof completeOnboarding>[0]> = {}): Promise<{
  people: Person[];
  wallets: Wallet[];
}> {
  await completeOnboarding({
    people: [
      { name: 'עומר', color: 'omer' },
      { name: 'רוני', color: 'roni' },
    ],
    cards: [],
    jointBufferOpening: 0,
    savingsOpening: 0,
    closeDay: 1,
    ...overrides,
  });

  return { people: await listPeople(), wallets: await listWallets() };
}

export async function makePeriod(ref: PeriodRef): Promise<BudgetPeriod> {
  return ensurePeriod(ref);
}

export async function makeIncome(
  periodId: string,
  amount: number,
  overrides: Partial<{ personId: string | null; label: string }> = {},
): Promise<void> {
  await addIncome({
    periodId,
    personId: overrides.personId ?? null,
    label: overrides.label ?? 'משכורת',
    amount,
  });
}

export async function findCategory(slug: string): Promise<Category> {
  const categories = await listCategories();
  const category = categories.find((c) => c.slug === slug);
  if (!category) throw new Error(`Unknown category slug: ${slug}`);
  return category;
}

/** Creates (or reuses) the shared manual account this household's transactions live under. */
export async function makeManualAccount(): Promise<string> {
  return ensureManualAccount();
}

export async function makeTransaction(
  overrides: Partial<ManualTransactionInput> & Pick<ManualTransactionInput, 'periodId' | 'amount'>,
): Promise<string> {
  const accountId = overrides.accountId ?? (await makeManualAccount());
  return createManualTransaction({
    accountId,
    date: overrides.date ?? '2026-01-15',
    description: overrides.description ?? 'עסקת בדיקה',
    direction: overrides.direction ?? 'out',
    categoryId: overrides.categoryId ?? null,
    wallet: overrides.wallet ?? 'joint',
    personId: overrides.personId ?? null,
    note: overrides.note ?? null,
    ...overrides,
  });
}
