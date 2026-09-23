import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full h-10 rounded-[var(--radius-field)] bg-surface-2 border border-line px-3 text-sm text-fg ' +
  'placeholder:text-fg-subtle transition-[border-color,box-shadow,background-color] duration-150 ' +
  'hover:border-line-strong focus:border-brand focus:bg-surface focus:outline-none ' +
  'focus:ring-2 focus:ring-brand/25 disabled:opacity-40 disabled:pointer-events-none';

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
        <p className="text-negative anim-rise text-xs">{error}</p>
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
      <select ref={ref} className={cn(fieldBase, 'cursor-pointer pe-8', className)} {...props}>
        {children}
      </select>
    );
  },
);

/**
 * Money input: the ₪ sits on the right and digits run left-to-right, so the
 * padding is physical — `.tnum` forces the field itself to LTR, which would
 * otherwise flip logical padding away from the affix.
 */
export const MoneyInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function MoneyInput({ className, ...props }, ref) {
    const id = useId();
    return (
      <div className="relative">
        <span className="text-fg-subtle pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">
          ₪
        </span>
        <input
          ref={ref}
          id={props.id ?? id}
          inputMode="decimal"
          className={cn(fieldBase, 'tnum pr-7 pl-3 text-right', className)}
          {...props}
        />
      </div>
    );
  },
);
