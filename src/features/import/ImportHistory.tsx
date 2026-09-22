import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { deleteImportBatch, listImportHistory } from '@/data/imports';
import { recomputeFrom } from '@/data/periodEngine';
import { periodLabel } from '@/lib/money';
import { cn } from '@/lib/utils';

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

export function ImportHistory({
  periodId,
  showPeriodColumn = false,
  compact = false,
}: {
  periodId?: string;
  showPeriodColumn?: boolean;
  /** Stacks the row instead of putting the action beside it, for narrow columns. */
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const { data: batches } = useQuery({
    queryKey: ['import-history', periodId ?? 'all'],
    queryFn: () => listImportHistory(periodId),
  });

  const remove = useMutation({
    mutationFn: async (batchId: string) => {
      const affected = await deleteImportBatch(batchId);
      if (affected) await recomputeFrom(affected);
    },
    onSuccess: async () => {
      setPending(null);
      await qc.invalidateQueries();
    },
  });

  if (!batches) return null;

  if (batches.length === 0) {
    return (
      <EmptyState
        icon={<FileUp className="size-7" strokeWidth={1.25} />}
        title="עדיין לא הועלו דפי חיוב"
        description="קבצים שהעלית מופיעים כאן, כדי שתוכל לבדוק מה נכנס — ולהסיר אם בחרת בקובץ הלא נכון."
      />
    );
  }

  return (
    <div className="divide-line divide-y">
      {batches.map((batch) => {
        const confirming = pending === batch.id;
        return (
          <div
            key={batch.id}
            className={cn(
              'gap-3 py-2.5 first:pt-0 last:pb-0',
              compact ? 'flex flex-col items-start' : 'flex items-center',
            )}
          >
            <div className="min-w-0 w-full flex-1">
              <div className="truncate text-xs font-medium">{batch.file_name}</div>
              <div className="text-fg-subtle mt-0.5 text-[11px]">
                {batch.account_name} · {batch.live_count} תנועות
                {batch.duplicates_skipped > 0 ? ` · דולגו ${batch.duplicates_skipped} כפילויות` : ''}
                {showPeriodColumn && batch.year && batch.month
                  ? ` · ${periodLabel(batch.year, batch.month)}`
                  : ''}
                {' · הועלה ב־'}
                {shortDate(batch.imported_at)}
              </div>
            </div>

            {confirming ? (
              <div
                className={cn(
                  'flex shrink-0 gap-1.5',
                  compact ? 'w-full flex-wrap items-center' : 'items-center',
                )}
              >
                <span className="text-fg-muted text-[11px]">
                  להסיר {batch.live_count} תנועות
                  {batch.reviewed_count > 0 ? `, ${batch.reviewed_count} כבר מוינו` : ''}?
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(batch.id)}
                >
                  {remove.isPending ? 'מסיר…' : 'הסרה'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                  ביטול
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0"
                onClick={() => setPending(batch.id)}
              >
                <Undo2 className="size-3.5" /> ביטול העלאה
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
