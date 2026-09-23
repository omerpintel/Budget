import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'joint' | 'savings' | 'omer' | 'roni' | 'positive' | 'negative' | 'warning';

/** A hairline of wallet colour along the top edge, so pools are recognisable at a glance. */
const tones: Record<Tone, string> = {
  default: '',
  joint: 'before:bg-joint',
  savings: 'before:bg-savings',
  omer: 'before:bg-omer',
  roni: 'before:bg-roni',
  positive: 'before:bg-positive',
  negative: 'before:bg-negative',
  warning: 'before:bg-warning',
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
  variant?: 'flat' | 'elevated' | 'interactive';
}

export function Card({ className, tone = 'default', variant = 'elevated', ...props }: CardProps) {
  return (
    <div
      className={cn(
        'bg-surface border-line relative overflow-hidden rounded-[var(--radius-card)] border',
        variant === 'elevated' && 'shadow-e2',
        variant === 'interactive' &&
          'shadow-e1 hover:border-line-strong hover:shadow-e2 transition-[box-shadow,border-color,transform] duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-0.5',
        tone !== 'default' &&
          'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:content-[""]',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5 pb-3', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="text-fg-muted mt-1 text-xs leading-relaxed">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}
