import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Trash2 } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, MoneyInput, Select } from '@/components/ui/Field';
import { addTransfer, listTransfers, removeTransfer } from '@/data/periodEngine';
import { listWallets } from '@/data/wallets';
import { listPeople } from '@/data/people';
import { formatAgorot, parseMoneyInput } from '@/lib/money';

export function TransfersCard({
  periodId,
  disabled = false,
}: {
  periodId: string;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amountRaw, setAmountRaw] = useState('');

  const { data } = useQuery({
    queryKey: ['transfers-card', periodId],
    queryFn: async () => {
      const [wallets, people, transfers] = await Promise.all([
        listWallets(),
        listPeople(),
        listTransfers(periodId),
      ]);
      return { wallets, people, transfers };
    },
  });

  if (!data) return null;
  const { wallets, people, transfers } = data;

  const label = (id: string) => {
    const w = wallets.find((x) => x.id === id);
    if (!w) return '—';
    if (w.kind !== 'personal') return w.name;
    return `הארנק של ${people.find((p) => p.id === w.person_id)?.name ?? ''}`.trim();
  };

  const source = from || wallets[0]?.id || '';
  const target = to || wallets[1]?.id || '';
  const invalidate = () => qc.invalidateQueries();

  return (
    <Card>
      <CardHeader
        title="העברות בין הארנקים"
        description="העבר כסף לחיסכון, או חלץ את הכרית המשותפת מארנק אישי."
      />
      <CardBody className="space-y-3">
        {transfers.length > 0 && (
          <table className="w-full text-xs">
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id} className="border-line/60 border-b last:border-0">
                  <td className="py-2">{label(t.from_wallet_id)}</td>
                  <td className="w-6 py-2">
                    <ArrowRight className="dir-icon text-fg-subtle size-3.5" />
                  </td>
                  <td className="py-2">{label(t.to_wallet_id)}</td>
                  <td className="text-fg-muted py-2">{t.reason}</td>
                  <td className="tnum w-24 py-2 text-end">{formatAgorot(t.amount)}</td>
                  <td className="w-8 text-end">
                    <button
                      type="button"
                      aria-label="הסרת העברה"
                      disabled={disabled}
                      className="text-fg-subtle hover:text-negative disabled:opacity-40"
                      onClick={async () => {
                        await removeTransfer(t.id, periodId);
                        invalidate();
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="grid grid-cols-[1fr_auto_1fr_1fr_auto] items-end gap-3">
          <Field label="מקור">
            <Select value={source} disabled={disabled} onChange={(e) => setFrom(e.target.value)}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {label(w.id)}
                </option>
              ))}
            </Select>
          </Field>
          <ArrowRight className="dir-icon text-fg-subtle mb-3 size-4" />
          <Field label="יעד">
            <Select value={target} disabled={disabled} onChange={(e) => setTo(e.target.value)}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {label(w.id)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="סכום">
            <MoneyInput
              value={amountRaw}
              disabled={disabled}
              onChange={(e) => setAmountRaw(e.target.value)}
            />
          </Field>
          <Button
            disabled={disabled || source === target || (parseMoneyInput(amountRaw) ?? 0) <= 0}
            onClick={async () => {
              await addTransfer({
                periodId,
                fromWalletId: source,
                toWalletId: target,
                amount: parseMoneyInput(amountRaw) ?? 0,
                reason: null,
              });
              setAmountRaw('');
              invalidate();
            }}
          >
            העבר
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
