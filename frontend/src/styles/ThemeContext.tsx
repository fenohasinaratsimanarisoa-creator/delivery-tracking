import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { buildCssVars, buildFieldVars, globalStyles } from './theme';
import type { ThemeMode } from './theme';

interface ThemeCtx {
  mode: ThemeMode;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeCtx>({
  mode: 'dark',
  toggle: () => {},
  setMode: () => {},
});

const STORAGE_KEY = 'dt-theme';

function getInitialMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  return 'dark';
}

function injectStyles(mode: ThemeMode) {
  if (!document.getElementById('dt-global-styles')) {
    const s = document.createElement('style');
    s.id = 'dt-global-styles';
    s.textContent = globalStyles;
    document.head.appendChild(s);
  }
  if (!document.getElementById('dt-field-vars')) {
    const s = document.createElement('style');
    s.id = 'dt-field-vars';
    s.textContent = buildFieldVars();
    document.head.appendChild(s);
  }
  const existing = document.getElementById('dt-theme-vars');
  if (existing) existing.remove();
  const s = document.createElement('style');
  s.id = 'dt-theme-vars';
  s.textContent = buildCssVars(mode);
  document.head.appendChild(s);
  document.documentElement.setAttribute('data-theme', mode);
}

// Inject BEFORE React mounts — élimine le FOUC
const initialMode = getInitialMode();
injectStyles(initialMode);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    injectStyles(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch {}
  }, []);

  const toggle = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) {
      document.documentElement.style.setProperty('--motion-reduce', 'reduce');
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, toggle, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeCtx {
  return useContext(ThemeContext);
}
