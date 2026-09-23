import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/state/theme';
import { cn } from '@/lib/utils';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={dark}
      aria-label={dark ? 'מעבר למצב בהיר' : 'מעבר למצב כהה'}
      title={dark ? 'מצב בהיר' : 'מצב כהה'}
      className={cn(
        'border-line bg-surface-2 hover:border-line-strong relative inline-flex h-7 w-12 shrink-0',
        'items-center rounded-[var(--radius-pill)] border transition-colors',
        className,
      )}
    >
      {/* Transform-only, so nothing has to be measured. A motion `layout` prop here
          kept the projection loop alive and jittered every screen. */}
      <span
        className="bg-surface shadow-e1 absolute top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full transition-transform duration-200 ease-[var(--ease-spring)]"
        style={{
          insetInlineStart: '0.25rem',
          transform: `translateY(-50%) translateX(${dark ? '-1.25rem' : '0'})`,
        }}
      >
        {dark ? (
          <Moon className="text-fg-muted size-3" strokeWidth={2} />
        ) : (
          <Sun className="text-warning size-3" strokeWidth={2} />
        )}
      </span>
    </button>
  );
}
