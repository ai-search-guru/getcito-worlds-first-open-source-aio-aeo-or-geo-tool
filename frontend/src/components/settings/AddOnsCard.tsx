'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getBillingAddOns,
  startAddOnPurchase,
  type AddOnPurchaseView,
  type BillingAddOns,
  type BillingAddOnsRead,
} from '@/lib/actions/addOns';
import type { AddOnKind } from '@/lib/billing/addOns';
import type { AddOnPackView, AddOnPurchaseState } from '@/lib/billing/addOnView';
import { cn } from '@/lib/utils';

/** After a payment, Billing reads once more: the webhook has usually landed by then. */
export const AFTER_PAYMENT_READ_MS = 5_000;

/** A price in its currency, without cents when it has none: $50, $1,000, $48.20. */
export function formatPackPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** "Oct 30, 2027": when a pack's credit ends, or it was bought. */
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

const STATE_VARIANT: Record<AddOnPurchaseState, 'default' | 'secondary' | 'outline'> = {
  processing: 'outline',
  active: 'default',
  used_up: 'secondary',
  expired: 'secondary',
  ended: 'secondary',
  refunded: 'outline',
};

/**
 * Settings › Billing › Add-ons (CHAT-18 §B item 6, §E item 17), behind
 * CHAT_AGENTIC: the AI credit and storage packs with what each adds to this
 * workspace's plan, "Most picked" on one of each, the AI credit left, and
 * for Admins the packs bought. The cards follow the "Get more" window's
 * pack cards; a pack is picked, then bought with Continue to payment: AI
 * credits on Stripe Checkout, storage added to the plan after a
 * confirmation, as it is charged at once. Only Admins buy; others see the
 * packs and the line to ask one. Renders nothing while Chat is off.
 */
