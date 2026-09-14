import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full h-10 rounded-lg bg-surface-2 border border-line-strong px-3 text-sm text-fg ' +
  'placeholder:text-fg-subtle transition-colors hover:border-fg-subtle ' +
  'focus:border-brand focus:outline-none disabled:opacity-40';

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="text-fg-muted block text-xs font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-negative text-xs">{error}</p>
      ) : hint ? (
        <p className="text-fg-subtle text-xs leading-relaxed">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(fieldBase, className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(fieldBase, 'cursor-pointer pr-8', className)} {...props}>
        {children}
      </select>
    );
  },
);

/** Money input: right-aligned, tabular, with a fixed ₪ affix. */
export const MoneyInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function MoneyInput({ className, ...props }, ref) {
    const id = useId();
    return (
      <div className="relative">
        <span className="text-fg-subtle pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
          ₪
        </span>
        <input
          ref={ref}
          id={props.id ?? id}
          inputMode="decimal"
          className={cn(fieldBase, 'tnum pr-3 pl-7 text-right', className)}
          {...props}
        />
      </div>
    );
  },
);
