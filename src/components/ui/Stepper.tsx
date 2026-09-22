import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Step {
  id: string;
  label: string;
}

export function Stepper({
  steps,
  current,
  maxReachable,
  onSelect,
}: {
  steps: Step[];
  current: number;
  /** Highest step the user is allowed to jump to; defaults to the current one. */
  maxReachable?: number;
  onSelect?: (index: number) => void;
}) {
  const limit = maxReachable ?? current;
  return (
    <ol className="flex items-center gap-1">
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const reachable = i <= limit;
        return (
          <li key={step.id} className="flex flex-1 items-center gap-1">
            <button
              type="button"
              disabled={!reachable || !onSelect}
              onClick={() => onSelect?.(i)}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-start transition-colors',
                reachable && onSelect ? 'hover:bg-surface-2 cursor-pointer' : 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-colors',
                  done && 'bg-positive text-bg',
                  active && 'bg-brand text-brand-fg',
                  !done && !active && 'bg-surface-2 text-fg-subtle border-line-strong border',
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span
                className={cn(
                  'truncate text-xs font-medium',
                  active ? 'text-fg' : done ? 'text-fg-muted' : 'text-fg-subtle',
                )}
              >
                {step.label}
              </span>
            </button>
            {i < steps.length - 1 ? <span className="bg-line h-px w-4 shrink-0" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
