export type CategoryKind = 'income' | 'fixed' | 'flexible' | 'personal' | 'savings' | 'transfer';
export type WalletKind = 'joint_buffer' | 'savings' | 'personal';
export type WalletScope = 'joint' | 'personal';
export type AccountType = 'bank' | 'credit_card' | 'cash';
export type Direction = 'in' | 'out';
export type PeriodStatus = 'draft' | 'committed';
export type EntryMode = 'imported' | 'manual';
export type CategorizationSource = 'exact' | 'rule' | 'llm' | 'user' | 'default';

export interface Person {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Wallet {
  id: string;
  kind: WalletKind;
  person_id: string | null;
  name: string;
  opening_balance: number;
  seeded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  display_name: string;
  issuer: string;
  type: AccountType;
  last4: string | null;
  owner_person_id: string | null;
  debit_day: number | null;
  parser_profile_id: string | null;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  kind: CategoryKind;
  parent_id: string | null;
  color: string | null;
  icon: string | null;
  sort_order: number;
  is_archived: number;
  is_system: number;
  created_at: string;
  updated_at: string;
}

export interface RecurringEntry {
  id: string;
  name: string;
  direction: Direction;
  category_id: string | null;
  person_id: string | null;
  default_amount: number;
  day_of_month: number | null;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BudgetPeriod {
  id: string;
  year: number;
  month: number;
  status: PeriodStatus;
  committed_at: string | null;
  snapshot: string | null;
  created_at: string;
  updated_at: string;
}

/** Israeli issuers whose statement formats ship with the app. */
export const ISSUERS = [
  { value: 'isracard', label: 'Isracard' },
  { value: 'max', label: 'Max' },
  { value: 'cal', label: 'Cal (Visa Cal)' },
  { value: 'amex-il', label: 'American Express (IL)' },
  { value: 'hapoalim', label: 'Bank Hapoalim' },
  { value: 'leumi', label: 'Bank Leumi' },
  { value: 'discount', label: 'Discount Bank' },
  { value: 'mizrahi', label: 'Mizrahi Tefahot' },
  { value: 'other', label: 'Other' },
] as const;

export const PERSON_COLORS = ['omer', 'roni'] as const;
