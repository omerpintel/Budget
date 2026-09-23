/**
 * Pure rollover maths for one budget period. No database access, so the arithmetic
 * can be property-tested directly.
 *
 * Money is integer agorot throughout; nothing here may introduce a fraction.
 */

export type WalletKey = 'joint' | 'savings' | { personal: string };

export interface Transfer {
  from: WalletKey;
  to: WalletKey;
  amount: number;
}

export interface PeriodInput {
  opening: {
    joint: number;
    savings: number;
    personal: Record<string, number>;
  };
  actual: {
    income: number;
    fixed: number;
    /** Joint flexible spending, excluding anything funded from savings. */
    jointFlexible: number;
    personalSpent: Record<string, number>;
    /** Big expenses explicitly drawn from the savings buffer. */
    savingsFunded: number;
    /** Real transfers into savings. Overrides `plan.savings` when present. */
    savingsContribution?: number;
  };
  plan: {
    /** Funded to each person regardless of what they actually spend. */
    allowances: Record<string, number>;
    /** Monthly contribution moved from the joint pot into savings. */
    savings: number;
  };
  transfers: Transfer[];
}

export interface WalletMovement {
  opening: number;
  inflow: number;
  outflow: number;
  delta: number;
  closing: number;
}

export interface PeriodResult {
  joint: WalletMovement;
  savings: WalletMovement;
  personal: Record<string, WalletMovement>;
  /** Positive when the joint buffer ends below zero. */
  shortfall: number;
}

function keyOf(wallet: WalletKey): string {
  return typeof wallet === 'string' ? wallet : `personal:${wallet.personal}`;
}

function movement(opening: number, inflow: number, outflow: number): WalletMovement {
  const delta = inflow - outflow;
  return { opening, inflow, outflow, delta, closing: opening + delta };
}

export function computePeriod(input: PeriodInput): PeriodResult {
  const transferIn = new Map<string, number>();
  const transferOut = new Map<string, number>();
  for (const t of input.transfers) {
    if (t.amount <= 0) continue;
    const from = keyOf(t.from);
    const to = keyOf(t.to);
    transferOut.set(from, (transferOut.get(from) ?? 0) + t.amount);
    transferIn.set(to, (transferIn.get(to) ?? 0) + t.amount);
  }
  const inOf = (key: string) => transferIn.get(key) ?? 0;
  const outOf = (key: string) => transferOut.get(key) ?? 0;

  const people = new Set([
    ...Object.keys(input.opening.personal),
    ...Object.keys(input.plan.allowances),
    ...Object.keys(input.actual.personalSpent),
  ]);

  const allowanceTotal = [...people].reduce(
    (sum, id) => sum + (input.plan.allowances[id] ?? 0),
    0,
  );

  // A real transfer into savings is the truth; the plan number is only a stand-in
  // for months where that transfer has not been made or imported yet. Using both
  // would charge the joint pot twice for the same shekels.
  const savingsMoved = input.actual.savingsContribution || input.plan.savings;

  // Allowances and the savings contribution leave the joint pot the moment the
  // period is planned, whether or not they are spent. That is what makes personal
  // money genuinely guilt-free.
  const joint = movement(
    input.opening.joint,
    input.actual.income + inOf('joint'),
    input.actual.fixed +
      input.actual.jointFlexible +
      allowanceTotal +
      savingsMoved +
      outOf('joint'),
  );

  const savings = movement(
    input.opening.savings,
    savingsMoved + inOf('savings'),
    input.actual.savingsFunded + outOf('savings'),
  );

  const personal: Record<string, WalletMovement> = {};
  for (const id of people) {
    const key = `personal:${id}`;
    personal[id] = movement(
      input.opening.personal[id] ?? 0,
      (input.plan.allowances[id] ?? 0) + inOf(key),
      (input.actual.personalSpent[id] ?? 0) + outOf(key),
    );
  }

  return {
    joint,
    savings,
    personal,
    shortfall: joint.closing < 0 ? -joint.closing : 0,
  };
}

/** Opening balances for the next period are simply this period's closings. */
export function nextOpening(result: PeriodResult): PeriodInput['opening'] {
  return {
    joint: result.joint.closing,
    savings: result.savings.closing,
    personal: Object.fromEntries(
      Object.entries(result.personal).map(([id, m]) => [id, m.closing]),
    ),
  };
}

