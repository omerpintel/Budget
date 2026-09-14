// Grouping is taken from en-US and the shekel sign prefixed manually: the he-IL
// currency formatter emits RTL control marks that corrupt an otherwise LTR layout.
const GROUPED = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const GROUPED_PRECISE = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Money is stored in agorot (integer minor units) to keep rollover math exact. */
export function toAgorot(major: number): number {
  return Math.round(major * 100);
}

export function toMajor(agorot: number): number {
  return agorot / 100;
}

export function formatAgorot(agorot: number, opts?: { precise?: boolean; signed?: boolean }): string {
  const value = toMajor(agorot);
  const fmt = opts?.precise ? GROUPED_PRECISE : GROUPED;
  const text = `₪${fmt.format(Math.abs(value))}`;
  if (opts?.signed && agorot !== 0) return `${agorot > 0 ? '+' : '−'}${text}`;
  return agorot < 0 ? `−${text}` : text;
}

export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,\-]/g, '').replace(/,/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? toAgorot(n) : null;
}

export function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function periodLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}
