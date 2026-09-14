import { getDb } from '@/db';
import { nowIso } from '@/lib/utils';
import { getAllSettings, SETTING_KEYS } from '@/data/settings';
import { toMajor } from '@/lib/money';
import { classifyMerchants, OllamaError, type ClassifyProgress, type MerchantVerdict } from './client';
import { checkOllama } from './health';
import type { CategoryOption, MerchantQuery } from './prompt';

export interface AiCategorizeScope {
  periodId?: string | null;
  importBatchId?: string | null;
}

export interface AiCategorizeResult {
  uniqueMerchants: number;
  transactionsUpdated: number;
  lowConfidence: number;
  skipped: number;
}

interface UnresolvedRow {
  id: string;
  normalized_merchant: string | null;
  raw_description: string;
  amount: number;
}

/** Categories the model is allowed to choose from; internal bookkeeping ones are excluded. */
async function loadCategoryOptions(): Promise<Array<CategoryOption & { id: string }>> {
  return getDb().select<CategoryOption & { id: string }>(
    `SELECT id, slug, name FROM categories
     WHERE is_archived = 0 AND kind IN ('income', 'fixed', 'flexible', 'savings')
     ORDER BY kind, sort_order`,
  );
}

async function loadUnresolved(scope: AiCategorizeScope): Promise<UnresolvedRow[]> {
  const filters: string[] = [];
  const params: string[] = [];
  if (scope.periodId) {
    filters.push('AND period_id = ?');
    params.push(scope.periodId);
  }
  if (scope.importBatchId) {
    filters.push('AND import_batch_id = ?');
    params.push(scope.importBatchId);
  }

  return getDb().select<UnresolvedRow>(
    `SELECT id, normalized_merchant, raw_description, amount
     FROM transactions
     WHERE is_reviewed = 0
       AND categorization_source = 'default'
       AND is_excluded = 0
       ${filters.join(' ')}`,
    params,
  );
}

export async function countUnresolved(scope: AiCategorizeScope = {}): Promise<number> {
  return (await loadUnresolved(scope)).length;
}

/**
 * Sends one request per *unique merchant*, not per transaction. After the first
 * month almost everything resolves from history, so the model sees very little.
 */
export async function categorizeWithAi(
  scope: AiCategorizeScope = {},
  onProgress?: (progress: ClassifyProgress) => void,
  signal?: AbortSignal,
): Promise<AiCategorizeResult> {
  const settings = await getAllSettings();
  const config = {
    baseUrl: settings[SETTING_KEYS.ollamaUrl],
    model: settings[SETTING_KEYS.ollamaModel],
  };

  const rows = await loadUnresolved(scope);
  const categories = await loadCategoryOptions();
  const slugToId = new Map(categories.map((c) => [c.slug, c.id]));

  const groups = new Map<string, UnresolvedRow[]>();
  for (const row of rows) {
    const key = row.normalized_merchant || row.raw_description;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  if (groups.size === 0) {
    return { uniqueMerchants: 0, transactionsUpdated: 0, lowConfidence: 0, skipped: 0 };
  }

  const queries: MerchantQuery[] = [...groups.entries()].map(([merchant, items]) => ({
    merchant,
    typicalAmount: Math.round(toMajor(items.reduce((s, i) => s + i.amount, 0) / items.length)),
  }));

  const verdicts = await classifyMerchants(
    config,
    categories.map(({ slug, name }) => ({ slug, name })),
    queries,
    onProgress,
    signal,
  );

  // Every batch failing usually means the service is down, not that the model was unsure.
  if (verdicts.length === 0 && !signal?.aborted) {
    const status = await checkOllama(config.baseUrl);
    if (!status.reachable) {
      throw new OllamaError(
        `Could not reach Ollama at ${config.baseUrl}. Nothing was changed — everything stays uncategorised.`,
      );
    }
    if (!status.models.includes(config.model)) {
      throw new OllamaError(
        `Model "${config.model}" is not installed. Run: ollama pull ${config.model}`,
      );
    }
  }

  const threshold = Number(settings[SETTING_KEYS.autoAcceptThreshold]) || 0.9;
  const ts = nowIso();
  const statements: Array<{ sql: string; params: Array<string | number | null> }> = [];
  let transactionsUpdated = 0;
  let lowConfidence = 0;

  const byMerchant = new Map<string, MerchantVerdict>(verdicts.map((v) => [v.merchant, v]));

  for (const [merchant, items] of groups) {
    const verdict = byMerchant.get(merchant);
    const categoryId = verdict ? slugToId.get(verdict.categorySlug) : undefined;
    if (!verdict || !categoryId || verdict.categorySlug === 'uncategorized') continue;
    if (verdict.confidence < threshold) lowConfidence += items.length;

    for (const item of items) {
      transactionsUpdated += 1;
      statements.push({
        sql: `UPDATE transactions
              SET category_id = ?, categorization_source = 'llm', llm_confidence = ?, updated_at = ?
              WHERE id = ?`,
        params: [categoryId, verdict.confidence, ts, item.id],
      });
    }
  }

  if (statements.length > 0) await getDb().batch(statements);

  return {
    uniqueMerchants: groups.size,
    transactionsUpdated,
    lowConfidence,
    skipped: rows.length - transactionsUpdated,
  };
}
