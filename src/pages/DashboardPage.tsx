import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, CircleCheck } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui/Feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { WalletCard } from '@/components/WalletCard';
import { listWallets } from '@/data/wallets';
import { listPeople } from '@/data/people';
import { listPeriods } from '@/data/periods';
import { listBudgetLines } from '@/data/budget';
import { loadActuals, recomputeFrom } from '@/data/periodEngine';
import { getRunStatus, deriveStep, RUN_STEPS } from '@/data/run';
import { getSetting, SETTING_KEYS } from '@/data/settings';
import { formatAgorot, periodLabel } from '@/lib/money';
import { cn } from '@/lib/utils';

function nextRunDate(closeDay: number): Date {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), closeDay);
  return today <= thisMonth ? thisMonth : new Date(now.getFullYear(), now.getMonth() + 1, closeDay);
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

export function DashboardPage() {
  const { data } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const [wallets, people, periods, closeDay] = await Promise.all([
        listWallets(),
        listPeople(),
        listPeriods(),
        getSetting(SETTING_KEYS.closeDay),
      ]);

      const current = periods[0] ?? null;
      if (!current) return { wallets, people, closeDay: Number(closeDay) || 10, current: null };

      const [result, lines, actuals, status] = await Promise.all([
        recomputeFrom(current.id),
        listBudgetLines(current.id),
        loadActuals(current.id),
        getRunStatus(current.id),
      ]);
      return {
        wallets,
        people,
        closeDay: Number(closeDay) || 10,
        current,
        result,
        lines,
        actuals,
        status,
      };
    },
  });

  if (!data) return null;
  const { people, closeDay, current } = data;
  const runDate = nextRunDate(closeDay);
  const daysAway = Math.round((runDate.getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  const now = new Date();

  if (!current || !data.result) {
    return (
      <>
        <PageHeader
          title={periodLabel(now.getFullYear(), now.getMonth() + 1)}
          description="Everything that moves through the bank this month."
        />
        <Card>
          <EmptyState
            icon={<CalendarClock className="size-8" strokeWidth={1.25} />}
            title="Nothing recorded yet"
            description="Start the monthly run to enter your salaries, import the card statements and see where the money went."
            action={
              <Link to="/run">
                <Button>
                  Start the run <ArrowRight className="size-4" />
                </Button>
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const { result, lines, actuals, status } = data;
  const flexible = (lines ?? []).filter((l) => l.kind === 'flexible');
  const step = status ? deriveStep(status) : 0;
  const committed = status?.committed ?? false;

  return (
    <>
      <PageHeader
        title={periodLabel(current.year, current.month)}
        description="Everything that moves through the bank this month."
        action={
          committed ? (
            <span className="text-positive flex shrink-0 items-center gap-1.5 text-xs font-medium">
              <CircleCheck className="size-4" /> Committed
            </span>
          ) : (
            <Link to="/run" className="shrink-0">
              <Button size="sm">
                {step === 0 ? 'Start the run' : 'Resume the run'} <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          )
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

      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-2">
          <CardHeader
            title="Flexible spending"
            description="Sorted by how far each category is from its plan."
          />
          <CardBody>
            {flexible.length === 0 ? (
              <p className="text-fg-subtle text-xs">
                No flexible categories planned yet. Set them on the{' '}
                <Link to="/budget" className="text-brand underline">
                  Budget page
                </Link>
                .
              </p>
            ) : (
              <div className="space-y-2.5">
                {[...flexible]
                  .map((line) => ({ line, actual: actuals?.byCategory[line.category_id] ?? 0 }))
                  .sort(
                    (a, b) =>
                      Math.abs(b.actual - b.line.planned_amount) -
                      Math.abs(a.actual - a.line.planned_amount),
                  )
                  .map(({ line, actual }) => {
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

        <Card>
          <CardHeader title="Monthly run" />
          <CardBody className="space-y-3">
            <div className="text-fg-subtle flex items-center gap-2 text-xs">
              <CalendarClock className="size-3.5" />
              {closeDay}
              {ordinal(closeDay)} ·{' '}
              {daysAway <= 0 ? 'ready now' : `in ${daysAway} day${daysAway === 1 ? '' : 's'}`}
            </div>

            <ol className="space-y-1.5">
              {RUN_STEPS.map((s, i) => (
                <li key={s.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold',
                      committed || i < step
                        ? 'bg-positive text-bg'
                        : i === step
                          ? 'bg-brand text-brand-fg'
                          : 'bg-surface-2 text-fg-subtle',
                    )}
                  >
                    {committed || i < step ? '✓' : i + 1}
                  </span>
                  <span className={i === step && !committed ? 'text-fg' : 'text-fg-muted'}>
                    {s.label}
                  </span>
                </li>
              ))}
            </ol>

            {!committed && status && status.unreviewed > 0 && (
              <p className="text-fg-subtle text-xs">
                {status.unreviewed} transaction{status.unreviewed === 1 ? '' : 's'} still to review.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
