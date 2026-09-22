import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { createRule, deleteRule, listRules, setRuleEnabled } from '@/data/rules';
import { listCategories } from '@/data/categories';
import { listMerchants } from '@/data/merchants';
import type { WalletScope } from '@/data/types';

const MATCH_LABELS: Record<string, string> = {
  contains: 'מכיל',
  exact: 'זהה בדיוק',
  regex: 'ביטוי רגולרי',
};

const WALLET_LABELS: Record<string, string> = {
  joint: 'משותף',
  personal: 'אישי',
};

export function RulesCard() {
  const qc = useQueryClient();
  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState<'exact' | 'contains' | 'regex'>('contains');
  const [categoryId, setCategoryId] = useState('');
  const [wallet, setWallet] = useState<WalletScope | ''>('');

  const { data } = useQuery({
    queryKey: ['rules'],
    queryFn: async () => {
      const [rules, categories, merchants] = await Promise.all([
        listRules(),
        listCategories(),
        listMerchants(),
      ]);
      return { rules, categories, merchants };
    },
  });

  const add = useMutation({
    mutationFn: () =>
      createRule({
        matchType,
        pattern: pattern.trim(),
        categoryId: categoryId || null,
        wallet: wallet || null,
      }),
    onSuccess: () => {
      setPattern('');
      qc.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setRuleEnabled(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  const remove = useMutation({
    mutationFn: deleteRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  if (!data) return null;
  const { rules, categories, merchants } = data;
  const learned = merchants.filter((m) => m.default_category_id);

  return (
    <Card>
      <CardHeader
        title="כללי סיווג"
        description={`הכללים רצים לפני הבינה המלאכותית. ${learned.length} בתי עסק כבר נלמדו מהתיקונים שלך ולא צריכים כלל.`}
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-6 items-end gap-3">
          <Field label="התאמה" >
            <Select
              value={matchType}
              onChange={(e) => setMatchType(e.target.value as typeof matchType)}
            >
              <option value="contains">מכיל</option>
              <option value="exact">זהה בדיוק</option>
              <option value="regex">ביטוי רגולרי</option>
            </Select>
          </Field>
          <Field label="תבנית" className="col-span-2">
            <Input
              value={pattern}
              placeholder="שופרסל"
              onChange={(e) => setPattern(e.target.value)}
            />
          </Field>
          <Field label="קטגוריה">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— ללא —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ארנק">
            <Select value={wallet} onChange={(e) => setWallet(e.target.value as WalletScope | '')}>
              <option value="">להשאיר כמו שהוא</option>
              <option value="joint">משותף</option>
              <option value="personal">אישי</option>
            </Select>
          </Field>
          <Button disabled={!pattern.trim()} onClick={() => add.mutate()}>
            <Plus className="size-4" /> הוספה
          </Button>
        </div>

        {rules.length === 0 ? (
          <p className="text-fg-subtle text-xs">
            עדיין אין כללים. בדרך כלל לא צריך אותם — תיקון של תנועה מלמד את בית העסק
            אוטומטית. השתמש בכללים למשפחות שלמות, כמו כל תחנות הדלק.
          </p>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-line/60 border-b last:border-0">
                  <td className="py-2">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      aria-label={`הפעלת ${rule.pattern}`}
                      checked={rule.is_enabled === 1}
                      onChange={(e) => toggle.mutate({ id: rule.id, enabled: e.target.checked })}
                    />
                  </td>
                  <td className="text-fg-muted py-2">{MATCH_LABELS[rule.match_type] ?? rule.match_type}</td>
                  <td className="py-2 font-medium">
                    <code>{rule.pattern}</code>
                  </td>
                  <td className="text-fg-muted py-2">
                    {categories.find((c) => c.id === rule.category_id)?.name ?? '—'}
                  </td>
                  <td className="text-fg-muted py-2">
                    {rule.wallet ? (WALLET_LABELS[rule.wallet] ?? rule.wallet) : ''}
                  </td>
                  <td className="w-8 text-end">
                    <button
                      type="button"
                      aria-label={`מחיקת הכלל ${rule.pattern}`}
                      className="text-fg-subtle hover:text-negative"
                      onClick={() => remove.mutate(rule.id)}
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
