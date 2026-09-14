import * as Comlink from 'comlink';
import { parseFile, type ParseResult } from './parseFile';
import type { ColumnMap } from './issuers';

const api = {
  parse(
    bytes: Uint8Array,
    issuer: string,
    overrideMap?: ColumnMap,
    overrideHeaderRow?: number,
  ): ParseResult {
    return parseFile(bytes, issuer, overrideMap, overrideHeaderRow);
  },
};

export type ParseWorkerApi = typeof api;

Comlink.expose(api);
