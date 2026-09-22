# Plan: Local "Mine/Yours/Ours" Budget Desktop App (v2 — after user answers)

Workspace: `c:\Users\OMERPI\Documents\Budget` (empty, greenfield).

## Locked decisions
- Israeli issuers, Hebrew CSV/XLS, ILS. Single install on Omer's PC, both users. No sync.
- Privacy = Option A (masked in UI, raw text stays in DB).
- Stack: **Tauri v2 + React + TS + Vite + Tailwind v4 + shadcn/ui + SQLite (tauri-plugin-sql)**.
- Ollama not installed. Model: `gemma3:12b` (fallback `gemma3:4b`, CPU `qwen2.5:3b-instruct`).

### PERIOD MODEL = CASH-FLOW (critical)
Period N = calendar month N = everything that **hits the bank account** in month N:
- salaries received in month N (manual, variable, entered each month)
- rent/wires paid in month N (manual, from recurring templates)
- credit-card bill debited in month N (covers month N-1 *spending*) — imported
Session runs ONCE at start of month N; all cash events knowable by then.
**Single retrospective period (option B)**: plan + actuals reconciled in same sitting.
=> `budget_lines.planned_amount` is a **reference benchmark**, not a forward constraint.
Period assignment for imported rows = month of statement **debit date** (`accounts.debit_day`), NOT transaction date. Store both dates.

### Wallets — FOUR pools, no named savings goals
1. Joint Buffer (flexible surplus/deficit, may go **negative**)
2. Savings Buffer (funded by planned monthly line + ad-hoc transfers; can fund big expenses)
3. Omer Personal rollover (unlimited, never expires)
4. Roni Personal rollover (unlimited, never expires)
Seed 1 & 2 from real bank balances during onboarding.

### Personal vs Joint
- No joint card. Each person has own card. Card owner => which person a personal tag maps to (no "whose?" prompt).
- **Every transaction defaults to JOINT**; user sweeps each one. `P` toggles personal.
- App learns `merchants.default_wallet` from corrections => later months mostly auto.
- Auto-accept AI when confidence >= 0.9 (category AND learned wallet), collapsed "auto-applied (N) — review" section.

### Negative Joint Buffer
Allowed. On commit, if negative -> "Cover shortfall" dialog offering transfers from Omer personal / Roni personal / Savings. Decline => carries negative.

### Equations
Plan:  Income(N) - Fixed(N) - Allowance(Omer) - Allowance(Roni) - PlannedSavings(N) = JointFlexPlan(N)
JointBuffer.closing = opening + Income_act - Fixed_act - JointFlex_act - Allowance_total - PlannedSavings_act +/- transfers
Personal[p].closing = opening + Allowance[p] - PersonalSpent[p] +/- transfers
Savings.closing     = opening + PlannedSavings + transfers_in - transfers_out - savings_funded_expenses
Transactions with `funding_wallet_id = savings` are excluded from JointFlex_act.

## Schema (SQLite)
people | accounts(owner_person_id, debit_day, parser_profile_id) | parser_profiles |
import_batches(debit_date, target_period_id) | transactions(transaction_date, debit_date,
period_id, wallet, personal_person_id, is_masked, funding_wallet_id, entry_mode,
installment_current/total, dedupe_hash, categorization_source, llm_confidence) |
merchants(default_category_id, default_wallet) | merchant_rules | categories(kind:
income/fixed/flexible/personal/savings/transfer) | budget_periods(status draft|committed, snapshot) |
budget_lines | personal_budgets(allowance, rollover_in/out) | period_incomes(person_id, amount) |
recurring_expenses(templates) | **wallets** | **wallet_ledger** (1 row/wallet/period) |
**wallet_transfers** | subscriptions | insights | settings | schema_migrations
(Replaced old buffer_ledger/buffer_adjustments with wallets/wallet_ledger/wallet_transfers.)

### v3 additions (final answers)
- Installments: book ONLY the amount debited this month. Parser keeps `3/12` for context; insight shows total future installment liability.
- **No bank CSV import.** All bank-side movements entered MANUALLY in wizard: income (salaries, refunds, gifts) AND expenses (rent, wires, mortgage). No transfer double-count problem.
- `recurring_entries` table replaces `recurring_expenses` — has `direction` (in/out), covers salary + rent templates.
- Onboarding: ask user to SPLIT starting bank balance between Savings and Joint Buffer. Personal wallets start at 0.
- **`settings.close_day`** (1-28), user-configurable. Drives reminder + default target period only; periods stay CALENDAR months. Validation: warn if close_day < max(accounts.debit_day) or < expected salary day. Wizard can be run manually any day.

