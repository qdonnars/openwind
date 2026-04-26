import { createContext, useContext, useEffect, useState } from 'react';

type ThemeMode = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'ow_theme';

function resolveMode(m: ThemeMode): ResolvedTheme {
  if (m !== 'system') return m;
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

const ThemeCtx = createContext<{
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (m: ThemeMode) => void;
}>({ mode: 'system', resolvedTheme: 'dark', setMode: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try { return (localStorage.getItem(STORAGE_KEY) as ThemeMode) ?? 'system'; }
    catch { return 'system'; }
  });
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveMode(
    (() => { try { return (localStorage.getItem(STORAGE_KEY) as ThemeMode) ?? 'system'; } catch { return 'system'; } })()
  ));

  useEffect(() => {
    function apply(m: ThemeMode) {
      const resolved = resolveMode(m);
      setResolvedTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
    }
    apply(mode);
    if (mode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      const handler = () => apply('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [mode]);

  function setMode(m: ThemeMode) {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch {}
  }

  return <ThemeCtx.Provider value={{ mode, resolvedTheme, setMode }}>{children}</ThemeCtx.Provider>;
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
