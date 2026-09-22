import { getDb } from '@/db';
import { nowIso } from '@/lib/utils';

export const SETTING_KEYS = {
  onboardingComplete: 'onboarding_complete',
  closeDay: 'close_day',
  theme: 'theme',
  ollamaUrl: 'ollama_url',
  ollamaModel: 'ollama_model',
  ollamaEnabled: 'ollama_enabled',
  autoAcceptThreshold: 'auto_accept_threshold',
  lastBackupAt: 'last_backup_at',
  dismissedSubscriptions: 'dismissed_subscriptions',
} as const;

export const SETTING_DEFAULTS: Record<string, string> = {
  [SETTING_KEYS.onboardingComplete]: '0',
  [SETTING_KEYS.closeDay]: '10',
  [SETTING_KEYS.theme]: 'dark',
  [SETTING_KEYS.ollamaUrl]: 'http://localhost:11434',
  [SETTING_KEYS.ollamaModel]: 'gemma3:4b',
  [SETTING_KEYS.ollamaEnabled]: '1',
  [SETTING_KEYS.autoAcceptThreshold]: '0.9',
  [SETTING_KEYS.lastBackupAt]: '',
  [SETTING_KEYS.dismissedSubscriptions]: '[]',
};

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await getDb().select<{ key: string; value: string }>('SELECT key, value FROM settings');
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...SETTING_DEFAULTS, ...stored };
}

export async function getSetting(key: string): Promise<string> {
  const rows = await getDb().select<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return rows[0]?.value ?? SETTING_DEFAULTS[key] ?? '';
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getDb().execute(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, nowIso()],
  );
}

export async function setSettings(entries: Record<string, string>): Promise<void> {
  const ts = nowIso();
  await getDb().batch(
    Object.entries(entries).map(([key, value]) => ({
      sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      params: [key, value, ts],
    })),
  );
}
