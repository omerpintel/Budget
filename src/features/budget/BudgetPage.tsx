import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Copy, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui/Feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input, MoneyInput, Select } from '@/components/ui/Field';
import { WalletCard } from '@/components/WalletCard';
import { ShortfallDialog } from './ShortfallDialog';
import { listPeriods } from '@/data/periods';
import { listWallets } from '@/data/wallets';
import { listPeople } from '@/data/people';
import { listCategories } from '@/data/categories';
import {
  addIncome,
  listBudgetLines,
  listIncomes,
  listPersonalBudgets,
  removeIncome,
  seedPlanFromPrevious,
  setAllowance,
  setBudgetLine,
  updateIncome,
} from '@/data/budget';
import {
  addTransfer,
  commitPeriod,
  listTransfers,
  loadActuals,
  recomputeFrom,
  removeTransfer,
  reopenPeriod,
} from '@/data/periodEngine';
import { leftToAssign } from '@/services/budget/engine';
import { formatAgorot, parseMoneyInput, periodLabel, toMajor } from '@/lib/money';
import { cn } from '@/lib/utils';

export function BudgetPage() {
  const qc = useQueryClient();
  const [periodId, setPeriodId] = useState('');
  const [carried, setCarried] = useState(false);

  const { data: periods } = useQuery({ queryKey: ['periods'], queryFn: listPeriods });

  useEffect(() => {
    if (!periodId && periods && periods.length > 0) setPeriodId(periods[0].id);
  }, [periods, periodId]);

  const { data } = useQuery({
    enabled: Boolean(periodId),
    queryKey: ['budget', periodId],
    queryFn: async () => {
      const result = await recomputeFrom(periodId);
      const [lines, allowances, incomes, actuals, wallets, people, categories, transfers] =
        await Promise.all([
          listBudgetLines(periodId),
          listPersonalBudgets(periodId),
          listIncomes(periodId),
          loadActuals(periodId),
          listWallets(),
          listPeople(),
          listCategories(),
          listTransfers(periodId),
        ]);
      return { result, lines, allowances, incomes, actuals, wallets, people, categories, transfers };
    },
  });

  const invalidate = () => qc.invalidateQueries();

  const period = periods?.find((p) => p.id === periodId);

  if (!periods) return null;
  if (periods.length === 0) {
    return (
      <>
        <PageHeader title="Budget" />
        <Card>
          <EmptyState
            title="No periods yet"
            description="Import a statement or add a manual transaction, and the period it belongs to appears here."
          />
        </Card>
      </>
    );
  }
  if (!data || !period) return null;

  const { result, lines, allowances, incomes, actuals, wallets, people, categories, transfers } = data;
  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? 'Unknown';
  const jointWallet = wallets.find((w) => w.kind === 'joint_buffer');
  const balances = new Map(
    wallets.map((w) => {
      if (w.kind === 'joint_buffer') return [w.id, result.joint.closing];
      if (w.kind === 'savings') return [w.id, result.savings.closing];
      return [w.id, w.person_id ? (result.personal[w.person_id]?.closing ?? 0) : 0];
    }),
  );

  const plannedIncome = incomes.reduce((s, i) => s + i.amount, 0);
  const allowanceMap = Object.fromEntries(allowances.map((a) => [a.person_id, a.allowance]));
  const unassigned = leftToAssign(
    plannedIncome,
    lines.map((l) => ({ categoryId: l.category_id, planned: l.planned_amount })),
    allowanceMap,
  );

  const committed = period.status === 'committed';

  return (
    <>
      <PageHeader
        title="Budget"
        description="Give every shekel of this month's income a job, then see where it actually went."
        action={
          <div className="flex shrink-0 items-center gap-2">
            <Select
              className="h-8 w-40 text-xs"
              value={periodId}
              onChange={(e) => {
                setPeriodId(e.target.value);
                setCarried(false);
              }}
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {periodLabel(p.year, p.month)}
                </option>
              ))}
            </Select>
            {committed ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await reopenPeriod(periodId);
                  invalidate();
                }}
              >
                <LockOpen className="size-3.5" /> Reopen
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={async () => {
                  await commitPeriod(periodId);
                  invalidate();
                }}
              >
                <Lock className="size-3.5" /> Commit
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-4 gap-3">
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

      {result.shortfall > 0 && !carried && jointWallet && (
        <div className="mb-4">
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
              invalidate();
            }}
          />
        </div>
      )}

      <div className="space-y-4">
        <IncomeCard
          incomes={incomes}
          people={people}
          disabled={committed}
          periodId={periodId}
          onChanged={invalidate}
        />

        <AllocationCard
          periodId={periodId}
          lines={lines}
          categories={categories}
          allowances={allowances}
          people={people}
          actuals={actuals.byCategory}
          unassigned={unassigned}
          income={plannedIncome}
          disabled={committed}
          onChanged={invalidate}
        />

        <TransfersCard
          periodId={periodId}
          wallets={wallets}
          transfers={transfers}
          personName={personName}
          disabled={committed}
          onChanged={invalidate}
        />
      </div>
    </>
  );
}

