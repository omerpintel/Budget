export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

const initialSchema: Migration = {
  version: 1,
  name: 'initial_schema',
  statements: [
    `CREATE TABLE people (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,

    `CREATE TABLE wallets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('joint_buffer', 'savings', 'personal')),
      person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      opening_balance INTEGER NOT NULL DEFAULT 0,
      seeded_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (kind = 'personal' AND person_id IS NOT NULL) OR
        (kind <> 'personal' AND person_id IS NULL)
      )
    )`,
    `CREATE UNIQUE INDEX idx_wallets_singleton ON wallets(kind) WHERE kind <> 'personal'`,
    `CREATE UNIQUE INDEX idx_wallets_person ON wallets(person_id) WHERE kind = 'personal'`,

    `CREATE TABLE parser_profiles (
      id TEXT PRIMARY KEY,
      issuer TEXT NOT NULL,
      name TEXT NOT NULL,
      header_row_index INTEGER NOT NULL DEFAULT 0,
      column_map TEXT NOT NULL,
      encoding TEXT NOT NULL DEFAULT 'utf-8',
      date_format TEXT NOT NULL DEFAULT 'dd/MM/yyyy',
      amount_sign_convention TEXT NOT NULL DEFAULT 'charge_positive'
        CHECK (amount_sign_convention IN ('charge_positive', 'charge_negative')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,

    `CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      issuer TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('bank', 'credit_card', 'cash')),
      last4 TEXT,
      owner_person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
      debit_day INTEGER CHECK (debit_day BETWEEN 1 AND 28),
      parser_profile_id TEXT REFERENCES parser_profiles(id) ON DELETE SET NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (type <> 'credit_card' OR (owner_person_id IS NOT NULL AND debit_day IS NOT NULL))
    )`,

    `CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('income', 'fixed', 'flexible', 'personal', 'savings', 'transfer')),
      parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      color TEXT,
      icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,

    `CREATE TABLE budget_periods (
      id TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'committed')),
      committed_at TEXT,
      snapshot TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (year, month)
    )`,

    `CREATE TABLE budget_lines (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL REFERENCES budget_periods(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      planned_amount INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (period_id, category_id)
    )`,

    `CREATE TABLE personal_budgets (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL REFERENCES budget_periods(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      allowance INTEGER NOT NULL DEFAULT 0,
      rollover_in INTEGER NOT NULL DEFAULT 0,
      spent INTEGER NOT NULL DEFAULT 0,
      rollover_out INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (period_id, person_id)
    )`,

    `CREATE TABLE period_incomes (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL REFERENCES budget_periods(id) ON DELETE CASCADE,
      person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
      label TEXT NOT NULL,
      amount INTEGER NOT NULL,
      recurring_entry_id TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,

    `CREATE TABLE recurring_entries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
      default_amount INTEGER NOT NULL DEFAULT 0,
      day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,

    `CREATE TABLE merchants (
      id TEXT PRIMARY KEY,
      normalized_name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      default_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      default_wallet TEXT CHECK (default_wallet IN ('joint', 'personal')),
      times_seen INTEGER NOT NULL DEFAULT 0,
      first_seen TEXT,
      last_seen TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,

    `CREATE TABLE merchant_rules (
      id TEXT PRIMARY KEY,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'contains', 'regex')),
      pattern TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
      wallet TEXT CHECK (wallet IN ('joint', 'personal')),
      is_enabled INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'llm')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,

    `CREATE TABLE import_batches (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      target_period_id TEXT REFERENCES budget_periods(id) ON DELETE SET NULL,
      file_name TEXT NOT NULL,
      file_sha256 TEXT NOT NULL,
      debit_date TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      duplicates_skipped INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,

    `CREATE TABLE subscriptions (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      cadence TEXT NOT NULL CHECK (cadence IN ('monthly', 'bimonthly', 'quarterly', 'annual')),
      expected_amount INTEGER NOT NULL,
      tolerance INTEGER NOT NULL DEFAULT 0,
      last_charge_date TEXT,
      next_expected_date TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'watch', 'cancelled')),
      first_detected_period_id TEXT REFERENCES budget_periods(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,

    `CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      period_id TEXT REFERENCES budget_periods(id) ON DELETE SET NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      import_batch_id TEXT REFERENCES import_batches(id) ON DELETE CASCADE,
      entry_mode TEXT NOT NULL CHECK (entry_mode IN ('imported', 'manual')),
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
      transaction_date TEXT NOT NULL,
      debit_date TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount >= 0),
      original_amount INTEGER,
      original_currency TEXT,
      fx_rate REAL,
      raw_description TEXT NOT NULL,
      normalized_merchant TEXT,
      merchant_id TEXT REFERENCES merchants(id) ON DELETE SET NULL,
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      wallet TEXT NOT NULL DEFAULT 'joint' CHECK (wallet IN ('joint', 'personal')),
      personal_person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
      is_masked INTEGER NOT NULL DEFAULT 0,
      funding_wallet_id TEXT REFERENCES wallets(id) ON DELETE SET NULL,
      installment_current INTEGER,
      installment_total INTEGER,
      categorization_source TEXT CHECK (categorization_source IN ('exact', 'rule', 'llm', 'user', 'default')),
      llm_confidence REAL,
      is_reviewed INTEGER NOT NULL DEFAULT 0,
      is_excluded INTEGER NOT NULL DEFAULT 0,
      subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
      note TEXT,
      dedupe_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (wallet = 'joint' OR personal_person_id IS NOT NULL)
    )`,
    `CREATE UNIQUE INDEX idx_transactions_dedupe ON transactions(dedupe_hash)`,
    `CREATE INDEX idx_transactions_period ON transactions(period_id)`,
    `CREATE INDEX idx_transactions_merchant ON transactions(merchant_id)`,
    `CREATE INDEX idx_transactions_txdate ON transactions(transaction_date)`,
    `CREATE INDEX idx_transactions_account ON transactions(account_id)`,

    `CREATE TABLE wallet_ledger (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL REFERENCES budget_periods(id) ON DELETE CASCADE,
      wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      opening INTEGER NOT NULL,
      inflow INTEGER NOT NULL,
      outflow INTEGER NOT NULL,
      delta INTEGER NOT NULL,
      closing INTEGER NOT NULL,
      computed_at TEXT NOT NULL,
      UNIQUE (period_id, wallet_id)
    )`,

    `CREATE TABLE wallet_transfers (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL REFERENCES budget_periods(id) ON DELETE CASCADE,
      from_wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      to_wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL CHECK (amount > 0),
      reason TEXT,
      created_at TEXT NOT NULL,
      CHECK (from_wallet_id <> to_wallet_id)
    )`,

    `CREATE TABLE insights (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL REFERENCES budget_periods(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
      title TEXT NOT NULL,
      body TEXT,
      payload TEXT,
      is_dismissed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,

    `CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,

    // Single chokepoint for joint-scope reads: personal rows can never leak a vendor name.
    `CREATE VIEW v_transactions_joint AS
      SELECT
        t.id,
        t.period_id,
        t.account_id,
        t.entry_mode,
        t.direction,
        t.transaction_date,
        t.debit_date,
        t.amount,
        t.category_id,
        t.wallet,
        t.personal_person_id,
        t.funding_wallet_id,
        t.is_excluded,
        t.is_reviewed,
        t.is_masked,
        CASE WHEN t.is_masked = 1 THEN 'הוצאה אישית' ELSE t.raw_description END AS description,
        CASE WHEN t.is_masked = 1 THEN NULL ELSE t.normalized_merchant END AS normalized_merchant,
        CASE WHEN t.is_masked = 1 THEN NULL ELSE t.merchant_id END AS merchant_id
      FROM transactions t`,
  ],
};

export const migrations: Migration[] = [initialSchema];
