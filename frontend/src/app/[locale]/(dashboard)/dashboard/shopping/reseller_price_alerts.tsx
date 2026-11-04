'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ExternalLink, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { numberFormat } from '@/lib/numberFormat';
import {
  RESELLER_PRICE_MIN_DISCOUNT,
  type ResellerPriceAlert,
} from '@/lib/shoppingResellerPriceAlert';

function formatPrice(locale: string, amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    // Not an ISO 4217 code: show the amount with the code as stored.
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount)} ${currency}`;
  }
}

/** A merchant's price and its link, opened in a new tab. */
function MerchantPrice({
  label,
  price,
  url,
  domain,
  emphasis = false,
}: {
  label: string;
  price: string;
  url: string | null;
  domain: string | null;
  emphasis?: boolean;
}) {
  const t = useTranslations('shopping.resellerPrices');
  const name = domain ?? t('unknownMerchant');
  return (
    <div className="min-w-0">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={
          emphasis
            ? 'block font-semibold tabular-nums text-foreground'
            : 'block font-medium tabular-nums text-foreground'
        }
      >
        {price}
      </span>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('openLink', { merchant: name })}
          className="inline-flex max-w-full items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-primary"
        >
          <span className="truncate">{name}</span>
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
        </a>
      ) : (
        <span className="block truncate text-xs text-muted-foreground">{name}</span>
      )}
    </div>
  );
}

/**
 * "Reseller cheaper than you" (#1277): the brand's products another merchant
 * sells for at least 5% less than the lowest price on its own store.
 */
export function ResellerPriceAlerts({
  alerts,
  loading,
}: {
  alerts: ResellerPriceAlert[];
  loading: boolean;
}) {
  const t = useTranslations('shopping.resellerPrices');
  const locale = useLocale();
  const f = numberFormat(locale);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
          <TrendingDown className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t('title')}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t('description', { percent: f.percent(RESELLER_PRICE_MIN_DISCOUNT * 100, 0) })}
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="max-h-[360px] divide-y overflow-y-auto rounded-md border">
            {alerts.map((alert, i) => (
              <li
                key={`${i}|${alert.currency}|${alert.productTitle ?? ''}`}
                className="space-y-2 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className="line-clamp-2 text-sm font-medium text-foreground"
                    title={alert.productTitle ?? undefined}
                  >
                    {alert.productTitle ?? t('untitled')}
                  </span>
                  <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium tabular-nums text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                    {t('lowerBy', { percent: f.percent(alert.discount * 100, 0) })}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <MerchantPrice
                    label={t('yourStore')}
                    price={formatPrice(locale, alert.ownPrice, alert.currency)}
                    url={alert.ownUrl}
                    domain={alert.ownDomain}
                  />
                  <MerchantPrice
                    label={t('reseller')}
                    price={formatPrice(locale, alert.resellerPrice, alert.currency)}
                    url={alert.resellerUrl}
                    domain={alert.resellerDomain}
                    emphasis
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
