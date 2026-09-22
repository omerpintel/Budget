import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CreditCard,
  EyeOff,
  Lock,
  Repeat,
  RotateCcw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui/Feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { MerchantText } from '@/components/MerchantText';
import { findPeriod } from '@/data/periods';
import { buildInsights, getDismissedSubscriptions, setSubscriptionDismissed } from '@/data/insights';
import { formatAgorot, periodLabel } from '@/lib/money';
import { usePeriod } from '@/state/period';
import { cn } from '@/lib/utils';
import type { Anomaly } from '@/services/insights/anomalies';

const CADENCE_LABEL: Record<string, string> = {
  monthly: 'חודשי',
  bimonthly: 'דו-חודשי',
  quarterly: 'רבעוני',
  annual: 'שנתי',
};

function BackLink() {
  return (
    <Link
      to="/"
      className="text-fg-subtle hover:text-fg mb-2 inline-flex items-center gap-1 text-xs"
    >
      <ArrowRight className="dir-icon size-3.5" />
      חזרה למרכז
    </Link>
  );
}

export function InsightsPage() {
  const qc = useQueryClient();
  const { ref } = usePeriod();
  const { data: period, isFetched } = useQuery({
    queryKey: ['period', ref.year, ref.month],
    queryFn: () => findPeriod(ref),
  });
  const active = period?.id ?? '';

  const { data } = useQuery({
    enabled: Boolean(active),
    queryKey: ['insights', active],
    queryFn: () => buildInsights(active),
  });

  const dismiss = useMutation({
    mutationFn: ({ merchant, hidden }: { merchant: string; hidden: boolean }) =>
      setSubscriptionDismissed(merchant, hidden),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['insights'] }),
  });

  if (isFetched && !period) {
    return (
      <>
        <BackLink />
        <PageHeader title="תובנות" />
        <Card>
          <EmptyState
            title={`אין מה לנתח ב${periodLabel(ref.year, ref.month)}`}
            description="ייבא כמה חודשים של דפי חיוב והדפוסים יתחילו להופיע כאן."
          />
        </Card>
      </>
    );
  }
  if (!data) return null;

  const activeSubs = data.subscriptions.filter((s) => s.status !== 'cancelled');
  const cancelledSubs = data.subscriptions.filter((s) => s.status === 'cancelled');

  return (
    <>
      <BackLink />
      <PageHeader
        title="תובנות"
        description="דפוסים שהאפליקציה זיהתה בעצמה. שום דבר כאן לא משנה את המספרים שלך."
      />

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="חיובים קבועים"
            description="מזוהים לפי קצב החיוב ויציבות המחיר — אין רשימה לתחזק."
            action={
              activeSubs.length > 0 ? (
                <div className="text-end">
                  <div className="tnum text-sm font-semibold">
                    {formatAgorot(data.annualSubscriptionCost)}
                  </div>
                  <div className="text-fg-subtle text-[11px]">בשנה</div>
                </div>
              ) : undefined
            }
          />
          <CardBody className={activeSubs.length === 0 ? undefined : 'p-0'}>
            {data.subscriptions.length === 0 ? (
              <p className="text-fg-subtle text-xs">
                עדיין לא נמצא שום חיוב קבוע. חיוב צריך להופיע לפחות שלוש פעמים במחיר יציב כדי להיחשב.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-fg-subtle">
                  <tr className="text-start">
                    <th className="px-4 py-2 font-medium">בית עסק</th>
                    <th className="w-36 px-4 py-2 font-medium">תדירות</th>
                    <th className="w-28 px-4 py-2 font-medium">הבא</th>
                    <th className="w-24 px-4 py-2 text-end font-medium">כל חיוב</th>
                    <th className="w-24 px-4 py-2 text-end font-medium">שולם</th>
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody>
                  {[...activeSubs, ...cancelledSubs].map((sub) => (
                    <tr
                      key={sub.merchant}
                      className={cn(
                        'border-line/60 border-t',
                        sub.status === 'cancelled' && 'text-fg-subtle',
                      )}
                    >
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-1.5">
                          {sub.isMasked ? (
                            <Lock className="text-fg-subtle size-3 shrink-0" />
                          ) : (
                            <Repeat className="text-fg-subtle size-3 shrink-0" />
                          )}
                          <MerchantText value={sub.merchant} masked={sub.isMasked} />
                        </span>
                      </td>
                      <td className="text-fg-muted px-4 py-2">
                        {CADENCE_LABEL[sub.cadence]}
                        {sub.status === 'cancelled' && ' · הופסק'}
                        {sub.status === 'watch' && ' · באיחור'}
                      </td>
                      <td className="text-fg-muted px-4 py-2">
                        {sub.status === 'cancelled' ? '—' : sub.nextExpected}
                      </td>
                      <td className="tnum px-4 py-2 text-end">
                        {formatAgorot(sub.expectedAmount)}
                      </td>
                      <td className="tnum text-fg-muted px-4 py-2 text-end">
                        {formatAgorot(sub.totalPaid)}
                      </td>
                      <td className="pe-3 text-end">
                        <button
                          type="button"
                          aria-label={`לא מנוי: ${sub.merchant}`}
                          title="לא מנוי"
                          className="text-fg-subtle hover:text-fg"
                          onClick={() => dismiss.mutate({ merchant: sub.merchant, hidden: true })}
                        >
                          <EyeOff className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data.dismissedCount > 0 && (
              <div className="border-line/60 border-t px-4 py-2.5">
                <button
                  type="button"
                  className="text-fg-subtle hover:text-fg flex items-center gap-1.5 text-xs"
                  onClick={async () => {
                    for (const merchant of await getDismissedSubscriptions()) {
                      await setSubscriptionDismissed(merchant, false);
                    }
                    await qc.invalidateQueries({ queryKey: ['insights'] });
                  }}
                >
                  <RotateCcw className="size-3" />
                  {data.dismissedCount === 1 ? 'חיוב אחד מוסתר' : `${data.dismissedCount} חיובים מוסתרים`} —
                  החזרה
                </button>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="מה השתנה החודש"
            description="קטגוריות משתנות בהשוואה לממוצע האחרון שלהן."
          />
          <CardBody className="space-y-2">
            {data.historyDepth < 2 ? (
              <p className="text-fg-subtle text-xs">
                צריך לפחות שני חודשים קודמים כדי שלממוצעים תהיה משמעות. השתמש ב־{' '}
                <Link to="/import" className="text-brand underline">
                  מילוי היסטוריה
                </Link>{' '}
                כדי לטעון דפי חיוב ישנים וזה יתמלא מיד.
              </p>
            ) : data.anomalies.length === 0 ? (
              <p className="text-fg-subtle text-xs">
                אין חריגות — כל קטגוריה קרובה לממוצע שלה.
              </p>
            ) : (
              data.anomalies.map((anomaly) => <AnomalyRow key={anomaly.categoryId} anomaly={anomaly} />)
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="תשלומים שנותרו"
            description="רק התשלום של החודש נכנס לתקציב, אז הנה מה שעוד חייבים."
            action={
              data.installments.length > 0 ? (
                <div className="text-end">
                  <div className="tnum text-sm font-semibold">
                    {formatAgorot(data.installmentOutstanding)}
                  </div>
                  <div className="text-fg-subtle text-[11px]">נותר לשלם</div>
                </div>
              ) : undefined
            }
          />
          <CardBody className={data.installments.length === 0 ? undefined : 'p-0'}>
            {data.installments.length === 0 ? (
              <p className="text-fg-subtle text-xs">אין תוכניות תשלומים פעילות.</p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {data.installments.map((plan) => (
                    <tr key={`${plan.merchant}-${plan.total}`} className="border-line/60 border-t">
                      <td className="w-8 ps-4">
                        <CreditCard className="text-fg-subtle size-3.5" />
                      </td>
                      <td className="px-2 py-2">
                        <MerchantText value={plan.merchant} />
                      </td>
                      <td className="text-fg-muted px-4 py-2">
                        שולמו {plan.paid} מתוך {plan.total}
                      </td>
                      <td className="text-fg-muted px-4 py-2">
                        <span className="flex items-center gap-1.5">
                          <CalendarClock className="size-3" />
                          מסתיים {plan.finalPayment}
                        </span>
                      </td>
                      <td className="tnum text-fg-muted px-4 py-2 text-end">
                        {formatAgorot(plan.monthlyAmount)}/חודש
                      </td>
                      <td className="tnum px-4 py-2 pe-4 text-end font-medium">
                        {formatAgorot(plan.outstanding)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function AnomalyRow({ anomaly }: { anomaly: Anomaly }) {
  const up = anomaly.difference > 0;
  const Icon = anomaly.severity === 'warning' ? AlertTriangle : up ? TrendingUp : TrendingDown;

  const sentence = () => {
    switch (anomaly.kind) {
      case 'new':
        return `חדש החודש — ${formatAgorot(anomaly.current)}, אין היסטוריה להשוואה.`;
      case 'stopped':
        return `לא הוצא כלום, מול ממוצע של ${formatAgorot(anomaly.average)}.`;
      default:
        return `${formatAgorot(anomaly.current)} מול ממוצע של ${formatAgorot(
          anomaly.average,
        )} — ${Math.abs(Math.round(anomaly.deviation * 100))}% ${up ? 'יותר' : 'פחות'}.`;
    }
  };

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border p-3',
        anomaly.severity === 'warning'
          ? 'border-warning/40 bg-warning/10'
          : 'border-line bg-surface-2/40',
      )}
    >
      <Icon
        className={cn(
          'mt-px size-4 shrink-0',
          anomaly.severity === 'warning' ? 'text-warning' : up ? 'text-fg-muted' : 'text-positive',
        )}
      />
      <div className="min-w-0">
        <div className="text-xs font-medium">{anomaly.categoryName}</div>
        <p className="text-fg-muted mt-0.5 text-xs leading-relaxed">{sentence()}</p>
      </div>
    </div>
  );
}
