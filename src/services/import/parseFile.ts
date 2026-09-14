import Papa from 'papaparse';
import { decodeBytes, stripBidi } from './encoding';
import { detectColumns, findHeaderRow, getAdapter, isMappingUsable, type ColumnMap } from './issuers';
import { parseAmount, parseCurrency, parseDate, parseInstallment, type Installment } from './parseValues';
import { isLegacyXls, isXlsx, readXlsx, type CellValue } from './xlsx';
import type { Direction } from '@/data/types';

export interface ParsedRow {
  rowIndex: number;
  transactionDate: string;
  description: string;
  /** Always positive; `direction` carries the sign. */
  amount: number;
  direction: Direction;
  originalAmount: number | null;
  originalCurrency: string | null;
  installment: Installment | null;
  issuerCategory: string | null;
  notes: string | null;
}

export interface SkippedRow {
  rowIndex: number;
  reason: string;
  preview: string;
}

export interface ParseResult {
  fileKind: 'csv' | 'xlsx';
  encoding: string;
  headerRowIndex: number;
  headers: string[];
  columnMap: ColumnMap;
  mappingComplete: boolean;
  rows: ParsedRow[];
  skipped: SkippedRow[];
  /** Raw grid head, so the mapping wizard can show the user what it saw. */
  preview: CellValue[][];
}

export function toGrid(bytes: Uint8Array): { grid: CellValue[][]; kind: 'csv' | 'xlsx'; encoding: string } {
  if (isLegacyXls(bytes)) {
    throw new Error(
      'This is a legacy .xls file. Open it in Excel and re-save as .xlsx or CSV, then import again.',
    );
  }
  if (isXlsx(bytes)) {
    return { grid: readXlsx(bytes), kind: 'xlsx', encoding: 'utf-8' };
  }
  const { text, encoding } = decodeBytes(bytes);
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  return { grid: parsed.data, kind: 'csv', encoding };
}

function cellText(value: CellValue | undefined): string {
  if (value == null) return '';
  return stripBidi(String(value)).trim();
}

export function parseGrid(
  grid: CellValue[][],
  issuer: string,
  overrideMap?: ColumnMap,
  overrideHeaderRow?: number,
): Omit<ParseResult, 'fileKind' | 'encoding'> {
  const adapter = getAdapter(issuer);
  const stringGrid = grid.map((row) => row.map(cellText));

  const headerRowIndex = overrideHeaderRow ?? findHeaderRow(stringGrid);
  const headers = headerRowIndex >= 0 ? stringGrid[headerRowIndex] : (stringGrid[0] ?? []);
  const columnMap = overrideMap ?? (headerRowIndex >= 0 ? detectColumns(headers) : {});
  const preview = grid.slice(0, 15);

  if (!isMappingUsable(columnMap)) {
    return {
      headerRowIndex,
      headers,
      columnMap,
      mappingComplete: false,
      rows: [],
      skipped: [],
      preview,
    };
  }

  const rows: ParsedRow[] = [];
  const skipped: SkippedRow[] = [];
  const startRow = (headerRowIndex >= 0 ? headerRowIndex : 0) + 1;

  for (let i = startRow; i < grid.length; i++) {
    const raw = grid[i];
    const text = stringGrid[i];
    if (!raw || text.every((c) => c === '')) continue;

    const description = cellText(raw[columnMap.description!]);
    // Totals labels sit in the first column, not the description column.
    const firstCell = text.find((c) => c !== '') ?? '';
    if (adapter.skipRowPatterns?.some((re) => re.test(firstCell) || re.test(description))) {
      skipped.push({ rowIndex: i, reason: 'Summary row', preview: firstCell });
      continue;
    }
    if (description === '') {
      continue;
    }

    const transactionDate = parseDate(raw[columnMap.transactionDate!]);
    if (!transactionDate) {
      skipped.push({ rowIndex: i, reason: 'Unreadable date', preview: description });
      continue;
    }

    const signed = extractAmount(raw, columnMap, adapter.amountSign);
    if (signed === null || signed === 0) {
      skipped.push({ rowIndex: i, reason: 'No amount', preview: description });
      continue;
    }

    const notes = columnMap.notes !== undefined ? cellText(raw[columnMap.notes]) : '';
    const installmentCell = columnMap.installment !== undefined ? cellText(raw[columnMap.installment]) : '';

    rows.push({
      rowIndex: i,
      transactionDate,
      description,
      amount: Math.abs(signed),
      direction: signed < 0 ? 'out' : 'in',
      originalAmount:
        columnMap.originalAmount !== undefined ? parseAmount(raw[columnMap.originalAmount]) : null,
      originalCurrency:
        columnMap.originalCurrency !== undefined ? parseCurrency(raw[columnMap.originalCurrency]) : null,
      installment: parseInstallment(installmentCell) ?? parseInstallment(`${description} ${notes}`),
      issuerCategory:
        columnMap.issuerCategory !== undefined ? cellText(raw[columnMap.issuerCategory]) || null : null,
      notes: notes || null,
    });
  }

  return { headerRowIndex, headers, columnMap, mappingComplete: true, rows, skipped, preview };
}

/** Returns signed agorot where negative means money leaving the account. */
function extractAmount(
  raw: CellValue[],
  map: ColumnMap,
  sign: 'charge_positive' | 'charge_negative',
): number | null {
  if (map.debit !== undefined || map.credit !== undefined) {
    const debit = map.debit !== undefined ? parseAmount(raw[map.debit]) : null;
    const credit = map.credit !== undefined ? parseAmount(raw[map.credit]) : null;
    if (debit) return -Math.abs(debit);
    if (credit) return Math.abs(credit);
    return null;
  }

  const value = map.chargeAmount !== undefined ? parseAmount(raw[map.chargeAmount]) : null;
  if (value === null) return null;
  // Card statements list charges as positive numbers; bank exports use a negative sign.
  return sign === 'charge_positive' ? -value : value;
}

export function parseFile(
  bytes: Uint8Array,
  issuer: string,
  overrideMap?: ColumnMap,
  overrideHeaderRow?: number,
): ParseResult {
  const { grid, kind, encoding } = toGrid(bytes);
  return { fileKind: kind, encoding, ...parseGrid(grid, issuer, overrideMap, overrideHeaderRow) };
}
