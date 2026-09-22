import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Keyboard,
  Lock,
  PiggyBank,
  Sparkles,
  User,
} from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/ui/Feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { MerchantText } from '@/components/MerchantText';
import { Kbd, KeyboardHelp } from './KeyboardHelp';
import {
  acceptAutoApplied,
  commitDecision,
  getQuickCategories,
  loadTriage,
  type TriageDecision,
  type TriageRow,
} from '@/data/triage';
import { listCategories } from '@/data/categories';
import { listPeriods } from '@/data/periods';
import { getWalletByKind } from '@/data/wallets';
import { getSetting, SETTING_KEYS } from '@/data/settings';
import { formatAgorot, periodLabel } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { WalletScope } from '@/data/types';

interface Draft {
  categoryId: string | null;
  wallet: WalletScope;
  fundFromSavings: boolean;
  excluded: boolean;
  applyToMerchant: boolean;
}

const draftFor = (row: TriageRow): Draft => ({
  categoryId: row.category_id,
  wallet: row.wallet,
  fundFromSavings: row.funding_wallet_id !== null,
  excluded: row.is_excluded === 1,
  applyToMerchant: row.siblings > 0,
});

export function TriagePage({
  embedded = false,
  fixedPeriodId,
}: { embedded?: boolean; fixedPeriodId?: string } = {}) {
  const qc = useQueryClient();
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const periodId = fixedPeriodId ?? selectedPeriod;
  const setPeriodId = setSelectedPeriod;
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const busy = useRef(false);

  const { data } = useQuery({
    queryKey: ['triage', periodId],
    queryFn: async () => {
      const threshold = Number(await getSetting(SETTING_KEYS.autoAcceptThreshold)) || 0.9;
      const [split, categories, periods, savings] = await Promise.all([
        loadTriage(periodId || null, threshold),
        listCategories(),
        listPeriods(),
        getWalletByKind('savings'),
      ]);
      return { ...split, categories, periods, savings, threshold };
    },
  });

  // Frozen for the whole session: re-ranking these mid-sweep would move the number keys
  // out from under the user's fingers.
  const { data: quick = [] } = useQuery({
    queryKey: ['quick-categories'],
    queryFn: () => getQuickCategories(9),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const current: TriageRow | undefined = data?.queue[index];

  useEffect(() => {
    setDraft(current ? draftFor(current) : null);
  }, [current?.id]);

  useEffect(() => {
    setIndex(0);
  }, [periodId]);

  const categories = data?.categories ?? [];
  const savingsWalletId = data?.savings?.id ?? null;

  const commit = useMemo(
    () => async (row: TriageRow, next: Draft) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const decision: TriageDecision = {
          categoryId: next.categoryId,
          wallet: next.wallet,
          personId: next.wallet === 'personal' ? row.account_owner_id : null,
          fundingWalletId: next.fundFromSavings ? savingsWalletId : null,
          excluded: next.excluded,
        };
        const affected = await commitDecision(row, decision, next.applyToMerchant);
        setLastAction(
          affected > 1 ? `הוחל על ${affected} תנועות מבית העסק הזה` : 'נשמר',
        );
        await qc.invalidateQueries({ queryKey: ['triage'] });
        setIndex(0);
      } finally {
        busy.current = false;
      }
    },
    [qc, savingsWalletId],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!current || !draft) return;

      const key = event.key;
      if (key === '?') {
        setShowHelp((v) => !v);
        return;
      }
      if (/^[1-9]$/.test(key)) {
        const picked = quick[Number(key) - 1];
        if (picked) {
          event.preventDefault();
          setDraft({ ...draft, categoryId: picked.id, excluded: false });
        }
        return;
      }
      switch (key.toLowerCase()) {
        case 'p':
          event.preventDefault();
          if (current.account_owner_id) {
            setDraft({ ...draft, wallet: draft.wallet === 'personal' ? 'joint' : 'personal' });
          }
          break;
        case 'a':
          event.preventDefault();
          setDraft({ ...draft, applyToMerchant: !draft.applyToMerchant });
          break;
        case 's':
          event.preventDefault();
          if (savingsWalletId) setDraft({ ...draft, fundFromSavings: !draft.fundFromSavings });
          break;
        case 'x':
          event.preventDefault();
          setDraft({ ...draft, excluded: !draft.excluded });
          break;
        case 'enter':
          event.preventDefault();
          void commit(current, draft);
          break;
        case 'arrowright':
          event.preventDefault();
          setIndex((i) => Math.min(i + 1, (data?.queue.length ?? 1) - 1));
          break;
        case 'arrowleft':
          event.preventDefault();
          setIndex((i) => Math.max(i - 1, 0));
          break;
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, draft, quick, savingsWalletId, commit, data?.queue.length]);

  if (!data) return null;
  const { queue, auto, periods } = data;
  const total = queue.length + auto.length;

  return (
    <>
      {!embedded && (
        <PageHeader
          title="מיון"
          description="אשר את מה שהאפליקציה זיהתה, וסמן מה אישי. כל מה שתאשר נשמר לפעם הבאה."
          action={
            <div className="flex shrink-0 items-center gap-2">
              <Select className="h-8 w-40 text-xs" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                <option value="">כל החודשים</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {periodLabel(p.year, p.month)}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="ghost" onClick={() => setShowHelp((v) => !v)}>
                <Keyboard className="size-3.5" /> קיצורי מקלדת
              </Button>
            </div>
          }
        />
      )}

      {total === 0 ? (
        <Card>
          <EmptyState
            icon={<Check className="size-8" strokeWidth={1.25} />}
            title="לא נשאר מה לבדוק"
            description="כל התנועות בחודש הזה אושרו. ייבא דף חיוב כדי להוסיף עוד."
          />
        </Card>
      ) : (
        <>
          <div className="mb-4">
            <div className="text-fg-muted mb-1.5 flex items-center justify-between text-xs">
              <span>
                {queue.length} לבדיקה
                {auto.length > 0 ? ` · ${auto.length} הוחלו אוטומטית` : ''}
              </span>
              {lastAction && <span className="text-positive">{lastAction}</span>}
            </div>
            <div className="bg-surface-2 h-1 overflow-hidden rounded-full">
              <div
                className="bg-brand h-full transition-all"
                style={{ width: `${total === 0 ? 0 : (auto.length / total) * 100}%` }}
              />
            </div>
          </div>

          {current && draft ? (
            <TriageCard
              row={current}
              draft={draft}
              quick={quick}
              categories={categories}
              canFundFromSavings={savingsWalletId !== null}
              position={{ index, total: queue.length }}
              onDraft={setDraft}
              onCommit={() => void commit(current, draft)}
              onMove={(delta) =>
                setIndex((i) => Math.min(Math.max(i + delta, 0), queue.length - 1))
              }
            />
          ) : (
            <Card>
              <EmptyState
                icon={<Check className="size-8" strokeWidth={1.25} />}
                title="התור ריק"
                description="נשארו רק תנועות שהוחלו אוטומטית. עבור עליהן למטה ואשר."
              />
            </Card>
          )}

          <KeyboardHelp open={showHelp} />

          {auto.length > 0 && (
            <Card className="mt-4">
              <CardHeader
                title={`${auto.length} הוחלו אוטומטית`}
                description="נקבעו לפי ההיסטוריה שלך, כלל, או תשובה בטוחה של המודל. עבור ואשר."
                action={
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setShowAuto((v) => !v)}>
                      {showAuto ? 'הסתרה' : 'בדיקה'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={async () => {
                        await acceptAutoApplied(auto);
                        setLastAction(`אושרו ${auto.length}`);
                        await qc.invalidateQueries({ queryKey: ['triage'] });
                      }}
                    >
                      אישור הכל
                    </Button>
                  </div>
                }
              />
              {showAuto && (
                <CardBody className="overflow-x-auto p-0">
                  <table className="w-full min-w-[38rem] text-xs">
                    <tbody>
                      {auto.map((row) => (
                        <tr key={row.id} className="border-line/60 border-t">
                          <td className="text-fg-muted w-24 px-4 py-2">{row.transaction_date}</td>
                          <td className="px-4 py-2">
                            <MerchantText value={row.raw_description} />
                          </td>
                          <td className="w-40 px-4 py-2">{row.category_name}</td>
                          <td className="w-28 px-4 py-2">
                            <SourceBadge row={row} />
                          </td>
                          <td className="tnum w-24 px-4 py-2 text-end">
                            {formatAgorot(row.direction === 'out' ? -row.amount : row.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardBody>
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}

function SourceBadge({ row }: { row: TriageRow }) {
  if (row.categorization_source === 'llm') {
    return (
      <span className="text-fg-subtle inline-flex items-center gap-1">
        <Sparkles className="size-3" />
        {Math.round((row.llm_confidence ?? 0) * 100)}%
      </span>
    );
  }
  return <span className="text-fg-subtle">{row.categorization_source === 'rule' ? 'כלל' : 'נלמד'}</span>;
}

function TriageCard({
  row,
  draft,
  quick,
  categories,
  canFundFromSavings,
  position,
  onDraft,
  onCommit,
  onMove,
}: {
  row: TriageRow;
  draft: Draft;
  quick: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  canFundFromSavings: boolean;
  position: { index: number; total: number };
  onDraft: (draft: Draft) => void;
  onCommit: () => void;
  onMove: (delta: number) => void;
}) {
  const owner = row.account_owner_name ?? 'בעל הכרטיס';
  return (
    <Card>
      <CardBody className="p-6">
        <div className="text-fg-subtle mb-4 flex items-center justify-between text-xs">
          <span>
            {row.transaction_date} · {row.account_name}
            {row.installment_total
              ? ` · תשלום ${row.installment_current}/${row.installment_total}`
              : ''}
          </span>
          <span>
            {position.index + 1} מתוך {position.total}
          </span>
        </div>

        <div className="flex items-start justify-between gap-6">
          <h2 className="text-xl leading-snug font-semibold tracking-tight">
            <MerchantText value={row.raw_description} />
          </h2>
          <div
            className={cn(
              'tnum shrink-0 text-xl font-semibold',
              row.direction === 'in' && 'text-positive',
            )}
          >
            {formatAgorot(row.direction === 'out' ? -row.amount : row.amount, { precise: true })}
          </div>
        </div>

        {row.categorization_source === 'llm' && (
          <p className="text-fg-subtle mt-2 flex items-center gap-1.5 text-xs">
            <Sparkles className="size-3" />
            המודל הציע {row.category_name} ברמת ביטחון של{' '}
            {Math.round((row.llm_confidence ?? 0) * 100)}%
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-1.5">
          {quick.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onDraft({ ...draft, categoryId: c.id, excluded: false })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                draft.categoryId === c.id
                  ? 'border-brand bg-brand/10 text-fg'
                  : 'border-line hover:border-fg-subtle hover:bg-surface-2 text-fg-muted',
              )}
            >
              <Kbd>{i + 1}</Kbd>
              {c.name}
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-fg-muted block text-xs">
            קטגוריה אחרת
            <Select
              className="mt-1.5"
              value={draft.categoryId ?? ''}
              onChange={(e) => onDraft({ ...draft, categoryId: e.target.value || null })}
            >
              <option value="">— ללא —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Toggle
            active={draft.wallet === 'personal'}
            disabled={!row.account_owner_id}
            shortcut="P"
            icon={draft.wallet === 'personal' ? <Lock className="size-3.5" /> : <User className="size-3.5" />}
            onClick={() =>
              onDraft({ ...draft, wallet: draft.wallet === 'personal' ? 'joint' : 'personal' })
            }
          >
            {draft.wallet === 'personal' ? `אישי של ${owner}` : 'משותף'}
          </Toggle>

          {row.siblings > 0 && (
            <Toggle
              active={draft.applyToMerchant}
              shortcut="A"
              onClick={() => onDraft({ ...draft, applyToMerchant: !draft.applyToMerchant })}
            >
              החל על {row.siblings + 1} תנועות מבית העסק הזה
            </Toggle>
          )}

          <Toggle
            active={draft.fundFromSavings}
            disabled={!canFundFromSavings}
            shortcut="S"
            icon={<PiggyBank className="size-3.5" />}
            onClick={() => onDraft({ ...draft, fundFromSavings: !draft.fundFromSavings })}
          >
            מימון מהחיסכון
          </Toggle>

          <Toggle
            active={draft.excluded}
            shortcut="X"
            icon={<CircleSlash className="size-3.5" />}
            onClick={() => onDraft({ ...draft, excluded: !draft.excluded })}
          >
            החרגה
          </Toggle>
        </div>

        {draft.wallet === 'personal' && (
          <p className="text-fg-subtle mt-3 flex items-center gap-1.5 text-xs">
            <Lock className="size-3" />
            שם בית העסק יוסתר בכל מקום; רק {owner} יראה אותו. הסכום עדיין יורד מהארנק של {owner}.
          </p>
        )}

        <div className="border-line mt-6 flex items-center justify-between border-t pt-4">
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => onMove(-1)} disabled={position.index === 0}>
              <ChevronLeft className="dir-icon size-4" /> חזרה
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onMove(1)}
              disabled={position.index >= position.total - 1}
            >
              דילוג <ChevronRight className="dir-icon size-4" />
            </Button>
          </div>
          <Button size="sm" onClick={onCommit}>
            <Check className="size-4" /> אישור
            <Kbd className="border-brand-fg/30 bg-brand-fg/10 text-brand-fg ms-1">↵</Kbd>
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function Toggle({
  active,
  disabled,
  shortcut,
  icon,
  children,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  shortcut: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
        active
          ? 'border-brand bg-brand/10 text-fg'
          : 'border-line text-fg-muted hover:border-fg-subtle hover:bg-surface-2',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      <Kbd>{shortcut}</Kbd>
      {icon}
      {children}
    </button>
  );
}
