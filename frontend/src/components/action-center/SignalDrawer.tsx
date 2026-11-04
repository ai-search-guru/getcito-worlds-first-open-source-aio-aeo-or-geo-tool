'use client';

import { useTranslations } from 'next-intl';
import { Check, Eye, RotateCcw, X } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { Signal } from '@/lib/actions/signals';
import { SIGNAL_KINDS, type SignalStatus } from '@/lib/signals/registry';
import { signalTexts } from '@/lib/signals/display';
import { isKpiKey } from '@/lib/kpis/registry';
import {
  ImpactDots,
  isSuperseded,
  SignalKindIcon,
  SignalStatusBadge,
  SourceList,
} from './SignalTable';
import { SignalChangeBlock, SignalEvidenceBlock, SignalWhereBlock } from './SignalDetailBlocks';

/**
 * Signal detail: where it happened, what changed, and what it rests on
 * (AC-001), then the related KPIs and triage. The "Create Action" CTA
 * belongs to the Actions iteration and is absent rather than dead.
 */
export function SignalDrawer({
  brandId,
  signal,
  onOpenChange,
  onStatusChange,
  isBusy,
}: {
  brandId: string;
  signal: Signal | null;
  onOpenChange: (open: boolean) => void;
  onStatusChange: (signal: Signal, status: SignalStatus) => void;
  isBusy: boolean;
}) {
  const t = useTranslations('actionCenter.signalsPage');
  const tTexts = useTranslations('actionCenter.signalTexts');
  const tCategories = useTranslations('actionCenter.signalCategories');
  const tRegistry = useTranslations('actionCenter.registry');

  if (!signal) return null;
  const texts = signalTexts(signal, tTexts);
  const stateKey = SIGNAL_KINDS[signal.kind].stateKey;
  const relatedKpis = signal.kpiKeys.filter(isKpiKey);

  return (
    <Sheet open={Boolean(signal)} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{tCategories(signal.category)}</span>
            <span>·</span>
            <span>{t(`states.${stateKey}`)}</span>
            <span className="flex items-center gap-1.5">
              <ImpactDots impact={signal.impact} />
              {t(`impact.${signal.impact}`)}
            </span>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
              <SignalKindIcon kind={signal.kind} category={signal.category} />
            </div>
            <div className="min-w-0">
              <SheetTitle>{texts.title}</SheetTitle>
              <SheetDescription>{texts.description}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <DetailItem label={t('drawer.status')}>
              <SignalStatusBadge status={signal.status} superseded={isSuperseded(signal)} />
            </DetailItem>
            <DetailItem label={t('drawer.source')}>
              <SourceList sources={signal.source} />
            </DetailItem>
          </div>

          <Separator />
          <SignalWhereBlock signal={signal} />
          <Separator />
          <SignalChangeBlock signal={signal} />
          <Separator />
          <SignalEvidenceBlock signal={signal} brandId={brandId} />

          {relatedKpis.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {t('drawer.relatedKpis')}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {relatedKpis.map((key) => (
                    <Badge key={key} variant="outline" className="text-xs">
                      {tRegistry(`${key}.name`)}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t px-6 py-4">
          {signal.status === 'new' && (
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => onStatusChange(signal, 'acknowledged')}
            >
              <Eye className="h-3.5 w-3.5" />
              {t('menu.acknowledge')}
            </Button>
          )}
          {(signal.status === 'new' || signal.status === 'acknowledged') && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={isBusy}
                onClick={() => onStatusChange(signal, 'dismissed')}
              >
                <X className="h-3.5 w-3.5" />
                {t('menu.dismiss')}
              </Button>
              <Button
                size="sm"
                disabled={isBusy}
                onClick={() => onStatusChange(signal, 'resolved')}
              >
                <Check className="h-3.5 w-3.5" />
                {t('menu.resolve')}
              </Button>
            </>
          )}
          {(signal.status === 'resolved' || signal.status === 'dismissed') && (
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => onStatusChange(signal, 'new')}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('menu.reopen')}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
