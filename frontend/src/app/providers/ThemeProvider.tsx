import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { getInitialTheme, THEME_STORAGE_KEY, type ThemeId } from '../../config/themes';

export type ColorMode = 'light' | 'dark';
export const COLOR_MODE_STORAGE_KEY = 'carteio-dashboard-theme';

function getInitialColorMode(): ColorMode {
  try {
    return window.localStorage.getItem(COLOR_MODE_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

type ThemeContextValue = {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  mode: ColorMode;
  setMode: (mode: ColorMode) => void;
};
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<ThemeId>(getInitialTheme);
  const [mode, updateMode] = useState<ColorMode>(getInitialColorMode);
  const setTheme = useCallback((nextTheme: ThemeId) => updateTheme(nextTheme), []);
  const setMode = useCallback((nextMode: ColorMode) => updateMode(nextMode), []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The selected theme still applies for this session when storage is unavailable.
    }
  }, [theme]);

  useLayoutEffect(() => {
    try {
      window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode);
    } catch {
      // The selected mode still applies for this session when storage is unavailable.
    }
  }, [mode]);

  const value = useMemo(() => ({ theme, setTheme, mode, setMode }), [theme, setTheme, mode, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}

