import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseAmount, parseCurrency, parseDate, parseInstallment } from './parseValues';
import { decodeBytes, normalizeHeader } from './encoding';
import { detectColumns, findHeaderRow, isMappingUsable } from './issuers';
import { parseFile, parseGrid, toGrid } from './parseFile';
import { isLegacyXls, isXlsx, readXlsx, type CellValue } from './xlsx';

describe('encoding', () => {
  it('decodes windows-1255 Hebrew that is not valid UTF-8', () => {
    const bytes = new Uint8Array([0xf9, 0xec, 0xe5, 0xed]);
    const result = decodeBytes(bytes);
    expect(result.encoding).toBe('windows-1255');
    expect(result.text).toBe('שלום');
  });

  it('strips a UTF-8 BOM instead of leaking it into the first header', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x62]);
    expect(decodeBytes(bytes)).toEqual({ text: 'ab', encoding: 'utf-8' });
  });

  it('removes bidi control marks from headers', () => {
    expect(normalizeHeader('\u200fסכום  חיוב\u200e')).toBe('סכום חיוב');
    expect(normalizeHeader('סכום חיוב בש"ח')).toBe('סכום חיוב בשח');
  });
});

describe('parseDate', () => {
  it('reads Israeli day-first dates', () => {
    expect(parseDate('14/08/2026')).toBe('2026-08-14');
    expect(parseDate('03/08/26')).toBe('2026-08-03');
    expect(parseDate('1.9.2026')).toBe('2026-09-01');
  });

  it('reads ISO dates emitted by xlsx date cells', () => {
    expect(parseDate('2026-08-14')).toBe('2026-08-14');
  });

  it('converts Excel serial numbers', () => {
    expect(parseDate(46248)).toBe('2026-08-14');
  });

  it('rejects unusable values', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('32/13/2026')).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

describe('parseAmount', () => {
  it('strips currency noise and separators', () => {
    expect(parseAmount('₪1,234.56')).toBe(123456);
    expect(parseAmount('245.90')).toBe(24590);
    expect(parseAmount(54.9)).toBe(5490);
  });

  it('treats parentheses and minus signs as negative', () => {
    expect(parseAmount('(150.00)')).toBe(-15000);
    expect(parseAmount('-150')).toBe(-15000);
  });

  it('returns null for empty cells', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('-')).toBeNull();
  });
});

describe('parseInstallment', () => {
  it('reads the Hebrew installment phrasing used by Israeli issuers', () => {
    expect(parseInstallment('תשלום 3 מתוך 12')).toEqual({ current: 3, total: 12 });
    expect(parseInstallment('תשלום 1 מ 6')).toEqual({ current: 1, total: 6 });
    expect(parseInstallment('3/12')).toEqual({ current: 3, total: 12 });
  });

  it('ignores single payments and nonsense ratios', () => {
    expect(parseInstallment('תשלום רגיל')).toBeNull();
    expect(parseInstallment('13/12')).toBeNull();
  });
});

describe('parseCurrency', () => {
  it('returns null for shekel so local charges stay unmarked', () => {
    expect(parseCurrency('ILS')).toBeNull();
    expect(parseCurrency('₪')).toBeNull();
    expect(parseCurrency('שקל חדש')).toBeNull();
  });

  it('maps foreign currencies', () => {
    expect(parseCurrency('USD')).toBe('USD');
    expect(parseCurrency('דולר')).toBe('USD');
  });
});

const ISRACARD: CellValue[][] = [
  ['פירוט עסקאות', '', '', '', ''],
  ['כרטיס 4471', '', '', '', ''],
  ['תאריך עסקה', 'שם בית עסק', 'סכום עסקה', 'סכום חיוב', 'פירוט נוסף'],
  ['14/08/2026', 'שופרסל דיל רמת גן', '245.90', '245.90', ''],
  ['03/08/2026', 'נטפליקס', '54.90', '54.90', 'מנוי חודשי'],
  ['סה"כ', '', '', '300.80', ''],
];

const MAX: CellValue[][] = [
  ['תאריך עסקה', 'שם בית העסק', 'קטגוריה', 'סכום חיוב', 'סכום עסקה מקורי', 'מטבע מקורי', 'הערות'],
  ['05/08/2026', 'איקאה נתניה', 'ריהוט', '500.00', '6000.00', 'ILS', 'תשלום 3 מתוך 12'],
  ['07/08/2026', 'AMAZON US', 'קניות', '380.00', '99.00', 'USD', ''],
];

