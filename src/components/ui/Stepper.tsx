import { Check } from 'lucide-react';
import { motion } from 'motion/react';
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
                'relative flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-field)] px-2.5 py-2 text-start',
                !active && reachable && onSelect && 'hover:bg-surface-2/60 cursor-pointer',
                (!reachable || !onSelect) && 'cursor-default',
              )}
            >
              {active && (
                <motion.span
                  layoutId="stepper-active"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  className="bg-surface-2 border-line absolute inset-0 rounded-[var(--radius-field)] border"
                />
              )}
              <span
                className={cn(
                  'relative flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-colors',
                  done && 'bg-positive text-bg',
                  active && 'bg-brand text-brand-fg shadow-e1',
                  !done && !active && 'bg-surface-2 text-fg-subtle border-line-strong border',
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span
                className={cn(
                  'relative truncate text-xs font-medium',
                  active ? 'text-fg' : done ? 'text-fg-muted' : 'text-fg-subtle',
                )}
              >
                {step.label}
              </span>
            </button>
            {i < steps.length - 1 ? (
              <span
                className={cn(
                  'h-px w-4 shrink-0 transition-colors duration-300',
                  done ? 'bg-positive' : 'bg-line',
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
