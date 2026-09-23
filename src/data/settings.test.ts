import { describe, expect, it } from 'vitest';
import { useTestDb } from '@/test/harness';
import { getAllSettings, getSetting, SETTING_DEFAULTS, SETTING_KEYS, setSetting, setSettings } from './settings';

describe('settings', () => {
  useTestDb();

  it('getSetting returns the default when nothing is stored', async () => {
    expect(await getSetting(SETTING_KEYS.closeDay)).toBe(SETTING_DEFAULTS[SETTING_KEYS.closeDay]);
  });

  it('getSetting returns "" for an unknown key with no default', async () => {
    expect(await getSetting('nonexistent-key')).toBe('');
  });

  it('setSetting upserts a value', async () => {
    await setSetting(SETTING_KEYS.closeDay, '15');
    expect(await getSetting(SETTING_KEYS.closeDay)).toBe('15');
    await setSetting(SETTING_KEYS.closeDay, '20');
    expect(await getSetting(SETTING_KEYS.closeDay)).toBe('20');
  });

  it('setSettings writes a whole batch atomically', async () => {
    await setSettings({ [SETTING_KEYS.theme]: 'light', [SETTING_KEYS.ollamaEnabled]: '0' });
    expect(await getSetting(SETTING_KEYS.theme)).toBe('light');
    expect(await getSetting(SETTING_KEYS.ollamaEnabled)).toBe('0');
  });

  it('getAllSettings merges defaults with stored overrides', async () => {
    await setSetting(SETTING_KEYS.theme, 'light');
    const all = await getAllSettings();
    expect(all[SETTING_KEYS.theme]).toBe('light');
    expect(all[SETTING_KEYS.closeDay]).toBe(SETTING_DEFAULTS[SETTING_KEYS.closeDay]);
  });
});