## Monthly Run wizard (4 steps, one sitting)
Bank (manual in/out from recurring_entries) -> Import cards -> Triage -> Reconcile & Commit

## Milestones
M0 scaffold | M1 DB+migrations+onboarding(seed balances, people, cards) |
M2 import (Israeli adapters, mapping wizard, dedupe, **historical backfill mode**) |
M3 normalizer+rules engine+manual entry+recurring templates |
M4 Ollama categorizer | M5 Triage UI (joint/personal sweep, auto-accept >=0.9) |
M6 wallets + period engine + transfers + shortfall dialog |
M7 dashboard + Monthly Run wizard | M8 insights | M9 polish/packaging | M10 Tauri desktop shell |
M11 UX rework (nav 8->5, global month switcher, import undo) + full Hebrew RTL.

## Status
**M0-M11 IMPLEMENTED. Hebrew RTL app, runs in the browser and as a native desktop window.**
VS2022 Community already has the "Desktop development with C++" workload (verified via vswhere).
Rust 1.98.1 (stable-x86_64-pc-windows-msvc) installed.
GitHub repo: https://github.com/omerpintel/Budget.git

### M11 UX rework + Hebrew RTL facts
Driven by the user reporting the app was confusing: too many tabs, no way to browse other
months, no way to undo an upload.
- **Nav collapsed 8 -> 5**: מרכז (/) · סגירת חודש (/run) · תנועות (/transactions) ·
  תקציב (/budget) · הגדרות (/settings). Import and Triage are no longer nav entries — they were
  duplicate doors to screens already embedded in the Monthly Run wizard. `/import` and `/triage`
  now redirect into the wizard so old links still work.
- **Insights is not in the nav** but is still routed at `/insights`, reached from the "שווה מבט"
  card on the overview. It was NOT deleted, because it owns the subscription-dismiss control.
- **`src/state/period.tsx` is the single source of truth for the selected month.**
  `PeriodProvider` wraps the router; `usePeriod()` gives `{ref, isCurrent, shiftBy, goToCurrent}`.
  `PeriodSwitcher` lives in the AppShell topbar. Overview / Run / Transactions / Budget / Insights
  all read it — the four independent period dropdowns they each had are gone.
- **Browsing to a month must never create it.** Pages use `findPeriod` (returns null) and show an
  empty state; only the current month auto-`ensurePeriod`s, plus an explicit "open this month"
  button on the Run page. Otherwise arrowing through months litters `budget_periods`.
- **Import undo**: `deleteImportBatch()` in `data/imports.ts`; `transactions.import_batch_id` is
  `ON DELETE CASCADE` but the rows are deleted explicitly too, then the period is recomputed.
  `listImportHistory()` reports `live_count` and `reviewed_count` so the confirm step can warn.
  UI is `features/import/ImportHistory.tsx`, used on the overview and in Run step 2.
- **RTL**: `index.html` is `lang="he" dir="rtl"`. Physical Tailwind utilities were converted to
  logical ones (`border-e`, `ps-`/`pe-`, `text-start`/`text-end`). Heebo is now the primary font.
- **`.dir-icon` (index.css) mirrors arrow icons** that express direction of travel. Lucide
  Arrow/Chevron icons do not flip on their own.
- **Money must be bidi-isolated.** `formatAgorot` wraps output in U+2066…U+2069 (LRI…PDI), because
  "₪0" and "−₪1,250" get reordered by the bidi algorithm when they sit in Hebrew prose — "₪0"
  rendered as "0₪" while "₪28,284" rendered correctly, in the same row of cards.
  `stripBidi()` is exported for comparisons. `.tnum` additionally sets `direction: ltr; unicode-bidi: isolate`.
  **`MoneyInput` deliberately uses PHYSICAL `right-3 / pr-7 / text-right`** — `.tnum` forces the
  field to LTR, so logical padding would resolve away from the ₪ affix and overlap the digits.
