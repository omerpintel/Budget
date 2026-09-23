import { describe, expect, it } from 'vitest';
import { useTestDb } from '@/test/harness';
import {
  createAccount,
  deleteAccount,
  ensureManualAccount,
  getLatestDebitDay,
  listAccounts,
  updateAccount,
} from './accounts';

describe('accounts', () => {
  useTestDb();

  it('creates and lists accounts ordered by sort_order', async () => {
    await createAccount({ displayName: 'B', issuer: 'leumi', type: 'bank' }, 1);
    await createAccount({ displayName: 'A', issuer: 'hapoalim', type: 'bank' }, 0);

    const accounts = await listAccounts();
    expect(accounts.map((a) => a.display_name)).toEqual(['A', 'B']);
  });

  it('updates an account', async () => {
    const id = await createAccount({ displayName: 'Old', issuer: 'leumi', type: 'bank' });
    await updateAccount(id, { displayName: 'New', issuer: 'hapoalim', type: 'bank', last4: '1234' });

    const [account] = await listAccounts();
    expect(account.display_name).toBe('New');
    expect(account.issuer).toBe('hapoalim');
    expect(account.last4).toBe('1234');
  });

  it('deletes an account', async () => {
    const id = await createAccount({ displayName: 'X', issuer: 'leumi', type: 'bank' });
    await deleteAccount(id);
    expect(await listAccounts()).toHaveLength(0);
  });

  it('rejects a credit card with no owner or debit day (CHECK constraint)', async () => {
    await expect(createAccount({ displayName: 'Card', issuer: 'isracard', type: 'credit_card' })).rejects.toThrow();
  });

  it('getLatestDebitDay returns the max debit day among active credit cards', async () => {
    const { createPerson } = await import('./people');
    const personId = await createPerson('עומר', 'omer', 0);
    await createAccount({
      displayName: 'Card1',
      issuer: 'isracard',
      type: 'credit_card',
      ownerPersonId: personId,
      debitDay: 10,
    });
    await createAccount({
      displayName: 'Card2',
      issuer: 'max',
      type: 'credit_card',
      ownerPersonId: personId,
      debitDay: 25,
    });

    expect(await getLatestDebitDay()).toBe(25);
  });

  it('getLatestDebitDay returns null when there are no active credit cards', async () => {
    await createAccount({ displayName: 'Bank', issuer: 'leumi', type: 'bank' });
    expect(await getLatestDebitDay()).toBeNull();
  });

  it('ensureManualAccount creates the manual account once and reuses it', async () => {
    const id1 = await ensureManualAccount();
    const id2 = await ensureManualAccount();
    expect(id1).toBe(id2);
    expect(await listAccounts()).toHaveLength(1);
  });
});
