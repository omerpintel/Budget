import { useCallback, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';

const ACCEPT = '.csv,.xlsx,.xls,.txt';

export function DropZone({ onFile, disabled }: { onFile: (file: File) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handle = useCallback(
    (file: File | undefined) => {
      if (file && !disabled) onFile(file);
    },
    [disabled, onFile],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files?.[0]);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'group flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed px-6 py-14',
        'transition-[border-color,background-color,transform] duration-200 ease-[var(--ease-out-soft)]',
        over
          ? 'border-brand bg-brand/8 scale-[1.01]'
          : 'border-line-strong hover:border-brand/60 hover:bg-surface-2/40',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <span
        className={cn(
          'flex size-12 items-center justify-center rounded-full transition-colors',
          over ? 'bg-brand/15 text-brand' : 'bg-surface-2 text-fg-subtle group-hover:text-brand',
        )}
      >
        <UploadCloud className="size-6" strokeWidth={1.5} />
      </span>
      <p className="mt-3 text-sm font-medium">גרור לכאן דף חיוב</p>
      <p className="text-fg-subtle mt-1 text-xs">CSV או XLSX שיוצאו מאתר המנפיק או הבנק</p>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          handle(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
