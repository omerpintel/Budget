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
}

const today = () => new Date().toISOString().slice(0, 10);

export function ManualEntryForm({
  categories,
  people,
  onSubmit,
  onCancel,
}: {
  categories: Category[];
  people: Person[];
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
  });
  const [saving, setSaving] = useState(false);

  const amount = parseMoneyInput(draft.amountRaw);
  const valid = draft.description.trim() !== '' && amount !== null && amount > 0;
  const set = <K extends keyof ManualDraft>(key: K, value: ManualDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <Card>
      <CardHeader
        title="Add a transaction"
        description="For anything that never reaches a card statement — rent wires, cash, standing orders, salary."
      />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-4 gap-3">
          <Field label="Date">
            <Input type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Direction">
            <Select
              value={draft.direction}
              onChange={(e) => set('direction', e.target.value as Direction)}
            >
              <option value="out">Money out</option>
              <option value="in">Money in</option>
            </Select>
          </Field>
          <Field label="Amount">
            <MoneyInput value={draft.amountRaw} onChange={(e) => set('amountRaw', e.target.value)} />
          </Field>
          <Field label="Category">
            <Select value={draft.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">— none —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <Field label="Description" className="col-span-2">
            <Input
              value={draft.description}
              placeholder="Rent transfer"
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <Field label="Wallet">
            <Select
              value={draft.wallet}
              onChange={(e) => set('wallet', e.target.value as WalletScope)}
            >
              <option value="joint">Joint</option>
              <option value="personal">Personal</option>
            </Select>
          </Field>
          <Field label="Whose" hint={draft.wallet === 'joint' ? 'Joint expenses have no owner' : undefined}>
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
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
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
            {saving ? 'Adding…' : 'Add transaction'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
