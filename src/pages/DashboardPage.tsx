import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarClock,
  CircleCheck,
  CreditCard,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui/Feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { WalletCard } from '@/components/WalletCard';
import { ImportHistory } from '@/features/import/ImportHistory';
import { listWallets } from '@/data/wallets';
import { listPeople } from '@/data/people';
import { findPeriod } from '@/data/periods';
import { listAllocationLines } from '@/data/budget';
import { buildInsights, type InsightBundle } from '@/data/insights';
import type { Anomaly } from '@/services/insights/anomalies';
import { loadActuals, recomputeFrom } from '@/data/periodEngine';
import { getRunStatus, deriveStep, RUN_STEPS } from '@/data/run';
import { getSetting, SETTING_KEYS } from '@/data/settings';
import { formatAgorot, periodLabel } from '@/lib/money';
import { usePeriod } from '@/state/period';
import { cn } from '@/lib/utils';

const KIND_LABELS: Record<'fixed' | 'flexible' | 'savings', string> = {
  fixed: 'הוצאות קבועות',
  flexible: 'הוצאות משתנות',
  savings: 'חיסכון',
};

function nextRunDate(closeDay: number): Date {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), closeDay);
  return today <= thisMonth ? thisMonth : new Date(now.getFullYear(), now.getMonth() + 1, closeDay);
}

