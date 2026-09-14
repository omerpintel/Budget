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
        'flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed px-6 py-12 transition-colors',
        over ? 'border-brand bg-brand/5' : 'border-line-strong hover:border-fg-subtle hover:bg-surface-2/40',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <UploadCloud className="text-fg-subtle size-7" strokeWidth={1.25} />
      <p className="mt-3 text-sm font-medium">Drop a statement here</p>
      <p className="text-fg-subtle mt-1 text-xs">CSV or XLSX exported from your card issuer or bank</p>
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
