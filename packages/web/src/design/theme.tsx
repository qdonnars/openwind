import { createContext, useContext, useEffect, useState } from 'react';

type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'ow_theme';

function getInitialMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  // No stored preference — follow system
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {}
  return 'dark';
}

const ThemeCtx = createContext<{
  mode: ThemeMode;
  resolvedTheme: ThemeMode;
  setMode: (m: ThemeMode) => void;
}>({ mode: 'dark', resolvedTheme: 'dark', setMode: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(getInitialMode);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  function setMode(m: ThemeMode) {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch {}
  }

  return (
    <ThemeCtx.Provider value={{ mode, resolvedTheme: mode, setMode }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() { return useContext(ThemeCtx); }

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <button
      onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
      className="shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-sm font-semibold transition-colors"
      style={{ color: 'var(--ow-fg-1)', background: 'transparent' }}
      title={`Switch to ${mode === 'dark' ? 'light' : 'dark'} theme`}
      aria-label={`Switch to ${mode === 'dark' ? 'light' : 'dark'} theme`}
    >
      {mode === 'dark' ? '☾' : '☀'}
    </button>
  );
}
