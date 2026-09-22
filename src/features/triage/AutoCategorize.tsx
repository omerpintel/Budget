import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles, TriangleAlert } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { getSetting, SETTING_KEYS } from '@/data/settings';
import { checkOllama } from '@/services/ollama/health';
import { categorizeWithAi, countUnresolved } from '@/services/ollama/categorize';
import type { ClassifyProgress } from '@/services/ollama/client';

type State =
  | { name: 'idle' }
  | { name: 'running'; progress: ClassifyProgress }
  | { name: 'done'; updated: number; merchants: number }
  | { name: 'offline'; reason: string }
  | { name: 'no-model'; model: string; installed: string[] }
  | { name: 'error'; message: string };

/**
 * Runs the model over everything the deterministic rules could not place, so the
 * triage queue starts pre-filled instead of empty. Fires once per period; the
 * user only confirms.
 */
export function AutoCategorize({ periodId }: { periodId: string }) {
  const qc = useQueryClient();
  const [state, setState] = useState<State>({ name: 'idle' });
  const attempted = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function run() {
    const unresolved = await countUnresolved({ periodId });
    if (unresolved === 0) {
      setState({ name: 'idle' });
      return;
    }

    // Checked up front so an unreachable service reads as a note, not a failure.
    const baseUrl = await getSetting(SETTING_KEYS.ollamaUrl);
    const model = await getSetting(SETTING_KEYS.ollamaModel);
    const health = await checkOllama(baseUrl);
    if (!health.reachable) {
      setState({ name: 'offline', reason: health.error ?? 'לא ניתן להתחבר' });
      return;
    }
    if (!health.models.includes(model)) {
      setState({ name: 'no-model', model, installed: health.models });
      return;
    }

    abort.current = new AbortController();
    setState({ name: 'running', progress: { done: 0, total: 0 } });
    try {
      const result = await categorizeWithAi(
        { periodId },
        (progress) => setState({ name: 'running', progress }),
        abort.current.signal,
      );
      setState({
        name: 'done',
        updated: result.transactionsUpdated,
        merchants: result.uniqueMerchants,
      });
      await qc.invalidateQueries();
    } catch (err) {
      setState({ name: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      abort.current = null;
    }
  }

  useEffect(() => {
    if (attempted.current === periodId) return;
    attempted.current = periodId;
    void run();
    return () => abort.current?.abort();
  }, [periodId]);

  function retry() {
    setState({ name: 'idle' });
    void run();
  }

  if (state.name === 'idle') return null;

  if (state.name === 'running') {
    const { done, total } = state.progress;
    const pct = total > 0 ? (done / total) * 100 : 0;
    return (
      <Card className="mb-4">
        <CardBody className="space-y-2 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2">
              <Sparkles className="text-brand size-3.5 animate-pulse" />
              Ollama מסווג את התנועות
              {total > 0 ? ` · ${done} מתוך ${total} בתי עסק` : '…'}
            </span>
            <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
              עצירה
            </Button>
          </div>
          <div className="bg-surface-2 h-1 overflow-hidden rounded-full">
            <div className="bg-brand h-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </CardBody>
      </Card>
    );
  }

  if (state.name === 'done') {
    if (state.updated === 0) return null;
    return (
      <Card className="mb-4">
        <CardBody className="flex items-center gap-2 py-3 text-xs">
          <Sparkles className="text-positive size-3.5" />
          Ollama סיווג {state.updated} תנועות מתוך {state.merchants} בתי עסק. עבור ואשר למטה.
        </CardBody>
      </Card>
    );
  }

  if (state.name === 'no-model') {
    return (
      <Card className="border-warning/40 mb-4">
        <CardBody className="flex items-start gap-2.5 py-3">
          <TriangleAlert className="text-warning mt-px size-4 shrink-0" />
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-medium">המודל {state.model} אינו מותקן</div>
            <p className="text-fg-muted mt-0.5 break-words">
              {state.installed.length > 0
                ? `בחר בהגדרות אחד מהמודלים המותקנים (${state.installed.join(', ')}), או הרץ ollama pull ${state.model}.`
                : `אין עדיין מודלים מותקנים. הרץ ollama pull ${state.model}.`}
            </p>
          </div>
          <Button size="sm" variant="secondary" className="shrink-0" onClick={retry}>
            נסה שוב
          </Button>
        </CardBody>
      </Card>
    );
  }

  const offline = state.name === 'offline';
  return (
    <Card className="border-warning/40 mb-4">
      <CardBody className="flex items-start gap-2.5 py-3">
        <TriangleAlert className="text-warning mt-px size-4 shrink-0" />
        <div className="min-w-0 flex-1 text-xs">
          <div className="font-medium">
            {offline ? 'Ollama לא זמין — הסיווג האוטומטי דולג' : 'הסיווג האוטומטי נכשל'}
          </div>
          <p className="text-fg-muted mt-0.5 break-words">
            {offline ? state.reason : state.message} שום דבר לא השתנה. אפשר למיין ידנית למטה, או
            להפעיל את Ollama ולנסות שוב.
          </p>
        </div>
        <Button size="sm" variant="secondary" className="shrink-0" onClick={retry}>
          נסה שוב
        </Button>
      </CardBody>
    </Card>
  );
}
