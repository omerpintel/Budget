import { useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input, MoneyInput, Select } from '@/components/ui/Field';
import { parseMoneyInput } from '@/lib/money';
import type { Category, Direction, Person, WalletScope } from '@/data/types';

export interface ManualDraft {
  date: string;
  description: string;
  amountRaw: string;
  direction: Direction;
  categoryId: string;
  wallet: WalletScope;
  personId: string;
  note: string;
  fundFromSavings: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

export function ManualEntryForm({
  categories,
  people,
  canFundFromSavings = false,
  onSubmit,
  onCancel,
}: {
  categories: Category[];
  people: Person[];
  canFundFromSavings?: boolean;
  onSubmit: (draft: ManualDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ManualDraft>({
    date: today(),
    description: '',
    amountRaw: '',
    direction: 'out',
    categoryId: '',
    wallet: 'joint',
    personId: people[0]?.id ?? '',
    note: '',
    fundFromSavings: false,
  });
  const [saving, setSaving] = useState(false);

  const amount = parseMoneyInput(draft.amountRaw);
  const valid = draft.description.trim() !== '' && amount !== null && amount > 0;
  const set = <K extends keyof ManualDraft>(key: K, value: ManualDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <Card>
      <CardHeader
        title="הוספת תנועה"
        description="לכל מה שלא מגיע לדף חיוב — העברות שכר דירה, מזומן, הוראות קבע ומשכורות."
      />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-4 gap-3">
          <Field label="תאריך">
            <Input type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="כיוון">
            <Select
              value={draft.direction}
              onChange={(e) => set('direction', e.target.value as Direction)}
            >
              <option value="out">כסף שיצא</option>
              <option value="in">כסף שנכנס</option>
            </Select>
          </Field>
          <Field label="סכום">
            <MoneyInput value={draft.amountRaw} onChange={(e) => set('amountRaw', e.target.value)} />
          </Field>
          <Field label="קטגוריה">
            <Select value={draft.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">— ללא —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <Field label="תיאור" className="col-span-2">
            <Input
              value={draft.description}
              placeholder="העברת שכר דירה"
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <Field label="ארנק">
            <Select
              value={draft.wallet}
              onChange={(e) => set('wallet', e.target.value as WalletScope)}
            >
              <option value="joint">משותף</option>
              <option value="personal">אישי</option>
            </Select>
          </Field>
          <Field label="של מי" hint={draft.wallet === 'joint' ? 'להוצאה משותפת אין בעלים' : undefined}>
            <Select
              value={draft.personId}
              disabled={draft.wallet === 'joint'}
              onChange={(e) => set('personId', e.target.value)}
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          {canFundFromSavings && draft.direction === 'out' && (
            <label className="text-fg-muted me-auto flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="accent-savings size-3.5"
                checked={draft.fundFromSavings}
                onChange={(e) => set('fundFromSavings', e.target.checked)}
              />
              לשלם מכרית החיסכון — יורד מהחיסכון ולא מהכרית המשותפת
            </label>
          )}
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            ביטול
          </Button>
          <Button
            size="sm"
            disabled={!valid || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSubmit(draft);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'מוסיף…' : 'הוספת תנועה'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
