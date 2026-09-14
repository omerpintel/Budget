import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-fg hover:opacity-90 disabled:opacity-40',
  secondary:
    'bg-surface-2 text-fg border border-line-strong hover:bg-surface hover:border-fg-subtle disabled:opacity-40',
  ghost: 'text-fg-muted hover:text-fg hover:bg-surface-2 disabled:opacity-40',
  danger: 'bg-negative text-white hover:opacity-90 disabled:opacity-40',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap transition-all',
        'disabled:cursor-not-allowed active:scale-[0.98]',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
