/** Pure anomaly detection: this period's spending against its own recent history. */

export interface CategoryHistory {
  categoryId: string;
  categoryName: string;
  /** Most recent first; excludes the current period. */
  previous: number[];
  current: number;
}

export type AnomalyKind = 'over' | 'under' | 'new' | 'stopped';

export interface Anomaly {
  categoryId: string;
  categoryName: string;
  kind: AnomalyKind;
  current: number;
  average: number;
  /** Signed fraction away from the average; 0.2 means 20% above. */
  deviation: number;
  difference: number;
  severity: 'info' | 'warning';
}

export interface AnomalyOptions {
  /** Minimum fractional deviation before anything is reported. */
  threshold?: number;
  /** Minimum shekel difference (in agorot) so tiny categories stay quiet. */
  minDifference?: number;
  /** Deviation at which a note becomes a warning. */
  warnAt?: number;
  /** History periods required before averages mean anything. */
  minHistory?: number;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

export function detectAnomalies(
  histories: CategoryHistory[],
  options: AnomalyOptions = {},
): Anomaly[] {
  const threshold = options.threshold ?? 0.2;
  const minDifference = options.minDifference ?? 10_000;
  const warnAt = options.warnAt ?? 0.5;
  const minHistory = options.minHistory ?? 2;

  const anomalies: Anomaly[] = [];

  for (const history of histories) {
    const previous = history.previous.filter((v) => v > 0);
    const average = mean(previous);

    if (previous.length < minHistory) {
      // A brand-new category only matters once it is material.
      if (average === 0 && history.current >= minDifference) {
        anomalies.push({
          categoryId: history.categoryId,
          categoryName: history.categoryName,
          kind: 'new',
          current: history.current,
          average: 0,
          deviation: 1,
          difference: history.current,
          severity: 'info',
        });
      }
      continue;
    }

    if (history.current === 0) {
      if (average >= minDifference) {
        anomalies.push({
          categoryId: history.categoryId,
          categoryName: history.categoryName,
          kind: 'stopped',
          current: 0,
          average,
          deviation: -1,
          difference: -average,
          severity: 'info',
        });
      }
      continue;
    }

    const difference = history.current - average;
    const deviation = difference / average;
    if (Math.abs(deviation) < threshold || Math.abs(difference) < minDifference) continue;

    anomalies.push({
      categoryId: history.categoryId,
      categoryName: history.categoryName,
      kind: difference > 0 ? 'over' : 'under',
      current: history.current,
      average,
      deviation,
      difference,
      severity: Math.abs(deviation) >= warnAt && difference > 0 ? 'warning' : 'info',
    });
  }

  return anomalies.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}

export interface InstallmentRow {
  merchant: string;
  amount: number;
  current: number;
  total: number;
  date: string;
}

export interface InstallmentPlan {
  merchant: string;
  monthlyAmount: number;
  paid: number;
  total: number;
  remaining: number;
  outstanding: number;
  finalPayment: string;
}

/**
 * Under cash-flow budgeting only the monthly instalment is booked, so the committed
 * future liability is invisible. This surfaces it.
 */
export function installmentPlans(rows: InstallmentRow[]): InstallmentPlan[] {
  const latest = new Map<string, InstallmentRow>();
  for (const row of rows) {
    if (row.total <= 1 || row.current < 1 || row.current > row.total) continue;
    const key = `${row.merchant}|${row.total}|${row.amount}`;
    const existing = latest.get(key);
    if (!existing || row.current > existing.current) latest.set(key, row);
  }

  return [...latest.values()]
    .map((row) => {
      const remaining = row.total - row.current;
      const last = new Date(`${row.date}T00:00:00Z`);
      last.setUTCMonth(last.getUTCMonth() + remaining);
      return {
        merchant: row.merchant,
        monthlyAmount: row.amount,
        paid: row.current,
        total: row.total,
        remaining,
        outstanding: row.amount * remaining,
        finalPayment: last.toISOString().slice(0, 10),
      };
    })
    .filter((plan) => plan.remaining > 0)
    .sort((a, b) => b.outstanding - a.outstanding);
}

export function totalOutstanding(plans: InstallmentPlan[]): number {
  return plans.reduce((sum, p) => sum + p.outstanding, 0);
}
