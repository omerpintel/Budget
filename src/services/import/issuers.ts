import { normalizeHeader } from './encoding';

export type ColumnField =
  | 'transactionDate'
  | 'billingDate'
  | 'description'
  | 'chargeAmount'
  | 'originalAmount'
  | 'originalCurrency'
  | 'issuerCategory'
  | 'installment'
  | 'notes'
  | 'debit'
  | 'credit';

export type ColumnMap = Partial<Record<ColumnField, number>>;

/**
 * Aliases are ordered most-specific first; the matcher consumes exact hits before
 * falling back to substring matching so a generic "סכום" never steals "סכום עסקה".
 */
export const COLUMN_ALIASES: Record<ColumnField, string[]> = {
  transactionDate: [
    'תאריך עסקה',
    'תאריך העסקה',
    'תאריך ביצוע העסקה',
    'תאריך רכישה',
    'תאריך ביצוע',
    'תאריך הפעולה',
    'תאריך',
    'transaction date',
    'date',
  ],
  billingDate: ['תאריך חיוב', 'תאריך החיוב', 'מועד חיוב', 'תאריך ערך', 'value date', 'billing date'],
  description: [
    'שם בית העסק',
    'שם בית עסק',
    'בית העסק',
    'בית עסק',
    'תיאור העסקה',
    'שם העסק',
    'תיאור',
    'פרטים',
    'פירוט',
    'merchant',
    'business name',
    'description',
    'payee',
    'details',
  ],
  chargeAmount: [
    'סכום חיוב בשח',
    'סכום החיוב',
    'סכום לחיוב',
    'סכום חיוב',
    'סכום בשח',
    'סכום',
    'charge amount',
    'amount',
  ],
  originalAmount: [
    'סכום עסקה מקורי',
    'סכום מקורי',
    'סכום העסקה',
    'סכום עסקה',
    'original amount',
  ],
  originalCurrency: ['מטבע מקורי', 'מטבע עסקה', 'מטבע חיוב', 'מטבע', 'currency'],
  issuerCategory: ['קטגוריה', 'ענף', 'סוג עסקה', 'category'],
  installment: ['תשלומים', 'מספר תשלום', 'פירוט תשלומים', 'installments'],
  notes: ['פירוט נוסף', 'מידע נוסף', 'הערות', 'notes', 'comments'],
  debit: ['חובה', 'סכום חובה', 'משיכה', 'debit', 'withdrawal'],
  credit: ['זכות', 'סכום זכות', 'הפקדה', 'credit', 'deposit'],
};

export interface IssuerAdapter {
  id: string;
  label: string;
  /** Charges arrive positive in most Israeli card exports; bank statements vary. */
  amountSign: 'charge_positive' | 'charge_negative';
  /** Rows whose description matches are summary/total lines, not transactions. */
  skipRowPatterns?: RegExp[];
}

const TOTALS = [/^סה"?כ/, /^סהכ/, /^total/i, /^יתרה/];

export const ISSUER_ADAPTERS: Record<string, IssuerAdapter> = {
  isracard: { id: 'isracard', label: 'Isracard', amountSign: 'charge_positive', skipRowPatterns: TOTALS },
  max: { id: 'max', label: 'Max', amountSign: 'charge_positive', skipRowPatterns: TOTALS },
  cal: { id: 'cal', label: 'Cal', amountSign: 'charge_positive', skipRowPatterns: TOTALS },
  'amex-il': { id: 'amex-il', label: 'American Express', amountSign: 'charge_positive', skipRowPatterns: TOTALS },
  hapoalim: { id: 'hapoalim', label: 'Bank Hapoalim', amountSign: 'charge_negative', skipRowPatterns: TOTALS },
  leumi: { id: 'leumi', label: 'Bank Leumi', amountSign: 'charge_negative', skipRowPatterns: TOTALS },
  discount: { id: 'discount', label: 'Discount Bank', amountSign: 'charge_negative', skipRowPatterns: TOTALS },
  mizrahi: { id: 'mizrahi', label: 'Mizrahi Tefahot', amountSign: 'charge_negative', skipRowPatterns: TOTALS },
  other: { id: 'other', label: 'Other', amountSign: 'charge_positive', skipRowPatterns: TOTALS },
};

export function getAdapter(issuer: string): IssuerAdapter {
  return ISSUER_ADAPTERS[issuer] ?? ISSUER_ADAPTERS.other;
}

const FIELD_ORDER: ColumnField[] = [
  'transactionDate',
  'billingDate',
  'description',
  'chargeAmount',
  'originalAmount',
  'originalCurrency',
  'debit',
  'credit',
  'installment',
  'issuerCategory',
  'notes',
];

/** Maps a header row to canonical fields. Exact matches win before substring matches. */
export function detectColumns(headerRow: string[]): ColumnMap {
  const headers = headerRow.map(normalizeHeader);
  const map: ColumnMap = {};
  const taken = new Set<number>();

  for (const pass of ['exact', 'partial'] as const) {
    for (const field of FIELD_ORDER) {
      if (map[field] !== undefined) continue;
      for (const alias of COLUMN_ALIASES[field]) {
        const key = normalizeHeader(alias);
        const idx = headers.findIndex((h, i) => {
          if (taken.has(i) || h === '') return false;
          return pass === 'exact' ? h === key : h.includes(key) || key.includes(h);
        });
        if (idx !== -1) {
          map[field] = idx;
          taken.add(idx);
          break;
        }
      }
    }
  }

  return map;
}

export function isMappingUsable(map: ColumnMap): boolean {
  const hasAmount =
    map.chargeAmount !== undefined || map.debit !== undefined || map.credit !== undefined;
  return map.transactionDate !== undefined && map.description !== undefined && hasAmount;
}

/**
 * Israeli exports prepend title and account-summary rows, so the header is rarely row 0.
 * Scans the first rows for the one that yields a usable mapping.
 */
export function findHeaderRow(rows: string[][], maxScan = 25): number {
  let best = -1;
  let bestScore = 0;

  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const map = detectColumns(rows[i]);
    if (!isMappingUsable(map)) continue;
    const score = Object.keys(map).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }

  return best;
}
