import { unzipSync, strFromU8 } from 'fflate';

/**
 * Minimal XLSX reader: an .xlsx is a ZIP of XML, so we unzip and scan the first
 * worksheet plus the shared-string table. Avoids the vulnerable `xlsx@0.18.5` on npm,
 * runs inside a Web Worker (which has no DOMParser), and processes no DTDs, formulas,
 * macros or external references.
 */

export type CellValue = string | number | null;

const BUILTIN_DATE_FORMATS = /^(1[4-9]|2[0-2]|4[5-7])$/;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
    return ENTITIES[code] ?? whole;
  });
}

function getAttr(tag: string, name: string): string | null {
  return new RegExp(`(?:^|\\s)(?:\\w+:)?${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1] ?? null;
}

interface XmlNode {
  attrs: string;
  body: string;
}

/** Matches both self-closing and paired tags, with or without a namespace prefix. */
function scan(xml: string, name: string): XmlNode[] {
  const re = new RegExp(
    `<(?:\\w+:)?${name}\\b([^>]*?)/>|<(?:\\w+:)?${name}\\b([^>]*?)>([\\s\\S]*?)</(?:\\w+:)?${name}>`,
    'g',
  );
  const out: XmlNode[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push({ attrs: m[1] ?? m[2] ?? '', body: m[3] ?? '' });
  return out;
}

function textContent(xml: string): string {
  return scan(xml, 't')
    .map((n) => decodeEntities(n.body))
    .join('');
}

function columnToIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function readSharedStrings(files: Record<string, Uint8Array>): string[] {
  const entry = files['xl/sharedStrings.xml'];
  if (!entry) return [];
  return scan(strFromU8(entry), 'si').map((si) => textContent(si.body));
}

/** Style indices whose number format is a date, so serials can be converted back. */
function readDateStyles(files: Record<string, Uint8Array>): Set<number> {
  const dateStyles = new Set<number>();
  const entry = files['xl/styles.xml'];
  if (!entry) return dateStyles;

  const xml = strFromU8(entry);
  const customDateFormats = new Set<string>();
  for (const fmt of scan(xml, 'numFmt')) {
    const code = getAttr(fmt.attrs, 'formatCode') ?? '';
    const id = getAttr(fmt.attrs, 'numFmtId');
    if (id && /[dmyh]/i.test(code) && !/^[#0.,\s%]+$/.test(code)) customDateFormats.add(id);
  }

  const cellXfs = scan(xml, 'cellXfs')[0];
  if (!cellXfs) return dateStyles;
  scan(cellXfs.body, 'xf').forEach((xf, i) => {
    const id = getAttr(xf.attrs, 'numFmtId') ?? '0';
    if (BUILTIN_DATE_FORMATS.test(id) || customDateFormats.has(id)) dateStyles.add(i);
  });
  return dateStyles;
}

function firstSheetPath(files: Record<string, Uint8Array>): string {
  const workbook = files['xl/workbook.xml'];
  const rels = files['xl/_rels/workbook.xml.rels'];

  if (workbook && rels) {
    const sheet = scan(strFromU8(workbook), 'sheet')[0];
    const relId = sheet ? getAttr(sheet.attrs, 'id') : null;
    if (relId) {
      const target = scan(strFromU8(rels), 'Relationship')
        .map((r) => r.attrs)
        .find((attrs) => getAttr(attrs, 'Id') === relId);
      const path = target ? getAttr(target, 'Target') : null;
      if (path) return `xl/${path.replace(/^\/?xl\//, '').replace(/^\//, '')}`;
    }
  }

  const fallback = Object.keys(files).find((name) => /^xl\/worksheets\/sheet\d*\.xml$/.test(name));
  if (!fallback) throw new Error('No worksheet found in this file.');
  return fallback;
}

export function readXlsx(bytes: Uint8Array): CellValue[][] {
  const files = unzipSync(bytes);
  const sheetEntry = files[firstSheetPath(files)];
  if (!sheetEntry) throw new Error('No worksheet found in this file.');

  const shared = readSharedStrings(files);
  const dateStyles = readDateStyles(files);
  const rows: CellValue[][] = [];

  for (const rowNode of scan(strFromU8(sheetEntry), 'row')) {
    const cells: CellValue[] = [];
    for (const cell of scan(rowNode.body, 'c')) {
      const ref = getAttr(cell.attrs, 'r') ?? '';
      const index = ref ? columnToIndex(ref) : cells.length;
      const type = getAttr(cell.attrs, 't');
      const styleIndex = Number(getAttr(cell.attrs, 's') ?? '-1');

      let value: CellValue = null;
      if (type === 'inlineStr') {
        value = textContent(cell.body);
      } else {
        const raw = scan(cell.body, 'v')[0]?.body ?? '';
        if (raw !== '') {
          if (type === 's') value = shared[Number(raw)] ?? '';
          else if (type === 'str' || type === 'e') value = decodeEntities(raw);
          else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
          else {
            const n = Number(raw);
            value = Number.isFinite(n) ? n : decodeEntities(raw);
            // Date cells arrive as serials; convert so the value parser sees a real date.
            if (dateStyles.has(styleIndex) && typeof value === 'number') value = serialToIso(value);
          }
        }
      }

      while (cells.length < index) cells.push(null);
      cells[index] = value;
    }
    rows.push(cells);
  }

  return rows;
}

function serialToIso(serial: number): string {
  const d = new Date(Math.round((serial - 25569) * 86_400_000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function isXlsx(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Legacy BIFF .xls files start with an OLE2 compound-document signature. */
export function isLegacyXls(bytes: Uint8Array): boolean {
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return sig.every((b, i) => bytes[i] === b);
}
