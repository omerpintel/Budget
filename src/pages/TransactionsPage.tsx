import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Lock, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui/Feedback';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { MerchantText } from '@/components/MerchantText';
import { ManualEntryForm, type ManualDraft } from '@/features/transactions/ManualEntryForm';
import { listTransactions, createManualTransaction, deleteTransaction } from '@/data/transactions';
import { listCategories } from '@/data/categories';
import { listPeople } from '@/data/people';
import { listWallets } from '@/data/wallets';
import { findPeriod, periodForDebitDate, ensurePeriod } from '@/data/periods';
import { ensureManualAccount } from '@/data/accounts';
import { applyCorrection, categorizePending } from '@/services/categorize/apply';
import { categorizeWithAi, countUnresolved } from '@/services/ollama/categorize';
import type { ClassifyProgress } from '@/services/ollama/client';
import { formatAgorot, parseMoneyInput, periodLabel } from '@/lib/money';
import { usePeriod } from '@/state/period';
import { cn } from '@/lib/utils';
import type { WalletScope } from '@/data/types';

export function TransactionsPage() {
  const qc = useQueryClient();
  const { ref } = usePeriod();
  const [allMonths, setAllMonths] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [aiProgress, setAiProgress] = useState<ClassifyProgress | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: period } = useQuery({
    queryKey: ['period', ref.year, ref.month],
    queryFn: () => findPeriod(ref),
  });

  // Empty string means every period; a missing month would otherwise show the whole ledger.
  const periodId = allMonths ? '' : (period?.id ?? '__none__');

  const { data } = useQuery({
    queryKey: ['ledger', periodId, reveal],
    queryFn: async () => {
      const [rows, categories, people, unresolved, wallets] = await Promise.all([
        listTransactions({ periodId: periodId || null, reveal }),
        listCategories(),
        listPeople(),
        countUnresolved({ periodId: periodId || null }),
        listWallets(),
      ]);
      return { rows, categories, people, unresolved, wallets };
    },
  });

  const savingsWalletId = data?.wallets.find((w) => w.kind === 'savings')?.id ?? null;

  const correct = useMutation({
    mutationFn: applyCorrection,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ledger'] }),
  });
  const remove = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ledger'] }),
  });

  const recategorize = useMutation({
    mutationFn: () => categorizePending({ periodId: periodId || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ledger'] }),
  });

  const askAi = useMutation({
    mutationFn: async () => {
      setAiError(null);
      abortRef.current = new AbortController();
      setAiProgress({ done: 0, total: 0 });
      try {
        return await categorizeWithAi(
          { periodId: periodId || null },
          setAiProgress,
          abortRef.current.signal,
        );
      } finally {
        setAiProgress(null);
        abortRef.current = null;
      }
    },
    onError: (err: unknown) => setAiError(err instanceof Error ? err.message : String(err)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ledger'] }),
  });

  const addManual = useMutation({
    mutationFn: async (draft: ManualDraft) => {
      const accountId = await ensureManualAccount();
      const period = await ensurePeriod(periodForDebitDate(draft.date));
      await createManualTransaction({
        accountId,
        periodId: period.id,
        date: draft.date,
        description: draft.description.trim(),
        amount: parseMoneyInput(draft.amountRaw) ?? 0,
        direction: draft.direction,
        categoryId: draft.categoryId || null,
        wallet: draft.wallet,
        personId: draft.wallet === 'personal' ? draft.personId : null,
        note: draft.note || null,
        fundingWalletId: draft.fundFromSavings ? savingsWalletId : null,
      });
    },
    onSuccess: () => {
      setAdding(false);
      qc.invalidateQueries();
    },
  });

  if (!data) return null;
  const { rows, categories, people, unresolved } = data;
  const personOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? '';

  return (
    <>
      <PageHeader
        title="תנועות"
        description="כל תנועה בחשבון הבנק, מקובצת לפי החודש שבו חויבה."
        action={
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setReveal((r) => !r)}>
              {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {reveal ? 'הסתר הוצאות אישיות' : 'הצג הוצאות אישיות'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => recategorize.mutate()}
              disabled={recategorize.isPending}
            >
              <RefreshCw className={cn('size-3.5', recategorize.isPending && 'animate-spin')} />
              הרץ כללים מחדש
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => askAi.mutate()}
              disabled={askAi.isPending || unresolved === 0}
            >
              <Sparkles className="size-3.5" />
              {unresolved === 0 ? 'אין מה לשאול' : `שאל AI (${unresolved})`}
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> הוספה
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <div className="border-line bg-surface-2/50 inline-flex rounded-[var(--radius-pill)] border p-1">
          <button
            type="button"
            onClick={() => setAllMonths(false)}
            className={cn(
              'rounded-[var(--radius-pill)] px-3 py-1 text-xs font-medium transition-colors',
              allMonths ? 'text-fg-muted hover:text-fg' : 'bg-surface text-fg shadow-e1',
            )}
          >
            {periodLabel(ref.year, ref.month)}
          </button>
          <button
            type="button"
            onClick={() => setAllMonths(true)}
            className={cn(
              'rounded-[var(--radius-pill)] px-3 py-1 text-xs font-medium transition-colors',
              allMonths ? 'bg-surface text-fg shadow-e1' : 'text-fg-muted hover:text-fg',
            )}
          >
            כל החודשים
          </button>
        </div>
        {recategorize.data && (
          <span className="text-fg-subtle text-xs">
            הותאמו {recategorize.data.matched} מתוך {recategorize.data.scanned}; ל־{recategorize.data.unresolved}{' '}
            עדיין חסרה קטגוריה.
          </span>
        )}
        {askAi.isPending && (
          <span className="text-fg-subtle flex items-center gap-2 text-xs">
            <Sparkles className="text-brand size-3.5 animate-pulse" />
            {aiProgress && aiProgress.total > 0
              ? `שואל את המודל — ${aiProgress.done} מתוך ${aiProgress.total} בתי עסק`
              : 'מעיר את המודל…'}
            <button
              type="button"
              className="text-fg-muted hover:text-fg inline-flex items-center gap-1"
              onClick={() => abortRef.current?.abort()}
            >
              <X className="size-3" /> ביטול
            </button>
          </span>
        )}
        {!askAi.isPending && askAi.data && (
          <span className="text-fg-subtle text-xs">
            ה־ AI קרא {askAi.data.uniqueMerchants} בתי עסק ייחודיים ומילא{' '}
            {askAi.data.transactionsUpdated} תנועות
            {askAi.data.lowConfidence > 0 ? `; ${askAi.data.lowConfidence} בביטחון נמוך` : ''}.
          </span>
        )}
        {aiError && <span className="text-negative text-xs">{aiError}</span>}
      </div>

      {adding && (
        <div className="mb-4">
          <ManualEntryForm
            categories={categories}
            people={people}
            canFundFromSavings={savingsWalletId !== null}
            onCancel={() => setAdding(false)}
            onSubmit={async (draft) => {
              await addManual.mutateAsync(draft);
            }}
          />
        </div>
      )}

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="אין עדיין תנועות"
            description="ייבא דף חיוב, או הוסף רשומה ידנית לשכר דירה ולתנועות בנק אחרות."
          />
        ) : (
          <CardBody className="max-h-[calc(100vh-18rem)] overflow-auto p-0">
            <table className="w-full min-w-[36rem] text-xs">
              <thead className="bg-surface-2 text-fg-subtle border-line sticky top-0 z-10 border-b">
                <tr className="text-start">
                  <th className="w-24 px-3 py-2.5 font-medium">תאריך</th>
                  <th className="px-3 py-2.5 font-medium">בית עסק</th>
                  <th className="w-40 px-2 py-2.5 font-medium">קטגוריה</th>
                  <th className="w-24 px-2 py-2.5 font-medium">ארנק</th>
                  <th className="w-24 px-3 py-2.5 text-end font-medium">סכום</th>
                  <th className="w-9" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-line/60 hover:bg-surface-2/40 border-t">
                    <td className="tnum text-fg-muted px-3 py-2 whitespace-nowrap">
                      {row.transaction_date}
                    </td>
                    <td className="max-w-0 px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        {row.is_masked === 1 && !reveal && (
                          <Lock className="text-fg-subtle size-3 shrink-0" />
                        )}
                        <span className="truncate">
                          <MerchantText value={row.description} />
                        </span>
                      </div>
                      {row.installment_total ? (
                        <span className="text-fg-subtle text-[10px]">
                          תשלום {row.installment_current}/{row.installment_total}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        className="h-7 px-2 text-xs"
                        value={row.category_id ?? ''}
                        onChange={(e) =>
                          correct.mutate({
                            transactionId: row.id,
                            categoryId: e.target.value || null,
                            wallet: row.wallet,
                            personId: row.personal_person_id,
                            learn: true,
                          })
                        }
                      >
                        <option value="">ללא קטגוריה</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        className="h-7 px-2 text-xs"
                        value={row.wallet === 'personal' ? row.personal_person_id ?? '' : 'joint'}
                        onChange={(e) => {
                          const value = e.target.value;
                          const wallet: WalletScope = value === 'joint' ? 'joint' : 'personal';
                          correct.mutate({
                            transactionId: row.id,
                            categoryId: row.category_id,
                            wallet,
                            personId: wallet === 'personal' ? value : null,
                            learn: true,
                          });
                        }}
                      >
                        <option value="joint">משותף</option>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td
                      className={cn(
                        'tnum px-3 py-2 text-end whitespace-nowrap',
                        row.direction === 'in' && 'text-positive',
                      )}
                    >
                      {formatAgorot(row.direction === 'out' ? -row.amount : row.amount, {
                        precise: true,
                      })}
                    </td>
                    <td className="pe-3">
                      {row.entry_mode === 'manual' && (
                        <button
                          type="button"
                          aria-label={`מחיקת ${row.description}`}
                          className="text-fg-subtle hover:text-negative"
                          onClick={() => remove.mutate(row.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        )}
      </Card>

      {rows.some((r) => r.is_masked === 1) && !reveal && (
        <p className="text-fg-subtle mt-3 flex items-center gap-1.5 text-xs">
          <Lock className="size-3" />
          שמות בתי העסק האישיים מוסתרים. הסכומים עדיין נזקפים לארנק של{' '}
          {[...new Set(rows.filter((r) => r.is_masked === 1).map((r) => personOf(r.personal_person_id)))]
            .filter(Boolean)
            .join(' ו') || 'הבעלים'}
          .
        </p>
      )}
    </>
  );
}
