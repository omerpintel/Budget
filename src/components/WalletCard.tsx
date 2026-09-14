import { cn } from '@/lib/utils';
import { formatAgorot } from '@/lib/money';
import type { WalletKind } from '@/data/types';

const ACCENT: Record<WalletKind, string> = {
  joint_buffer: 'text-joint',
  savings: 'text-savings',
  personal: 'text-fg',
};

const RING: Record<WalletKind, string> = {
  joint_buffer: 'bg-joint',
  savings: 'bg-savings',
  personal: 'bg-fg-subtle',
};

export function WalletCard({
  name,
  kind,
  balance,
  accentClass,
  caption,
}: {
  name: string;
  kind: WalletKind;
  balance: number;
  accentClass?: string;
  caption?: string;
}) {
  const negative = balance < 0;
  return (
    <div className="bg-surface border-line rounded-[var(--radius-card)] border p-4">
      <div className="flex items-center gap-2">
        <span className={cn('size-1.5 rounded-full', accentClass ?? RING[kind])} />
        <span className="text-fg-muted truncate text-xs font-medium">{name}</span>
      </div>
      <div
        className={cn(
          'tnum mt-2.5 text-2xl font-semibold tracking-tight',
          negative ? 'text-negative' : (accentClass ? '' : ACCENT[kind]),
        )}
      >
        {formatAgorot(balance)}
      </div>
      <div className="text-fg-subtle mt-1 text-[11px]">{caption ?? 'Opening balance'}</div>
    </div>
  );
}
