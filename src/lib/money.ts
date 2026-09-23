// Grouping is taken from en-US and the shekel sign prefixed manually: the he-IL
// currency formatter emits RTL control marks that corrupt the number itself.
const GROUPED = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const GROUPED_PRECISE = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Amounts are LTR runs ("−₪1,250") sitting inside RTL Hebrew text. Without an
 * isolate the sign and the shekel sign get reordered by the bidi algorithm, so
 * every amount is wrapped in LRI…PDI. These are zero-width formatting characters.
 */
const LRI = '\u2066';
const PDI = '\u2069';

/** Strips the bidi isolates, for comparisons and any non-display use. */
export function stripBidi(text: string): string {
  return text.replace(/[\u2066\u2069]/g, '');
}

/** Money is stored in agorot (integer minor units) to keep rollover math exact. */
export function toAgorot(major: number): number {
  return Math.round(major * 100);
}

export function toMajor(agorot: number): number {
  return agorot / 100;
}

export function formatAgorot(agorot: number, opts?: { precise?: boolean; signed?: boolean }): string {
  const fmt = opts?.precise ? GROUPED_PRECISE : GROUPED;
  const text = `₪${fmt.format(Math.abs(toMajor(agorot)))}`;
  // Amounts under the displayed precision format as "0"; signing those would
  // print "−₪0", which reads as a deficit when there is nothing there.
  if (!/[1-9]/.test(text)) return `${LRI}${text}${PDI}`;
  if (agorot < 0) return `${LRI}−${text}${PDI}`;
  return `${LRI}${opts?.signed ? '+' : ''}${text}${PDI}`;
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
  return new Date(year, month - 1, 1).toLocaleDateString('he-IL', {
    month: 'long',
    year: 'numeric',
  });
}
