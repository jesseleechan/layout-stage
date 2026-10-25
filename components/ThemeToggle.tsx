'use client';
import { useLayoutEffect, useState } from 'react';

/* System → Light → Dark. Light/Dark set data-theme on <html>; System removes it so the
   prefers-color-scheme tokens apply. app/layout.tsx applies the saved choice before first paint. */
export const THEME_KEY = 'layoutStage.theme';
type Theme = 'system' | 'light' | 'dark';
const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const ICONS: Record<Theme, React.ReactNode> = {
  system: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
    </>
  ),
  light: (
    <>
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </>
  ),
  dark: <path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1z" />,
};

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  // Also re-applies after React's dev remount resets <html> attributes.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  const cycle = () => {
    const next = NEXT[theme];
    setTheme(next);
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage blocked: the choice lasts for this session */
    }
  };

  return (
    <button
      className="icon-btn" id="themeBtn" type="button" onClick={cycle}
      aria-label={`Theme: ${LABEL[theme]}`} title={`Theme: ${LABEL[theme]} (click for ${LABEL[NEXT[theme]]})`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[theme]}
      </svg>
    </button>
  );
}
