import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileWarning, Info } from 'lucide-react';
import { PageHeader } from '@/components/ui/Feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Field';
import { MerchantText } from '@/components/MerchantText';
import { DropZone } from './DropZone';
import { MappingWizard } from './MappingWizard';
import { listAccounts } from '@/data/accounts';
import { listPeople } from '@/data/people';
import {
  commitImport,
  getUncategorizedCategoryId,
  isFileAlreadyImported,
  stageRows,
  type StagedRow,
} from '@/data/imports';
import { debitDateFor, ensurePeriod, periodForDebitDate } from '@/data/periods';
import { categorizePending } from '@/services/categorize/apply';
import { parseInWorker } from '@/services/import/parseClient';
import { hashFile } from '@/services/import/dedupe';
import { isMappingUsable, type ColumnField, type ColumnMap } from '@/services/import/issuers';
import type { ParseResult } from '@/services/import/parseFile';
import { formatAgorot, periodLabel } from '@/lib/money';
import { ISSUERS } from '@/data/types';

type Stage =
  | { name: 'idle' }
  | { name: 'parsing' }
  | { name: 'mapping'; result: ParseResult }
  | { name: 'review'; result: ParseResult; staged: StagedRow[] }
  | { name: 'done'; inserted: number; duplicates: number; period: string }
  | { name: 'error'; message: string };

