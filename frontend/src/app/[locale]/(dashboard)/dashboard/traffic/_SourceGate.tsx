'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plug, type LucideIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';
import { useIntegrationConnect } from '@/hooks/useIntegrationConnect';
import type { IntegrationProvider, SourceState } from '@/lib/actions/integrations';
import {
  INTEGRATIONS_SETTINGS_PATH,
  googleSourceStatus,
  sectionsNeeding,
  sourceHost,
} from '@/lib/trafficSources';
import { MetricCard } from '../insights/_KpiCards';

/**
 * What a section that needs Google Analytics or Google Search Console shows
 * (AT-016, spec §3.8b), so that none is ever blank: a "Needs …" tag beside
 * its title, always, and — until the source has data — a state in place of
 * the data that says what's missing and what happens next.
 *
 * Sections show the full state; KPI cards the compact one (AT-017). The
 * partial note comes with the sections that need it.
 */

const isGa = (provider: IntegrationProvider) => provider === 'google-analytics';

/** "Needs Google Analytics": shown even when connected, so users learn where each number comes from. */
export function NeedsTag({ provider }: { provider: IntegrationProvider }) {
  const t = useTranslations('traffic');
  return (
    <span className="whitespace-nowrap rounded-md border px-1.5 text-[11px] font-medium leading-4 text-muted-foreground">
      {t('gate.needs', { source: isGa(provider) ? t('sources.ga') : t('sources.gsc') })}
    </span>
  );
}

function StateBlock({
  icon,
  title,
  body,
  action,
  footer,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  footer?: string;
}) {
  return (
    <div className="flex min-h-[120px] flex-col items-start justify-center gap-1.5 px-6 py-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <p className="max-w-[460px] text-xs text-muted-foreground">{body}</p>
      {action}
      {footer && <p className="text-xs text-muted-foreground">{footer}</p>}
    </div>
  );
}

const plugIcon = (
  <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-lg border bg-card text-muted-foreground">
    <Plug className="h-3.5 w-3.5" />
  </span>
);

/**
 * The state a section shows while its source has no data for it: not
 * connected (with Connect, in place), syncing (with the expected wait),
 * connected with no property for this brand (with Manage), or a server
 * without the keys to connect at all. Renders nothing once the source is
 * connected and synced; the section shows its data, or `SourceNoData`.
 */
export function SourceUnavailable({
  provider,
  state,
  domain,
  canConnect,
  onConnected,
}: {
  provider: IntegrationProvider;
  state: SourceState;
  /** The brand's primary domain, for the property line. */
  domain: string | undefined;
  /** Admins and managers; the server refuses anyone else. */
  canConnect: boolean;
  onConnected: () => void;
}) {
  const t = useTranslations('traffic');
  const source = isGa(provider) ? t('sources.ga') : t('sources.gsc');
  const { connecting, connect } = useIntegrationConnect(provider, {
    label: source,
    callbackUrl: () => window.location.href,
    onStatus: (status) => {
      if (status === 'connected') onConnected();
    },
  });

  const status = googleSourceStatus(state);
  if (status === 'connected') return null;

  if (status === 'syncing') {
    return (
      <StateBlock
        icon={<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        title={isGa(provider) ? t('gate.syncingTitleGa') : t('gate.syncingTitleGsc')}
        body={isGa(provider) ? t('gate.syncingGa') : t('gate.syncingGsc')}
        footer={t('gate.connectedTo', {
          property: t('sources.property', {
            host: sourceHost(provider, state.property, domain),
            source: isGa(provider) ? 'GA4' : 'GSC',
          }),
        })}
      />
    );
  }

  if (status === 'unmapped') {
    return (
      <StateBlock
        icon={plugIcon}
        title={t('gate.unmappedTitle')}
        body={t('gate.unmapped', { source })}
        action={
          <Link
            href={INTEGRATIONS_SETTINGS_PATH}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 text-xs')}
          >
            {t('sources.manage')}
          </Link>
        }
      />
    );
  }

  if (status === 'not_configured') {
    return (
      <StateBlock
        icon={plugIcon}
        title={t('gate.notConfiguredTitle')}
        body={t('gate.notConfigured', { source })}
      />
    );
  }

  const sections = new Intl.ListFormat('en', { type: 'conjunction' }).format(
    sectionsNeeding(provider).map((section) => t(`gate.sections.${section}`)),
  );
  return (
    <StateBlock
      icon={plugIcon}
      title={t('gate.notConnectedTitle', { source })}
      body={isGa(provider) ? t('gate.notConnectedGa') : t('gate.notConnectedGsc')}
      action={
        // A span carries the tooltip: a disabled button gets no hover.
        <span title={canConnect ? undefined : t('sources.connectNotAllowed')}>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={!canConnect || connecting}
            onClick={() => void connect()}
          >
            {connecting && <Loader2 className="h-3 w-3 animate-spin" />}
            {connecting ? t('sources.connecting') : t('gate.connect', { source })}
          </Button>
        </span>
      }
      footer={sections ? t('gate.neededFor', { sections }) : undefined}
    />
  );
}

/**
 * A connected source with no rows for the range: says so, with a way to
 * widen it. Never an empty table without text.
 */
export function SourceNoData({
  provider,
  onShowAllTime,
}: {
  provider: IntegrationProvider;
  /** Absent when the range is already all time. */
  onShowAllTime?: () => void;
}) {
  const t = useTranslations('traffic');
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-6 pb-4 text-xs text-muted-foreground">
      <span>
        {t('gate.noData', { source: isGa(provider) ? t('sources.ga') : t('sources.gsc') })}
      </span>
      {onShowAllTime && (
        <button
          type="button"
          onClick={onShowAllTime}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t('gate.showAllTime')}
        </button>
      )}
    </div>
  );
}

