import { ChevronLeft, ChevronRight } from 'lucide-react';
import { periodLabel } from '@/lib/money';
import { usePeriod, shiftPeriod } from '@/state/period';

const ARROW =
  'flex size-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg';

export function PeriodSwitcher() {
  const { ref, isCurrent, shiftBy, goToCurrent } = usePeriod();
  const prev = shiftPeriod(ref, -1);
  const next = shiftPeriod(ref, 1);

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => shiftBy(-1)}
        aria-label={`מעבר ל${periodLabel(prev.year, prev.month)}`}
        className={ARROW}
      >
        <ChevronRight className="size-4" strokeWidth={2} />
      </button>

      <div className="flex min-w-[9.5rem] flex-col items-center leading-none">
        <span className="text-[13px] font-semibold tracking-tight">
          {periodLabel(ref.year, ref.month)}
        </span>
        {isCurrent ? (
          <span className="text-fg-subtle mt-1 text-[10px]">החודש הנוכחי</span>
        ) : (
          <button
            type="button"
            onClick={goToCurrent}
            className="text-brand mt-1 text-[10px] hover:underline"
          >
            חזרה לחודש הנוכחי
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => shiftBy(1)}
        aria-label={`מעבר ל${periodLabel(next.year, next.month)}`}
        className={ARROW}
      >
        <ChevronLeft className="size-4" strokeWidth={2} />
      </button>
    </div>
  );
}
