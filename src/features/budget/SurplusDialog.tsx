import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, MoneyInput, Select } from '@/components/ui/Field';
import { formatAgorot, parseMoneyInput } from '@/lib/money';
import { ArrowRight, PiggyBank } from 'lucide-react';
import type { Wallet } from '@/data/types';

/**
 * Mirror of the shortfall flow. A surplus used to pass silently, which is how the
 * same shekels ended up being assigned again the next month — the buffer never
 * shrank, so it looked like fresh money.
 */
export function SurplusDialog({
  surplus,
  wallets,
  jointWalletId,
  onMove,
  onKeep,
  personName,
}: {
  surplus: number;
  wallets: Wallet[];
  jointWalletId: string;
  onMove: (toWalletId: string, amount: number) => Promise<void>;
  onKeep: () => void;
  personName: (id: string | null) => string;
}) {
  const targets = wallets.filter((w) => w.id !== jointWalletId);
  const savings = targets.find((w) => w.kind === 'savings');
  const [toWalletId, setToWalletId] = useState(savings?.id ?? targets[0]?.id ?? '');
  const [amountRaw, setAmountRaw] = useState(String(surplus / 100));
  const [busy, setBusy] = useState(false);

  const amount = parseMoneyInput(amountRaw) ?? 0;
  const label = (w: Wallet) =>
    w.kind === 'personal' ? `הארנק של ${personName(w.person_id)}` : w.name;

  return (
    <Modal
      open
      tone="positive"
      onOpenChange={(next) => !next && onKeep()}
      title={`נשארו ${formatAgorot(surplus)} בכרית המשותפת`}
      description="אפשר להעביר את העודף לחיסכון או לארנק אישי, או להשאיר אותו ככרית. מה שנשאר יופיע כיתרה פתוחה בחודש הבא."
    >
      <div className="space-y-3">
        <div className="border-positive/30 bg-positive/5 flex items-start gap-2.5 rounded-lg border p-3">
          <PiggyBank className="text-positive mt-px size-4 shrink-0" />
          <p className="text-xs leading-relaxed">
            עודף שנשאר בכרית נזקף לחודש הבא ומופיע שם כ״יתרה מהחודש שעבר״, כך שהוא ישויך שוב. העבר
            אותו לחיסכון אם אתה לא מתכוון להוציא אותו.
          </p>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-3">
          <Field label="יעד">
            <Select value={toWalletId} onChange={(e) => setToWalletId(e.target.value)}>
              {targets.map((w) => (
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
            disabled={amount <= 0 || !toWalletId}
            onClick={async () => {
              setBusy(true);
              try {
                await onMove(toWalletId, amount);
              } finally {
                setBusy(false);
              }
            }}
          >
            העבר
          </Button>
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onKeep}>
            השאר ככרית משותפת
          </Button>
        </div>
      </div>
    </Modal>
  );
}
