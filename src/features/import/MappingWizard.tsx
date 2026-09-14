import { Field, Select } from '@/components/ui/Field';
import { MerchantText } from '@/components/MerchantText';
import type { ColumnField, ColumnMap } from '@/services/import/issuers';
import type { CellValue } from '@/services/import/xlsx';

const REQUIRED: Array<{ field: ColumnField; label: string }> = [
  { field: 'transactionDate', label: 'Transaction date' },
  { field: 'description', label: 'Merchant / description' },
];

const AMOUNT: Array<{ field: ColumnField; label: string }> = [
  { field: 'chargeAmount', label: 'Charged amount' },
  { field: 'debit', label: 'Debit column' },
  { field: 'credit', label: 'Credit column' },
];

const OPTIONAL: Array<{ field: ColumnField; label: string }> = [
  { field: 'originalAmount', label: 'Original amount' },
  { field: 'originalCurrency', label: 'Original currency' },
  { field: 'installment', label: 'Installments' },
  { field: 'notes', label: 'Notes' },
];

export function MappingWizard({
  preview,
  headerRowIndex,
  columnMap,
  onHeaderRowChange,
  onColumnChange,
}: {
  preview: CellValue[][];
  headerRowIndex: number;
  columnMap: ColumnMap;
  onHeaderRowChange: (index: number) => void;
  onColumnChange: (field: ColumnField, index: number | undefined) => void;
}) {
  const headerRow = preview[headerRowIndex] ?? [];
  const columnCount = Math.max(...preview.map((r) => r.length), 0);
  const columnLabel = (i: number) => {
    const header = headerRow[i];
    const text = header == null || String(header).trim() === '' ? `Column ${i + 1}` : String(header);
    return `${i + 1}. ${text}`;
  };

  const picker = (field: ColumnField, label: string) => (
    <Field key={field} label={label}>
      <Select
        value={columnMap[field] ?? ''}
        onChange={(e) => onColumnChange(field, e.target.value === '' ? undefined : Number(e.target.value))}
      >
        <option value="">— none —</option>
        {Array.from({ length: columnCount }, (_, i) => (
          <option key={i} value={i}>
            {columnLabel(i)}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <div className="space-y-5">
      <Field
        label="Which row holds the column headers?"
        hint="Israeli exports usually start with a title and account summary."
        className="max-w-64"
      >
        <Select value={headerRowIndex} onChange={(e) => onHeaderRowChange(Number(e.target.value))}>
          {preview.map((row, i) => (
            <option key={i} value={i}>
              Row {i + 1} — {row.filter((c) => c != null && String(c).trim() !== '').slice(0, 3).join(' · ') || '(empty)'}
            </option>
          ))}
        </Select>
      </Field>

      <div className="border-line overflow-x-auto rounded-lg border">
        <table className="w-full text-[11px]">
          <tbody>
            {preview.slice(0, 8).map((row, r) => (
              <tr
                key={r}
                className={r === headerRowIndex ? 'bg-brand/10 font-medium' : 'border-line/60 border-t'}
              >
                {Array.from({ length: columnCount }, (_, c) => (
                  <td key={c} className="max-w-40 truncate px-2 py-1.5">
                    <MerchantText value={row[c] == null ? '' : String(row[c])} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <div className="text-fg-muted mb-2 text-xs font-medium">Required</div>
        <div className="grid grid-cols-2 gap-3">{REQUIRED.map((f) => picker(f.field, f.label))}</div>
      </div>

      <div>
        <div className="text-fg-muted mb-2 text-xs font-medium">
          Amount — a charged amount, or a debit/credit pair
        </div>
        <div className="grid grid-cols-3 gap-3">{AMOUNT.map((f) => picker(f.field, f.label))}</div>
      </div>

      <div>
        <div className="text-fg-muted mb-2 text-xs font-medium">Optional</div>
        <div className="grid grid-cols-4 gap-3">{OPTIONAL.map((f) => picker(f.field, f.label))}</div>
      </div>
    </div>
  );
}