export function AddOnsCard() {
  const t = useTranslations('settings.addOns');
  const [read, setRead] = useState<BillingAddOnsRead | undefined>(undefined);
  // Each change reads the section again.
  const [version, setVersion] = useState(0);
  // Back from Checkout: the pack shows once Stripe's webhook has granted it.
  // Nothing renders before the first read, so the server's render agrees.
  const [paidNote] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('add_on') === 'paid',
  );
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    void getBillingAddOns().then((next) => {
      if (!cancelled) setRead(next);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  useEffect(() => {
    if (!paidNote) return;
    const later = window.setTimeout(reload, AFTER_PAYMENT_READ_MS);
    return () => window.clearTimeout(later);
  }, [paidNote, reload]);

  // Nothing until it's known whether the workspace has the section.
  if (!read || (!read.ok && read.failure === 'off')) return null;

  return (
    <Card id="add-ons" className="scroll-mt-6">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {read.ok ? (
          <AddOnsBody addOns={read.addOns} paidNote={paidNote} onChange={reload} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('readFailed')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function AddOnsBody({
  addOns,
  paidNote,
  onChange,
}: {
  addOns: BillingAddOns;
  paidNote: boolean;
  onChange: () => void;
}) {
  const t = useTranslations('settings.addOns');
  const [tab, setTab] = useState<AddOnKind>('ai');
  // The pack picked on each tab; its Most picked one to start with.
  const [picked, setPicked] = useState<Record<AddOnKind, string | null>>(() => ({
    ai: firstPick(addOns.packs, 'ai'),
    storage: firstPick(addOns.packs, 'storage'),
  }));
  const { busy, confirming, setConfirming, message, buy, start } = useAddOnPurchase(
    t('storageAdded'),
    onChange,
  );

  const canBuy = addOns.isAdmin && addOns.buy === 'open';
  const packs = addOns.packs.filter((p) => p.kind === tab);
  const chosen = packs.find((p) => p.id === picked[tab] && p.available) ?? null;

  function onContinue() {
    if (chosen) start(chosen);
  }

  return (
    <>
      {addOns.credit && (
        <p className="text-sm font-medium">
          {t('credit', {
            amount: formatPackPrice(addOns.credit.leftCents, 'usd'),
            date: formatDate(addOns.credit.expiresAt),
          })}
        </p>
      )}
      {paidNote && <p className="text-sm text-muted-foreground">{t('paidNote')}</p>}

      <div className="space-y-3">
        <div
          role="group"
          aria-label={t('tabs.label')}
          className="inline-flex rounded-lg border bg-muted/40 p-0.5"
        >
          {(['ai', 'storage'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={tab === kind}
              onClick={() => setTab(kind)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                // Picked: black in light, white in dark, as the plan tabs above (#1806).
                tab === kind
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`tabs.${kind}`)}
            </button>
          ))}
        </div>

        <div
          role="radiogroup"
          aria-label={t('packsLabel', { kind: tab })}
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
        <p className="text-xs text-muted-foreground">
          {t(tab === 'ai' ? 'monthlyLimitNote' : 'storageNote')}
        </p>
      </div>

      {canBuy ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">{t('paidWith')}</p>
          <Button onClick={onContinue} disabled={!chosen || busy}>
            {busy && !confirming ? t('starting') : t('continue')}
          </Button>
        </div>
      ) : (
        <p className="border-t pt-4 text-sm text-muted-foreground">
          {!addOns.isAdmin ? t('askAdmin') : addOns.buy === 'trial' ? t('trial') : t('noPlan')}
        </p>
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

      {addOns.purchases && <PurchaseHistory purchases={addOns.purchases} />}

      <Dialog
        open={confirming != null}
        onOpenChange={(open) => !open && !busy && setConfirming(null)}
      >
        {confirming && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {t('storageConfirm.title', {
                  gb: confirming.adds?.kind === 'storage' ? confirming.adds.gb : 0,
                })}
              </DialogTitle>
              <DialogDescription>
                {t('storageConfirm.description', {
                  price: formatPackPrice(confirming.priceCents, confirming.currency),
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
                {t('storageConfirm.cancel')}
              </Button>
              <Button onClick={() => void buy(confirming)} disabled={busy}>
                {busy ? t('starting') : t('storageConfirm.confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

/**
 * Buying a pack with Continue to payment, here and in the Get more window:
 * AI credits go on to Stripe Checkout; storage, charged at once to the
 * card on file, waits in `confirming` until `buy` is called again. `added`
 * says what a storage pack did; `onAdded` reads again.
 */
export function useAddOnPurchase(added: string, onAdded: () => void) {
  const t = useTranslations('settings.addOns');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<AddOnPackView | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function buy(pack: AddOnPackView) {
    setBusy(true);
    setMessage(null);
    // A dropped connection or a 502 answers as a failure, never a button left at "Opening…".
    const result = await startAddOnPurchase(pack.id).catch(
      () => ({ ok: false, failure: 'failed' }) as const,
    );
    if (result.ok && result.next === 'checkout') {
      // Stripe's page; the busy state stays until the browser leaves.
      window.location.assign(result.url);
      return;
    }
    setBusy(false);
    setConfirming(null);
    if (result.ok) {
      setMessage({ tone: 'ok', text: added });
      onAdded();
      return;
    }
    setMessage({
      tone: 'error',
      text:
        result.failure === 'payment_failed' && result.message
          ? result.message
          : t(`errors.${result.failure}`),
    });
  }

  /** Continue to payment: storage is charged at once, to the card on file, so it's said first. */
  function start(pack: AddOnPackView) {
    if (pack.kind === 'storage') setConfirming(pack);
    else void buy(pack);
  }

  return { busy, confirming, setConfirming, message, buy, start };
}

/** The tab's Most picked pack, else its first, while it can be bought. */
export function firstPick(packs: AddOnPackView[], kind: AddOnKind): string | null {
  const open = packs.filter((p) => p.kind === kind && p.available);
  return (open.find((p) => p.mostPicked) ?? open[0])?.id ?? null;
}

/** One pack, as the "Get more" window's cards show it: price, what it adds, how long, Most picked. */
export function PackCard({
  pack,
  selected,
  selectable,
  onSelect,
}: {
  pack: AddOnPackView;
  selected: boolean;
  selectable: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('settings.addOns');
  const adds =
    pack.adds?.kind === 'share'
      ? t('addsShare', { percent: pack.adds.percent })
      : pack.adds?.kind === 'limits'
        ? t('addsLimits', { count: pack.adds.count })
        : pack.adds?.kind === 'storage'
          ? t('addsStorage', { gb: pack.adds.gb })
          : null;
  const validity = !pack.available
    ? t('notOnSale')
    : pack.monthly
      ? t('monthly')
      : t('validMonths', { months: pack.validMonths ?? 12 });
  const live = selectable && pack.available;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={!live}
      onClick={onSelect}
      className={cn(
        'relative rounded-xl border bg-card p-3 text-left transition-colors',
        live && 'hover:bg-accent/50',
        !live && 'cursor-default',
        !pack.available && 'opacity-60',
        selected && 'border-foreground ring-1 ring-foreground',
      )}
    >
      <span className="block text-lg font-semibold tabular-nums">
        {formatPackPrice(pack.priceCents, pack.currency)}
      </span>
      {adds && <span className="mt-0.5 block text-xs">{adds}</span>}
      <span className="mt-1 block text-[11px] text-muted-foreground">{validity}</span>
      {pack.mostPicked && (
        <span className="absolute -top-2.5 right-2 rounded-full bg-emerald-100 px-2 text-[10.5px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
          {t('mostPicked')}
        </span>
      )}
    </button>
  );
}

/** The packs bought, newest first (Admins only): date, pack, price, status, what's left, invoice. */
function PurchaseHistory({ purchases }: { purchases: AddOnPurchaseView[] }) {
  const t = useTranslations('settings.addOns.history');
  return (
    <div className="space-y-2 border-t pt-4">
      <h3 className="text-sm font-medium">{t('title')}</h3>
      {purchases.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('date')}</TableHead>
              <TableHead>{t('pack')}</TableHead>
              <TableHead>{t('price')}</TableHead>
              <TableHead>{t('status')}</TableHead>
              <TableHead>{t('left')}</TableHead>
              <TableHead className="text-right">{t('invoice')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purchases.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="whitespace-nowrap">{formatDate(p.createdAt)}</TableCell>
                <TableCell>
                  {p.kind === 'ai'
                    ? t('packAi', { price: formatPackPrice(p.packPriceCents, p.currency) })
                    : t('packStorage', { gb: p.gb ?? 0 })}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatPackPrice(p.paidCents ?? p.packPriceCents, p.currency)}
                </TableCell>
                <TableCell>
                  <Badge variant={STATE_VARIANT[p.state]}>{t(`states.${p.state}`)}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {p.creditLeftCents != null
                    ? t('creditLeft', { amount: formatPackPrice(p.creditLeftCents, p.currency) })
                    : p.kind === 'storage' && p.state === 'active' && p.until
                      ? t('until', { date: formatDate(p.until) })
                      : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {p.hasInvoice ? (
                    <a
                      href={`/api/add-ons/invoice/${p.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('download')}
                      title={t('download')}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
