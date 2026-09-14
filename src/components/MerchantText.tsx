import { cn } from '@/lib/utils';

/**
 * Hebrew vendor names sit next to Latin UI and digits; without bidi isolation
 * the rendered order scrambles. Every raw description must go through here.
 */
export function MerchantText({
  value,
  className,
  masked = false,
}: {
  value: string | null | undefined;
  className?: string;
  masked?: boolean;
}) {
  if (masked) {
    return (
      <span className={cn('text-fg-muted italic', className)} dir="auto">
        Personal expense
      </span>
    );
  }
  return (
    <bdi dir="auto" className={cn('font-hebrew', className)}>
      {value ?? '—'}
    </bdi>
  );
}
