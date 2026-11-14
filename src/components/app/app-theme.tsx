import { useEffect, useState, type ReactNode } from 'react';
import { Theme, defaultTheme, type ThemeConfig } from '@/lib/theme/theme';
import { cn } from 'cn';

function usePrefersDark(): boolean {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

/** Radix-base theme for extension pages: indigo accent (close to the browser's own blue), solid panels, follows the system color scheme. */
export function AppTheme({ children, className }: { children: ReactNode; className?: string }) {
  const dark = usePrefersDark();
  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }, [dark]);
  const config: ThemeConfig = {
    ...defaultTheme,
    accentColor: 'indigo',
    appearance: dark ? 'dark' : 'light',
    panelBackground: 'solid',
  };
  return (
    <Theme config={config} className={cn('bg-background text-foreground antialiased', className)}>
      {children}
    </Theme>
  );
}