- **Category and wallet names are DATA**, so translating `db/seed.ts` was not enough:
  migration **v2 `hebrew_default_names`** renames seeded categories + joint/savings wallets, and
  **v3 `hebrew_personal_wallet_names`** renames "<person>'s Wallet". Both match on the old English
  name as well as the slug, so anything the user renamed themselves is left untouched.
  Verified against the real desktop DB: migrations 1-3 applied, 42 transactions preserved.
- Ollama: `OLLAMA_ORIGINS` must include `http://tauri.localhost` (User-scope env var) or every
  request from the desktop app fails CORS and surfaces as a bare "Failed to fetch".

### M10 desktop facts
- `src-tauri/` is a Tauri v2 shell. `npm run desktop` = `tauri dev`, `npm run desktop:build` = installer.
- **`src-tauri/src/db.rs` implements the SqlDriver contract natively with rusqlite (bundled SQLite).**
  Commands: db_open/db_select/db_execute/db_batch/db_export/db_import/db_close.
  `db_execute` falls back to `execute_batch` when there are no params, because migrations ship
  multi-statement DDL that rusqlite's `execute` refuses.
  `db_batch` uses `unchecked_transaction()` so it only needs `&Connection`.
  `db_export` uses **VACUUM INTO** a temp file — a consistent copy even with a live WAL.
  `db_import` stages the new file and only then closes/renames, so a failed write cannot destroy
  the live ledger; it also deletes the stale `-wal`/`-shm` siblings.
- Blobs cross IPC as arrays of byte values; export returns raw bytes via `tauri::ipc::Response`,
  import receives raw bytes via `tauri::ipc::Request`.
- `src/db/tauriDriver.ts` + `src/lib/platform.ts` (`isDesktop()` checks `__TAURI_INTERNALS__`).
  `initDb()` dynamically imports the Tauri driver so the web bundle never pulls it in.
- `src/lib/saveFile.ts` — native save dialog on desktop, anchor download in the browser.
  Used by both `downloadBackup` and `downloadSnapshot`.
- DB lives at `%APPDATA%\com.omerpintel.budget\budget.sqlite3` (WAL mode, foreign_keys ON).
- **CSP must include `ipc:` and `http://ipc.localhost`** in connect-src or every IPC call is blocked.
  Kept in sync between `index.html` and `tauri.conf.json`.
- **Vite's watcher must ignore `**/src-tauri/**`** — it crawls `target/` and dies with EBUSY on
  locked build DLLs, which kills `beforeDevCommand`.
- **cargo could not reach crates.io** through the corporate TLS proxy (schannel
  CRYPT_E_NO_REVOCATION_CHECK). Fixed with `[http] check-revoke = false` in `~/.cargo/config.toml`.
- OPFS snapshots still work inside WebView2, so the rolling auto-backups are unchanged on desktop.

### M9 polish facts
- `components/ErrorBoundary.tsx` wraps every route. Fallback offers **Export database** before
  Reload, so a render crash can never cost the ledger. Verified with a temporary throw.
- `App.tsx` lazy-loads every page except the dashboard. Main chunk 437 kB -> 374 kB and the
  500 kB Vite warning is gone. Dashboard stays eager (it is the landing route).
- `data/snapshots.ts` — rolling OPFS backups in a `backups/` directory, max 7 kept.
  `autoSnapshot()` runs on launch, at most once per 24h, and skips when there are no transactions.
  Settings > "Automatic snapshots" lists them with Save / Restore / Delete.
- **TS lib.dom lacks `FileSystemDirectoryHandle.entries()`** -> ambient declaration in
  `src/types/file-system-access.d.ts`.
- Subscriptions can be dismissed (EyeOff) — stored as a JSON array in
  `settings.dismissed_subscriptions`; "N hidden — bring back" restores them. Needed because a
  regular habit (weekly cafe) is mathematically indistinguishable from a subscription.

### M8 insights facts
- `services/insights/subscriptions.ts` PURE. Needs >=3 charges; median interval must land in a
  cadence window (monthly 24-37d, bimonthly 52-70, quarterly 80-104, annual 340-390); every interval
  within 25% of median; every amount within 15% of median (or 500 agorot floor).
  Status: active -> **watch (overdue)** -> cancelled after a second missed cycle.
  `referenceDate` is injected so tests are deterministic.
