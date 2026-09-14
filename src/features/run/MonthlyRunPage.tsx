import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  Copy,
  FileText,
  Lock,
  Plus,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/Feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input, MoneyInput, Select } from '@/components/ui/Field';
import { Stepper } from '@/components/ui/Stepper';
import { WalletCard } from '@/components/WalletCard';
import { MerchantText } from '@/components/MerchantText';
import { ImportPage } from '@/features/import/ImportPage';
import { TriagePage } from '@/features/triage/TriagePage';
import { ShortfallDialog } from '@/features/budget/ShortfallDialog';
import { ensurePeriod } from '@/data/periods';
import {
  deriveStep,
  getRunStatus,
  listImportBatches,
  listManualOutflows,
  materializeRecurring,
  RUN_STEPS,
} from '@/data/run';
import {
  addIncome,
  listBudgetLines,
  listIncomes,
  listPersonalBudgets,
  removeIncome,
  updateIncome,
} from '@/data/budget';
import { addTransfer, commitPeriod, loadActuals, recomputeFrom } from '@/data/periodEngine';
import { listWallets } from '@/data/wallets';
import { listPeople } from '@/data/people';
import { listCategories, listRecurringEntries } from '@/data/categories';
import { deleteTransaction, createManualTransaction } from '@/data/transactions';
import { ensureManualAccount } from '@/data/accounts';
import { formatAgorot, parseMoneyInput, periodLabel, toMajor } from '@/lib/money';
import { cn } from '@/lib/utils';