// Small helper so each card can own its mutation without repeating boilerplate.
function IncomeCard({
  incomes,
  people,
  periodId,
  disabled,
  onChanged,
}: {
  incomes: Array<{ id: string; person_id: string | null; label: string; amount: number }>;
  people: Array<{ id: string; name: string }>;
  periodId: string;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [label, setLabel] = useState('Salary');
  const [personId, setPersonId] = useState(people[0]?.id ?? '');
  const [amountRaw, setAmountRaw] = useState('');
  const total = incomes.reduce((s, i) => s + i.amount, 0);

  return (
    <Card>
      <CardHeader
        title="Income this month"
        description="Salaries vary, so enter what actually landed in the account."
        action={<span className="tnum text-sm font-semibold">{formatAgorot(total)}</span>}
      />
      <CardBody className="space-y-3">
        {incomes.length > 0 && (
          <table className="w-full text-xs">
            <tbody>
              {incomes.map((income) => (
                <tr key={income.id} className="border-line/60 border-b last:border-0">
                  <td className="py-2 font-medium">{income.label}</td>
                  <td className="text-fg-muted py-2">
                    {income.person_id ? people.find((p) => p.id === income.person_id)?.name : 'Household'}
                  </td>
                  <td className="w-32 py-2">
                    <MoneyInput
                      // Uncontrolled input: remount when the value changes or it keeps the old period's number.
                      key={`${income.id}-${income.amount}`}
                      className="h-7 text-xs"
                      disabled={disabled}
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
                      disabled={disabled}
                      className="text-fg-subtle hover:text-negative disabled:opacity-40"
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
            <Input value={label} disabled={disabled} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Whose">
            <Select value={personId} disabled={disabled} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">Household</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount">
            <MoneyInput
              value={amountRaw}
              disabled={disabled}
              onChange={(e) => setAmountRaw(e.target.value)}
            />
          </Field>
          <Button
            disabled={disabled || !label.trim() || (parseMoneyInput(amountRaw) ?? 0) <= 0}
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
  );
}

function AllocationCard({
  periodId,
  lines,
  categories,
  allowances,
  people,
  actuals,
  unassigned,
  income,
  disabled,
  onChanged,
}: {
  periodId: string;
  lines: Array<{ category_id: string; category_name: string; kind: string; planned_amount: number }>;
  categories: Array<{ id: string; name: string; kind: string }>;
  allowances: Array<{ person_id: string; allowance: number }>;
  people: Array<{ id: string; name: string }>;
  actuals: Record<string, number>;
  unassigned: number;
  income: number;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState('');  const planned = lines.map((l) => l.category_id);
  const addable = categories.filter(
    (c) => !planned.includes(c.id) && ['fixed', 'flexible', 'savings'].includes(c.kind),
  );

  const grouped = useMemo(
    () => ({
      fixed: lines.filter((l) => l.kind === 'fixed'),
      flexible: lines.filter((l) => l.kind === 'flexible'),
      savings: lines.filter((l) => l.kind === 'savings'),
    }),
    [lines],
  );

  return (
    <Card>
      <CardHeader
        title="Allocation"
        description="Income minus fixed costs, allowances and savings leaves your joint flexible budget."
        action={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={async () => {
                await seedPlanFromPrevious(periodId);
                onChanged();
              }}
            >
              <Copy className="size-3.5" /> Copy last month
            </Button>
          </div>
        }
      />
      <CardBody className="space-y-4">
        <div
          className={cn(
            'flex items-center justify-between rounded-lg border p-3',
            unassigned === 0
              ? 'border-positive/40 bg-positive/10'
              : unassigned > 0
                ? 'border-line bg-surface-2/40'
                : 'border-negative/40 bg-negative/10',
          )}
        >
          <span className="text-xs font-medium">
            {unassigned === 0
              ? 'Every shekel has a job'
              : unassigned > 0
                ? 'Left to assign'
                : 'Over-assigned'}
          </span>
          <span className="tnum text-sm font-semibold">{formatAgorot(unassigned)}</span>
        </div>

        {income === 0 && (
          <p className="text-fg-subtle text-xs">Add this month&rsquo;s income above to start allocating.</p>
        )}

        {(['fixed', 'flexible', 'savings'] as const).map((kind) =>
          grouped[kind].length === 0 ? null : (
            <div key={kind}>
              <div className="text-fg-muted mb-1.5 text-xs font-medium capitalize">{kind}</div>
              <table className="w-full text-xs">
                <thead className="text-fg-subtle">
                  <tr className="text-left">
                    <th className="pb-1 font-medium">Category</th>
                    <th className="w-28 pb-1 font-medium">Planned</th>
                    <th className="w-24 pb-1 text-right font-medium">Actual</th>
                    <th className="w-24 pb-1 text-right font-medium">Left</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped[kind].map((line) => {
                    const actual = actuals[line.category_id] ?? 0;
                    const left = line.planned_amount - actual;
                    return (
                      <tr key={line.category_id} className="border-line/60 border-t">
                        <td className="py-1.5">{line.category_name}</td>
                        <td className="py-1.5">
                          <MoneyInput
                            key={`${periodId}-${line.category_id}-${line.planned_amount}`}
                            className="h-7 text-xs"
                            disabled={disabled}
                            defaultValue={String(toMajor(line.planned_amount))}
                            onBlur={async (e) => {
                              const value = parseMoneyInput(e.target.value);
                              if (value !== null && value !== line.planned_amount) {
                                await setBudgetLine(periodId, line.category_id, value);
                                onChanged();
                              }
                            }}
                          />
                        </td>
                        <td className="tnum py-1.5 text-right">{formatAgorot(actual)}</td>
                        <td
                          className={cn(
                            'tnum py-1.5 text-right',
                            left < 0 ? 'text-negative' : 'text-fg-muted',
                          )}
                        >
                          {formatAgorot(left)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ),
        )}

        <div>
          <div className="text-fg-muted mb-1.5 text-xs font-medium">Personal allowances</div>
          <table className="w-full text-xs">
            <tbody>
              {people.map((person) => {
                const current = allowances.find((a) => a.person_id === person.id)?.allowance ?? 0;
                return (
                  <tr key={person.id} className="border-line/60 border-t">
                    <td className="py-1.5">{person.name}</td>
                    <td className="w-28 py-1.5">
                      <MoneyInput
                        key={`${periodId}-${person.id}-${current}`}
                        className="h-7 text-xs"
                        disabled={disabled}
                        defaultValue={String(toMajor(current))}
                        onBlur={async (e) => {
                          const value = parseMoneyInput(e.target.value);
                          if (value !== null && value !== current) {
                            await setAllowance(periodId, person.id, value);
                            onChanged();
                          }
                        }}
                      />
                    </td>
                    <td className="text-fg-subtle py-1.5 text-xs">
                      Funded whether or not it is spent; anything left rolls over to {person.name}.
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {addable.length > 0 && (
          <div className="flex items-end gap-2">
            <Field label="Add a category to the plan" className="max-w-64">
              <Select value={adding} disabled={disabled} onChange={(e) => setAdding(e.target.value)}>
                <option value="">— choose —</option>
                {addable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              size="md"
              variant="secondary"
              disabled={disabled || !adding}
              onClick={async () => {
                await setBudgetLine(periodId, adding, 0);
                setAdding('');
                onChanged();
              }}
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function TransfersCard({
  periodId,
  wallets,
  transfers,
  personName,
  disabled,
  onChanged,
}: {
  periodId: string;
  wallets: Array<{ id: string; kind: string; name: string; person_id: string | null }>;
  transfers: Array<{ id: string; from_wallet_id: string; to_wallet_id: string; amount: number; reason: string | null }>;
  personName: (id: string | null) => string;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [from, setFrom] = useState(wallets[0]?.id ?? '');
  const [to, setTo] = useState(wallets[1]?.id ?? '');
  const [amountRaw, setAmountRaw] = useState('');
  const label = (id: string) => {
    const w = wallets.find((x) => x.id === id);
    if (!w) return '—';
    return w.kind === 'personal' ? `${personName(w.person_id)}'s wallet` : w.name;
  };

  return (
    <Card>
      <CardHeader
        title="Transfers between pools"
        description="Move money into savings, or bail out the joint buffer from a personal wallet."
      />
      <CardBody className="space-y-3">
        {transfers.length > 0 && (
          <table className="w-full text-xs">
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id} className="border-line/60 border-b last:border-0">
                  <td className="py-2">{label(t.from_wallet_id)}</td>
                  <td className="w-6 py-2">
                    <ArrowRight className="text-fg-subtle size-3.5" />
                  </td>
                  <td className="py-2">{label(t.to_wallet_id)}</td>
                  <td className="text-fg-muted py-2">{t.reason}</td>
                  <td className="tnum w-24 py-2 text-right">{formatAgorot(t.amount)}</td>
                  <td className="w-8 text-right">
                    <button
                      type="button"
                      aria-label="Remove transfer"
                      disabled={disabled}
                      className="text-fg-subtle hover:text-negative disabled:opacity-40"
                      onClick={async () => {
                        await removeTransfer(t.id, periodId);
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

        <div className="grid grid-cols-[1fr_auto_1fr_1fr_auto] items-end gap-3">
          <Field label="From">
            <Select value={from} disabled={disabled} onChange={(e) => setFrom(e.target.value)}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {label(w.id)}
                </option>
              ))}
            </Select>
          </Field>
          <ArrowRight className="text-fg-subtle mb-3 size-4" />
          <Field label="To">
            <Select value={to} disabled={disabled} onChange={(e) => setTo(e.target.value)}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {label(w.id)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount">
            <MoneyInput
              value={amountRaw}
              disabled={disabled}
              onChange={(e) => setAmountRaw(e.target.value)}
            />
          </Field>
          <Button
            disabled={disabled || from === to || (parseMoneyInput(amountRaw) ?? 0) <= 0}
            onClick={async () => {
              await addTransfer({
                periodId,
                fromWalletId: from,
                toWalletId: to,
                amount: parseMoneyInput(amountRaw) ?? 0,
                reason: null,
              });
              setAmountRaw('');
              onChanged();
            }}
          >
            Move
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
