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
        title="Categorisation rules"
        description={`Rules run before the AI. ${learned.length} merchant${
          learned.length === 1 ? ' has' : 's have'
        } already been learned from your corrections and need no rule.`}
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-6 items-end gap-3">
          <Field label="Match" >
            <Select
              value={matchType}
              onChange={(e) => setMatchType(e.target.value as typeof matchType)}
            >
              <option value="contains">Contains</option>
              <option value="exact">Exact</option>
              <option value="regex">Regex</option>
            </Select>
          </Field>
          <Field label="Pattern" className="col-span-2">
            <Input
              value={pattern}
              placeholder="שופרסל"
              onChange={(e) => setPattern(e.target.value)}
            />
          </Field>
          <Field label="Category">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— none —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Wallet">
            <Select value={wallet} onChange={(e) => setWallet(e.target.value as WalletScope | '')}>
              <option value="">Leave as is</option>
              <option value="joint">Joint</option>
              <option value="personal">Personal</option>
            </Select>
          </Field>
          <Button disabled={!pattern.trim()} onClick={() => add.mutate()}>
            <Plus className="size-4" /> Add
          </Button>
        </div>

        {rules.length === 0 ? (
          <p className="text-fg-subtle text-xs">
            No rules yet. You rarely need them — correcting a transaction teaches the merchant
            automatically. Use rules for whole families, like every fuel station.
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
                      aria-label={`Enable ${rule.pattern}`}
                      checked={rule.is_enabled === 1}
                      onChange={(e) => toggle.mutate({ id: rule.id, enabled: e.target.checked })}
                    />
                  </td>
                  <td className="text-fg-muted py-2">{rule.match_type}</td>
                  <td className="py-2 font-medium">
                    <code>{rule.pattern}</code>
                  </td>
                  <td className="text-fg-muted py-2">
                    {categories.find((c) => c.id === rule.category_id)?.name ?? '—'}
                  </td>
                  <td className="text-fg-muted py-2">{rule.wallet ?? ''}</td>
                  <td className="w-8 text-right">
                    <button
                      type="button"
                      aria-label={`Delete rule ${rule.pattern}`}
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
