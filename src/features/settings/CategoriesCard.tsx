import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { archiveCategory, createCategory, listCategories } from '@/data/categories';
import type { CategoryKind } from '@/data/types';

const KINDS: Array<{ value: CategoryKind; label: string; hint: string }> = [
  { value: 'income', label: 'הכנסה', hint: 'משכורות, החזרים' },
  { value: 'fixed', label: 'קבוע', hint: 'אותו דבר כל חודש' },
  { value: 'flexible', label: 'משתנה', hint: 'משתנה מחודש לחודש — זה מה שהכרית המשותפת סופגת' },
  { value: 'savings', label: 'חיסכון', hint: 'הפרשות לכרית החיסכון' },
];

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
  return base || `category-${Date.now()}`;
}

export function CategoriesCard() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>('flexible');

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: listCategories });

  const add = useMutation({
    mutationFn: async () => {
      const existing = new Set((categories ?? []).map((c) => c.slug));
      let slug = slugify(name);
      let n = 2;
      while (existing.has(slug)) slug = `${slugify(name)}-${n++}`;
      await createCategory(name.trim(), kind, slug);
    },
    onSuccess: () => {
      setName('');
      qc.invalidateQueries();
    },
  });

  const archive = useMutation({
    mutationFn: archiveCategory,
    onSuccess: () => qc.invalidateQueries(),
  });

  if (!categories) return null;

  return (
    <Card>
      <CardHeader
        title="קטגוריות"
        description="הקטגוריות המשתנות הן אלה שנמדדות מול התכנית המשותפת. אי אפשר להסיר קטגוריות מובנות."
      />
      <CardBody className="space-y-4">
        <div className="flex items-end gap-3">
          <Field label="קטגוריה חדשה" className="flex-1">
            <Input
              value={name}
              placeholder="מכבסה"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) add.mutate();
              }}
            />
          </Field>
          <Field label="סוג" className="w-44">
            <Select value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button size="md" disabled={!name.trim()} onClick={() => add.mutate()}>
            <Plus className="size-4" /> הוספה
          </Button>
        </div>

        {KINDS.map((k) => {
          const items = categories.filter((c) => c.kind === k.value);
          if (items.length === 0) return null;
          return (
            <div key={k.value}>
              <div className="text-fg-muted mb-1.5 text-xs font-medium">
                {k.label} <span className="text-fg-subtle font-normal">· {k.hint}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {items.map((c) => (
                  <span
                    key={c.id}
                    className="border-line bg-surface-2/60 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                  >
                    {c.name}
                    {c.is_system === 0 && (
                      <button
                        type="button"
                        aria-label={`הסרת ${c.name}`}
                        className="text-fg-subtle hover:text-negative"
                        onClick={() => archive.mutate(c.id)}
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
