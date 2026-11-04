'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { Check, Clock, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingDots } from '@/components/ui/loading-dots';
import { getSiteTrust } from '@/lib/actions/audits';
import {
  SITE_TRUST_CHECKS,
  SITE_TRUST_RECHECK_MS,
  type SiteTrust,
  type SiteTrustCheck,
} from '@/lib/content/siteTrust';
import { cn } from '@/lib/utils';
import { useUpgradeGate } from '@/components/context/upgradeGate';

/**
 * Site trust (Content Editor Quality spec §8, CE-043): the brand's five
 * site-level checks, "Site trust {n}/5", each with the page that passes it
 * or what to add. Quality's "Fix in Site Audit" lands here (#site-trust),
 * and the score is worth 5 Trust points on every page.
 */
export function SiteTrustCard({ brandId }: { brandId: string }) {
  const t = useTranslations('audit.siteTrust');
  const format = useFormatter();
  const [trust, setTrust] = useState<SiteTrust | null>(null);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  // A read-only workspace (plan not active): Check again reads the site
  // again, a cost; it opens the upgrade dialog instead, and a partial read
  // isn't read again on its own.
  const { guard, isLocked } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  const load = useCallback(
    async (refresh: boolean) => {
      setChecking(refresh);
      try {
        setTrust(await getSiteTrust(brandId, refresh));
        setFailed(false);
      } catch (err) {
        console.error('Failed to read the site trust:', err);
        setFailed(true);
      } finally {
        setChecking(false);
      }
    },
    [brandId],
  );
  useEffect(() => {
    void load(false);
  }, [load]);

  // The API keeps a read for SITE_TRUST_RECHECK_MS when asked again, so Check
  // again would answer the same read: it waits, and says until when.
  const now = useNow({ updateInterval: 15_000 });
  const recheckAt = trust ? Date.parse(trust.checkedAt) + SITE_TRUST_RECHECK_MS : 0;
  const tooSoon = !!trust && now.getTime() < recheckAt;
  // A partial read (the site didn't answer all of it) is read again once
  // that wait is over, as its rows say; not while the workspace is read-only.
  const partial = trust?.complete === false;
  useEffect(() => {
    if (partial && !tooSoon && !isLocked) void load(false);
  }, [partial, tooSoon, isLocked, load]);

  // Quality's "Fix in Site Audit" lands here (#site-trust): once the card has
  // its read, and the cards above have theirs, it scrolls into view once.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!trust || scrolled.current || window.location.hash !== '#site-trust') return;
    scrolled.current = true;
    requestAnimationFrame(() => document.getElementById('site-trust')?.scrollIntoView());
  }, [trust]);

  return (
    <Card id="site-trust" className="scroll-mt-24">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">
            {trust ? t('title', { score: trust.score }) : t('titleLoading')}
          </CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={checking || !trust || tooSoon}
          aria-describedby={tooSoon ? 'site-trust-recheck' : undefined}
          onClick={guard(() => void load(true), { action: tActions('checkSiteTrust') })}
        >
          {checking && <LoadingDots className="mr-1.5" />}
          {t('checkAgain')}
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {!trust && !failed && (
          <p className="text-sm text-muted-foreground" role="status" aria-busy="true">
            <LoadingDots />
            <span className="sr-only">{t('loading')}</span>
          </p>
        )}
        {failed && !trust && (
          <p className="text-sm text-destructive" role="alert">
            {t('loadFailed')}{' '}
            <button type="button" className="underline" onClick={() => void load(false)}>
              {t('retry')}
            </button>
          </p>
        )}
        {trust && (
          <>
            <ul className="divide-y rounded-xl border">
              {SITE_TRUST_CHECKS.map((check) => (
                <CheckRow key={check} check={check} trust={trust} />
              ))}
            </ul>
            {failed && (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {t('refreshFailed')}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {t('checkedAt', {
                date: format.dateTime(new Date(trust.checkedAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
              {tooSoon && (
                <span id="site-trust-recheck">
                  {' · '}
                  {t('checkAgainAt', {
                    time: format.dateTime(new Date(recheckAt), { timeStyle: 'short' }),
                  })}
                </span>
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CheckRow({ check, trust }: { check: SiteTrustCheck; trust: SiteTrust }) {
  const t = useTranslations('audit.siteTrust');
  const format = useFormatter();
  const result = trust.checks[check];
  const ok = !!result?.ok;
  const url = check === 'authorPages' ? null : (trust.checks[check].url ?? null);
  const authors = check === 'authorPages' ? trust.checks.authorPages.authors : [];
  const withoutPage = authors.filter((a) => !a.url).map((a) => a.name);
  // With a partial read, a check that fails may only not have been read: no
  // advice to add what the site may already have. No authors at all isn't
  // the site's answer.
  const unread = !ok && trust.complete === false && (check !== 'authorPages' || authors.length > 0);

  let detail: string;
  if (unread) {
    detail = t('notAnswered');
  } else if (check === 'authorPages') {
    detail = !authors.length
      ? t('checks.authorPages.noAuthors')
      : ok
        ? t('checks.authorPages.ok', { count: authors.length })
        : t('checks.authorPages.missing', { names: format.list(withoutPage) });
  } else {
    detail = ok ? t(`checks.${check}.ok`) : t(`checks.${check}.missing`);
  }

  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5">
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
          ok
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
            : unread
              ? 'bg-muted text-muted-foreground'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
        )}
      >
        {ok ? (
          <Check className="h-3 w-3" />
        ) : unread ? (
          <Clock className="h-3 w-3" />
        ) : (
          <X className="h-3 w-3" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {t(`checks.${check}.name`)}
          <span className="sr-only">
            {' · '}
            {ok ? t('passes') : unread ? t('notAnsweredLabel') : t('missingLabel')}
          </span>
        </p>
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{detail}</p>
      </div>
      {url && ok && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('openLabel', { name: t(`checks.${check}.name`) })}
          className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {t('open')}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </li>
  );
}
