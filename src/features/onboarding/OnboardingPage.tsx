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
  { id: 'people', label: 'מי' },
  { id: 'cards', label: 'כרטיסים' },
  { id: 'balances', label: 'יתרות' },
  { id: 'schedule', label: 'לוח זמנים' },
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
  const [names, setNames] = useState<[string, string]>(['עומר', 'רוני']);
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
        <h1 className="text-xl font-semibold tracking-tight">הקמת הספרים שלך</h1>
        <p className="text-fg-muted mt-1 text-sm">
          ארבעה שלבים קצרים. הכל נשאר על המחשב הזה.
        </p>
      </div>

      <div className="mb-6">
        <Stepper steps={STEPS} current={step} onSelect={setStep} />
      </div>

      <Card>
        {step === 0 && (
          <>
            <CardHeader
              title="מי חי במשק הבית הזה?"
              description="לכל אחד יש ארנק אישי משלו וצבע שמלווה אותו בכל האפליקציה."
            />
            <CardBody className="grid grid-cols-2 gap-4">
              {([0, 1] as const).map((i) => (
                <Field key={i} label={i === 0 ? 'אדם ראשון' : 'אדם שני'}>
                  <Input
                    value={names[i]}
                    onChange={(e) =>
                      setNames((prev) => {
                        const next: [string, string] = [...prev];
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                    placeholder={i === 0 ? 'עומר' : 'רוני'}
                  />
                </Field>
              ))}
            </CardBody>
          </>
        )}

        {step === 1 && (
          <>
            <CardHeader
              title="כרטיסי אשראי"
              description="כל כרטיס שייך לאדם אחד — כך האפליקציה יודעת של מי ההוצאה האישית, בלי לשאול. יום החיוב הוא היום שבו החשבון יורד מהבנק."
              action={
                <Button size="sm" variant="secondary" onClick={() => setCards((c) => [...c, newCard(0)])}>
                  <Plus className="size-3.5" /> הוספת כרטיס
                </Button>
              }
            />
            <CardBody className="space-y-3">
              {cards.map((card, idx) => (
                <div key={card.key} className="border-line bg-surface-2/40 rounded-lg border p-3">
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
                    <Field label="שם הכרטיס">
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
                    <Field label="מנפיק">
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
                        aria-label="הסרת כרטיס"
                        disabled={cards.length === 1}
                        onClick={() => setCards((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <Field label="בעלים">
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
                        <option value={0}>{names[0] || 'אדם ראשון'}</option>
                        <option value={1}>{names[1] || 'אדם שני'}</option>
                      </Select>
                    </Field>
                    <Field label="4 ספרות אחרונות" hint="רשות">
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
                    <Field label="יום החיוב בבנק">
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
              title="יתרות פתיחה"
              description="הזן מה שיש היום בחשבון המשותף, ואז החלט כמה ממנו אתה מחשיב כחיסכון לטווח ארוך. השאר הופך לכרית התפעול שלך. הארנקים האישיים מתחילים באפס."
            />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="יתרה נוכחית בבנק">
                  <MoneyInput
                    value={totalRaw}
                    onChange={(e) => setTotalRaw(e.target.value)}
                    placeholder="0"
                  />
                </Field>
                <Field label="מתוך זה, לחשוב כחיסכון">
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
                  <div className="text-savings text-[11px] font-medium">כרית חיסכון</div>
                  <div className="tnum mt-1 text-lg font-semibold">{formatAgorot(savings)}</div>
                </div>
                <div className="border-line bg-surface-2/40 rounded-lg border p-3">
                  <div className="text-joint text-[11px] font-medium">כרית משותפת</div>
                  <div className="tnum mt-1 text-lg font-semibold">{formatAgorot(jointBuffer)}</div>
                </div>
              </div>

              {savings > total && (
                <p className="text-negative text-xs">החיסכון לא יכול לעלות על היתרה בבנק.</p>
              )}
            </CardBody>
          </>
        )}

        {step === 3 && (
          <>
            <CardHeader
              title="מתי אתה סוגר את החודש?"
              description="בחר את היום שבו אתה מתיישב להשלים חשבון. חודשי התקציב נשארים חודשי לוח שנה — זה רק קובע את התזכורת ואת חודש ברירת המחדל."
            />
            <CardBody className="space-y-4">
              <Field
                label="יום סגירת החודש"
                hint="בחר יום שאחרי שהמשכורת נכנסה וכל חשבונות הכרטיסים ירדו."
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
                    אחד הכרטיסים שלך יורד ביום {maxDebitDay}. סגירה ביום {closeDay} אומרת שהחיוב הזה
                    עדיין לא ייכנס לחודש. שקול יום {maxDebitDay} או מאוחר יותר.
                  </p>
                </div>
              )}

              <div className="border-line bg-surface-2/40 space-y-1.5 rounded-lg border p-4 text-xs">
                <div className="text-fg-muted font-medium">אתה עומד ליצור</div>
                <ul className="text-fg-subtle space-y-1">
                  <li>
                    {names[0]} ו{names[1]}, לכל אחד ארנק אישי שמתחיל ב־₪0
                  </li>
                  <li>
                    כרית משותפת {formatAgorot(jointBuffer)} · כרית חיסכון {formatAgorot(savings)}
                  </li>
                  <li>
                    {cards.length} כרטיסים ו־{31} קטגוריות ברירת מחדל
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
          <ArrowLeft className="dir-icon size-4" /> חזרה
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
            המשך <ArrowRight className="dir-icon size-4" />
          </Button>
        ) : (
          <Button onClick={finish} disabled={saving}>
            {saving ? 'יוצר…' : 'צור את הספרים'}
          </Button>
        )}
      </div>
    </div>
  );
}
