import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Copy, PiggyBank, Sparkles, TriangleAlert, Wand2 } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { MoneyInput, Select } from '@/components/ui/Field';
import {
  availableToAssign,
  averageSpendByCategory,
  listAllocationLines,
  listIncomes,
  listPersonalBudgets,
  setAllowance,
  setBudgetLine,
  setBudgetLines,
  seedPlanFromPrevious,
} from '@/data/budget';
import { listPeople } from '@/data/people';
import { loadActuals } from '@/data/periodEngine';
import { coverDeficits, moveBetweenCategories, spreadByWeight } from '@/services/budget/engine';
import { formatAgorot, parseMoneyInput, toMajor } from '@/lib/money';
import { cn } from '@/lib/utils';

const KIND_LABELS: Record<string, string> = {
  fixed: 'הוצאות קבועות',
  flexible: 'הוצאות משתנות',
  savings: 'חיסכון',
};

/** Personal allowances live in their own table, so they get a synthetic row id. */
const ALLOWANCE_PREFIX = 'allowance:';

export function AllocationPlanner({
  periodId,
  disabled = false,
}: {
  periodId: string;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const [moveFrom, setMoveFrom] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [moveAmountRaw, setMoveAmountRaw] = useState('');
  const [coverSource, setCoverSource] = useState<Record<string, string>>({});

  const { data } = useQuery({
    queryKey: ['allocation', periodId],
    queryFn: async () => {
      const [lines, incomes, allowances, people, actuals, history, available] = await Promise.all([
        listAllocationLines(periodId),
        listIncomes(periodId),
        listPersonalBudgets(periodId),
        listPeople(),
        loadActuals(periodId),
        averageSpendByCategory(periodId),
        availableToAssign(periodId),
      ]);
      return { lines, incomes, allowances, people, actuals, history, available };
    },
  });

  if (!data) return null;
  const { lines, allowances, people, actuals, history, available } = data;

  const allowanceOf = (personId: string) =>
    allowances.find((a) => a.person_id === personId)?.allowance ?? 0;
  const { income, carryover, assigned: plannedTotal, left: unassigned } = available;

  const deficits = [
    ...lines.map((l) => ({
      id: l.category_id,
      gap: (actuals.byCategory[l.category_id] ?? 0) - l.planned_amount,
    })),
    ...people.map((p) => ({
      id: ALLOWANCE_PREFIX + p.id,
      gap: (actuals.personalSpent[p.id] ?? 0) - allowanceOf(p.id),
    })),
  ].filter((d) => d.gap > 0);
  const deficitTotal = deficits.reduce((s, d) => s + d.gap, 0);

  const invalidate = async () => {
    await qc.invalidateQueries();
  };

  async function runCoverDeficits() {
    const { assignments, used } = coverDeficits(
      [
        ...lines.map((l) => ({
          id: l.category_id,
          planned: l.planned_amount,
          actual: actuals.byCategory[l.category_id] ?? 0,
        })),
        ...people.map((p) => ({
          id: ALLOWANCE_PREFIX + p.id,
          planned: allowanceOf(p.id),
          actual: actuals.personalSpent[p.id] ?? 0,
        })),
      ],
      unassigned,
    );

    const categoryUpdates: Record<string, number> = {};
    for (const [id, extra] of Object.entries(assignments)) {
      if (id.startsWith(ALLOWANCE_PREFIX)) {
        const personId = id.slice(ALLOWANCE_PREFIX.length);
        await setAllowance(periodId, personId, allowanceOf(personId) + extra);
        continue;
      }
      const line = lines.find((l) => l.category_id === id);
      if (line) categoryUpdates[id] = line.planned_amount + extra;
    }

    await setBudgetLines(periodId, categoryUpdates);
    setNote(`כוסו חריגות בסך ${formatAgorot(used)}`);
    await invalidate();
  }

  async function runSpread(includeSavingsAndPersonal: boolean) {
    if (unassigned <= 0) return;

    // 'uncategorized' is a holding pen, never something to plan money into.
    const targets: Array<{ id: string; weight: number }> = lines
      .filter((l) => l.kind !== 'savings')
      .map((l) => ({ id: l.category_id, weight: history[l.category_id] ?? 0 }));

    const savingsLine = lines.find((l) => l.kind === 'savings');
    if (includeSavingsAndPersonal) {
      if (savingsLine) {
        targets.push({ id: savingsLine.category_id, weight: savingsLine.planned_amount });
      }
      for (const person of people) {
        targets.push({ id: ALLOWANCE_PREFIX + person.id, weight: allowanceOf(person.id) });
      }
    }
    if (targets.length === 0) return;

    const split = spreadByWeight(targets, unassigned);
    const categoryUpdates: Record<string, number> = {};

    for (const [id, extra] of Object.entries(split)) {
      if (extra <= 0) continue;
      if (id.startsWith(ALLOWANCE_PREFIX)) {
        const personId = id.slice(ALLOWANCE_PREFIX.length);
        await setAllowance(periodId, personId, allowanceOf(personId) + extra);
        continue;
      }
      const line = lines.find((l) => l.category_id === id);
      if (line) categoryUpdates[id] = line.planned_amount + extra;
    }

    await setBudgetLines(periodId, categoryUpdates);
    setNote(`חולקו ${formatAgorot(unassigned)} לפי ההוצאות שלך`);
    await invalidate();
  }

  async function runMove() {
    const amount = parseMoneyInput(moveAmountRaw) ?? 0;
    if (!moveFrom || !moveTo || moveFrom === moveTo || amount <= 0) return;

    const planLines = lines.map((l) => ({ categoryId: l.category_id, planned: l.planned_amount }));
    const changes = moveBetweenCategories(planLines, moveFrom, moveTo, amount);
    if (changes.length === 0) return;

    await setBudgetLines(periodId, Object.fromEntries(changes.map((c) => [c.categoryId, c.planned])));
    setMoveFrom('');
    setMoveTo('');
    setMoveAmountRaw('');
    setNote('הועבר בין קטגוריות');
    await invalidate();
  }

  async function coverFromCategory(targetCategoryId: string, gap: number) {
    const sourceId = coverSource[targetCategoryId];
    if (!sourceId) return;
    const planLines = lines.map((l) => ({ categoryId: l.category_id, planned: l.planned_amount }));
    const changes = moveBetweenCategories(planLines, sourceId, targetCategoryId, gap);
    if (changes.length === 0) return;
    await setBudgetLines(periodId, Object.fromEntries(changes.map((c) => [c.categoryId, c.planned])));
    setCoverSource((prev) => ({ ...prev, [targetCategoryId]: '' }));
    await invalidate();
  }

  const grouped = {
    fixed: lines.filter((l) => l.kind === 'fixed'),
    flexible: lines.filter((l) => l.kind === 'flexible'),
    savings: lines.filter((l) => l.kind === 'savings'),
  };

  return (
    <Card>
      <CardHeader
        title="שיוך"
        description="תן לכל שקל מההכנסה של החודש תפקיד. מה שלא שויך יושב בכרית המשותפת בלי ייעוד."
        action={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            disabled={disabled}
            onClick={async () => {
              await seedPlanFromPrevious(periodId);
              setNote('הועתקה התוכנית מהחודש שעבר');
              await invalidate();
            }}
          >
            <Copy className="size-3.5" /> העתק מהחודש שעבר
          </Button>
        }
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Summary label="הכנסות החודש" value={income} />
          <Summary label="יתרה מהחודש שעבר" value={carryover} />
          <Summary label="שויך" value={plannedTotal} />
          <Summary
            label={unassigned < 0 ? 'שויך יותר מדי' : 'נותר לשייך'}
            value={unassigned}
            tone={unassigned === 0 ? 'good' : unassigned > 0 ? 'neutral' : 'bad'}
          />
        </div>

        {unassigned < 0 && (
          <div className="border-negative/40 bg-negative/10 text-negative rounded-lg border p-3 text-xs">
            שויך {formatAgorot(-unassigned)} יותר ממה שיש בפועל. אי אפשר לנעול את החודש ככה — הקטן
            סעיף, או העבר כסף בין קטגוריות למטה.
          </div>
        )}

        {available.pool === 0 ? (
          <p className="text-fg-subtle text-xs">
            אין עדיין הכנסות לחודש הזה. חזור לשלב הבנק והזן את המשכורות.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || deficitTotal === 0 || unassigned <= 0}
              onClick={runCoverDeficits}
            >
              <TriangleAlert className="size-3.5" />
              כסה חריגות
              {deficitTotal > 0 ? ` (${formatAgorot(deficitTotal)})` : ''}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || unassigned <= 0}
              onClick={() => runSpread(false)}
            >
              <Wand2 className="size-3.5" /> חלק את היתרה לקטגוריות
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || unassigned <= 0}
              onClick={() => runSpread(true)}
            >
              <PiggyBank className="size-3.5" /> חלק הכל כולל חיסכון ודמי כיס
            </Button>
            {note && (
              <span className="text-positive flex items-center gap-1 text-xs">
                <Sparkles className="size-3.5" /> {note}
              </span>
            )}
          </div>
        )}

        <div className="border-line rounded-lg border p-3">
          <div className="text-fg-muted mb-2 text-xs font-medium">העברה בין קטגוריות</div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-fg-subtle flex flex-col gap-1 text-xs">
              מ
              <Select
                className="h-7 text-xs"
                value={moveFrom}
                disabled={disabled}
                onChange={(e) => setMoveFrom(e.target.value)}
              >
                <option value="">— בחר —</option>
                {lines.map((l) => (
                  <option key={l.category_id} value={l.category_id}>
                    {l.category_name}
                  </option>
                ))}
              </Select>
            </label>
            <ArrowLeftRight className="text-fg-subtle mb-1.5 size-3.5 shrink-0" />
            <label className="text-fg-subtle flex flex-col gap-1 text-xs">
              אל
              <Select
                className="h-7 text-xs"
                value={moveTo}
                disabled={disabled}
                onChange={(e) => setMoveTo(e.target.value)}
              >
                <option value="">— בחר —</option>
                {lines.map((l) => (
                  <option key={l.category_id} value={l.category_id}>
                    {l.category_name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-fg-subtle flex flex-col gap-1 text-xs">
              סכום
              <MoneyInput
                className="h-7 w-28 text-xs"
                value={moveAmountRaw}
                disabled={disabled}
                onChange={(e) => setMoveAmountRaw(e.target.value)}
              />
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={
                disabled ||
                !moveFrom ||
                !moveTo ||
                moveFrom === moveTo ||
                (parseMoneyInput(moveAmountRaw) ?? 0) <= 0
              }
              onClick={runMove}
            >
              העבר
            </Button>
          </div>
        </div>

        {deficitTotal > 0 && (
          <p className="text-fg-muted text-xs">
            {deficits.length} סעיפים חרגו מהתכנון ב־{formatAgorot(deficitTotal)}. ״כסה חריגות״ מעלה
            את המתוכנן לגובה מה שבאמת הוצא, מהחריגה הקטנה לגדולה, כך שגם אם אין מספיק כסף נסגרים
            כמה שיותר סעיפים.
          </p>
        )}

        {(['fixed', 'flexible', 'savings'] as const).map((kind) =>
          grouped[kind].length === 0 ? null : (
            <div key={kind}>
              <div className="text-fg-muted mb-1.5 text-xs font-medium">{KIND_LABELS[kind]}</div>
              <table className="w-full text-xs">
                <thead className="text-fg-subtle">
                  <tr className="text-start">
                    <th className="pb-1 font-medium">קטגוריה</th>
                    <th className="w-28 pb-1 font-medium">מתוכנן</th>
                    <th className="w-24 pb-1 text-end font-medium">בפועל</th>
                    <th className="w-24 pb-1 text-end font-medium">נותר</th>
                    <th className="w-44 pb-1 font-medium">כסה מ…</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped[kind].map((line) => {
                    const actual = actuals.byCategory[line.category_id] ?? 0;
                    const left = line.planned_amount - actual;
                    const surplusOptions = lines.filter(
                      (l) =>
                        l.category_id !== line.category_id &&
                        l.planned_amount - (actuals.byCategory[l.category_id] ?? 0) > 0,
                    );
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
                                await invalidate();
                              }
                            }}
                          />
                        </td>
                        <td className="tnum py-1.5 text-end">{formatAgorot(actual)}</td>
                        <td
                          className={cn(
                            'tnum py-1.5 text-end',
                            left < 0 ? 'text-negative' : 'text-fg-muted',
                          )}
                        >
                          {formatAgorot(left)}
                        </td>
                        <td className="py-1.5">
                          {left < 0 && surplusOptions.length > 0 && (
                            <div className="flex items-center gap-1">
                              <Select
                                className="h-7 text-xs"
                                disabled={disabled}
                                value={coverSource[line.category_id] ?? ''}
                                onChange={(e) =>
                                  setCoverSource((prev) => ({
                                    ...prev,
                                    [line.category_id]: e.target.value,
                                  }))
                                }
                              >
                                <option value="">— בחר —</option>
                                {surplusOptions.map((o) => (
                                  <option key={o.category_id} value={o.category_id}>
                                    {o.category_name}
                                  </option>
                                ))}
                              </Select>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={disabled || !coverSource[line.category_id]}
                                onClick={() => coverFromCategory(line.category_id, -left)}
                              >
                                כסה
                              </Button>
                            </div>
                          )}
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
          <div className="text-fg-muted mb-1.5 text-xs font-medium">דמי כיס אישיים</div>
          <table className="w-full text-xs">
            <tbody>
              {people.map((person) => {
                const current = allowanceOf(person.id);
                const spent = actuals.personalSpent[person.id] ?? 0;
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
                            await invalidate();
                          }
                        }}
                      />
                    </td>
                    <td className="tnum w-24 py-1.5 text-end">{formatAgorot(spent)}</td>
                    <td
                      className={cn(
                        'tnum w-24 py-1.5 text-end',
                        current - spent < 0 ? 'text-negative' : 'text-fg-muted',
                      )}
                    >
                      {formatAgorot(current - spent)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function Summary({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'good' | 'bad';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        tone === 'good'
          ? 'border-positive/40 bg-positive/10'
          : tone === 'bad'
            ? 'border-negative/40 bg-negative/10'
            : 'border-line bg-surface-2/40',
      )}
    >
      <div className="text-fg-subtle text-[11px]">{label}</div>
      <div className="tnum mt-0.5 text-sm font-semibold">{formatAgorot(value)}</div>
    </div>
  );
}
