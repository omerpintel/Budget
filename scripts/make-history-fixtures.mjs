// Generates four consecutive monthly Isracard statements so the insight detectors
// have real history to chew on. Run: node scripts/make-history-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../fixtures/history/', import.meta.url);
mkdirSync(OUT, { recursive: true });

function toCp1255(text) {
  const bytes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code <= 0x7f) bytes.push(code);
    else if (code >= 0x05d0 && code <= 0x05ea) bytes.push(code - 0x05d0 + 0xe0);
    else bytes.push(0x3f);
  }
  return Uint8Array.from(bytes);
}

const pad = (n) => String(n).padStart(2, '0');

// Spending month -> the month its bill is debited.
const MONTHS = [
  { spend: 5, debit: 'jun', groceries: 1850.4, restaurants: 240 },
  { spend: 6, debit: 'jul', groceries: 1910.25, restaurants: 265 },
  { spend: 7, debit: 'aug', groceries: 1795.8, restaurants: 250 },
  // September's bill covers August, where groceries jump and fuel stops.
  { spend: 8, debit: 'sep', groceries: 3120.6, restaurants: 255 },
];

for (const [index, month] of MONTHS.entries()) {
  const m = pad(month.spend);
  const rows = [
    ['פירוט עסקאות', '', '', '', ''],
    ['כרטיס 4471', '', '', '', ''],
    ['', '', '', '', ''],
    ['תאריך עסקה', 'שם בית עסק', 'סכום עסקה', 'סכום חיוב', 'פירוט נוסף'],
    [`08/${m}/2026`, 'שופרסל דיל רמת גן', month.groceries.toFixed(2), month.groceries.toFixed(2), ''],
    [`12/${m}/2026`, 'ארומה תל אביב', month.restaurants.toFixed(2), month.restaurants.toFixed(2), ''],
    [`18/${m}/2026`, 'נטפליקס', '54.90', '54.90', 'מנוי חודשי'],
    [`22/${m}/2026`, 'ספוטיפיי', '19.90', '19.90', 'מנוי חודשי'],
    [
      `25/${m}/2026`,
      'איקאה נתניה',
      '6000.00',
      '500.00',
      `תשלום ${index + 1} מתוך 12`,
    ],
  ];

  // Fuel runs for the first three months and then stops.
  if (index < 3) rows.push([`15/${m}/2026`, 'פז יעל דלק', '310.45', '310.45', '']);

  rows.push(['סה"כ', '', '', '0.00', '']);

  const csv = rows
    .map((row) => row.map((c) => (c.includes(',') ? `"${c}"` : c)).join(','))
    .join('\r\n');
  writeFileSync(new URL(`isracard-${month.debit}.csv`, OUT), toCp1255(csv));
}

console.log('Wrote 4 monthly statements to fixtures/history/');
