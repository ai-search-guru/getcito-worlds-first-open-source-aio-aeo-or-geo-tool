'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { AskAdminButton } from '@/components/chat-access/AskAdminButton';
import { YourPlanCard } from '@/components/chat-access/PlanCard';
import { useAiUsage } from '@/components/context/AiUsageProvider';
import { useChatAgentic } from '@/components/context/ChatAgenticProvider';
import {
  AFTER_PAYMENT_READ_MS,
  PackCard,
  firstPick,
  formatDate,
  formatPackPrice,
  useAddOnPurchase,
} from '@/components/settings/AddOnsCard';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { isCloud } from '@/config/plans';
import { Link } from '@/i18n/navigation';
import { getGetMore, type GetMoreRead, type GetMoreWindow } from '@/lib/actions/getMore';
import { packEstimate } from '@/lib/billing/addOnEstimates';
import { percentLabel } from '@/lib/billing/aiUsage';
import { gbLabel } from '@/lib/chat/files';
import { formatMonthDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ownKeyOffered } from './AiUsageGetMore';
import { GetMoreContext, type GetMoreTab } from './getMoreContext';

/**
 * The "Get more" window (CHAT-18 §B item 6, §C; mockup `#s-limits` #more):
 * one window wherever a limit shows (the AI usage meter, the used-up banner,
 * Chat at its cap, the Files storage meter and "Storage is full"), on its
 * AI credits or Storage tab. "Your plan" on top (CHAT-20 §7a), then where
 * the limit stands, the packs with what each adds, on AI credits what a
 * pack covers roughly, and Continue to payment, through Billing's own
 * purchase. Only Admins buy; the others see the packs and Ask your Admin.
 * The free trial can't buy packs (CHAT-18 open question 1): its plan card
 * offers starting the plan. Use your own key shows on Enterprise only
 * (DECISIONS S). On the cloud with Chat on; elsewhere there is no window
 * and useGetMore() is null.
 */

export function GetMoreProvider({ children }: { children: ReactNode }) {
  const enabled = useChatAgentic() && isCloud();
  const [tab, setTab] = useState<GetMoreTab | null>(null);
  const open = useCallback((next: GetMoreTab = 'ai') => setTab(next), []);
  return (
    <GetMoreContext.Provider value={enabled ? open : null}>
      {children}
      {enabled && <GetMoreDialog tab={tab} onTab={setTab} onClose={() => setTab(null)} />}
    </GetMoreContext.Provider>
  );
}