- `services/insights/anomalies.ts` PURE. `detectAnomalies` needs >=2 non-zero history periods;
  fires at >=20% deviation AND >=10,000 agorot difference; warning only for overspend >=50%.
  Kinds: over/under/new/stopped. `installmentPlans` dedupes by merchant|total|amount taking the
  highest `current`, so the same plan across statements is not double counted.
- `data/insights.ts` `buildInsights(periodId)`. Subscription query **excludes rows with
  installment_total** — otherwise instalment plans are reported as subscriptions.
  Anomalies use the trailing 3 periods, flexible categories only.
- `features/insights/InsightsPage.tsx`. Masked personal subscriptions render via MerchantText.
- `PlaceholderPage` deleted — every route now has a real implementation.

### BUG: import period silently reset on file drop
`handleFile` called `setPeriodRef(defaultPeriod(...))`, wiping a debit month the user had chosen —
statements landed in the wrong period. Fixed with a `periodTouched` flag. General lesson: never let
an async handler overwrite an explicit user choice.

### Fixtures
`scripts/make-fixtures.mjs` -> isracard-sample.csv (cp1255), max-sample.xlsx, and
`scripts/make-history-fixtures.mjs` -> fixtures/history/isracard-{jun,jul,aug,sep}.csv giving
4 months with monthly subs, a 12-part instalment, a groceries spike and fuel stopping.

### M7 run wizard facts
- `data/runModel.ts` is PURE: `deriveStep(status)` + `isStepComplete`. RUN_STEPS = Bank, Import,
  Triage, Reconcile. **No stored cursor** — the step is derived from what is already done, so the
  run resumes exactly where it stopped.
- `data/run.ts` — `getRunStatus` (one query with 4 subselects), `materializeRecurring` (idempotent:
  incomes keyed by recurring_entry_id, expenses by dedupe_hash `recurring:<entryId>:<periodId>`),
  `listManualOutflows`, `listImportBatches`.
- `features/run/MonthlyRunPage.tsx` embeds the REAL ImportPage and TriagePage via new
  `embedded` / `fixedPeriodId` props — no duplicated logic.
- Dashboard rewritten: 4 wallet cards with month delta, flexible variance bars sorted by distance
  from plan, run-progress checklist, next-run chip.

### BUG CLASS: latched state from stale React Query cache
MonthlyRunPage originally did `useEffect(() => { if (step === null) setStep(deriveStep(status)) })`.
Hash navigation does NOT remount the app, so the first render saw CACHED status and latched an old
step — after finishing triage you landed on Triage with Reconcile disabled. Fix: never latch.
`const step = manualStep ?? deriveStep(status)` plus a `maxReachable` prop on Stepper so completed
work can't lock you out. Prefer derived values over useState+useEffect mirrors.

### M6 engine facts
- `services/budget/engine.ts` is PURE (no db). `computePeriod(input)` returns movements for
  joint/savings/each personal wallet + `shortfall`. `nextOpening(result)` chains months.
  `leftToAssign`, `computeVariance` for the allocator.
- Allowances and the planned savings contribution are JOINT OUTFLOWS and personal/savings INFLOWS —
  internal moves, so total cash is conserved. Key invariant proven by property test:
  `Σ closings == Σ openings + income − fixed − jointFlexible − Σ personalSpent − savingsFunded`.
- `data/periodEngine.ts` — `loadActuals` (savings-funded rows are excluded from jointFlexible),
  `buildPeriodInput`, `recomputeFrom(periodId)` **recomputes that period AND every later one**
  because an early edit shifts all later openings. `commitPeriod` stores a JSON snapshot;
  `reopenPeriod` sets draft and recomputes forward.
- Opening balances: previous period's `wallet_ledger.closing`, else `wallets.opening_balance`.
- `data/budget.ts` — budget_lines / personal_budgets / period_incomes CRUD + `seedPlanFromPrevious`.
- UI `features/budget/BudgetPage.tsx` + `ShortfallDialog.tsx`. Committed periods disable all inputs.

