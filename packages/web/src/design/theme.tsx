import { createContext, useContext, useEffect, useState } from 'react';

type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'ow_theme';

const ThemeCtx = createContext<{
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
}>({ mode: 'system', setMode: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try { return (localStorage.getItem(STORAGE_KEY) as ThemeMode) ?? 'system'; }
    catch { return 'system'; }
  });

  useEffect(() => {
    function apply(m: ThemeMode) {
      const resolved = m === 'system'
        ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : m;
      document.documentElement.setAttribute('data-theme', resolved);
    }
    apply(mode);
    if (mode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      mq.addEventListener('change', () => apply('system'));
      return () => mq.removeEventListener('change', () => apply('system'));
    }
  }, [mode]);

  function setMode(m: ThemeMode) {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch {}
  }

  return <ThemeCtx.Provider value={{ mode, setMode }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() { return useContext(ThemeCtx); }

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const next: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' };
  const label: Record<ThemeMode, string> = { light: '☀', dark: '☾', system: '⊙' };
  return (
    <button
      onClick={() => setMode(next[mode])}
      className="shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-sm font-semibold transition-colors"
      style={{ color: 'var(--ow-fg-1)', background: 'transparent' }}
      title={`Theme: ${mode}`}
      aria-label={`Switch theme (current: ${mode})`}
    >
      {label[mode]}
    </button>
  );
}
