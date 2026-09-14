import { z } from 'zod';
import { buildMessages, buildResponseSchema, type CategoryOption, type MerchantQuery } from './prompt';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

export interface MerchantVerdict {
  merchant: string;
  categorySlug: string;
  confidence: number;
}

const responseSchema = z.object({
  results: z.array(
    z.object({
      merchant: z.string(),
      category_slug: z.string(),
      confidence: z.number(),
    }),
  ),
});

export class OllamaError extends Error {}

const REQUEST_TIMEOUT_MS = 90_000;

async function chatOnce(
  config: OllamaConfig,
  categories: CategoryOption[],
  merchants: MerchantQuery[],
  signal?: AbortSignal,
): Promise<MerchantVerdict[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        stream: false,
        keep_alive: '10m',
        options: { temperature: 0, num_ctx: 4096 },
        format: buildResponseSchema(categories.map((c) => c.slug)),
        messages: buildMessages(categories, merchants),
      }),
    });

    if (!response.ok) {
      throw new OllamaError(
        response.status === 404
          ? `Model "${config.model}" is not installed. Run: ollama pull ${config.model}`
          : `Ollama returned HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as { message?: { content?: string } };
    const content = body.message?.content;
    if (!content) throw new OllamaError('Ollama returned an empty response');

    const parsed = responseSchema.parse(JSON.parse(content));
    const allowed = new Set(categories.map((c) => c.slug));

    return parsed.results
      .filter((r) => allowed.has(r.category_slug))
      .map((r) => ({
        merchant: r.merchant,
        categorySlug: r.category_slug,
        confidence: Math.min(1, Math.max(0, r.confidence)),
      }));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Timeout ladder: a failed batch is split in half and retried, down to single
 * merchants. Anything that still fails is simply left uncategorised.
 */
export async function classifyBatch(
  config: OllamaConfig,
  categories: CategoryOption[],
  merchants: MerchantQuery[],
  signal?: AbortSignal,
): Promise<MerchantVerdict[]> {
  if (merchants.length === 0) return [];

  try {
    const verdicts = await chatOnce(config, categories, merchants, signal);
    // A short reply means the model dropped entries; retry the missing ones individually.
    if (merchants.length > 1 && verdicts.length < merchants.length) {
      const answered = new Set(verdicts.map((v) => v.merchant));
      const missing = merchants.filter((m) => !answered.has(m.merchant));
      if (missing.length < merchants.length) {
        return [...verdicts, ...(await classifyBatch(config, categories, missing, signal))];
      }
    }
    return verdicts;
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof OllamaError && err.message.includes('not installed')) throw err;
    if (merchants.length === 1) return [];

    const mid = Math.ceil(merchants.length / 2);
    const [left, right] = [merchants.slice(0, mid), merchants.slice(mid)];
    return [
      ...(await classifyBatch(config, categories, left, signal)),
      ...(await classifyBatch(config, categories, right, signal)),
    ];
  }
}

export interface ClassifyProgress {
  done: number;
  total: number;
}

const BATCH_SIZE = 12;
const CONCURRENCY = 2;

export async function classifyMerchants(
  config: OllamaConfig,
  categories: CategoryOption[],
  merchants: MerchantQuery[],
  onProgress?: (progress: ClassifyProgress) => void,
  signal?: AbortSignal,
): Promise<MerchantVerdict[]> {
  const batches: MerchantQuery[][] = [];
  for (let i = 0; i < merchants.length; i += BATCH_SIZE) {
    batches.push(merchants.slice(i, i + BATCH_SIZE));
  }

  const verdicts: MerchantVerdict[] = [];
  let done = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < batches.length) {
      if (signal?.aborted) return;
      const batch = batches[cursor++];
      const result = await classifyBatch(config, categories, batch, signal);
      verdicts.push(...result);
      done += batch.length;
      onProgress?.({ done, total: merchants.length });
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  return verdicts;
}
