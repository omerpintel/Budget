import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getSetting, setSetting, SETTING_KEYS } from '@/data/settings';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.add('theme-transition');
  root.classList.toggle('dark', theme === 'dark');
  window.setTimeout(() => root.classList.remove('theme-transition'), 200);
}

/**
 * The theme lives in the settings table, but SQLite loads asynchronously in a
 * worker. localStorage mirrors it so `public/theme-boot.js` can paint the right
 * colours before the app bundle has even parsed.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);

  useEffect(() => {
    let cancelled = false;
    getSetting(SETTING_KEYS.theme)
      .then((stored) => {
        const value: Theme = stored === 'light' ? 'light' : 'dark';
        if (cancelled || value === readStored()) return;
        setThemeState(value);
        apply(value);
        localStorage.setItem(STORAGE_KEY, value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    apply(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private-mode storage failures must not break the toggle.
    }
    void setSetting(SETTING_KEYS.theme, next);
  }, []);

  const toggle = useCallback(
    () => setTheme(readStored() === 'dark' ? 'light' : 'dark'),
    [setTheme],
  );

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
