import { ChevronLeft, ChevronRight } from 'lucide-react';
import { periodLabel, periodKey } from '@/lib/money';
import { usePeriod, shiftPeriod } from '@/state/period';

const ARROW =
  'flex size-7 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg';

export function PeriodSwitcher() {
  const { ref, isCurrent, shiftBy, goToCurrent } = usePeriod();
  const prev = shiftPeriod(ref, -1);
  const next = shiftPeriod(ref, 1);

  return (
    <div className="border-line bg-surface-2/50 flex items-center gap-1 rounded-[var(--radius-pill)] border px-1 py-1">
      <button
        type="button"
        onClick={() => shiftBy(-1)}
        aria-label={`מעבר ל${periodLabel(prev.year, prev.month)}`}
        className={ARROW}
      >
        {/* RTL: earlier months sit to the right, so back points right. */}
        <ChevronRight className="size-4" strokeWidth={2} />
      </button>

      <div className="relative flex min-w-[9.5rem] flex-col items-center overflow-hidden leading-none">
        {/* Keyed remount replays the CSS fade. AnimatePresence/popLayout here kept
            layout projection running every frame and jittered the whole shell. */}
        <span
          key={periodKey(ref.year, ref.month)}
          className="anim-rise text-[13px] font-semibold tracking-tight"
        >
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
