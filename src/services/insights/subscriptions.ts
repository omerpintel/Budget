/**
 * Pure detection for recurring charges. Works on transaction dates (when you swiped),
 * not debit dates, because a subscription's rhythm is set by the vendor.
 */

export type Cadence = 'monthly' | 'bimonthly' | 'quarterly' | 'annual';

export interface Charge {
  date: string;
  amount: number;
  merchant: string;
  isMasked?: boolean;
}

export interface Subscription {
  merchant: string;
  cadence: Cadence;
  expectedAmount: number;
  intervalDays: number;
  occurrences: number;
  firstCharge: string;
  lastCharge: string;
  nextExpected: string;
  status: 'active' | 'watch' | 'cancelled';
  /** Total paid so far across the detected run. */
  totalPaid: number;
  isMasked: boolean;
}

const CADENCE_WINDOWS: Array<{ cadence: Cadence; min: number; max: number }> = [
  { cadence: 'monthly', min: 24, max: 37 },
  { cadence: 'bimonthly', min: 52, max: 70 },
  { cadence: 'quarterly', min: 80, max: 104 },
  { cadence: 'annual', min: 340, max: 390 },
];

const DAY = 86_400_000;

function toTime(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function toDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function cadenceFor(days: number): Cadence | null {
  return CADENCE_WINDOWS.find((w) => days >= w.min && days <= w.max)?.cadence ?? null;
}

export interface ScanOptions {
  /** Today, so "has it stopped?" is decidable. */
  referenceDate: string;
  /** Fraction by which an interval may deviate from the median and still count. */
  intervalTolerance?: number;
  /** Fraction by which an amount may deviate from the median and still count. */
  amountTolerance?: number;
  /** Amounts within this many agorot are treated as equal regardless of percentage. */
  amountFloor?: number;
}

export function detectSubscriptions(charges: Charge[], options: ScanOptions): Subscription[] {
  const byMerchant = new Map<string, Charge[]>();
  for (const charge of charges) {
    if (!charge.merchant) continue;
    const bucket = byMerchant.get(charge.merchant);
    if (bucket) bucket.push(charge);
    else byMerchant.set(charge.merchant, [charge]);
  }

  const intervalTolerance = options.intervalTolerance ?? 0.25;
  const amountTolerance = options.amountTolerance ?? 0.15;
  const amountFloor = options.amountFloor ?? 500;
  const reference = toTime(options.referenceDate);
  const found: Subscription[] = [];

  for (const [merchant, list] of byMerchant) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => toTime(a.date) - toTime(b.date));

    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(Math.round((toTime(sorted[i].date) - toTime(sorted[i - 1].date)) / DAY));
    }

    const medianInterval = median(intervals);
    const cadence = cadenceFor(medianInterval);
    if (!cadence) continue;

    const regular = intervals.every(
      (gap) => Math.abs(gap - medianInterval) <= Math.max(medianInterval * intervalTolerance, 3),
    );
    if (!regular) continue;

    const amounts = sorted.map((c) => c.amount);
    const medianAmount = median(amounts);
    const stable = amounts.every(
      (amount) =>
        Math.abs(amount - medianAmount) <= Math.max(medianAmount * amountTolerance, amountFloor),
    );
    if (!stable) continue;

    const lastTime = toTime(sorted[sorted.length - 1].date);
    const nextExpected = lastTime + medianInterval * DAY;
    // Past due is only suspicious; a second missed cycle means it really stopped.
    const status: Subscription['status'] =
      reference > nextExpected + medianInterval * DAY
        ? 'cancelled'
        : reference > nextExpected
          ? 'watch'
          : 'active';

    found.push({
      merchant,
      cadence,
      expectedAmount: medianAmount,
      intervalDays: medianInterval,
      occurrences: sorted.length,
      firstCharge: sorted[0].date,
      lastCharge: sorted[sorted.length - 1].date,
      nextExpected: toDate(nextExpected),
      status,
      totalPaid: amounts.reduce((sum, a) => sum + a, 0),
      isMasked: sorted.some((c) => c.isMasked),
    });
  }

  return found.sort((a, b) => b.expectedAmount - a.expectedAmount);
}

/** What the detected subscriptions cost over twelve months. */
export function annualCost(subscriptions: Subscription[]): number {
  const perYear: Record<Cadence, number> = {
    monthly: 12,
    bimonthly: 6,
    quarterly: 4,
    annual: 1,
  };
  return subscriptions
    .filter((s) => s.status !== 'cancelled')
    .reduce((sum, s) => sum + s.expectedAmount * perYear[s.cadence], 0);
}
