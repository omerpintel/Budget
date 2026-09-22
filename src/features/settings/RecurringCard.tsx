import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input, MoneyInput, Select } from '@/components/ui/Field';
import {
  createRecurringEntry,
  deleteRecurringEntry,
  listCategories,
  listRecurringEntries,
} from '@/data/categories';
import { listPeople } from '@/data/people';
import { formatAgorot, parseMoneyInput } from '@/lib/money';
import type { Direction } from '@/data/types';

export function RecurringCard() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [direction, setDirection] = useState<Direction>('out');
  const [amountRaw, setAmountRaw] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [personId, setPersonId] = useState('');
  const [day, setDay] = useState('1');

  const { data } = useQuery({
    queryKey: ['recurring'],
    queryFn: async () => {
      const [entries, categories, people] = await Promise.all([
        listRecurringEntries(),
        listCategories(),
        listPeople(),
      ]);
      return { entries, categories, people };
    },
  });

  const add = useMutation({
    mutationFn: () =>
      createRecurringEntry({
        name: name.trim(),
        direction,
        categoryId: categoryId || null,
        personId: direction === 'in' ? personId || null : null,
        defaultAmount: parseMoneyInput(amountRaw) ?? 0,
        dayOfMonth: Number(day) || null,
      }),
    onSuccess: () => {
      setName('');
      setAmountRaw('');
      qc.invalidateQueries({ queryKey: ['recurring'] });
    },
  });

  const remove = useMutation({
    mutationFn: deleteRecurringEntry,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring'] }),
  });

  if (!data) return null;
  const { entries, categories, people } = data;
  const relevantCategories = categories.filter((c) =>
    direction === 'in' ? c.kind === 'income' : c.kind === 'fixed' || c.kind === 'savings',
  );

  return (
    <Card>
      <CardHeader
        title="תנועות בנק קבועות"
        description="תבניות שממלאות מראש כל סגירת חודש — משכורות נכנסות, שכר דירה והוראות קבע יוצאים. הסכומים נשארים ניתנים לעריכה בכל חודש."
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-7 items-end gap-3">
          <Field label="שם" className="col-span-2">
            <Input value={name} placeholder="שכר דירה" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="כיוון">
            <Select
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as Direction);
                setCategoryId('');
              }}
            >
              <option value="out">יוצא</option>
              <option value="in">נכנס</option>
            </Select>
          </Field>
          <Field label="סכום אופייני">
            <MoneyInput value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} />
          </Field>
          <Field label="יום">
            <Select value={day} onChange={(e) => setDay(e.target.value)}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={direction === 'in' ? 'הכנסה של מי' : 'קטגוריה'}>
            {direction === 'in' ? (
              <Select value={personId} onChange={(e) => setPersonId(e.target.value)}>
                <option value="">משק הבית</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">— ללא —</option>
                {relevantCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button disabled={!name.trim()} onClick={() => add.mutate()}>
            <Plus className="size-4" /> הוספה
          </Button>
        </div>

        {entries.length === 0 ? (
          <p className="text-fg-subtle text-xs">
            עדיין אין תבניות. הוסף את שכר הדירה ואת שתי המשכורות כדי שסגירת החודש תתחיל מלאה.
          </p>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-line/60 border-b last:border-0">
                  <td className="py-2 font-medium">{entry.name}</td>
                  <td className="text-fg-muted py-2">
                    {entry.direction === 'in' ? 'הכנסה' : 'הוצאה'}
                    {entry.person_id
                      ? ` · ${people.find((p) => p.id === entry.person_id)?.name ?? ''}`
                      : entry.category_id
                        ? ` · ${categories.find((c) => c.id === entry.category_id)?.name ?? ''}`
                        : ''}
                  </td>
                  <td className="text-fg-muted py-2">
                    {entry.day_of_month ? `יום ${entry.day_of_month}` : ''}
                  </td>
                  <td className="tnum py-2 text-end">{formatAgorot(entry.default_amount)}</td>
                  <td className="w-8 ps-2 text-end">
                    <button
                      type="button"
                      aria-label={`הסרת ${entry.name}`}
                      className="text-fg-subtle hover:text-negative"
                      onClick={() => remove.mutate(entry.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
