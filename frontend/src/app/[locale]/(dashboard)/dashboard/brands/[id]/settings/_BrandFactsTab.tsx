'use client';

import { useEffect, useId, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingDots } from '@/components/ui/loading-dots';
import { getBrandFacts, readBrandFactsAgain, setBrandFactStatus } from '@/lib/actions/brandFacts';
import {
  factValueText,
  isPrice,
  type BrandFact,
  type BrandFactsRead,
  type FactStatus,
} from '@/lib/content/brandFacts';
import { cn } from '@/lib/utils';
import { useUpgradeGate } from '@/components/context/upgradeGate';

/**
 * Brand settings › Brand facts (Quality spec §10, CE-047): the facts the API
 * read from the brand's own pricing, About and product pages, each with its
 * words on the page and where; a member approves or rejects each one (no
 * "approve all": the spec has each approved). Only approved facts still on
 * the site are compared with a page. "Read again" reads the site again, not
 * more than the API allows; nothing else here reads the site.
 */
export function BrandFactsTab({ brandId }: { brandId: string }) {
  const t = useTranslations('brands.settings.facts');
  const format = useFormatter();
  // Read again turns on when the API allows it, without a reload.
  const now = useNow({ updateInterval: 30_000 });
  const [read, setRead] = useState<BrandFactsRead | null>(null);
  const [failed, setFailed] = useState<'off' | 'failed' | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ids = useId();
  // A read-only workspace (plan not active): Approve, Reject and Read again
  // (it reads the site) open the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  useEffect(() => {
    let cancelled = false;
    getBrandFacts(brandId)
      .then((result) => {
        if (cancelled) return;
        if ('error' in result) setFailed(result.error === 'off' ? 'off' : 'failed');
        else setRead(result);
      })
      .catch(() => !cancelled && setFailed('failed'));
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const readAgain = async () => {
    setReading(true);
    try {
      const result = await readBrandFactsAgain(brandId);
      if ('error' in result) toast.error(t('readFailed'));
      else setRead(result);
    } catch {
      toast.error(t('readFailed'));
    } finally {
      setReading(false);
    }
  };

  /** The facts as kept after a review: its status, and the gone fact an approval replaces dropped. */
  const reviewed = (fact: BrandFact, status: FactStatus) => (prev: BrandFactsRead | null) =>
    prev && {
      ...prev,
      facts: prev.facts
        .filter((f) => !(status === 'approved' && f.id === fact.replaces?.id && f.gone))
        .map((f) => (f.id === fact.id ? { ...f, status, replaces: null } : f)),
    };

  const review = async (fact: BrandFact, status: 'approved' | 'rejected') => {
    setBusy(fact.id);
    try {
      const result = await setBrandFactStatus(fact.id, status);
      if (!('error' in result)) {
        setRead(reviewed(fact, result.status));
        return;
      }
      toast.error(t('reviewFailed'));
      // A read may have removed it meanwhile: the list as kept now.
      const again = await getBrandFacts(brandId);
      if (!('error' in again)) setRead(again);
    } catch {
      toast.error(t('reviewFailed'));
    } finally {
      setBusy(null);
    }
  };

  const valueOf = (fact: Pick<BrandFact, 'kind' | 'value' | 'quote'>) => {
    const text = factValueText(fact.kind, fact.value, fact.quote);
    if (fact.kind === 'trial') return t('trialDays', { days: Number(text) });
    if (!isPrice(fact)) return text;
    const { plan, period, billed, per } = fact.value;
    return [
      plan,
      `${text}${period ? ` ${t(`periods.${period}`)}` : ''}`,
      per ? t('perSeat') : null,
      billed ? t(`billed.${billed}`) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  };

  if (failed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{failed === 'off' ? t('off') : t('loadFailed')}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pending = read?.facts.filter((f) => f.status === 'pending') ?? [];
  const approved = read?.facts.filter((f) => f.status === 'approved') ?? [];
  const rejected = read?.facts.filter((f) => f.status === 'rejected') ?? [];
  // One thing at a time: a read of the site and a review would overwrite each other.
  const canReadAgain =
    !!read &&
    !reading &&
    busy === null &&
    (!read.recheckAt || Date.parse(read.recheckAt) <= now.getTime());

  const row = (fact: BrandFact) => (
    <li
      key={fact.id}
      aria-busy={busy === fact.id}
      className={cn('flex items-start gap-3 px-3 py-2.5 text-sm', busy === fact.id && 'opacity-60')}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium [overflow-wrap:anywhere]">
          <span className="mr-1.5 text-xs font-normal text-muted-foreground">
            {t(`kinds.${fact.kind}`)}
          </span>
          {fact.kind === 'claim' ? t('quoted', { quote: fact.quote }) : valueOf(fact)}
          {fact.gone && (
            <Badge variant="outline" className="ml-2 align-middle text-[11px] font-normal">
              {t('gone')}
            </Badge>
          )}
        </p>
        {fact.kind !== 'claim' && (
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {t('quoted', { quote: fact.quote })}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          <a
            href={fact.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            {t(`sources.${fact.sourceKind}`)}
          </a>
          {fact.replaces && (
            <>
              {' · '}
              {t('replaces', {
                value: valueOf({ kind: fact.kind, value: fact.replaces.value, quote: '' }),
              })}
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        {fact.status !== 'approved' && (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={busy !== null || reading}
            aria-label={t('approveFact', { fact: valueOf(fact) })}
            onClick={guard(() => void review(fact, 'approved'), {
              action: tActions('reviewBrandFacts'),
            })}
          >
            {t('approve')}
          </Button>
        )}
        {fact.status !== 'rejected' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            disabled={busy !== null || reading}
            aria-label={t('rejectFact', { fact: valueOf(fact) })}
            onClick={guard(() => void review(fact, 'rejected'), {
              action: tActions('reviewBrandFacts'),
            })}
          >
            {t('reject')}
          </Button>
        )}
      </div>
    </li>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!read ? (
          <div className="flex justify-center py-8">
            <LoadingDots size="md" label={t('loading')} className="text-muted-foreground" />
          </div>
        ) : read.noDomain ? (
          <p className="text-sm text-muted-foreground">{t('noDomain')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 text-xs text-muted-foreground">
                {read.checkedAt && (
                  <p>
                    {t('checked', {
                      date: format.dateTime(new Date(read.checkedAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {read.pages.map((page) => {
                    const name = t(`sources.${page.kind}`);
                    return (
                      <li key={page.kind}>
                        {page.url && page.status !== 'not_found' ? (
                          <a
                            href={page.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline-offset-2 hover:underline"
                          >
                            {name}
                          </a>
                        ) : (
                          name
                        )}
                        {t('pageStatusAfter', { status: t(`pageStatus.${page.status}`) })}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!canReadAgain}
                title={canReadAgain ? undefined : t('readAgainSoon')}
                onClick={guard(() => void readAgain(), { action: tActions('readBrandFacts') })}
              >
                {reading && <LoadingDots />}
                {t('readAgain')}
              </Button>
            </div>

            {read.paused && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                {t('aiPaused')}
              </p>
            )}

            {read.facts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
              <>
                {pending.length > 0 && (
                  <section aria-labelledby={`${ids}-pending`} className="space-y-2">
                    <h4 id={`${ids}-pending`} className="text-xs font-medium text-muted-foreground">
                      {t('toApprove', { count: pending.length })}
                    </h4>
                    <ul className="divide-y rounded-xl border">{pending.map(row)}</ul>
                  </section>
                )}
                {approved.length > 0 && (
                  <section aria-labelledby={`${ids}-approved`} className="space-y-2">
                    <h4
                      id={`${ids}-approved`}
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t('approved')}
                    </h4>
                    <ul className="divide-y rounded-xl border">{approved.map(row)}</ul>
                  </section>
                )}
                {rejected.length > 0 && (
                  <details className="space-y-2">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                      {t('rejected', { count: rejected.length })}
                    </summary>
                    <ul className="mt-2 divide-y rounded-xl border">{rejected.map(row)}</ul>
                  </details>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
