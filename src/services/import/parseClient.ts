import * as Comlink from 'comlink';
import type { ParseWorkerApi } from './parse.worker';
import type { ParseResult } from './parseFile';
import type { ColumnMap } from './issuers';

let worker: Worker | null = null;
let remote: Comlink.Remote<ParseWorkerApi> | null = null;

function client(): Comlink.Remote<ParseWorkerApi> {
  if (!remote) {
    worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    remote = Comlink.wrap<ParseWorkerApi>(worker);
  }
  return remote;
}

/** Parsing a 5k-row statement off the main thread keeps the import UI responsive. */
export async function parseInWorker(
  bytes: Uint8Array,
  issuer: string,
  overrideMap?: ColumnMap,
  overrideHeaderRow?: number,
): Promise<ParseResult> {
  return client().parse(bytes, issuer, overrideMap, overrideHeaderRow) as Promise<ParseResult>;
}

export function disposeParseWorker(): void {
  worker?.terminate();
  worker = null;
  remote = null;
}
