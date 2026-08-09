'use client';
import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';

// Client-mount flag without setState-in-effect: getServerSnapshot returns false
// (server + initial hydration), getSnapshot returns true (post-hydration client).
const emptySubscribe = () => () => {};

export function ThemeToggle() {
  const t = useTranslations('common');
  const { setTheme, resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  if (!mounted) return <Button variant="ghost" size="icon" aria-label={t('toggleTheme')} />;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('toggleTheme')}
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
