import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
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
    w.kind === 'personal' ? `הארנק של ${personName(w.person_id)}` : w.name;

  return (
    <Modal
      open
      tone="negative"
      dismissable={false}
      onOpenChange={(next) => !next && onCarry()}
      title={`הכרית המשותפת עומדת על ${formatAgorot(-shortfall)}`}
      description="אפשר להעביר כסף כדי לכסות את הגירעון, או לגלגל אותו לחודש הבא. לגלגל זו בחירה לגיטימית — הכרית פשוט תיפתח במינוס."
    >
      <div className="space-y-3">
        <div className="border-negative/30 bg-negative/5 flex items-start gap-2.5 rounded-lg border p-3">
          <AlertTriangle className="text-negative mt-px size-4 shrink-0" />
          <p className="text-xs leading-relaxed">
            צריך {formatAgorot(shortfall)} כדי להחזיר את הכרית המשותפת לאפס.
          </p>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-3">
          <Field label="מקור" hint={`זמין ${formatAgorot(available)}`}>
            <Select value={fromWalletId} onChange={(e) => setFromWalletId(e.target.value)}>
              {donors.map((w) => (
                <option key={w.id} value={w.id}>
                  {label(w)}
                </option>
              ))}
            </Select>
          </Field>
          <ArrowRight className="dir-icon text-fg-subtle mb-3 size-4" />
          <Field label="סכום">
            <MoneyInput value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} />
          </Field>
          <Button
            loading={busy}
            disabled={amount <= 0 || !fromWalletId}
            onClick={async () => {
              setBusy(true);
              try {
                await onCover(fromWalletId, amount);
              } finally {
                setBusy(false);
              }
            }}
          >
            כיסוי
          </Button>
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onCarry}>
            גלגל את הגירעון לחודש הבא
          </Button>
        </div>
      </div>
    </Modal>
  );
}