function defaultPeriod(debitDay: number): { year: number; month: number } {
  const now = new Date();
  // Before the card debits, the statement in hand still belongs to the previous month.
  const shift = now.getDate() < debitDay ? -1 : 0;
  const d = new Date(now.getFullYear(), now.getMonth() + shift, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function ImportPage({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState<string>('');
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const [fileInfo, setFileInfo] = useState<{ name: string; hash: string; bytes: Uint8Array } | null>(null);
  const [alreadyImported, setAlreadyImported] = useState(false);
  const [backfill, setBackfill] = useState(false);
  const [periodRef, setPeriodRef] = useState(() => defaultPeriod(2));
  const [periodTouched, setPeriodTouched] = useState(false);
  const [mapDraft, setMapDraft] = useState<{ map: ColumnMap; headerRow: number }>({ map: {}, headerRow: 0 });

  const { data } = useQuery({
    queryKey: ['import-accounts'],
    queryFn: async () => {
      const [accounts, people] = await Promise.all([listAccounts(), listPeople()]);
      return { accounts, people };
    },
  });

  const accounts = (data?.accounts ?? []).filter((a) => a.type === 'credit_card');
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const ownerName = data?.people.find((p) => p.id === account?.owner_person_id)?.name ?? '—';

  const periodChoices = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 18 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
  }, []);

  async function handleFile(file: File) {
    if (!account) return;
    setStage({ name: 'parsing' });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await hashFile(bytes);
      setFileInfo({ name: file.name, hash, bytes });
      setAlreadyImported(await isFileAlreadyImported(hash));
      // Never override a period the user picked on purpose.
      if (!periodTouched) setPeriodRef(defaultPeriod(account.debit_day ?? 2));

      const result = await parseInWorker(bytes, account.issuer);
      if (!result.mappingComplete) {
        setMapDraft({ map: result.columnMap, headerRow: Math.max(result.headerRowIndex, 0) });
        setStage({ name: 'mapping', result });
        return;
      }
      setStage({ name: 'review', result, staged: await stageRows(account.id, result.rows) });
    } catch (err) {
      setStage({ name: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function applyMapping() {
    if (!account || !fileInfo) return;
    setStage({ name: 'parsing' });
    try {
      const result = await parseInWorker(fileInfo.bytes, account.issuer, mapDraft.map, mapDraft.headerRow);
      if (!result.mappingComplete) {
        setStage({ name: 'mapping', result });
        return;
      }
      setStage({ name: 'review', result, staged: await stageRows(account.id, result.rows) });
    } catch (err) {
      setStage({ name: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function commit() {
    if (stage.name !== 'review' || !account || !fileInfo) return;
    try {
      const debitDate = debitDateFor(periodRef, account.debit_day ?? 2);
      const period = backfill ? null : await ensurePeriod(periodForDebitDate(debitDate));
      const defaultCategoryId = await getUncategorizedCategoryId();
      const result = await commitImport({
        accountId: account.id,
        periodId: period?.id ?? null,
        debitDate,
        fileName: fileInfo.name,
        fileHash: fileInfo.hash,
        rows: stage.staged,
        defaultCategoryId,
      });
      qc.invalidateQueries();
      await categorizePending({ importBatchId: result.batchId });
      setStage({
        name: 'done',
        inserted: result.inserted,
        duplicates: result.duplicatesSkipped,
        period: backfill ? 'historical backfill' : periodLabel(periodRef.year, periodRef.month),
      });
    } catch (err) {
      setStage({ name: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  function reset() {
    setStage({ name: 'idle' });
    setFileInfo(null);
    setAlreadyImported(false);
  }

  if (!data) return null;

  if (accounts.length === 0) {
    return (
      <>
        {!embedded && <PageHeader title="Import" />}
        <Card>
          <CardBody className="text-fg-muted py-10 text-center text-sm">
            Add a card in Settings before importing.
          </CardBody>
        </Card>
      </>
    );
  }

  return (
    <>
      {!embedded && (
        <PageHeader
          title="Import statement"
          description="Charges land in the period their bill hits the bank, not the month you swiped."
          action={
            stage.name !== 'idle' ? (
              <Button variant="ghost" size="sm" onClick={reset}>
                <ArrowLeft className="size-3.5" /> Start over
              </Button>
            ) : undefined
          }
        />
      )}

      {embedded && stage.name !== 'idle' && (
        <div className="mb-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={reset}>
            <ArrowLeft className="size-3.5" /> Start over
          </Button>
        </div>
      )}

      <div className="space-y-4">
        <Card>
          <CardHeader title="Which card is this?" />
          <CardBody className="grid grid-cols-3 gap-4">
            <Field label="Card">
              <Select
                value={account?.id ?? ''}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={stage.name !== 'idle'}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.display_name}
                    {a.last4 ? ` ·${a.last4}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Issuer format" hint={`Owner: ${ownerName}`}>
              <Select value={account?.issuer ?? 'other'} disabled>
                {ISSUERS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Bill debits in"
              hint={backfill ? 'Disabled during backfill' : `Debit day ${account?.debit_day ?? '—'}`}
            >
              <Select
                value={`${periodRef.year}-${periodRef.month}`}
                disabled={backfill}
                onChange={(e) => {
                  const [y, m] = e.target.value.split('-').map(Number);
                  setPeriodTouched(true);
                  setPeriodRef({ year: y, month: m });
                }}
              >
                {periodChoices.map((p) => (
                  <option key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>
                    {periodLabel(p.year, p.month)}
                  </option>
                ))}
              </Select>
            </Field>
          </CardBody>
        </Card>

        {stage.name === 'idle' && (
          <>
            <DropZone onFile={handleFile} />
            <label className="text-fg-muted flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={backfill}
                onChange={(e) => setBackfill(e.target.checked)}
                className="accent-brand"
              />
              Historical backfill — load old statements to train categorisation without touching any budget
              period
            </label>
          </>
        )}

        {stage.name === 'parsing' && (
          <Card>
            <CardBody className="text-fg-muted py-10 text-center text-sm">Reading statement…</CardBody>
          </Card>
        )}

        {stage.name === 'error' && (
          <Card>
            <CardBody className="flex items-start gap-2.5 py-6">
              <FileWarning className="text-negative mt-px size-4 shrink-0" />
              <p className="text-xs leading-relaxed">{stage.message}</p>
            </CardBody>
          </Card>
        )}

        {stage.name === 'mapping' && (
          <Card>
            <CardHeader
              title="Tell me how to read this file"
              description="The columns were not recognised automatically. Match them once and the choice is saved for this issuer."
              action={
                <Button size="sm" onClick={applyMapping} disabled={!isMappingUsable(mapDraft.map)}>
                  Apply mapping
                </Button>
              }
            />
            <CardBody>
              <MappingWizard
                preview={stage.result.preview}
                headerRowIndex={mapDraft.headerRow}
                columnMap={mapDraft.map}
                onHeaderRowChange={(headerRow) => setMapDraft((d) => ({ ...d, headerRow }))}
                onColumnChange={(field: ColumnField, index) =>
                  setMapDraft((d) => {
                    const map = { ...d.map };
                    if (index === undefined) delete map[field];
                    else map[field] = index;
                    return { ...d, map };
                  })
                }
              />
            </CardBody>
          </Card>
        )}

        {stage.name === 'review' && (
          <ReviewStage
            result={stage.result}
            staged={stage.staged}
            fileName={fileInfo?.name ?? ''}
            alreadyImported={alreadyImported}
            backfill={backfill}
            periodText={periodLabel(periodRef.year, periodRef.month)}
            debitDate={debitDateFor(periodRef, account?.debit_day ?? 2)}
            onCommit={commit}
          />
        )}

        {stage.name === 'done' && (
          <Card>
            <CardBody className="space-y-2 py-8 text-center">
              <CheckCircle2 className="text-positive mx-auto size-7" strokeWidth={1.5} />
              <p className="text-sm font-medium">
                Imported {stage.inserted} transaction{stage.inserted === 1 ? '' : 's'} into {stage.period}
              </p>
              {stage.duplicates > 0 && (
                <p className="text-fg-muted text-xs">
                  {stage.duplicates} duplicate{stage.duplicates === 1 ? '' : 's'} skipped
                </p>
              )}
              <div className="pt-2">
                <Button size="sm" variant="secondary" onClick={reset}>
                  Import another
                </Button>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}

function ReviewStage({
  result,
  staged,
  fileName,
  alreadyImported,
  backfill,
  periodText,
  debitDate,
  onCommit,
}: {
  result: ParseResult;
  staged: StagedRow[];
  fileName: string;
  alreadyImported: boolean;
  backfill: boolean;
  periodText: string;
  debitDate: string;
  onCommit: () => void;
}) {
  const fresh = staged.filter((r) => !r.isDuplicate);
  const duplicates = staged.length - fresh.length;
  const outflow = fresh.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amount, 0);
  const inflow = fresh.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amount, 0);

  return (
    <Card>
      <CardHeader
        title={`${fresh.length} new transaction${fresh.length === 1 ? '' : 's'}`}
        description={`${fileName} · ${result.fileKind.toUpperCase()} · ${result.encoding} · debits ${debitDate} · ${
          backfill ? 'historical backfill' : periodText
        }`}
        action={
          <Button size="sm" onClick={onCommit} disabled={fresh.length === 0}>
            Import {fresh.length}
          </Button>
        }
      />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Outflow" value={formatAgorot(-outflow)} />
          <Stat label="Inflow" value={formatAgorot(inflow)} />
          <Stat label="Duplicates skipped" value={String(duplicates)} />
          <Stat label="Rows ignored" value={String(result.skipped.length)} />
        </div>

        {alreadyImported && (
          <Notice icon={<AlertTriangle className="text-warning size-4" />}>
            This exact file was imported before. Any rows already stored are marked as duplicates and will
            not be added again.
          </Notice>
        )}

        {result.skipped.length > 0 && (
          <Notice icon={<Info className="text-fg-subtle size-4" />}>
            Ignored {result.skipped.length} row{result.skipped.length === 1 ? '' : 's'}:{' '}
            {[...new Set(result.skipped.map((s) => s.reason))].join(', ')}.
          </Notice>
        )}

        <div className="border-line max-h-96 overflow-y-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-surface-2 text-fg-subtle sticky top-0">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Merchant</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {staged.slice(0, 200).map((row) => (
                <tr
                  key={row.dedupeHash}
                  className={row.isDuplicate ? 'text-fg-subtle line-through' : 'border-line/60 border-t'}
                >
                  <td className="tnum px-3 py-2 whitespace-nowrap">{row.transactionDate}</td>
                  <td className="max-w-72 truncate px-3 py-2">
                    <MerchantText value={row.description} />
                  </td>
                  <td className="tnum px-3 py-2 text-right whitespace-nowrap">
                    {formatAgorot(row.direction === 'out' ? -row.amount : row.amount, { precise: true })}
                  </td>
                  <td className="text-fg-subtle px-3 py-2 whitespace-nowrap">
                    {row.installment
                      ? `Payment ${row.installment.current}/${row.installment.total}`
                      : row.originalCurrency
                        ? `${row.originalCurrency} original`
                        : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line bg-surface-2/40 rounded-lg border p-3">
      <div className="text-fg-subtle text-[11px]">{label}</div>
      <div className="tnum mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

function Notice({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-line bg-surface-2/40 flex items-start gap-2.5 rounded-lg border p-3">
      <span className="mt-px shrink-0">{icon}</span>
      <p className="text-xs leading-relaxed">{children}</p>
    </div>
  );
}
