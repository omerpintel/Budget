import { stripBidi } from './encoding';
import { toAgorot } from '@/lib/money';

/** Excel serial epoch offset (1900 system, including its leap-year bug). */
const EXCEL_EPOCH_OFFSET = 25569;

export function parseDate(value: unknown): string | null {
  if (value == null || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDate(value);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 1 || value > 80_000) return null;
    return toIsoDate(new Date(Math.round((value - EXCEL_EPOCH_OFFSET) * 86_400_000)));
  }

  const raw = stripBidi(String(value)).trim();
  if (raw === '') return null;

  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Israeli exports are day-first; a value above 12 in the first slot confirms it.
  const dmy = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return buildDate(year, month, day);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : toIsoDate(parsed);
}

function buildDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Returns agorot, or null when the cell holds no usable number. */
export function parseAmount(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? toAgorot(value) : null;

  let raw = stripBidi(String(value)).trim();
  if (raw === '' || raw === '-') return null;

  const parenthesised = /^\((.*)\)$/.test(raw);
  if (parenthesised) raw = raw.replace(/^\(|\)$/g, '');

  const negative = parenthesised || raw.includes('-');
  const digits = raw.replace(/[^\d.]/g, '');
  if (digits === '' || digits === '.') return null;

  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return toAgorot(negative ? -n : n);
}

export interface Installment {
  current: number;
  total: number;
}

const INSTALLMENT_PATTERNS = [
  /תשלום\s*(\d+)\s*(?:מתוך|מ־|מ-|מ)\s*(\d+)/,
  /(\d+)\s*מתוך\s*(\d+)\s*תשלומים/,
  /תשלום\s*(\d+)\s*\/\s*(\d+)/,
  /\b(\d{1,2})\s*\/\s*(\d{1,2})\b(?!\s*\/)/,
];

export function parseInstallment(value: unknown): Installment | null {
  if (value == null) return null;
  const raw = stripBidi(String(value)).trim();
  if (raw === '') return null;

  for (const pattern of INSTALLMENT_PATTERNS) {
    const m = raw.match(pattern);
    if (!m) continue;
    const current = Number(m[1]);
    const total = Number(m[2]);
    if (total > 1 && current >= 1 && current <= total) return { current, total };
  }
  return null;
}

export function parseCurrency(value: unknown): string | null {
  if (value == null || value === '') return null;
  const raw = stripBidi(String(value)).trim().toUpperCase();
  if (raw === '' || raw === 'ILS' || raw === '₪' || raw.includes('שקל') || raw === 'NIS') return null;
  if (raw === '$' || raw.includes('דולר')) return 'USD';
  if (raw === '€' || raw.includes('אירו') || raw.includes('יורו')) return 'EUR';
  if (raw === '£') return 'GBP';
  return /^[A-Z]{3}$/.test(raw) ? raw : null;
}