const BANK: CellValue[][] = [
  ['תאריך', 'תיאור', 'חובה', 'זכות', 'יתרה'],
  ['01/09/2026', 'העברת משכורת', '', '18,500.00', '30,000.00'],
  ['02/09/2026', 'שכר דירה', '6,200.00', '', '23,800.00'],
];

describe('column detection', () => {
  it('finds the header row below Israeli title rows', () => {
    expect(findHeaderRow(ISRACARD.map((r) => r.map(String)))).toBe(2);
  });

  it('does not let the generic amount alias steal the original-amount column', () => {
    const map = detectColumns(ISRACARD[2] as string[]);
    expect(map.chargeAmount).toBe(3);
    expect(map.originalAmount).toBe(2);
  });

  it('maps bank debit and credit columns', () => {
    const map = detectColumns(BANK[0] as string[]);
    expect(map.debit).toBe(2);
    expect(map.credit).toBe(3);
    expect(map.chargeAmount).toBeUndefined();
    expect(isMappingUsable(map)).toBe(true);
  });
});

describe('parseGrid', () => {
  it('parses an Isracard statement and drops the totals row', () => {
    const result = parseGrid(ISRACARD, 'isracard');
    expect(result.mappingComplete).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      transactionDate: '2026-08-14',
      description: 'שופרסל דיל רמת גן',
      amount: 24590,
      direction: 'out',
    });
    expect(result.skipped.map((s) => s.reason)).toContain('Summary row');
  });

  it('captures installments and foreign currency from a Max statement', () => {
    const result = parseGrid(MAX, 'max');
    expect(result.rows[0].installment).toEqual({ current: 3, total: 12 });
    expect(result.rows[0].amount).toBe(50000);
    expect(result.rows[1].originalCurrency).toBe('USD');
    expect(result.rows[1].originalAmount).toBe(9900);
  });

  it('signs bank rows from the debit and credit columns', () => {
    const result = parseGrid(BANK, 'leumi');
    expect(result.rows[0]).toMatchObject({ direction: 'in', amount: 1_850_000 });
    expect(result.rows[1]).toMatchObject({ direction: 'out', amount: 620_000 });
  });

  it('reports an incomplete mapping instead of guessing', () => {
    const result = parseGrid([['foo', 'bar'], ['1', '2']], 'other');
    expect(result.mappingComplete).toBe(false);
    expect(result.rows).toHaveLength(0);
  });
});

function buildXlsx(rows: string[][], extra: Record<string, string> = {}): Uint8Array {
  const shared = [...new Set(rows.flat())];
  const index = new Map(shared.map((s, i) => [s, i]));
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const col = (i: number) => String.fromCharCode(65 + i);

  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(
      `<workbook xmlns:r="x"><sheets><sheet name="s" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    'xl/sharedStrings.xml': strToU8(
      `<sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<worksheet><sheetData>${rows
        .map(
          (row, r) =>
            `<row r="${r + 1}">${row
              .map((cell, c) => `<c r="${col(c)}${r + 1}" t="s"><v>${index.get(cell)}</v></c>`)
              .join('')}</row>`,
        )
        .join('')}</sheetData></worksheet>`,
    ),
  };
  for (const [name, content] of Object.entries(extra)) files[name] = strToU8(content);
  return zipSync(files);
}

describe('readXlsx', () => {
  it('reads shared strings and preserves Hebrew', () => {
    const bytes = buildXlsx([
      ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב'],
      ['05/08/2026', 'רמי לוי שיווק', '389.20'],
    ]);
    expect(readXlsx(bytes)).toEqual([
      ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב'],
      ['05/08/2026', 'רמי לוי שיווק', '389.20'],
    ]);
  });

  it('decodes XML entities in cell text', () => {
    const bytes = buildXlsx([['A&B <Ltd>']]);
    expect(readXlsx(bytes)[0][0]).toBe('A&B <Ltd>');
  });

  it('rejects a legacy .xls signature before attempting to unzip', () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(isLegacyXls(ole)).toBe(true);
    expect(isXlsx(ole)).toBe(false);
    expect(() => toGrid(ole)).toThrow(/legacy \.xls/i);
  });

  it('parses an xlsx statement end to end', () => {
    const bytes = buildXlsx([
      ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב', 'מטבע מקורי'],
      ['07/08/2026', 'AMAZON US', '380.00', 'USD'],
    ]);
    const result = parseFile(bytes, 'max');
    expect(result.fileKind).toBe('xlsx');
    expect(result.rows[0]).toMatchObject({
      transactionDate: '2026-08-07',
      description: 'AMAZON US',
      amount: 38000,
      direction: 'out',
      originalCurrency: 'USD',
    });
  });
});
