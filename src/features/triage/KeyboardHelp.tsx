import { cn } from '@/lib/utils';

export interface Shortcut {
  keys: string;
  label: string;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: '1–9', label: 'בחירת קטגוריה' },
  { keys: 'Enter', label: 'אישור ומעבר לבא' },
  { keys: 'P', label: 'מעבר לאישי' },
  { keys: 'A', label: 'החל על הכל מאותו בית עסק' },
  { keys: 'S', label: 'מימון מהחיסכון' },
  { keys: 'X', label: 'החרגה' },
  { keys: '← →', label: 'הקודם / דילוג' },
  { keys: '?', label: 'הצגת העזרה הזו' },
];

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'border-line-strong bg-surface-2 text-fg-muted inline-flex h-5 min-w-5 items-center justify-center rounded border px-1.5 font-sans text-[10px] font-medium',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function KeyboardHelp({ open }: { open: boolean }) {
  if (!open) return null;
  return (
    <div className="border-line bg-surface-2/40 mt-4 grid grid-cols-4 gap-x-6 gap-y-2 rounded-lg border p-4">
      {SHORTCUTS.map((s) => (
        <div key={s.keys} className="flex items-center gap-2 text-xs">
          <Kbd>{s.keys}</Kbd>
          <span className="text-fg-muted">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
