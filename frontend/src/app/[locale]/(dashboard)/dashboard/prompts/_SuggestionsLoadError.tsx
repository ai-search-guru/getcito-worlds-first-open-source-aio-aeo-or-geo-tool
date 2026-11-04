'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReadFailure } from '@/lib/apiFailure';

/**
 * A suggestions card's failed read, in plain words, with Retry: an API that
 * isn't answering says so, anything else says why as the failure toasts do.
 * Never the thrown message, which production hides behind React's #441.
 */
export function SuggestionsLoadError({
  failure,
  onRetry,
}: {
  failure: ReadFailure;
  onRetry: () => void;
}) {
  const t = useTranslations('prompts.suggestions');
  const tFailure = useTranslations('apiFailure');
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive/60 mb-2" />
      <p className="text-sm font-medium mb-1">{t('loadFailed')}</p>
      <p className="text-xs text-muted-foreground mb-3 max-w-sm">
        {failure.retryable ? t('loadUnavailable') : tFailure(failure.failure)}
      </p>
      <Button onClick={onRetry} size="sm" variant="outline" className="gap-2">
        <RefreshCw className="h-3.5 w-3.5" />
        {t('retry')}
      </Button>
    </div>
  );
}
