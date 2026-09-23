import { cn } from '@/lib/utils';
import { AnimatedMoney } from '@/components/ui/AnimatedMoney';
import { Sparkline, type SparkPoint } from '@/components/ui/Sparkline';
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

const TINT: Record<WalletKind, string> = {
  joint_buffer: 'var(--joint)',
  savings: 'var(--savings)',
  personal: 'var(--fg-subtle)',
};

export function WalletCard({
  name,
  kind,
  balance,
  accentClass,
  caption,
  trend,
  trendColor,
}: {
  name: string;
  kind: WalletKind;
  balance: number;
  accentClass?: string;
  caption?: string;
  trend?: SparkPoint[];
  trendColor?: string;
}) {
  const negative = balance < 0;
  return (
    <div
      className={cn(
        'bg-surface border-line shadow-e1 hover:shadow-e2 hover:border-line-strong relative overflow-hidden',
        'rounded-[var(--radius-card)] border p-4 transition-[box-shadow,border-color] duration-200',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('size-1.5 rounded-full', accentClass ?? RING[kind])} />
        <span className="text-fg-muted truncate text-xs font-medium">{name}</span>
      </div>
      <AnimatedMoney
        value={balance}
        className={cn(
          'mt-2.5 block text-2xl font-semibold tracking-tight',
          negative ? 'text-negative' : accentClass ? '' : ACCENT[kind],
        )}
      />
      <div className="text-fg-subtle mt-1 text-[11px]">{caption ?? 'יתרת פתיחה'}</div>
      {trend && trend.length > 1 && (
        <div className="-mx-4 -mb-4 mt-2">
          <Sparkline data={trend} color={trendColor ?? TINT[kind]} height={40} />
        </div>
      )}
    </div>
  );
}