export interface PlanLine {
  categoryId: string;
  planned: number;
}

/**
 * Zero-based check: every shekel of income must be given a job, whether that is a
 * category, someone's allowance, or savings. `carryover` folds in cash already
 * sitting in the joint buffer from previous months, which is real spendable money.
 */
export function leftToAssign(
  income: number,
  lines: PlanLine[],
  allowances: Record<string, number>,
  carryover = 0,
): number {
  const assigned =
    lines.reduce((sum, l) => sum + l.planned, 0) +
    Object.values(allowances).reduce((sum, a) => sum + a, 0);
  return income + carryover - assigned;
}

export interface CategoryVariance {
  categoryId: string;
  planned: number;
  actual: number;
  /** Negative means overspent. */
  delta: number;
}

export interface AllocationTarget {
  id: string;
  planned: number;
  actual: number;
}

export interface AllocationStep {
  assignments: Record<string, number>;
  used: number;
}

/**
 * Brings each plan up to what was actually spent. Smallest gap first, so a pot
 * that cannot cover everything still closes as many categories as possible
 * rather than sinking into the single worst one.
 */
export function coverDeficits(targets: AllocationTarget[], available: number): AllocationStep {
  const gaps = targets
    .map((t) => ({ id: t.id, gap: t.actual - t.planned }))
    .filter((g) => g.gap > 0)
    .sort((a, b) => a.gap - b.gap);

  const assignments: Record<string, number> = {};
  let left = Math.max(available, 0);

  for (const { id, gap } of gaps) {
    if (left <= 0) break;
    const give = Math.min(gap, left);
    assignments[id] = give;
    left -= give;
  }

  return { assignments, used: Math.max(available, 0) - left };
}

/**
 * Splits `amount` across weighted targets. Weights of zero fall back to an even
 * split, and the rounding remainder lands on the heaviest target so the parts
 * always add back up to `amount` exactly.
 */
export function spreadByWeight(
  targets: Array<{ id: string; weight: number }>,
  amount: number,
): Record<string, number> {
  const result: Record<string, number> = {};
  if (targets.length === 0 || amount <= 0) return result;

  const totalWeight = targets.reduce((s, t) => s + Math.max(t.weight, 0), 0);
  const even = totalWeight <= 0;
  let allocated = 0;

  for (const t of targets) {
    const share = even
      ? Math.floor(amount / targets.length)
      : Math.floor((amount * Math.max(t.weight, 0)) / totalWeight);
    result[t.id] = share;
    allocated += share;
  }

  const remainder = amount - allocated;
  if (remainder > 0) {
    const heaviest = even
      ? targets[0]
      : targets.reduce((a, b) => (Math.max(b.weight, 0) > Math.max(a.weight, 0) ? b : a));
    result[heaviest.id] += remainder;
  }

  return result;
}

export function computeVariance(
  lines: PlanLine[],
  actuals: Record<string, number>,
): CategoryVariance[] {
  const ids = new Set([...lines.map((l) => l.categoryId), ...Object.keys(actuals)]);
  return [...ids].map((categoryId) => {
    const planned = lines.find((l) => l.categoryId === categoryId)?.planned ?? 0;
    const actual = actuals[categoryId] ?? 0;
    return { categoryId, planned, actual, delta: planned - actual };
  });
}

/**
 * Moves planned money between two categories without touching the unassigned pool.
 * Clamped to what the source actually has, so a category can never go negative and
 * the total planned amount is always conserved.
 */
export function moveBetweenCategories(
  lines: PlanLine[],
  fromCategoryId: string,
  toCategoryId: string,
  amount: number,
): PlanLine[] {
  if (fromCategoryId === toCategoryId || amount <= 0) return [];

  const from = lines.find((l) => l.categoryId === fromCategoryId);
  const to = lines.find((l) => l.categoryId === toCategoryId);
  if (!from) return [];

  const moved = Math.min(amount, from.planned);
  if (moved <= 0) return [];

  return [
    { categoryId: fromCategoryId, planned: from.planned - moved },
    { categoryId: toCategoryId, planned: (to?.planned ?? 0) + moved },
  ];
}
