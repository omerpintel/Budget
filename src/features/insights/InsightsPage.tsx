import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
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
import { Select } from '@/components/ui/Field';
import { MerchantText } from '@/components/MerchantText';
import { listPeriods } from '@/data/periods';
import { buildInsights, getDismissedSubscriptions, setSubscriptionDismissed } from '@/data/insights';
import { formatAgorot, periodLabel } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { Anomaly } from '@/services/insights/anomalies';

const CADENCE_LABEL: Record<string, string> = {
  monthly: 'Monthly',
  bimonthly: 'Every two months',
  quarterly: 'Quarterly',
  annual: 'Yearly',
};

export function InsightsPage() {
  const [periodId, setPeriodId] = useState('');
  const qc = useQueryClient();
  const { data: periods } = useQuery({ queryKey: ['periods'], queryFn: listPeriods });
  const active = periodId || periods?.[0]?.id || '';

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

  if (!periods) return null;
  if (periods.length === 0) {
    return (
      <>
        <PageHeader title="Insights" />
        <Card>
          <EmptyState
            title="Nothing to analyse yet"
            description="Import a few months of statements and patterns start showing up here."
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
      <PageHeader
        title="Insights"
        description="Patterns the app noticed on its own. Nothing here changes your numbers."
        action={
          <Select
            className="h-8 w-40 shrink-0 text-xs"
            value={active}
            onChange={(e) => setPeriodId(e.target.value)}
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {periodLabel(p.year, p.month)}
              </option>
            ))}
          </Select>
        }
      />

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Recurring charges"
            description="Detected from billing rhythm and price stability — no list to maintain."
            action={
              activeSubs.length > 0 ? (
                <div className="text-right">
                  <div className="tnum text-sm font-semibold">
                    {formatAgorot(data.annualSubscriptionCost)}
                  </div>
                  <div className="text-fg-subtle text-[11px]">per year</div>
                </div>
              ) : undefined
            }
          />
          <CardBody className={activeSubs.length === 0 ? undefined : 'p-0'}>
            {data.subscriptions.length === 0 ? (
              <p className="text-fg-subtle text-xs">
                Nothing recurring found yet. A charge needs to appear at least three times at a steady
                price before it counts.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-fg-subtle">
                  <tr className="text-left">
                    <th className="px-4 py-2 font-medium">Merchant</th>
                    <th className="w-36 px-4 py-2 font-medium">Rhythm</th>
                    <th className="w-28 px-4 py-2 font-medium">Next</th>
                    <th className="w-24 px-4 py-2 text-right font-medium">Each</th>
                    <th className="w-24 px-4 py-2 text-right font-medium">Paid</th>
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
                        {sub.status === 'cancelled' && ' · stopped'}
                        {sub.status === 'watch' && ' · overdue'}
                      </td>
                      <td className="text-fg-muted px-4 py-2">
                        {sub.status === 'cancelled' ? '—' : sub.nextExpected}
                      </td>
                      <td className="tnum px-4 py-2 text-right">
                        {formatAgorot(sub.expectedAmount)}
                      </td>
                      <td className="tnum text-fg-muted px-4 py-2 text-right">
                        {formatAgorot(sub.totalPaid)}
                      </td>
                      <td className="pr-3 text-right">
                        <button
                          type="button"
                          aria-label={`Not a subscription: ${sub.merchant}`}
                          title="Not a subscription"
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
                  {data.dismissedCount} hidden — bring back
                </button>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="What changed this month"
            description="Flexible categories compared with their own recent average."
          />
          <CardBody className="space-y-2">
            {data.historyDepth < 2 ? (
              <p className="text-fg-subtle text-xs">
                Two earlier months are needed before averages mean anything. Use{' '}
                <Link to="/import" className="text-brand underline">
                  historical backfill
                </Link>{' '}
                to load older statements and this fills in immediately.
              </p>
            ) : data.anomalies.length === 0 ? (
              <p className="text-fg-subtle text-xs">
                Nothing unusual — every category is close to its average.
              </p>
            ) : (
              data.anomalies.map((anomaly) => <AnomalyRow key={anomaly.categoryId} anomaly={anomaly} />)
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Committed instalments"
            description="Only this month's payment hits the budget, so here is what is still owed."
            action={
              data.installments.length > 0 ? (
                <div className="text-right">
                  <div className="tnum text-sm font-semibold">
                    {formatAgorot(data.installmentOutstanding)}
                  </div>
                  <div className="text-fg-subtle text-[11px]">still to pay</div>
                </div>
              ) : undefined
            }
          />
          <CardBody className={data.installments.length === 0 ? undefined : 'p-0'}>
            {data.installments.length === 0 ? (
              <p className="text-fg-subtle text-xs">No instalment plans running.</p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {data.installments.map((plan) => (
                    <tr key={`${plan.merchant}-${plan.total}`} className="border-line/60 border-t">
                      <td className="w-8 pl-4">
                        <CreditCard className="text-fg-subtle size-3.5" />
                      </td>
                      <td className="px-2 py-2">
                        <MerchantText value={plan.merchant} />
                      </td>
                      <td className="text-fg-muted px-4 py-2">
                        {plan.paid} of {plan.total} paid
                      </td>
                      <td className="text-fg-muted px-4 py-2">
                        <span className="flex items-center gap-1.5">
                          <CalendarClock className="size-3" />
                          ends {plan.finalPayment}
                        </span>
                      </td>
                      <td className="tnum text-fg-muted px-4 py-2 text-right">
                        {formatAgorot(plan.monthlyAmount)}/mo
                      </td>
                      <td className="tnum px-4 py-2 pr-4 text-right font-medium">
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
        return `New this month — ${formatAgorot(anomaly.current)} with no history to compare against.`;
      case 'stopped':
        return `Nothing spent, against an average of ${formatAgorot(anomaly.average)}.`;
      default:
        return `${formatAgorot(anomaly.current)} against an average of ${formatAgorot(
          anomaly.average,
        )} — ${Math.abs(Math.round(anomaly.deviation * 100))}% ${up ? 'more' : 'less'}.`;
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
