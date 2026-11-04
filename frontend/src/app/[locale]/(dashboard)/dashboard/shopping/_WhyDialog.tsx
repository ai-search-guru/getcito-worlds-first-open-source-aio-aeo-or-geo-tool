'use client';

import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useIntegrationConnect } from '@/hooks/useIntegrationConnect';

/** The four steps, in order (en.json shopping.why.steps). */
const STEPS = ['shelf', 'why', 'fix', 'sell'] as const;

/**
 * "Why GetCito Product Visibility?" (ECOM-010): what the page does for a
 * shop, from the AI shelf to the sale, in four steps. Its Connect Google
 * Analytics is there while GA isn't connected and the member may connect
 * it: GA joins an AI visit to its order.
 */
export function WhyDialog({
  open,
  onOpenChange,
  offerGa,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether to offer Connect Google Analytics. */
  offerGa: boolean;
  onConnected: () => void;
}) {
  const t = useTranslations('shopping.why');
  const { connecting, connect } = useIntegrationConnect('google-analytics', {
    label: t('ga'),
    callbackUrl: () => window.location.href,
    onStatus: (status) => {
      if (status === 'connected') {
        onConnected();
        onOpenChange(false);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <p className="text-xs font-medium text-muted-foreground">{t('eyebrow')}</p>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('lead')}</DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
          {STEPS.map((step, i) => (
            <li key={step} className="flex gap-3">
              <span
                aria-hidden
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{t(`steps.${step}.title`)}</p>
                <p className="text-sm text-muted-foreground">{t(`steps.${step}.body`)}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm font-medium">{t('closing')}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('gotIt')}
          </Button>
          {offerGa && (
            <Button className="gap-2" disabled={connecting} onClick={() => void connect()}>
              {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('connectGa')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