### BUG CLASS TO WATCH: uncontrolled inputs across periods
`MoneyInput` uses `defaultValue`, so React reuses the DOM node when the period changes and the field
keeps showing the PREVIOUS period's number while the DB is correct. Fix applied: `key` prop including
periodId + the value, forcing remount. Any future uncontrolled input needs the same treatment.

### M5 triage facts
- `data/triageModel.ts` is PURE (no db import) so it unit-tests without mocking:
  `isAutoApplied(row, threshold)` + `splitTriage`. exact/rule/user => always auto; llm => only if
  `llm_confidence >= threshold`; no category => always queue. Queue sorted least-certain-first
  (unknown merchants before low-confidence guesses).
- `data/triage.ts` = db layer. `loadTriage`, `commitDecision` (optionally applies to all unreviewed
  rows sharing normalized_merchant, then promotes merchant defaults), `acceptAutoApplied` (bulk
  mark reviewed + promote each merchant), `getQuickCategories`.
- `getQuickCategories` orders by usage DESC then **flexible before fixed** — with no history the
  sort_order fallback surfaced Rent/Mortgage/Arnona, which are useless for a card sweep.
- **Quick categories are a SEPARATE useQuery with staleTime/gcTime Infinity.** They were in the main
  triage query and re-ranked after every accept, moving the 1-9 keys under the user's fingers
  mid-sweep. Never invalidate ['quick-categories'] during a session.
- Keys: 1-9 category, Enter accept+next, P personal (person from card owner), A apply-to-merchant,
  S fund from savings, X exclude, arrows navigate, ? help. Handler ignores events from
  INPUT/SELECT/TEXTAREA and any modifier combo.
- Route `/triage`, nav icon ListChecks.

### M4 Ollama facts
- `services/ollama/prompt.ts` — system prompt + `buildResponseSchema` puts category slugs in a JSON
  Schema **enum**, so an invented category is structurally impossible.
- `services/ollama/client.ts` — POST /api/chat, stream:false, temperature 0, num_ctx 4096,
  keep_alive 10m. BATCH_SIZE 12, CONCURRENCY 2, 90s timeout.
  Ladder: fail -> split batch in half -> ... -> single merchant -> give up (return []).
  Also retries merchants the model silently omitted. 404 (model missing) is rethrown, not retried.
- `services/ollama/categorize.ts` — groups unresolved transactions by normalized merchant, so the
  model sees UNIQUE MERCHANTS not transactions. Writes category + `categorization_source='llm'` +
  `llm_confidence` on transactions ONLY. **Never writes merchants.default_category_id** — that is
  reserved for user confirmations, otherwise LLM guesses would poison the learning signal.
  If zero verdicts came back it health-checks and throws a specific "could not reach"/"not installed"
  error instead of silently reporting "filled 0".
- UI: "Ask AI (N)" button on Transactions with live progress + Cancel; Settings warns when the
  configured model is not among installed ones.

### Model reality check (gemma3:4b, real run)
Hebrew accuracy was good: איקאה->Home, ארומה->Restaurants, שופרסל->Groceries, סופר פארם->Pharmacy,
פז יעל דלק->Fuel, חניון->Transport, ספוטיפיי->Subscriptions, רמי לוי->Groceries.
Miss: Latin "PAZ YELLOW" -> Groceries (should be Fuel). 12b would likely do better. This is exactly
what the M5 triage sweep exists to catch.