/**
 * A KPI card whose source has no data for it yet: the compact state (spec
 * §3.8b). The card keeps its label and shows "—", and one line says what's
 * missing — "Needs Google Analytics" with Connect, "Syncing…" with the wait,
 * a property to choose with Manage, or a server without the keys. Renders
 * nothing once the source is connected and synced; the card shows its data.
 */
export function SourceKpiCard({
  label,
  tooltip,
  icon,
  provider,
  state,
  canConnect,
  onConnected,
}: {
  label: string;
  tooltip: string;
  icon: LucideIcon;
  provider: IntegrationProvider;
  state: SourceState;
  canConnect: boolean;
  onConnected: () => void;
}) {
  const t = useTranslations('traffic');
  const source = isGa(provider) ? t('sources.ga') : t('sources.gsc');
  const { connecting, connect } = useIntegrationConnect(provider, {
    label: source,
    callbackUrl: () => window.location.href,
    onStatus: (status) => {
      if (status === 'connected') onConnected();
    },
  });

  const status = googleSourceStatus(state);
  if (status === 'connected') return null;

  const card = (sub: ReactNode, footer?: ReactNode) => (
    <MetricCard
      label={label}
      tooltip={tooltip}
      icon={icon}
      value="—"
      sub={sub}
      // The sparkline's height, so a card with a button and one without line up.
      footer={footer ?? <div className="h-6" aria-hidden />}
    />
  );

  if (status === 'syncing') {
    return card(
      <span className="flex items-center gap-1.5">
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        <span className="truncate">
          {t('kpis.syncing')} · {isGa(provider) ? t('kpis.waitGa') : t('kpis.waitGsc')}
        </span>
      </span>,
    );
  }

  if (status === 'unmapped') {
    return card(
      t('kpis.unmapped'),
      <Link
        href={INTEGRATIONS_SETTINGS_PATH}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-6 self-start text-xs')}
      >
        {t('sources.manage')}
      </Link>,
    );
  }

  if (status === 'not_configured') return card(t('sources.notConfigured'));

  return card(
    t('gate.needs', { source }),
    // A span carries the tooltip: a disabled button gets no hover.
    <span className="self-start" title={canConnect ? undefined : t('sources.connectNotAllowed')}>
      <Button
        size="sm"
        variant="outline"
        className="h-6 gap-1.5 text-xs"
        disabled={!canConnect || connecting}
        onClick={() => void connect()}
      >
        {connecting && <Loader2 className="h-3 w-3 animate-spin" />}
        {connecting ? t('sources.connecting') : t('sources.connect')}
      </Button>
    </span>,
  );
}
