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
      <PageHeader title="Settings" description="Local configuration. Nothing leaves this machine." />

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Monthly run"
            description="Budget periods are always calendar months. This only decides when you are reminded to sit down."
          />
          <CardBody className="space-y-3">
            <Field label="Run day of month" className="max-w-40">
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
                  A card debits on day {maxDebitDay}. Running on day {closeDay} leaves that bill out of
                  the period.
                </p>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Local AI"
            description="Ollama categorises new merchants. If it is offline the app still works — everything lands in Uncategorized."
          />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Ollama URL">
                <Input
                  defaultValue={settings[SETTING_KEYS.ollamaUrl]}
                  onBlur={(e) => save.mutate({ key: SETTING_KEYS.ollamaUrl, value: e.target.value })}
                />
              </Field>
              <Field label="Model">
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
                {checking ? 'Checking…' : 'Test connection'}
              </Button>
              {status && (
                <span className="flex items-center gap-1.5 text-xs">
                  {!status.reachable ? (
                    <>
                      <XCircle className="text-negative size-3.5" />
                      <span className="text-fg-muted">Not reachable — {status.error}</span>
                    </>
                  ) : status.models.length === 0 ? (
                    <>
                      <AlertTriangle className="text-warning size-3.5" />
                      <span className="text-fg-muted">Ollama is running, but no models are pulled</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="text-positive size-3.5" />
                      <span className="text-fg-muted">
                        Connected · {status.models.length} model{status.models.length === 1 ? '' : 's'}
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
                    Pull a model to enable categorisation:{' '}
                    <code className="text-fg">ollama pull gemma3:12b</code> (or{' '}
                    <code className="text-fg">gemma3:4b</code> on a smaller GPU).
                  </>
                ) : (
                  <>
                    Start the Ollama service, then run{' '}
                    <code className="text-fg">ollama pull gemma3:12b</code>.
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
                    <code>{settings[SETTING_KEYS.ollamaModel]}</code> is not installed. Pick an
                    installed model above, or run{' '}
                    <code>ollama pull {settings[SETTING_KEYS.ollamaModel]}</code>.
                  </p>
                </div>
              )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Cards & accounts"
            description="Card ownership decides whose personal wallet an expense belongs to."
          />
          <CardBody>
            <table className="w-full text-xs">
              <thead className="text-fg-subtle border-line border-b">
                <tr className="text-left">
                  <th className="pb-2 font-medium">Card</th>
                  <th className="pb-2 font-medium">Issuer</th>
                  <th className="pb-2 font-medium">Owner</th>
                  <th className="pb-2 text-right font-medium">Debit day</th>
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
                    <td className="tnum text-fg-muted py-2.5 text-right">{a.debit_day ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Backup"
            description="Your entire ledger is one SQLite file. Export it somewhere safe now and then."
          />
          <CardBody className="flex items-center gap-3">
            <Button size="sm" variant="secondary" onClick={() => downloadBackup()}>
              <Download className="size-3.5" /> Export database
            </Button>
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" /> Restore from file
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
                Last export {new Date(settings[SETTING_KEYS.lastBackupAt]).toLocaleDateString('en-GB')}
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
            title="Erase everything"
            description={`Deletes all ${counts.transactions} transactions, ${counts.periods} period(s) and ${counts.accounts} account(s), then restarts onboarding. Export a backup first — this cannot be undone.`}
          />
          <CardBody className="flex items-end gap-3">
            <Field label="Type ERASE to confirm" className="max-w-48">
              <Input
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                placeholder="ERASE"
              />
            </Field>
            <Button
              variant="danger"
              disabled={resetConfirm !== 'ERASE'}
              onClick={async () => {
                await resetAllData();
                window.location.hash = '#/onboarding';
                window.location.reload();
              }}
            >
              <Trash2 className="size-3.5" /> Erase all data
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
