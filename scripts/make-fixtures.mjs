// Generates sample Israeli statements for manual import testing.
// Run: node scripts/make-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';

const OUT = new URL('../fixtures/', import.meta.url);
mkdirSync(OUT, { recursive: true });

/** Hebrew letters map contiguously onto 0xE0..0xFA in windows-1255. */
function toCp1255(text) {
  const bytes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code <= 0x7f) bytes.push(code);
    else if (code >= 0x05d0 && code <= 0x05ea) bytes.push(code - 0x05d0 + 0xe0);
    else if (ch === '₪') bytes.push(0xa4);
    else bytes.push(0x3f);
  }
  return Uint8Array.from(bytes);
}

const isracard = [
  ['פירוט עסקאות', '', '', '', ''],
  ['כרטיס 4471', '', '', '', ''],
  ['', '', '', '', ''],
  ['תאריך עסקה', 'שם בית עסק', 'סכום עסקה', 'סכום חיוב', 'פירוט נוסף'],
  ['14/08/2026', 'שופרסל דיל רמת גן', '245.90', '245.90', ''],
  ['15/08/2026', 'ארומה תל אביב', '32.00', '32.00', ''],
  ['16/08/2026', 'פז יעל דלק', '310.45', '310.45', ''],
  ['18/08/2026', 'נטפליקס', '54.90', '54.90', 'מנוי חודשי'],
  ['19/08/2026', 'סופר פארם דיזנגוף', '128.30', '128.30', ''],
  ['21/08/2026', 'שופרסל דיל רמת גן', '412.15', '412.15', ''],
  ['23/08/2026', 'ארומה תל אביב', '32.00', '32.00', ''],
  ['25/08/2026', 'איקאה נתניה', '6000.00', '500.00', 'תשלום 3 מתוך 12'],
  ['סה"כ', '', '', '1715.70', ''],
]
  .map((row) => row.map((c) => (c.includes(',') ? `"${c}"` : c)).join(','))
  .join('\r\n');

writeFileSync(new URL('isracard-sample.csv', OUT), toCp1255(isracard));

const maxRows = [
  ['תאריך עסקה', 'שם בית העסק', 'קטגוריה', 'סכום חיוב', 'סכום עסקה מקורי', 'מטבע מקורי', 'הערות'],
  ['05/08/2026', 'רמי לוי שיווק', 'מזון', '389.20', '389.20', 'ILS', ''],
  ['07/08/2026', 'AMAZON US', 'קניות', '380.00', '99.00', 'USD', ''],
  ['09/08/2026', 'ספוטיפיי', 'בידור', '19.90', '19.90', 'ILS', 'מנוי חודשי'],
  ['12/08/2026', 'חניון דיזנגוף סנטר', 'תחבורה', '45.00', '45.00', 'ILS', ''],
  ['20/08/2026', 'סטימצקי', 'פנאי', '89.00', '89.00', 'ILS', ''],
];

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c],
  );
}

const shared = [...new Set(maxRows.flat())];
const sharedIndex = new Map(shared.map((s, i) => [s, i]));
const colName = (i) => String.fromCharCode(65 + i);

const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${maxRows
  .map(
    (row, r) =>
      `<row r="${r + 1}">${row
        .map((cell, c) => `<c r="${colName(c)}${r + 1}" t="s"><v>${sharedIndex.get(cell)}</v></c>`)
        .join('')}</row>`,
  )
  .join('')}</sheetData></worksheet>`;

const files = {
  '[Content_Types].xml': strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
  ),
  '_rels/.rels': strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  ),
  'xl/workbook.xml': strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="עסקאות" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  ),
  'xl/_rels/workbook.xml.rels': strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  ),
  'xl/sharedStrings.xml': strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
      .map((s) => `<si><t>${escapeXml(s)}</t></si>`)
      .join('')}</sst>`,
  ),
  'xl/worksheets/sheet1.xml': strToU8(sheetXml),
};

writeFileSync(new URL('max-sample.xlsx', OUT), zipSync(files));

console.log('Wrote fixtures/isracard-sample.csv (windows-1255) and fixtures/max-sample.xlsx');