export function DashboardPage() {
  const { ref, isCurrent } = usePeriod();

  const { data } = useQuery({
    queryKey: ['dashboard', ref.year, ref.month],
    queryFn: async () => {
      const [wallets, people, current, closeDay] = await Promise.all([
        listWallets(),
        listPeople(),
        findPeriod(ref),
        getSetting(SETTING_KEYS.closeDay),
      ]);

      if (!current) return { wallets, people, closeDay: Number(closeDay) || 10, current: null };

      const [result, lines, actuals, status, insights] = await Promise.all([
        recomputeFrom(current.id),
        listAllocationLines(current.id),
        loadActuals(current.id),
        getRunStatus(current.id),
        buildInsights(current.id),
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
        insights,
      };
    },
  });

  if (!data) return null;
  const { people, closeDay, current } = data;
  const runDate = nextRunDate(closeDay);
  const daysAway = Math.round((runDate.getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);

  if (!current || !data.result) {
    return (
      <>
        <PageHeader
          title={periodLabel(ref.year, ref.month)}
          description="כל מה שעובר בחשבון הבנק החודש."
        />
        <Card>
          <EmptyState
            icon={<CalendarClock className="size-8" strokeWidth={1.25} />}
            title="לא נרשם כלום לחודש הזה"
            description="התחל את סגירת החודש כדי להזין את המשכורות שלך, לייבא את דפי החיוב ולראות לאן הלך הכסף."
            action={
              <Link to="/run">
                <Button>
                  {isCurrent ? 'התחל סגירת חודש' : `פתח את ${periodLabel(ref.year, ref.month)}`}{' '}
                  <ArrowRight className="dir-icon size-4" />
                </Button>
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const { result, lines, actuals, status } = data;
  // Only categories with a plan; the rest would be a wall of zeroes on a read-only view.
  const budgeted = (lines ?? []).filter((l) => l.planned_amount > 0);
  const step = status ? deriveStep(status) : 0;
  const committed = status?.committed ?? false;

  return (
    <>
      <PageHeader
        title={periodLabel(current.year, current.month)}
        description="כל מה שעובר בחשבון הבנק החודש."
        action={
          committed ? (
            <span className="text-positive flex shrink-0 items-center gap-1.5 text-xs font-medium">
              <CircleCheck className="size-4" /> נעול
            </span>
          ) : (
            <Link to="/run" className="shrink-0">
              <Button size="sm">
                {step === 0 ? 'התחל סגירת חודש' : 'המשך סגירת חודש'}{' '}
                <ArrowRight className="dir-icon size-3.5" />
              </Button>
            </Link>
          )
        }
      />

      <div className="mb-4 grid grid-cols-4 gap-3">
        <WalletCard
          name="משותף"
          kind="joint_buffer"
          balance={result.joint.closing}
          caption={`${formatAgorot(result.joint.delta, { signed: true })} החודש`}
        />
        <WalletCard
          name="חיסכון"
          kind="savings"
          balance={result.savings.closing}
          caption={`${formatAgorot(result.savings.delta, { signed: true })} החודש`}
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
            })} החודש`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-2">
          <CardHeader
            title="כמה נשאר בכל קטגוריה"
            description="מתוכנן מול בפועל לחודש הזה. לעריכה — שלב השיוך בסגירת החודש."
            action={
              <Link to="/run" className="text-brand shrink-0 text-xs hover:underline">
                עריכת התקציב
              </Link>
            }
          />
          <CardBody>
            {budgeted.length === 0 ? (
              <p className="text-fg-subtle text-xs">
                עדיין לא הוקצה תקציב לחודש הזה. עבור לשלב{' '}
                <Link to="/run" className="text-brand underline">
                  השיוך בסגירת החודש
                </Link>{' '}
                כדי לחלק את ההכנסות לקטגוריות.
              </p>
            ) : (
              <div className="space-y-4">
                {(['fixed', 'flexible', 'savings'] as const).map((kind) => {
                  const group = budgeted.filter((l) => l.kind === kind);
                  if (group.length === 0) return null;
                  return (
                    <div key={kind}>
                      <div className="text-fg-subtle mb-2 text-[11px] font-medium">
                        {KIND_LABELS[kind]}
                      </div>
                      <div className="space-y-2.5">
                        {group.map((line) => {
                          const actual = actuals?.byCategory[line.category_id] ?? 0;
                          const pct =
                            line.planned_amount > 0 ? (actual / line.planned_amount) * 100 : 0;
                          const over = actual > line.planned_amount;
                          const left = line.planned_amount - actual;
                          return (
                            <div key={line.category_id}>
                              <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                                <span className="truncate">{line.category_name}</span>
                                <span
                                  className={cn(
                                    'tnum shrink-0',
                                    over ? 'text-negative' : 'text-fg-muted',
                                  )}
                                >
                                  {over ? 'חריגה של ' : 'נותר '}
                                  {formatAgorot(Math.abs(left))}
                                  <span className="text-fg-subtle">
                                    {' '}
                                    · {formatAgorot(actual)} מתוך {formatAgorot(line.planned_amount)}
                                  </span>
                                </span>
                              </div>
                              <div className="bg-surface-2 h-1.5 overflow-hidden rounded-full">
                                <div
                                  className={cn(
                                    'h-full rounded-full',
                                    over ? 'bg-negative' : 'bg-joint',
                                  )}
                                  style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="סגירת חודש" />
          <CardBody className="space-y-3">
            <div className="text-fg-subtle flex items-center gap-2 text-xs">
              <CalendarClock className="size-3.5" />
              ה־{closeDay} בחודש ·{' '}
              {daysAway <= 0 ? 'אפשר להתחיל' : daysAway === 1 ? 'מחר' : `בעוד ${daysAway} ימים`}
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
                נותרו {status.unreviewed} תנועות למיון.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <Card className="col-span-2">
          <CardHeader
            title="שווה מבט"
            description="מנויים והוצאות חריגות שזוהו מההיסטוריה שלך."
            action={
              <Link to="/insights" className="text-brand shrink-0 text-xs hover:underline">
                הצג הכל
              </Link>
            }
          />
          <CardBody>
            <InsightsSummary insights={data.insights} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="העלאות החודש" />
          <CardBody>
            <ImportHistory periodId={current.id} compact />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function anomalySentence(a: Anomaly): string {
  switch (a.kind) {
    case 'new':
      return `חדש החודש — ${formatAgorot(a.current)}, אין היסטוריה להשוואה.`;
    case 'stopped':
      return `לא הוצא כלום, מול ממוצע של ${formatAgorot(a.average)}.`;
    default:
      return `${formatAgorot(a.current)} מול ממוצע של ${formatAgorot(a.average)} — ${Math.abs(
        Math.round(a.deviation * 100),
      )}% ${a.difference > 0 ? 'יותר' : 'פחות'}.`;
  }
}

function InsightsSummary({ insights }: { insights: InsightBundle | undefined }) {
  if (!insights) return null;

  const { subscriptions, anomalies, installments, installmentOutstanding } = insights;
  if (subscriptions.length === 0 && anomalies.length === 0 && installments.length === 0) {
    return (
      <p className="text-fg-subtle text-xs">
        אין ממצאים חריגים. הזיהוי צריך כמה חודשי היסטוריה לפני שיהיה לו מה להגיד.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {anomalies.slice(0, 3).map((a) => (
        <div key={a.categoryId} className="flex items-start gap-2 text-xs">
          <TriangleAlert
            className={cn(
              'mt-px size-3.5 shrink-0',
              a.severity === 'warning' ? 'text-warning' : 'text-fg-subtle',
            )}
          />
          <div>
            <div className="font-medium">{a.categoryName}</div>
            <div className="text-fg-muted">{anomalySentence(a)}</div>
          </div>
        </div>
      ))}

      {subscriptions.length > 0 && (
        <div className="flex items-start gap-2 text-xs">
          <RefreshCw className="text-fg-subtle mt-px size-3.5 shrink-0" />
          <div>
            <div className="font-medium">
              {subscriptions.length === 1
                ? 'חיוב קבוע אחד'
                : `${subscriptions.length} חיובים קבועים`}
            </div>
            <div className="text-fg-muted">
              בערך {formatAgorot(insights.annualSubscriptionCost)} בשנה.
            </div>
          </div>
        </div>
      )}

      {installments.length > 0 && (
        <div className="flex items-start gap-2 text-xs">
          <CreditCard className="text-fg-subtle mt-px size-3.5 shrink-0" />
          <div>
            <div className="font-medium">
              {installments.length === 1
                ? 'תוכנית תשלומים אחת פעילה'
                : `${installments.length} תוכניות תשלומים פעילות`}
            </div>
            <div className="text-fg-muted">
              נותר לשלם {formatAgorot(installmentOutstanding)}.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
