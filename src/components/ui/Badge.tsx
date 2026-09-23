import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'brand' | 'positive' | 'negative' | 'warning' | 'joint' | 'savings';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted border-line',
  brand: 'bg-brand/12 text-brand border-brand/25',
  positive: 'bg-positive/12 text-positive border-positive/25',
  negative: 'bg-negative/12 text-negative border-negative/25',
  warning: 'bg-warning/12 text-warning border-warning/25',
  joint: 'bg-joint/12 text-joint border-joint/25',
  savings: 'bg-savings/12 text-savings border-savings/25',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-pill)] border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
