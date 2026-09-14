import { useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, MoneyInput, Select } from '@/components/ui/Field';
import { formatAgorot, parseMoneyInput } from '@/lib/money';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import type { Wallet } from '@/data/types';

export function ShortfallDialog({
  shortfall,
  wallets,
  balances,
  jointWalletId,
  onCover,
  onCarry,
  personName,
}: {
  shortfall: number;
  wallets: Wallet[];
  balances: Map<string, number>;
  jointWalletId: string;
  onCover: (fromWalletId: string, amount: number) => Promise<void>;
  onCarry: () => void;
  personName: (id: string | null) => string;
}) {
  const donors = wallets.filter((w) => w.id !== jointWalletId);
  const [fromWalletId, setFromWalletId] = useState(donors[0]?.id ?? '');
  const [amountRaw, setAmountRaw] = useState(String(shortfall / 100));
  const [busy, setBusy] = useState(false);

  const amount = parseMoneyInput(amountRaw) ?? 0;
  const available = balances.get(fromWalletId) ?? 0;
  const label = (w: Wallet) =>
    w.kind === 'personal' ? `${personName(w.person_id)}'s wallet` : w.name;

  return (
    <Card className="border-negative/40">
      <CardHeader
        title={`The joint buffer is ${formatAgorot(-shortfall)}`}
        description="Move money in to cover it, or carry the deficit into next month. Carrying it is a legitimate choice — the buffer simply opens negative."
      />
      <CardBody className="space-y-3">
        <div className="border-negative/30 bg-negative/5 flex items-start gap-2.5 rounded-lg border p-3">
          <AlertTriangle className="text-negative mt-px size-4 shrink-0" />
          <p className="text-xs leading-relaxed">
            You need {formatAgorot(shortfall)} to bring the joint buffer back to zero.
          </p>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-3">
          <Field label="Take from" hint={`Available ${formatAgorot(available)}`}>
            <Select value={fromWalletId} onChange={(e) => setFromWalletId(e.target.value)}>
              {donors.map((w) => (
                <option key={w.id} value={w.id}>
                  {label(w)}
                </option>
              ))}
            </Select>
          </Field>
          <ArrowRight className="text-fg-subtle mb-3 size-4" />
          <Field label="Amount">
            <MoneyInput value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} />
          </Field>
          <Button
            disabled={busy || amount <= 0 || !fromWalletId}
            onClick={async () => {
              setBusy(true);
              try {
                await onCover(fromWalletId, amount);
              } finally {
                setBusy(false);
              }
            }}
          >
            Cover
          </Button>
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onCarry}>
            Carry the deficit into next month
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
