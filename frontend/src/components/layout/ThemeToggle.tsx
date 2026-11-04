'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

const emptySubscribe = () => () => {};

/**
 * Switches the dashboard between light and dark, beside the logo in the
 * sidebar and the mobile menu. Light is the default (the ThemeProvider in
 * [locale]/layout.tsx); next-themes remembers the choice per browser. The
 * theme isn't known before mount, so it shows the light state until then,
 * as the logo does.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('nav');
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    useCallback(() => true, []),
    useCallback(() => false, []),
  );
  const dark = mounted && resolvedTheme === 'dark';
  const label = dark ? t('switchToLight') : t('switchToDark');

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={label}
      title={label}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
