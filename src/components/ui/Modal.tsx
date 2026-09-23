import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Radix handles the focus trap, ESC and scroll lock. The dialogs here are
 * decisions the user must make before locking a month, so they are non-dismissable
 * by outside click — closing has to be an explicit choice.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  tone = 'default',
  dismissable = true,
}: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  tone?: 'default' | 'positive' | 'negative';
  dismissable?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
          style={{ animation: 'overlay-in 160ms var(--ease-out-soft)' }}
        />
        <Dialog.Content
          onInteractOutside={(e) => !dismissable && e.preventDefault()}
          className={cn(
            'bg-surface border-line shadow-e3 fixed top-1/2 left-1/2 z-50 w-[min(34rem,calc(100vw-2rem))]',
            'max-h-[85vh] overflow-y-auto rounded-[var(--radius-card)] border',
            tone === 'positive' && 'border-positive/40',
            tone === 'negative' && 'border-negative/40',
          )}
          style={{
            transform: 'translate(-50%, -50%)',
            animation: 'panel-in 180ms var(--ease-out-soft)',
          }}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold tracking-tight">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-fg-muted mt-1 text-xs leading-relaxed">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            {dismissable && (
              <Dialog.Close
                className="text-fg-subtle hover:text-fg hover:bg-surface-2 -me-1 -mt-1 rounded-lg p-1.5 transition-colors"
                aria-label="סגירה"
              >
                <X className="size-4" />
              </Dialog.Close>
            )}
          </div>
          <div className="px-5 pb-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
