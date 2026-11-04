'use client';

/**
 * Shared presentational cells for citation-source tables. Used by the
 * citations page and the prompt detail Top Sources card so a domain renders
 * identically (favicon, category badge, platform dots) everywhere.
 */

import { useState } from 'react';
import Image from 'next/image';
import { Globe } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getSiteIconUrl } from '@/lib/siteIcon';
import { SOURCE_CATEGORY_LABELS, type SourceCategory } from '@/lib/citations/classify';
import {
  AIProviderAvatar,
  resolveAIProvider,
  type AIProviderKey,
} from '@/components/AiProviderAvatar';

// You in ink, the theme's primary, as Mentions marks your brand; the other
// categories in hues apart from one another, none of them violet.
export const CATEGORY_BADGE_CLASSES: Record<SourceCategory, string> = {
  you: 'border-primary/30 bg-primary/10 text-foreground',
  competitor: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  editorial: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  forum: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
  social: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  review: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
  institutional: 'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300',
  other: 'border-slate-400/30 bg-slate-400/10 text-slate-700 dark:text-slate-300',
};

export function CategoryBadge({ category }: { category: SourceCategory }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] font-medium capitalize whitespace-nowrap',
        CATEGORY_BADGE_CLASSES[category],
      )}
    >
      {SOURCE_CATEGORY_LABELS[category]}
    </Badge>
  );
}

function ProviderDot({ provider }: { provider: AIProviderKey }) {
  return <AIProviderAvatar provider={provider} />;
}

/**
 * Collapse model identifiers down to their underlying provider so the column
 * shows at most one dot per platform (ChatGPT, Claude, Gemini, ...). There
 * are only 7 known providers, so the row width stays stable regardless of
 * how many raw models fed into the domain.
 */
export function PlatformsCell({ models }: { models: string[] }) {
  if (models.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const providers = Array.from(new Set(models.map((m) => resolveAIProvider(m)))).sort();
  return (
    <div className="flex items-center gap-1">
      {providers.map((p) => (
        <ProviderDot key={p} provider={p} />
      ))}
    </div>
  );
}

export function UsageBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${clamped}%` }} />
      </div>
      <span className="text-xs tabular-nums text-foreground">{pct.toFixed(1)}%</span>
    </div>
  );
}

export function DomainFavicon({ domain }: { domain: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded border bg-muted">
        <Globe className="h-3 w-3 text-muted-foreground" />
      </div>
    );
  }
  return (
    <Image
      src={getSiteIconUrl(domain, 64)}
      alt=""
      width={20}
      height={20}
      unoptimized
      className="h-5 w-5 rounded-sm border bg-white object-contain"
      onError={() => setErrored(true)}
    />
  );
}