### M3 categorization facts
- `services/categorize/normalize.ts` — strips branch cities (~65 name list), installment/subscription
  noise, payment aggregators (`PAYPAL *STEAM` -> `steam`), domains, company suffixes (בע"מ/Ltd),
  3+ digit refs. Never returns empty. Idempotent.
- Streets/malls are NOT in the city list, so `merchantPrefixKey` = first 2 tokens acts as a family key
  (`סופר פארם דיזנגוף` ~ `סופר פארם רמת אביב`).
- `services/categorize/rules.ts` cascade: exact merchant -> user rules by priority -> prefix family
  (ONLY when every known branch agrees) -> null for the LLM. Regex pattern capped 200 chars,
  subject 300 (ReDoS guard); invalid regex is swallowed, never throws.
- `services/categorize/apply.ts`: `categorizePending({periodId?, importBatchId?})` auto-runs after
  import commit; `applyCorrection({..., learn:true})` writes merchants.default_category_id/wallet.
- Ledger masks personal vendors unless `reveal: true` is passed to `listTransactions`.
- Settings gained Categories / Recurring / Rules CRUD + **"Erase everything"** (type ERASE).
- `ensureManualAccount()` lazily creates a `bank`/`manual` account for rent wires and cash.

### Bugs found and fixed during M3 verification
- **CSP was missing `worker-src`/`child-src`** -> blob workers blocked. index.html now allows blob:.
- **`completeOnboarding` was not atomic** -> a half-finished run left wallets behind and every retry
  failed on UNIQUE(wallets.kind). Now one `db.batch()` that deletes accounts/wallets/people first.
- Ledger table columns collapsed; now explicit widths + `overflow-x-auto`, container `max-w-6xl px-7`.

### Implementation facts (verified)
- Money stored as **integer agorot**. `src/lib/money.ts`. Format is LTR `₪18,000` — he-IL currency
  formatter injects RTL control marks, do NOT use it.
- SQLite = `@sqlite.org/sqlite-wasm` in a Comlink worker (`src/db/sqlite.worker.ts`) using
  **OPFS SAHPool VFS** (no COOP/COEP needed). Console warns about the *other* OPFS VFS — harmless.
- `SqlDriver` interface (`src/db/driver.ts`) is the Tauri swap point. `WebSqlDriver` and
  `TauriSqlDriver` both implement it.
- **Ollama IS running** on localhost:11434 (GUI service; CLI not on PATH) with **0 models pulled**.
- npm 11 blocks postinstall scripts: `npm install-scripts approve esbuild` needed after wiping node_modules.
- Route mode: `createHashRouter`.
- Schema in `src/db/migrations.ts` migration v1. Seeds 31 categories via `src/db/seed.ts`.

### M2 import facts
- **cdn.sheetjs.com is BLOCKED** by corporate TLS interception (UNABLE_TO_GET_ISSUER_CERT_LOCALLY).
  npm registry itself works fine. `xlsx@0.18.5` on npm has CVE-2023-30533 + CVE-2024-22363 — DO NOT USE.
- Solution: hand-rolled XLSX reader `src/services/import/xlsx.ts` using **fflate** unzip + a regex
  XML scanner. **Web Workers have NO DOMParser** — that was a real bug; the scanner fixed it.
  Legacy .xls (OLE2 signature) is detected and rejected with a "re-save as xlsx" message.
- CSV via papaparse. Encoding auto-detect in `encoding.ts`: BOM checks, then UTF-8 fatal decode,
  fallback **windows-1255**. Verified against a real cp1255 fixture.
- Column detection `issuers.ts`: Hebrew alias table, two-pass (exact then partial) so generic
  'סכום' cannot steal 'סכום עסקה'. `findHeaderRow` scans first 25 rows (Israeli exports have title rows).
- Totals rows: label sits in the FIRST column, not the description column — check both.
- Installments: book only the amount debited this month; `installment_current/total` kept for context.
- Dedupe: sha256(account|date|direction|amount|desc|occurrenceIndex). Occurrence index means two
  identical same-day charges both survive, but re-importing a file is a no-op.
- Period assignment: `debitDateFor(period, account.debit_day)` -> `periodForDebitDate`. Verified:
  Aug purchases on a card debiting the 2nd land in September.
- `npm run dev` toolchain upgraded to vite 8 / vitest 5 to clear 5 advisories -> npm audit now 0.
  tsconfig `baseUrl` removed (deprecated in TS 6).
- Fixtures: `scripts/make-fixtures.mjs` generates `fixtures/isracard-sample.csv` (windows-1255) and
  `fixtures/max-sample.xlsx`. Plus `fixtures/unknown-format.csv` for the mapping wizard.
- Settings has a danger-zone **Erase all data** (type ERASE) -> `src/data/maintenance.ts`.
  Used it to clear fixture test data; DB is now clean and sitting at onboarding.

### Verified working
build + tsc clean; 31 unit tests pass; npm audit clean; onboarding end-to-end; close-day warning;
balance split; persistence across reload; CSV windows-1255 import with Hebrew intact; totals row
skipped; installment booked at ₪500 not ₪6,000; XLSX import in worker; re-import shows 0 new /
8 duplicates; mapping wizard maps an unknown CSV and imports; erase-all returns to onboarding.
