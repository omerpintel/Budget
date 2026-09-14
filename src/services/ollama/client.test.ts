import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyBatch, classifyMerchants, OllamaError } from './client';
import { buildResponseSchema, buildCategoryList } from './prompt';

const CATEGORIES = [
  { slug: 'groceries', name: 'Groceries' },
  { slug: 'restaurants', name: 'Restaurants' },
  { slug: 'uncategorized', name: 'Uncategorized' },
];

const CONFIG = { baseUrl: 'http://localhost:11434', model: 'test-model' };

function reply(results: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ message: { content: JSON.stringify({ results }) } }),
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('response schema', () => {
  it('constrains category_slug to an enum so invention is impossible', () => {
    const schema = buildResponseSchema(['groceries', 'fuel']);
    expect(schema.properties.results.items.properties.category_slug.enum).toEqual([
      'groceries',
      'fuel',
    ]);
  });

  it('lists categories one per line for the prompt', () => {
    expect(buildCategoryList(CATEGORIES)).toContain('- groceries: Groceries');
  });
});

describe('classifyBatch', () => {
  it('returns verdicts and clamps confidence into range', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reply([{ merchant: 'שופרסל', category_slug: 'groceries', confidence: 1.4 }]),
      ),
    );
    const out = await classifyBatch(CONFIG, CATEGORIES, [{ merchant: 'שופרסל', typicalAmount: 250 }]);
    expect(out).toEqual([{ merchant: 'שופרסל', categorySlug: 'groceries', confidence: 1 }]);
  });

  it('drops a hallucinated category that is not in the list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply([{ merchant: 'X', category_slug: 'crypto-mining', confidence: 0.9 }])),
    );
    expect(await classifyBatch(CONFIG, CATEGORIES, [{ merchant: 'X', typicalAmount: 10 }])).toEqual([]);
  });

  it('splits the batch when a request fails, so one bad row cannot lose the rest', async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error('timeout');
      return reply([{ merchant: 'A', category_slug: 'groceries', confidence: 0.8 }]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await classifyBatch(CONFIG, CATEGORIES, [
      { merchant: 'A', typicalAmount: 1 },
      { merchant: 'B', typicalAmount: 2 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(out).toHaveLength(2);
  });

  it('gives up on a single merchant rather than throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );
    expect(await classifyBatch(CONFIG, CATEGORIES, [{ merchant: 'A', typicalAmount: 1 }])).toEqual([]);
  });

  it('survives malformed JSON from the model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ message: { content: '{ this is not json' } }),
      })),
    );
    expect(await classifyBatch(CONFIG, CATEGORIES, [{ merchant: 'A', typicalAmount: 1 }])).toEqual([]);
  });

  it('surfaces a missing model instead of silently retrying', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(
      classifyBatch(CONFIG, CATEGORIES, [
        { merchant: 'A', typicalAmount: 1 },
        { merchant: 'B', typicalAmount: 2 },
      ]),
    ).rejects.toBeInstanceOf(OllamaError);
  });

  it('retries merchants the model omitted from its reply', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        return call === 1
          ? reply([{ merchant: 'A', category_slug: 'groceries', confidence: 0.9 }])
          : reply([{ merchant: 'B', category_slug: 'restaurants', confidence: 0.7 }]);
      }),
    );

    const out = await classifyBatch(CONFIG, CATEGORIES, [
      { merchant: 'A', typicalAmount: 1 },
      { merchant: 'B', typicalAmount: 2 },
    ]);
    expect(out.map((v) => v.merchant).sort()).toEqual(['A', 'B']);
  });
});

describe('classifyMerchants', () => {
  it('reports progress across batches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply([])),
    );
    const merchants = Array.from({ length: 25 }, (_, i) => ({
      merchant: `m${i}`,
      typicalAmount: 10,
    }));
    const seen: number[] = [];
    await classifyMerchants(CONFIG, CATEGORIES, merchants, (p) => seen.push(p.done));
    expect(seen.at(-1)).toBe(25);
  });

  it('stops early when aborted', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort();
      return reply([]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const merchants = Array.from({ length: 60 }, (_, i) => ({
      merchant: `m${i}`,
      typicalAmount: 10,
    }));
    await classifyMerchants(CONFIG, CATEGORIES, merchants, undefined, controller.signal);
    expect(fetchMock.mock.calls.length).toBeLessThan(5);
  });
});
