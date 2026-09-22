import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, Trash2, Upload, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/ui/Feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { getAllSettings, setSetting, SETTING_KEYS } from '@/data/settings';
import { listAccounts, getLatestDebitDay } from '@/data/accounts';
import { listPeople } from '@/data/people';
import { downloadBackup, restoreBackup } from '@/data/backup';
import { getDataCounts, resetAllData } from '@/data/maintenance';
import { checkOllama, type OllamaStatus } from '@/services/ollama/health';
import { CategoriesCard } from '@/features/settings/CategoriesCard';
import { RecurringCard } from '@/features/settings/RecurringCard';
import { RulesCard } from '@/features/settings/RulesCard';
import { SnapshotsCard } from '@/features/settings/SnapshotsCard';
import { ISSUERS } from '@/data/types';

export function SettingsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState('');

  const { data } = useQuery({
    queryKey: ['settings-page'],
    queryFn: async () => {
      const [settings, accounts, people, maxDebitDay, counts] = await Promise.all([
        getAllSettings(),
        listAccounts(),
        listPeople(),
        getLatestDebitDay(),
        getDataCounts(),
      ]);
      return { settings, accounts, people, maxDebitDay, counts };
    },
  });

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => setSetting(key, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings-page'] }),
  });

  const ollamaUrl = data?.settings[SETTING_KEYS.ollamaUrl] ?? '';

  useEffect(() => {
    if (!ollamaUrl) return;
    const controller = new AbortController();
    checkOllama(ollamaUrl, controller.signal).then(setStatus);
    return () => controller.abort();
  }, [ollamaUrl]);

  if (!data) return null;
  const { settings, accounts, people, maxDebitDay, counts } = data;
  const closeDay = Number(settings[SETTING_KEYS.closeDay]);
  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? '—';

  async function onRestore(file: File) {
    try {
      await restoreBackup(file);
      window.location.reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <PageHeader title="הגדרות" description="הגדרות מקומיות. שום דבר לא עוזב את המחשב הזה." />

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="סגירת חודש"
            description="חודשי התקציב הם תמיד חודשי לוח שנה. זה רק קובע מתי תקבל תזכורת להתיישב על זה."
          />
          <CardBody className="space-y-3">
            <Field label="יום סגירת החודש" className="max-w-40">
              <Select
                value={closeDay}
                onChange={(e) => save.mutate({ key: SETTING_KEYS.closeDay, value: e.target.value })}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
            {maxDebitDay !== null && closeDay < maxDebitDay && (
              <div className="border-warning/40 bg-warning/10 flex gap-2.5 rounded-lg border p-3">
                <AlertTriangle className="text-warning mt-px size-4 shrink-0" />
                <p className="text-xs leading-relaxed">
                  כרטיס יורד ביום {maxDebitDay}. סגירה ביום {closeDay} משאירה את החיוב הזה מחוץ
                  לחודש.
                </p>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="בינה מלאכותית מקומית"
            description="Ollama מסווג בתי עסק חדשים. אם הוא לא זמין האפליקציה עדיין עובדת — הכל נוחת תחת ללא קטגוריה."
          />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <Field label="כתובת Ollama">
                <Input
                  defaultValue={settings[SETTING_KEYS.ollamaUrl]}
                  onBlur={(e) => save.mutate({ key: SETTING_KEYS.ollamaUrl, value: e.target.value })}
                />
              </Field>
              <Field label="מודל">
                {status?.reachable && status.models.length > 0 ? (
                  <Select
                    value={settings[SETTING_KEYS.ollamaModel]}
                    onChange={(e) => save.mutate({ key: SETTING_KEYS.ollamaModel, value: e.target.value })}
                  >
                    {status.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    defaultValue={settings[SETTING_KEYS.ollamaModel]}
                    onBlur={(e) => save.mutate({ key: SETTING_KEYS.ollamaModel, value: e.target.value })}
                  />
                )}
              </Field>
            </div>

            <Field
              label={`אישור אוטומטי מרמת ביטחון ${Math.round(Number(settings[SETTING_KEYS.autoAcceptThreshold]) * 100)}%`}
              hint="מעל הרף התנועה נכנסת ל״הוחלו אוטומטית״ ואפשר לאשר הכל בלחיצה. מתחתיו היא מחכה לך במיון עם ההצעה של המודל."
            >
              <input
                type="range"
                min={0.5}
                max={1}
                step={0.05}
                className="accent-brand w-full"
                defaultValue={settings[SETTING_KEYS.autoAcceptThreshold]}
                onChange={(e) =>
                  save.mutate({ key: SETTING_KEYS.autoAcceptThreshold, value: e.target.value })
                }
              />
            </Field>

            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="secondary"
                disabled={checking}
                onClick={async () => {
                  setChecking(true);
                  setStatus(await checkOllama(ollamaUrl));
                  setChecking(false);
                }}
              >
                {checking ? 'בודק…' : 'בדיקת חיבור'}
              </Button>
              {status && (
                <span className="flex items-center gap-1.5 text-xs">
                  {!status.reachable ? (
                    <>
                      <XCircle className="text-negative size-3.5" />
                      <span className="text-fg-muted">אין חיבור — {status.error}</span>
                    </>
                  ) : status.models.length === 0 ? (
                    <>
                      <AlertTriangle className="text-warning size-3.5" />
                      <span className="text-fg-muted">Ollama רץ, אבל לא הורדו מודלים</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="text-positive size-3.5" />
                      <span className="text-fg-muted">
                        מחובר · {status.models.length === 1 ? 'מודל אחד' : `${status.models.length} מודלים`}
                      </span>
                    </>
                  )}
                </span>
              )}
            </div>

            {status && (!status.reachable || status.models.length === 0) && (
              <p className="text-fg-subtle text-xs leading-relaxed">
                {status.reachable ? (
                  <>
                    הורד מודל כדי להפעיל סיווג אוטומטי:{' '}
                    <code className="text-fg">ollama pull gemma3:4b</code> (או{' '}
                    <code className="text-fg">gemma3:12b</code> על כרטיס מסך חזק יותר).
                  </>
                ) : (
                  <>
                    הפעל את שירות Ollama, ואז הרץ{' '}
                    <code className="text-fg">ollama pull gemma3:4b</code>.
                  </>
                )}
              </p>
            )}

            {status?.reachable &&
              status.models.length > 0 &&
              !status.models.includes(settings[SETTING_KEYS.ollamaModel]) && (
                <div className="border-warning/40 bg-warning/10 flex gap-2.5 rounded-lg border p-3">
                  <AlertTriangle className="text-warning mt-px size-4 shrink-0" />
                  <p className="text-xs leading-relaxed">
                    <code>{settings[SETTING_KEYS.ollamaModel]}</code> אינו מותקן. בחר מודל מותקן
                    מלמעלה, או הרץ{' '}
                    <code>ollama pull {settings[SETTING_KEYS.ollamaModel]}</code>.
                  </p>
                </div>
              )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="כרטיסים וחשבונות"
            description="הבעלות על הכרטיס קובעת לאיזה ארנק אישי שייכת ההוצאה."
          />
          <CardBody>
            <table className="w-full text-xs">
              <thead className="text-fg-subtle border-line border-b">
                <tr className="text-start">
                  <th className="pb-2 font-medium">כרטיס</th>
                  <th className="pb-2 font-medium">מנפיק</th>
                  <th className="pb-2 font-medium">בעלים</th>
                  <th className="pb-2 text-end font-medium">יום חיוב</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-line/60 border-b last:border-0">
                    <td className="py-2.5 font-medium">
                      {a.display_name}
                      {a.last4 ? <span className="text-fg-subtle"> ·{a.last4}</span> : null}
                    </td>
                    <td className="text-fg-muted py-2.5">
                      {ISSUERS.find((i) => i.value === a.issuer)?.label ?? a.issuer}
                    </td>
                    <td className="text-fg-muted py-2.5">{personName(a.owner_person_id)}</td>
                    <td className="tnum text-fg-muted py-2.5 text-end">{a.debit_day ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="גיבוי"
            description="כל הספרים שלך הם קובץ SQLite אחד. ייצא אותו מדי פעם למקום בטוח."
          />
          <CardBody className="flex items-center gap-3">
            <Button size="sm" variant="secondary" onClick={() => downloadBackup()}>
              <Download className="size-3.5" /> ייצוא מסד הנתונים
            </Button>
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" /> שחזור מקובץ
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".sqlite3,.sqlite,.db"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onRestore(file);
              }}
            />
            {settings[SETTING_KEYS.lastBackupAt] && (
              <span className="text-fg-subtle text-xs">
                ייצוא אחרון {new Date(settings[SETTING_KEYS.lastBackupAt]).toLocaleDateString('he-IL')}
              </span>
            )}
            {message && <span className="text-negative text-xs">{message}</span>}
          </CardBody>
        </Card>

        <SnapshotsCard />

        <CategoriesCard />
        <RecurringCard />
        <RulesCard />

        <Card className="border-negative/30">
          <CardHeader
            title="מחיקת הכל"
            description={`מוחק את כל ${counts.transactions} התנועות, ${counts.periods} החודשים ו־${counts.accounts} החשבונות, ומתחיל את ההגדרה מההתחלה. ייצא גיבוי קודם — אי אפשר לבטל את זה.`}
          />
          <CardBody className="flex items-end gap-3">
            <Field label="הקלד מחק כדי לאשר" className="max-w-48">
              <Input
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                placeholder="מחק"
              />
            </Field>
            <Button
              variant="danger"
              disabled={resetConfirm !== 'מחק'}
              onClick={async () => {
                await resetAllData();
                window.location.hash = '#/onboarding';
                window.location.reload();
              }}
            >
              <Trash2 className="size-3.5" /> מחיקת כל הנתונים
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
