/** Bidi control characters that Israeli exports sprinkle through headers and values. */
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/g;

export interface DecodedFile {
  text: string;
  encoding: string;
}

function hasBom(bytes: Uint8Array, ...bom: number[]): boolean {
  return bom.every((b, i) => bytes[i] === b);
}

/**
 * Israeli bank and card exports are usually windows-1255, occasionally UTF-8 with a BOM.
 * Guessing wrong turns every Hebrew merchant name into mojibake, so validate strictly.
 */
export function decodeBytes(bytes: Uint8Array): DecodedFile {
  if (hasBom(bytes, 0xef, 0xbb, 0xbf)) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  }
  if (hasBom(bytes, 0xff, 0xfe)) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (hasBom(bytes, 0xfe, 0xff)) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text, encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1255').decode(bytes), encoding: 'windows-1255' };
  }
}

export function stripBidi(value: string): string {
  return value.replace(BIDI, '');
}

/** Collapses an export header into a stable key for alias lookup. */
export function normalizeHeader(value: string): string {
  return stripBidi(value)
    .replace(/["'״׳`]/g, '')
    .replace(/[()\[\]{}.,:;*]/g, ' ')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
