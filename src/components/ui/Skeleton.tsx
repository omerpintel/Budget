import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('bg-surface-2 animate-pulse rounded-[var(--radius-field)]', className)}
      {...props}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-surface border-line space-y-3 rounded-[var(--radius-card)] border p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-2 w-full" />
    </div>
  );
}
