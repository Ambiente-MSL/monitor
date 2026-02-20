import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'ui-theme';

const ThemeContext = createContext({
  theme: 'auto',
  resolvedTheme: 'light',
  setTheme: () => {},
  toggleTheme: () => {},
});

const getSystemTheme = () => {
  if (typeof window === 'undefined') return 'light';
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  return media && media.matches ? 'dark' : 'light';
};

const getInitialTheme = () => {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    return stored;
  }
  return 'light';
};

export function ThemeProvider({ children }) {
  const initialTheme = getInitialTheme();
  const [theme, setTheme] = useState(initialTheme);
  const [resolvedTheme, setResolvedTheme] = useState(() => (initialTheme === 'auto' ? getSystemTheme() : initialTheme));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.localStorage.setItem(STORAGE_KEY, theme);
    const root = document.documentElement;

    const applyTheme = (mode) => {
      // Ativa transição suave
      root.classList.add('theme-transitioning');
      root.setAttribute('data-theme', mode);
      document.body.classList.toggle('theme-light', mode === 'light');
      document.body.classList.toggle('theme-dark', mode === 'dark');
      setResolvedTheme(mode);
      // Remove a classe após a transição terminar
      const timer = setTimeout(() => root.classList.remove('theme-transitioning'), 350);
      return () => clearTimeout(timer);
    };

    if (theme === 'auto') {
      const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      const updateFromSystem = () => applyTheme(media && media.matches ? 'dark' : 'light');
      updateFromSystem();
      if (media) {
        if (media.addEventListener) {
          media.addEventListener('change', updateFromSystem);
          return () => media.removeEventListener('change', updateFromSystem);
        }
        if (media.addListener) {
          media.addListener(updateFromSystem);
          return () => media.removeListener(updateFromSystem);
        }
      }
      return undefined;
    }

    applyTheme(theme);
    return undefined;
  }, [theme]);

  const value = useMemo(() => ({
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme: () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')),
  }), [theme, resolvedTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
