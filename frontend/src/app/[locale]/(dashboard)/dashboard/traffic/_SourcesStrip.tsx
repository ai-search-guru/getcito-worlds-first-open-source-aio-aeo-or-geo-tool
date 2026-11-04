'use client';

import { useTranslations } from 'next-intl';
import { Code, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { SourceCard } from './_SourceCard';
import { BotsSource } from './_BotsConnect';
import { formatRelative } from '@/lib/formatRelative';
import { useIntegrationConnect } from '@/hooks/useIntegrationConnect';
import type { IntegrationProvider, SourceState } from '@/lib/actions/integrations';
import type { TrafficSources } from '@/lib/actions/traffic';
import {
  INTEGRATIONS_SETTINGS_PATH,
  googleSourceStatus,
  snippetStateOf,
  sourceHost,
} from '@/lib/trafficSources';

/**
 * Google Analytics or Google Search Console: connected with its property and
 * last sync, syncing with how long the first data takes, or a Connect that
 * runs the Settings OAuth flow in a popup, here. Connections stay org-wide.
 * Also on Product Visibility's strip, which says what each one adds there
 * (`pitch`, its line while not connected).
 */
export function GoogleSource({
  provider,
  state,
  domain,
  canConnect,
  onConnected,
  pitch,
}: {
  provider: IntegrationProvider;
  state: SourceState;
  domain: string | undefined;
  canConnect: boolean;
  onConnected: () => void;
  pitch?: string;
}) {
  const t = useTranslations('traffic.sources');
  const tCommon = useTranslations('common');
  const isGa = provider === 'google-analytics';
  const title = isGa ? t('ga') : t('gsc');
  const { connecting, connect } = useIntegrationConnect(provider, {
    label: title,
    callbackUrl: () => window.location.href,
    onStatus: (status) => {
      if (status === 'connected') onConnected();
    },
  });

  const manage = (
    <Link
      href={INTEGRATIONS_SETTINGS_PATH}
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 text-xs')}
    >
      {t('manage')}
    </Link>
  );

  const status = googleSourceStatus(state);
  if (status === 'connected' || status === 'syncing') {
    const host = sourceHost(provider, state.property, domain);
    return (
      <SourceCard
        tone={status === 'connected' ? 'on' : 'sync'}
        title={title}
        line={
          status === 'connected'
            ? t('synced', {
                property: t('property', { host, source: isGa ? 'GA4' : 'GSC' }),
                when: formatRelative(state.lastDataAt, tCommon),
              })
            : isGa
              ? t('syncingGa')
              : t('syncingGsc')
        }
        action={manage}
      />
    );
  }
  if (status === 'unmapped') {
    return <SourceCard tone="off" title={title} line={t('unmapped')} action={manage} />;
  }
  if (status === 'not_configured') {
    return <SourceCard tone="off" title={title} line={t('notConfigured')} />;
  }
  return (
    <SourceCard
      tone="off"
      title={title}
      line={pitch ?? (isGa ? t('notConnectedGa') : t('notConnectedGsc'))}
      action={
        // A span carries the tooltip: a disabled button gets no hover.
        <span title={canConnect ? undefined : t('connectNotAllowed')}>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={!canConnect || connecting}
            onClick={() => void connect()}
          >
            {connecting && <Loader2 className="h-3 w-3 animate-spin" />}
            {connecting ? t('connecting') : t('connect')}
          </Button>
        </span>
      }
    />
  );
}

/**
 * The data sources strip (AT-001): what feeds the page — the tracking
 * snippet, Google Analytics, Google Search Console and AI bots — and what's
 * missing, with a way to connect it without leaving the page (fixes F8).
 * The snippet is active, installed and quiet (the home page check found it,
 * or it sent a visit before: 00433), or not detected on the brand's domain;
 * its code moves behind its Code button once it's seen (F3). While the
 * page's first check of the home page runs, it says so. AI bots come from
 * the brand's Cloudflare or Vercel (AT-010).
 */
export function SourcesStrip({
  brandId,
  sources,
  domain,
  snippetChecking = false,
  hasTrackingCode,
  canConnect,
  onShowCode,
  onConnected,
  botsRevision,
  onBotsChanged,
}: {
  brandId: string;
  /** Null while loading. */
  sources: TrafficSources | null;
  /** The brand's primary domain, for the GA4 property line and the snippet's. */
  domain: string | undefined;
  /** The page's first check of the home page for the snippet is running. */
  snippetChecking?: boolean;
  hasTrackingCode: boolean;
  canConnect: boolean;
  onShowCode: () => void;
  onConnected: () => void;
  /** Bumped when an AI-bot connection is made or revoked on the page. */
  botsRevision?: number;
  onBotsChanged?: () => void;
}) {
  const t = useTranslations('traffic.sources');
  const tCommon = useTranslations('common');

  if (!sources) {
    return <Skeleton className="h-[62px] w-full rounded-xl" />;
  }

  const snippet = snippetStateOf(sources);
  const seen = snippet !== 'not_detected';
  const checking = snippetChecking && !seen;
  return (
    <section
      aria-label={t('label')}
      // The 1px gaps over the border colour draw the lines between cards, in
      // one row of four on a wide screen and two by two below it.
      className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 min-[75rem]:grid-cols-4"
    >
      <SourceCard
        tone={seen ? 'on' : checking ? 'sync' : 'off'}
        title={t('snippet')}
        line={
          checking
            ? t('snippetChecking')
            : snippet === 'active'
              ? t('snippetActive', { when: formatRelative(sources.snippetLastVisitAt, tCommon) })
              : snippet === 'installed_quiet'
                ? t('snippetQuiet')
                : domain
                  ? t('snippetNotDetectedOn', { domain })
                  : t('snippetNotDetected')
        }
        action={
          hasTrackingCode ? (
            <Button
              variant={seen ? 'outline' : 'default'}
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={onShowCode}
            >
              <Code className="h-3 w-3" />
              {seen ? t('code') : t('install')}
            </Button>
          ) : undefined
        }
      />
      <GoogleSource
        provider="google-analytics"
        state={sources.ga}
        domain={domain}
        canConnect={canConnect}
        onConnected={onConnected}
      />
      <GoogleSource
        provider="google-search-console"
        state={sources.gsc}
        domain={domain}
        canConnect={canConnect}
        onConnected={onConnected}
      />
      <BotsSource
        brandId={brandId}
        canConnect={canConnect}
        revision={botsRevision}
        onChanged={onBotsChanged}
      />
    </section>
  );
}