function GetMoreDialog({
  tab,
  onTab,
  onClose,
}: {
  tab: GetMoreTab | null;
  onTab: (tab: GetMoreTab) => void;
  onClose: () => void;
}) {
  const t = useTranslations('aiUsage.getMoreWindow');
  const [read, setRead] = useState<GetMoreRead | undefined>(undefined);
  // Each opening and each pack added reads again.
  const [version, setVersion] = useState(0);
  const open = tab !== null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getGetMore()
      // A dropped connection or a 502 says so, never a window left on its skeleton.
      .catch((): GetMoreRead => ({ ok: false, failure: 'failed' }))
      .then((next) => {
        if (!cancelled) setRead(next);
      });
    return () => {
      cancelled = true;
    };
  }, [open, version]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-slot="get-more" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(tab === 'storage' ? 'titleStorage' : 'titleAi')}</DialogTitle>
          <DialogDescription className="sr-only">{t('description')}</DialogDescription>
        </DialogHeader>
        {!read ? (
          <div aria-hidden className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : read.ok ? (
          <GetMoreBody
            data={read.window}
            tab={tab ?? 'ai'}
            onTab={onTab}
            onAdded={() => setVersion((v) => v + 1)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t('readFailed')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GetMoreBody({
  data: { addOns, plan, storage },
  tab,
  onTab,
  onAdded,
}: {
  data: GetMoreWindow;
  tab: GetMoreTab;
  onTab: (tab: GetMoreTab) => void;
  onAdded: () => void;
}) {
  const t = useTranslations('aiUsage.getMoreWindow');
  const tAdd = useTranslations('settings.addOns');
  const tFiles = useTranslations('chatFiles');
  const { usage, refresh } = useAiUsage();
  const [picked, setPicked] = useState<Record<GetMoreTab, string | null>>(() => ({
    ai: firstPick(addOns.packs, 'ai'),
    storage: firstPick(addOns.packs, 'storage'),
  }));
  // A storage pack counts once Stripe's webhook hears it was paid: said so, and read again after
  // the moment that usually takes, as Billing does.
  const later = useRef<number | null>(null);
  useEffect(() => () => window.clearTimeout(later.current ?? undefined), []);
  const { busy, confirming, setConfirming, message, buy, start } = useAddOnPurchase(
    tAdd('storageAdded'),
    () => {
      later.current = window.setTimeout(() => {
        refresh();
        onAdded();
      }, AFTER_PAYMENT_READ_MS);
    },
  );

  const canBuy = addOns.isAdmin && addOns.buy === 'open';
  const packs = addOns.packs.filter((p) => p.kind === tab);
  const chosen = packs.find((p) => p.id === picked[tab] && p.available) ?? null;
  const planName = plan ? (plan.isTrial ? `${t('trial')} · ${plan.planName}` : plan.planName) : '';
  // Own AI keys: Enterprise's while Chat draws on the AI budget (DECISIONS S), as everywhere.
  const ownKey =
    addOns.isAdmin &&
    ownKeyOffered({
      plan: plan?.planId ?? usage?.plan ?? '',
      chatMetered: usage?.chatMetered ?? true,
    });

  const limitLine =
    tab === 'ai'
      ? usage && usage.percentUsed !== null
        ? usage.periodEnd
          ? t('aiLine', {
              percent: percentLabel(usage.percentUsed),
              plan: planName,
              date: formatMonthDay(usage.periodEnd),
            })
          : t('aiLineNoDate', { percent: percentLabel(usage.percentUsed), plan: planName })
        : null
      : storage.limitBytes === null
        ? tFiles('storageNoLimit', { used: gbLabel(storage.usedBytes) })
        : `${tFiles('storage', {
            used: gbLabel(storage.usedBytes),
            limit: gbLabel(storage.limitBytes),
          })} · ${planName}`;

  return (
    <div className="space-y-4">
      {plan && <YourPlanCard plan={plan} isAdmin={addOns.isAdmin} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label={tAdd('tabs.label')}
          className="inline-flex rounded-lg border bg-muted/40 p-0.5"
        >
          {(['ai', 'storage'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              data-action="getMore.tab"
              aria-pressed={tab === kind}
              onClick={() => onTab(kind)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                // Picked: black in light, white in dark, as Billing's plan tabs (#1806).
                tab === kind
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tAdd(`tabs.${kind}`)}
            </button>
          ))}
        </div>
        {limitLine && (
          <p data-slot="get-more-limit" className="text-sm text-muted-foreground">
            {limitLine}
          </p>
        )}
      </div>

      {tab === 'ai' && addOns.credit && (
        <p className="text-sm font-medium">
          {tAdd('credit', {
            amount: formatPackPrice(addOns.credit.leftCents, 'usd'),
            date: formatDate(addOns.credit.expiresAt),
          })}
        </p>
      )}

      <div
        role="radiogroup"
        aria-label={tAdd('packsLabel', { kind: tab })}
        className={cn(
          'grid grid-cols-2 gap-3 pt-2',
          tab === 'ai' ? 'sm:grid-cols-4' : 'sm:grid-cols-3',
        )}
      >
        {packs.map((pack) => (
          <PackCard
            key={pack.id}
            pack={pack}
            selected={canBuy && chosen?.id === pack.id}
            selectable={canBuy}
            onSelect={() => setPicked((now) => ({ ...now, [tab]: pack.id }))}
          />
        ))}
      </div>

      {tab === 'ai' && packs.length > 0 && (
        <PackEstimates
          packs={packs.map((p) => ({ id: p.id, priceCents: p.priceCents, currency: p.currency }))}
          selected={chosen?.id ?? null}
        />
      )}
      {tab === 'storage' && <p className="text-xs text-muted-foreground">{tAdd('storageNote')}</p>}

      {confirming && (
        <div
          role="group"
          data-slot="get-more-confirm"
          className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm"
        >
          <p className="font-medium">
            {tAdd('storageConfirm.title', {
              gb: confirming.adds?.kind === 'storage' ? confirming.adds.gb : 0,
            })}
          </p>
          <p className="text-muted-foreground">
            {tAdd('storageConfirm.description', {
              price: formatPackPrice(confirming.priceCents, confirming.currency),
            })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirming(null)} disabled={busy}>
              {tAdd('storageConfirm.cancel')}
            </Button>
            <Button
              size="sm"
              data-action="credits.confirmStorage"
              onClick={() => void buy(confirming)}
              disabled={busy}
            >
              {busy ? tAdd('starting') : tAdd('storageConfirm.confirm')}
            </Button>
          </div>
        </div>
      )}

      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'text-sm',
            message.tone === 'error'
              ? 'text-red-600 dark:text-red-400'
              : 'text-emerald-700 dark:text-emerald-400',
          )}
        >
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {!addOns.isAdmin
            ? tAdd('askAdmin')
            : addOns.buy === 'trial'
              ? tAdd('trial')
              : addOns.buy === 'no_plan'
                ? tAdd('noPlan')
                : tAdd('paidWith')}
        </p>
        <div className="flex flex-wrap gap-2">
          {ownKey && (
            <Link
              href="/dashboard/settings/ai-providers"
              data-action="keys.open"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {t('ownKey')}
            </Link>
          )}
          {canBuy ? (
            <Button
              size="sm"
              data-action="credits.continueToPayment"
              onClick={() => chosen && start(chosen)}
              disabled={!chosen || busy || confirming !== null}
            >
              {busy && !confirming ? tAdd('starting') : tAdd('continue')}
            </Button>
          ) : (
            !addOns.isAdmin && (
              <AskAdminButton
                variant="default"
                asked={t(tab === 'ai' ? 'askAi' : 'askStorage')}
                ruleKind="plan"
                ruleDetail={tAdd('askAdmin')}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** "What a pack can cover, roughly": examples on Auto, the picked pack's row marked (CHAT-18 item 3). */
function PackEstimates({
  packs,
  selected,
}: {
  packs: { id: string; priceCents: number; currency: string }[];
  selected: string | null;
}) {
  const t = useTranslations('aiUsage.getMoreWindow.estimates');
  const count = (n: number) => `~${n.toLocaleString('en-US')}`;
  return (
    <div className="space-y-2">
      <div data-slot="pack-estimates" className="overflow-hidden rounded-xl border text-[12.5px]">
        <p className="bg-muted/50 px-3 py-1.5 font-medium">{t('title')}</p>
        <div className="grid grid-cols-3 border-t px-3 py-1.5 text-[11.5px] text-muted-foreground">
          <span>{t('pack')}</span>
          <span className="text-right">{t('answers')}</span>
          <span className="text-right">{t('articles')}</span>
        </div>
        {packs.map((pack) => {
          const estimate = packEstimate(pack.priceCents);
          return (
            <div
              key={pack.id}
              data-selected={pack.id === selected || undefined}
              className={cn(
                'grid grid-cols-3 border-t px-3 py-1.5 tabular-nums',
                pack.id === selected && 'bg-muted font-medium',
              )}
            >
              <span>{formatPackPrice(pack.priceCents, pack.currency)}</span>
              <span className="text-right">{count(estimate.answers)}</span>
              <span className="text-right">{count(estimate.articles)}</span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t('examples')}</p>
      <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
        <AlertTriangle
          className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-500"
          aria-hidden
        />
        {t('warning')}
      </p>
    </div>
  );
}