export function MonthlyRunPage() {
  const qc = useQueryClient();
  // Null means "follow the data"; once the user navigates we respect their choice.
  const [manualStep, setManualStep] = useState<number | null>(null);
  const now = new Date();
  const ref = { year: now.getFullYear(), month: now.getMonth() + 1 };

  const { data: period } = useQuery({
    queryKey: ['run-period', ref.year, ref.month],
    queryFn: () => ensurePeriod(ref),
  });

  const { data: status } = useQuery({
    enabled: Boolean(period),
    queryKey: ['run-status', period?.id],
    queryFn: () => getRunStatus(period!.id),
  });

  useEffect(() => {
    setManualStep(null);
  }, [period?.id]);

  if (!period || !status) return null;
  const derived = deriveStep(status);
  const step = manualStep ?? derived;
  const maxReachable = Math.max(derived, manualStep ?? 0);
  const invalidate = () => qc.invalidateQueries();

  return (
    <>
      <PageHeader
        title={`${periodLabel(period.year, period.month)} run`}
        description="Everything that moves through the bank this month, in one sitting."
        action={
          status.committed ? (
            <span className="text-positive flex items-center gap-1.5 text-xs font-medium">
              <CircleCheck className="size-4" /> Committed
            </span>
          ) : undefined
        }
      />

      <div className="mb-6">
        <Stepper
          steps={[...RUN_STEPS]}
          current={step}
          maxReachable={maxReachable}
          onSelect={setManualStep}
        />
      </div>

      {step === 0 && <BankStep periodId={period.id} periodRef={ref} onChanged={invalidate} />}
      {step === 1 && <ImportStep periodId={period.id} />}
      {step === 2 && <TriageStep periodId={period.id} unreviewed={status.unreviewed} />}
      {step === 3 && <ReconcileStep periodId={period.id} committed={status.committed} onChanged={invalidate} />}

      <div className="mt-5 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => setManualStep(Math.max(step - 1, 0))}
          disabled={step === 0}
        >
          <ArrowLeft className="size-4" /> Back
        </Button>
        {step < RUN_STEPS.length - 1 && (
          <Button onClick={() => setManualStep(Math.min(step + 1, RUN_STEPS.length - 1))}>
            Continue <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </>
  );
}

function BankStep({
  periodId,
  periodRef,
  onChanged,
}: {
  periodId: string;
  periodRef: { year: number; month: number };
  onChanged: () => void;
}) {
  const [label, setLabel] = useState('Salary');
  const [personId, setPersonId] = useState('');
  const [amountRaw, setAmountRaw] = useState('');
  const [expense, setExpense] = useState({ name: '', amount: '', categoryId: '' });

  const { data } = useQuery({
    queryKey: ['run-bank', periodId],
    queryFn: async () => {
      const [incomes, outflows, people, templates, categories] = await Promise.all([
        listIncomes(periodId),
        listManualOutflows(periodId),
        listPeople(),
        listRecurringEntries(),
        listCategories(),
      ]);
      return { incomes, outflows, people, templates, categories };
    },
  });

  if (!data) return null;
  const { incomes, outflows, people, templates, categories } = data;
  const incomeTotal = incomes.reduce((s, i) => s + i.amount, 0);
  const outflowTotal = outflows.reduce((s, o) => s + o.amount, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Money in"
          description="Salaries vary month to month, so confirm what actually landed."
          action={
            <div className="flex items-center gap-2">
              {templates.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await materializeRecurring(periodId, periodRef.year, periodRef.month);
                    onChanged();
                  }}
                >
                  <Copy className="size-3.5" /> Fill from templates
                </Button>
              )}
              <span className="tnum text-sm font-semibold">{formatAgorot(incomeTotal)}</span>
            </div>
          }
        />
        <CardBody className="space-y-3">
          {incomes.length === 0 ? (
            <p className="text-fg-subtle text-xs">
              Nothing yet. Add both salaries, or set up templates in Settings so this fills itself.
            </p>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {incomes.map((income) => (
                  <tr key={income.id} className="border-line/60 border-b last:border-0">
                    <td className="py-2 font-medium">{income.label}</td>
                    <td className="text-fg-muted py-2">
                      {income.person_id
                        ? people.find((p) => p.id === income.person_id)?.name
                        : 'Household'}
                    </td>
                    <td className="w-32 py-2">
                      <MoneyInput
                        key={`${income.id}-${income.amount}`}
                        className="h-7 text-xs"
                        defaultValue={String(toMajor(income.amount))}
                        onBlur={async (e) => {
                          const value = parseMoneyInput(e.target.value);
                          if (value !== null && value !== income.amount) {
                            await updateIncome(income.id, value);
                            onChanged();
                          }
                        }}
                      />
                    </td>
                    <td className="w-8 text-right">
                      <button
                        type="button"
                        aria-label={`Remove ${income.label}`}
                        className="text-fg-subtle hover:text-negative"
                        onClick={async () => {
                          await removeIncome(income.id);
                          onChanged();
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-3">
            <Field label="Label">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="Whose">
              <Select value={personId} onChange={(e) => setPersonId(e.target.value)}>
                <option value="">Household</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount">
              <MoneyInput value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} />
            </Field>
            <Button
              disabled={!label.trim() || (parseMoneyInput(amountRaw) ?? 0) <= 0}
              onClick={async () => {
                await addIncome({
                  periodId,
                  personId: personId || null,
                  label: label.trim(),
                  amount: parseMoneyInput(amountRaw) ?? 0,
                });
                setAmountRaw('');
                onChanged();
              }}
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Money out of the bank"
          description="Rent wires, standing orders and cash — anything that never reaches a card statement."
          action={<span className="tnum text-sm font-semibold">{formatAgorot(-outflowTotal)}</span>}
        />
        <CardBody className="space-y-3">
          {outflows.length > 0 && (
            <table className="w-full text-xs">
              <tbody>
                {outflows.map((row) => (
                  <tr key={row.id} className="border-line/60 border-b last:border-0">
                    <td className="text-fg-muted w-24 py-2">{row.transaction_date}</td>
                    <td className="py-2">
                      <MerchantText value={row.raw_description} />
                    </td>
                    <td className="text-fg-muted py-2">{row.category_name}</td>
                    <td className="tnum w-24 py-2 text-right">{formatAgorot(-row.amount)}</td>
                    <td className="w-8 text-right">
                      <button
                        type="button"
                        aria-label={`Remove ${row.raw_description}`}
                        className="text-fg-subtle hover:text-negative"
                        onClick={async () => {
                          await deleteTransaction(row.id);
                          onChanged();
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-3">
            <Field label="What">
              <Input
                value={expense.name}
                placeholder="Rent"
                onChange={(e) => setExpense({ ...expense, name: e.target.value })}
              />
            </Field>
            <Field label="Category">
              <Select
                value={expense.categoryId}
                onChange={(e) => setExpense({ ...expense, categoryId: e.target.value })}
              >
                <option value="">— none —</option>
                {categories
                  .filter((c) => ['fixed', 'flexible', 'savings'].includes(c.kind))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Amount">
              <MoneyInput
                value={expense.amount}
                onChange={(e) => setExpense({ ...expense, amount: e.target.value })}
              />
            </Field>
            <Button
              disabled={!expense.name.trim() || (parseMoneyInput(expense.amount) ?? 0) <= 0}
              onClick={async () => {
                const accountId = await ensureManualAccount();
                await createManualTransaction({
                  accountId,
                  periodId,
                  date: `${periodRef.year}-${String(periodRef.month).padStart(2, '0')}-01`,
                  description: expense.name.trim(),
                  amount: parseMoneyInput(expense.amount) ?? 0,
                  direction: 'out',
                  categoryId: expense.categoryId || null,
                  wallet: 'joint',
                  personId: null,
                  note: null,
                });
                setExpense({ name: '', amount: '', categoryId: '' });
                onChanged();
              }}
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function ImportStep({ periodId }: { periodId: string }) {
  const { data: batches } = useQuery({
    queryKey: ['run-batches', periodId],
    queryFn: () => listImportBatches(periodId),
  });

  return (
    <div className="space-y-4">
      {batches && batches.length > 0 && (
        <Card>
          <CardHeader
            title={`${batches.length} statement${batches.length === 1 ? '' : 's'} in this period`}
          />
          <CardBody className="p-0">
            <table className="w-full text-xs">
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-line/60 border-t">
                    <td className="w-8 pl-4">
                      <FileText className="text-fg-subtle size-3.5" />
                    </td>
                    <td className="py-2 font-medium">{b.file_name}</td>
                    <td className="text-fg-muted py-2">{b.account_name}</td>
                    <td className="text-fg-muted py-2">debits {b.debit_date}</td>
                    <td className="tnum text-fg-muted py-2 pr-4 text-right">{b.row_count} rows</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
      <ImportPage embedded />
    </div>
  );
}

function TriageStep({ periodId, unreviewed }: { periodId: string; unreviewed: number }) {
  if (unreviewed === 0) {
    return (
      <Card>
        <CardBody className="space-y-2 py-10 text-center">
          <Check className="text-positive mx-auto size-7" strokeWidth={1.5} />
          <p className="text-sm font-medium">Everything in this period is confirmed</p>
          <p className="text-fg-muted text-xs">Continue to reconcile and commit the month.</p>
        </CardBody>
      </Card>
    );
  }
  return <TriagePage embedded fixedPeriodId={periodId} />;
}

function ReconcileStep({
  periodId,
  committed,
  onChanged,
}: {
  periodId: string;
  committed: boolean;
  onChanged: () => void;
}) {
  const [carried, setCarried] = useState(false);

  const { data } = useQuery({
    queryKey: ['run-reconcile', periodId],
    queryFn: async () => {
      const result = await recomputeFrom(periodId);
      const [lines, allowances, actuals, wallets, people] = await Promise.all([
        listBudgetLines(periodId),
        listPersonalBudgets(periodId),
        loadActuals(periodId),
        listWallets(),
        listPeople(),
      ]);
      return { result, lines, allowances, actuals, wallets, people };
    },
  });

  if (!data) return null;
  const { result, lines, actuals, wallets, people } = data;
  const jointWallet = wallets.find((w) => w.kind === 'joint_buffer');
  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? 'Unknown';
  const balances = new Map(
    wallets.map((w) => {
      if (w.kind === 'joint_buffer') return [w.id, result.joint.closing];
      if (w.kind === 'savings') return [w.id, result.savings.closing];
      return [w.id, w.person_id ? (result.personal[w.person_id]?.closing ?? 0) : 0];
    }),
  );

  const flexible = lines.filter((l) => l.kind === 'flexible');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <WalletCard
          name="Joint"
          kind="joint_buffer"
          balance={result.joint.closing}
          caption={`${formatAgorot(result.joint.delta, { signed: true })} this month`}
        />
        <WalletCard
          name="Savings"
          kind="savings"
          balance={result.savings.closing}
          caption={`${formatAgorot(result.savings.delta, { signed: true })} this month`}
        />
        {people.map((person, i) => (
          <WalletCard
            key={person.id}
            name={person.name}
            kind="personal"
            accentClass={i === 0 ? 'bg-omer' : 'bg-roni'}
            balance={result.personal[person.id]?.closing ?? 0}
            caption={`${formatAgorot(result.personal[person.id]?.delta ?? 0, {
              signed: true,
            })} this month`}
          />
        ))}
      </div>

      {result.shortfall > 0 && !carried && jointWallet && !committed && (
        <ShortfallDialog
          shortfall={result.shortfall}
          wallets={wallets}
          balances={balances}
          jointWalletId={jointWallet.id}
          personName={personName}
          onCarry={() => setCarried(true)}
          onCover={async (fromWalletId, amount) => {
            await addTransfer({
              periodId,
              fromWalletId,
              toWalletId: jointWallet.id,
              amount,
              reason: 'Cover shortfall',
            });
            onChanged();
          }}
        />
      )}

      <Card>
        <CardHeader
          title="Planned against actual"
          description="Flexible categories only — these are what the joint buffer absorbs."
          action={
            committed ? undefined : (
              <Button
                size="sm"
                onClick={async () => {
                  await commitPeriod(periodId);
                  onChanged();
                }}
              >
                <Lock className="size-3.5" /> Commit month
              </Button>
            )
          }
        />
        <CardBody>
          {flexible.length === 0 ? (
            <p className="text-fg-subtle text-xs">
              No flexible categories planned. Set them on the{' '}
              <Link to="/budget" className="text-brand underline">
                Budget page
              </Link>{' '}
              to compare against actuals.
            </p>
          ) : (
            <div className="space-y-2.5">
              {flexible.map((line) => {
                const actual = actuals.byCategory[line.category_id] ?? 0;
                const pct = line.planned_amount > 0 ? (actual / line.planned_amount) * 100 : 0;
                const over = actual > line.planned_amount;
                return (
                  <div key={line.category_id}>
                    <div className="mb-1 flex items-baseline justify-between text-xs">
                      <span>{line.category_name}</span>
                      <span className={cn('tnum', over ? 'text-negative' : 'text-fg-muted')}>
                        {formatAgorot(actual)} of {formatAgorot(line.planned_amount)}
                      </span>
                    </div>
                    <div className="bg-surface-2 h-1.5 overflow-hidden rounded-full">
                      <div
                        className={cn('h-full rounded-full', over ? 'bg-negative' : 'bg-joint')}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
