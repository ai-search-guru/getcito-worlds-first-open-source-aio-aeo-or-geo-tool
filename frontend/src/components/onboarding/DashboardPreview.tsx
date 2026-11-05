'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { ChevronsUpDown } from 'lucide-react';
import { dashboardNav } from '@/config/dashboard';
import { siteConfig } from '@/config/site';
import {
  getDashboardNavGroupLabel,
  getDashboardNavLabel,
  shouldShowDashboardNavItem,
} from '@/lib/dashboardNavigation';
import { getSiteIconUrl } from '@/lib/siteIcon';
import { cn } from '@/lib/utils';
import { isDashboardHomeItem } from '@/config/home';
import { useChatAgentic } from '@/components/context/ChatAgenticProvider';

export interface DashboardPreviewCompetitor {
  name: string;
  domain: string;
}

interface DashboardPreviewProps {
  brandName: string;
  domain: string;
  topics: string[];
  promptCount: number;
  competitors: DashboardPreviewCompetitor[];
}

const MAX_ROWS = 6;

/**
 * The dashboard a new user is being set up for, drawn behind the onboarding
 * wizard. It fills in as the wizard does — brand, topics, prompt count,
 * competitors — so the steps read as configuring a real panel rather than
 * filling in forms that lead somewhere unstated.
 *
 * Purely presentational: it renders the real navigation from dashboardNav but
 * reads no plan, brand or tracking state, because none exists yet. Metrics are
 * placeholder bars, never numbers — nothing has been measured at this point.
 * Agent Center is in it only with the new Chat on (CHAT_AGENTIC), as in the
 * menu the wizard leads to.
 */
export function DashboardPreview({
  brandName,
  domain,
  topics,
  promptCount,
  competitors,
}: DashboardPreviewProps) {
  const t = useTranslations('nav');
  const chatAgentic = useChatAgentic();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const logoSrc =
    mounted && resolvedTheme === 'dark'
      ? '/brand/icons/getcito-icon-dark-512.png'
      : '/brand/icons/getcito-icon-512.png';

  const name = brandName.trim();
  const shownTopics = topics.slice(0, MAX_ROWS);
  const shownCompetitors = competitors.slice(0, MAX_ROWS - 1);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <aside className="getcito-sidebar flex h-full w-60 shrink-0 flex-col border-r bg-sidebar">
        <div className="flex h-16 items-center gap-2 border-b px-3">
          <Image src={logoSrc} alt="" width={24} height={24} className="h-6 w-6 shrink-0" />
          <span className="truncate font-semibold">{siteConfig.name}</span>
        </div>

        <div className="border-b px-2 py-2">
          <div className="flex items-center gap-2 rounded-md border px-2 py-1.5">
            <BrandMark name={name} domain={domain} />
            {name ? (
              <span className="flex-1 truncate text-sm font-medium">{name}</span>
            ) : (
              <Bar className="h-3 flex-1" />
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </div>
        </div>

        <div className="flex-1 px-2 py-3">
          {dashboardNav.map((group, i) => (
            <div key={i} className="mb-4">
              {group.title && (
                <p className="mb-1 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {getDashboardNavGroupLabel(group.title, t)}
                </p>
              )}
              {!group.title && i > 0 && <div className="mb-2 h-px bg-border" />}
              <div className="space-y-0.5">
                {group.items
                  .filter((item) =>
                    shouldShowDashboardNavItem(
                      item,
                      { shoppingModeEnabled: false },
                      new Set(),
                      chatAgentic,
                    ),
                  )
                  .map((item) => (
                    <div
                      key={item.href}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-2 py-1.5 text-[13px] font-medium',
                        isDashboardHomeItem(item.href)
                          ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                          : 'text-muted-foreground',
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{getDashboardNavLabel(item.title, t)}</span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="flex-1 space-y-6 overflow-hidden p-8">
        <div className="flex items-center gap-3">
          <BrandMark name={name} domain={domain} size="lg" />
          <div className="space-y-1">
            <p className="text-2xl font-bold tracking-tight">{t('insights')}</p>
            {name ? (
              <p className="text-sm text-muted-foreground">
                {name}
                {domain && ` · ${domain}`}
                {promptCount > 0 && ` · ${promptCount} prompts`}
              </p>
            ) : (
              <Bar className="h-3 w-48" />
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-3 rounded-xl border bg-card p-4">
              <Bar className="h-3 w-20" />
              <Bar className="h-7 w-16" />
              <Bar className="h-2 w-24" />
            </div>
          ))}
        </div>

        <div className="rounded-xl border bg-card p-5">
          <Bar className="mb-5 h-3 w-32" />
          <div className="flex h-40 items-end gap-2">
            {[38, 45, 42, 55, 52, 60, 58, 66, 63, 70, 68, 74].map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-muted" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <PreviewList title={t('topics')} empty={shownTopics.length === 0}>
            {shownTopics.map((topic) => (
              <Row key={topic} label={topic} />
            ))}
          </PreviewList>

          <PreviewList title={t('competitors')} empty={!name}>
            {name && <Row label={name} icon={<BrandMark name={name} domain={domain} />} strong />}
            {shownCompetitors.map((c) => (
              <Row
                key={`${c.name}-${c.domain}`}
                label={c.name}
                icon={<BrandMark name={c.name} domain={c.domain} />}
              />
            ))}
          </PreviewList>
        </div>
      </main>
    </div>
  );
}

function Bar({ className }: { className?: string }) {
  return <div className={cn('rounded-md bg-muted', className)} />;
}

function BrandMark({
  name,
  domain,
  size = 'sm',
}: {
  name: string;
  domain: string;
  size?: 'sm' | 'lg';
}) {
  const box = size === 'lg' ? 'h-10 w-10 rounded-lg' : 'h-5 w-5 rounded';
  if (domain) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img src={getSiteIconUrl(domain, 64)} alt="" className={cn(box, 'shrink-0')} />
    );
  }
  return (
    <div
      className={cn(
        box,
        'flex shrink-0 items-center justify-center bg-muted text-[10px] font-semibold text-muted-foreground',
      )}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function PreviewList({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="mb-4 text-sm font-medium">{title}</p>
      <div className="space-y-3">
        {empty
          ? Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Bar className="h-3 flex-1" />
                <Bar className="h-2 w-24" />
              </div>
            ))
          : children}
      </div>
    </div>
  );
}

function Row({ label, icon, strong }: { label: string; icon?: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center gap-3 duration-500 animate-in fade-in">
      {icon}
      <span className={cn('flex-1 truncate text-sm', strong && 'font-medium')}>{label}</span>
      <Bar className="h-2 w-24" />
    </div>
  );
}
