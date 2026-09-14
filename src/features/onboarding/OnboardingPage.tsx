import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, MoneyInput, Select } from '@/components/ui/Field';
import { Stepper } from '@/components/ui/Stepper';
import { formatAgorot, parseMoneyInput, toMajor } from '@/lib/money';
import { ISSUERS } from '@/data/types';
import { completeOnboarding, type OnboardingDraft } from './completeOnboarding';

const STEPS = [
  { id: 'people', label: 'Who' },
  { id: 'cards', label: 'Cards' },
  { id: 'balances', label: 'Balances' },
  { id: 'schedule', label: 'Schedule' },
];

interface DraftCard {
  key: string;
  displayName: string;
  issuer: string;
  last4: string;
  ownerIndex: 0 | 1;
  debitDay: number;
}

const newCard = (ownerIndex: 0 | 1): DraftCard => ({
  key: crypto.randomUUID(),
  displayName: '',
  issuer: 'isracard',
  last4: '',
  ownerIndex,
  debitDay: 2,
});

export function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [names, setNames] = useState<[string, string]>(['Omer', 'Roni']);
  const [cards, setCards] = useState<DraftCard[]>([newCard(0), newCard(1)]);
  const [totalRaw, setTotalRaw] = useState('');
  const [savingsRaw, setSavingsRaw] = useState('');
  const [closeDay, setCloseDay] = useState(10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = parseMoneyInput(totalRaw) ?? 0;
  const savings = parseMoneyInput(savingsRaw) ?? 0;
  const jointBuffer = total - savings;
  const maxDebitDay = useMemo(() => Math.max(...cards.map((c) => c.debitDay), 1), [cards]);

  const canAdvance = (() => {
    if (step === 0) return names[0].trim() !== '' && names[1].trim() !== '';
    if (step === 1) return cards.length > 0 && cards.every((c) => c.displayName.trim() !== '');
    if (step === 2) return total > 0 && savings >= 0 && savings <= total;
    return true;
  })();

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      const draft: OnboardingDraft = {
        people: [
          { name: names[0].trim(), color: 'omer' },
          { name: names[1].trim(), color: 'roni' },
        ],
        cards: cards.map((c) => ({
          displayName: c.displayName.trim(),
          issuer: c.issuer,
          last4: c.last4.trim() || null,
          ownerIndex: c.ownerIndex,
          debitDay: c.debitDay,
        })),
        jointBufferOpening: jointBuffer,
        savingsOpening: savings,
        closeDay,
      };
      await completeOnboarding(draft);
      window.location.hash = '#/';
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-8 py-12">
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Set up your ledger</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Four short steps. Everything stays on this machine.
        </p>
      </div>

      <div className="mb-6">
        <Stepper steps={STEPS} current={step} onSelect={setStep} />
      </div>

      <Card>
        {step === 0 && (
          <>
            <CardHeader
              title="Who is in this household?"
              description="Each person gets their own personal wallet and a colour used across the app."
            />
            <CardBody className="grid grid-cols-2 gap-4">
              {([0, 1] as const).map((i) => (
                <Field key={i} label={i === 0 ? 'First person' : 'Second person'}>
                  <Input
                    value={names[i]}
                    onChange={(e) =>
                      setNames((prev) => {
                        const next: [string, string] = [...prev];
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                    placeholder={i === 0 ? 'Omer' : 'Roni'}
                  />
                </Field>
              ))}
            </CardBody>
          </>
        )}

        {step === 1 && (
          <>
            <CardHeader
              title="Credit cards"
              description="Each card belongs to one person — that is how the app knows whose personal expense it is, so it never has to ask. The debit day is when the bill hits your bank account."
              action={
                <Button size="sm" variant="secondary" onClick={() => setCards((c) => [...c, newCard(0)])}>
                  <Plus className="size-3.5" /> Add card
                </Button>
              }
            />
            <CardBody className="space-y-3">
              {cards.map((card, idx) => (
                <div key={card.key} className="border-line bg-surface-2/40 rounded-lg border p-3">
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
                    <Field label="Card name">
                      <Input
                        value={card.displayName}
                        placeholder="Max Gold"
                        onChange={(e) =>
                          setCards((prev) =>
                            prev.map((c, i) => (i === idx ? { ...c, displayName: e.target.value } : c)),
                          )
                        }
                      />
                    </Field>
                    <Field label="Issuer">
                      <Select
                        value={card.issuer}
                        onChange={(e) =>
                          setCards((prev) =>
                            prev.map((c, i) => (i === idx ? { ...c, issuer: e.target.value } : c)),
                          )
                        }
                      >
                        {ISSUERS.map((iss) => (
                          <option key={iss.value} value={iss.value}>
                            {iss.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="flex items-end pb-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Remove card"
                        disabled={cards.length === 1}
                        onClick={() => setCards((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <Field label="Owner">
                      <Select
                        value={card.ownerIndex}
                        onChange={(e) =>
                          setCards((prev) =>
                            prev.map((c, i) =>
                              i === idx ? { ...c, ownerIndex: Number(e.target.value) as 0 | 1 } : c,
                            ),
                          )
                        }
                      >
                        <option value={0}>{names[0] || 'First person'}</option>
                        <option value={1}>{names[1] || 'Second person'}</option>
                      </Select>
                    </Field>
                    <Field label="Last 4 digits" hint="Optional">
                      <Input
                        value={card.last4}
                        maxLength={4}
                        inputMode="numeric"
                        placeholder="4471"
                        onChange={(e) =>
                          setCards((prev) =>
                            prev.map((c, i) =>
                              i === idx ? { ...c, last4: e.target.value.replace(/\D/g, '') } : c,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Debits bank on day">
                      <Select
                        value={card.debitDay}
                        onChange={(e) =>
                          setCards((prev) =>
                            prev.map((c, i) =>
                              i === idx ? { ...c, debitDay: Number(e.target.value) } : c,
                            ),
                          )
                        }
                      >
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                </div>
              ))}
            </CardBody>
          </>
        )}

        {step === 2 && (
          <>
            <CardHeader
              title="Starting balances"
              description="Enter what is in the joint account today, then decide how much of it you consider long-term savings. The rest becomes your operating buffer. Personal wallets start at zero."
            />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Current bank balance">
                  <MoneyInput
                    value={totalRaw}
                    onChange={(e) => setTotalRaw(e.target.value)}
                    placeholder="0"
                  />
                </Field>
                <Field label="Of that, treat as savings">
                  <MoneyInput
                    value={savingsRaw}
                    onChange={(e) => setSavingsRaw(e.target.value)}
                    placeholder="0"
                  />
                </Field>
              </div>

              {total > 0 && (
                <input
                  type="range"
                  min={0}
                  max={toMajor(total)}
                  step={100}
                  value={toMajor(savings)}
                  onChange={(e) => setSavingsRaw(e.target.value)}
                  className="accent-savings w-full"
                />
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="border-line bg-surface-2/40 rounded-lg border p-3">
                  <div className="text-savings text-[11px] font-medium">Savings Buffer</div>
                  <div className="tnum mt-1 text-lg font-semibold">{formatAgorot(savings)}</div>
                </div>
                <div className="border-line bg-surface-2/40 rounded-lg border p-3">
                  <div className="text-joint text-[11px] font-medium">Joint Buffer</div>
                  <div className="tnum mt-1 text-lg font-semibold">{formatAgorot(jointBuffer)}</div>
                </div>
              </div>

              {savings > total && (
                <p className="text-negative text-xs">Savings cannot exceed your bank balance.</p>
              )}
            </CardBody>
          </>
        )}

        {step === 3 && (
          <>
            <CardHeader
              title="When do you run the month?"
              description="Pick the day you sit down to reconcile. Budget periods stay calendar months — this only sets the reminder and the default period."
            />
            <CardBody className="space-y-4">
              <Field
                label="Monthly run day"
                hint="Choose a day after your salary has landed and every card bill has been debited."
                className="max-w-40"
              >
                <Select value={closeDay} onChange={(e) => setCloseDay(Number(e.target.value))}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>

              {closeDay < maxDebitDay && (
                <div className="border-warning/40 bg-warning/10 flex gap-2.5 rounded-lg border p-3">
                  <AlertTriangle className="text-warning mt-px size-4 shrink-0" />
                  <p className="text-xs leading-relaxed">
                    One of your cards debits on day {maxDebitDay}. Running on day {closeDay} means that
                    bill will not be in the period yet. Consider day {maxDebitDay} or later.
                  </p>
                </div>
              )}

              <div className="border-line bg-surface-2/40 space-y-1.5 rounded-lg border p-4 text-xs">
                <div className="text-fg-muted font-medium">You are about to create</div>
                <ul className="text-fg-subtle space-y-1">
                  <li>
                    {names[0]} and {names[1]}, with a personal wallet each starting at ₪0
                  </li>
                  <li>
                    Joint Buffer {formatAgorot(jointBuffer)} · Savings Buffer {formatAgorot(savings)}
                  </li>
                  <li>
                    {cards.length} card{cards.length === 1 ? '' : 's'} and {31} default categories
                  </li>
                </ul>
              </div>

              {error && <p className="text-negative text-xs">{error}</p>}
            </CardBody>
          </>
        )}
      </Card>

      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0 || saving}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
            Continue <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button onClick={finish} disabled={saving}>
            {saving ? 'Creating…' : 'Create ledger'}
          </Button>
        )}
      </div>
    </div>
  );
}
