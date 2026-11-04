'use client';

import { useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import type { PromptResultWithText } from '@/lib/actions/tracking';
import { Markdown } from '@/components/ui/markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { stripEntityMarkup } from '@/lib/entityMarkup';
import { formatSearchQuerySource, visibleSearchQueries } from './queryFanout';

/** Past this length the compact view folds the answer behind "Show full response". */
const FOLD_AT_CHARS = 1200;

/**
 * One AI answer's body: the response itself, the sources it cited and the
 * search queries the engine fanned out to.
 *
 * `page` is the standalone result page's card layout; `compact` sits inside a
 * run row on the prompt detail page, where several can be open at once, so it
 * drops the card chrome and folds long answers.
 */
export function ResponseDetail({
  result,
  variant,
}: {
  result: PromptResultWithText;
  variant: 'page' | 'compact';
}) {
  const compact = variant === 'compact';
  const response = stripEntityMarkup(result.response);
  const searchQueries = visibleSearchQueries(result.searchQueries);
  const foldable = compact && response.length > FOLD_AT_CHARS;
  const [unfolded, setUnfolded] = useState(false);
  const folded = foldable && !unfolded;

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      <Section title="AI Response" compact={compact}>
        <div className={cn('relative', folded && 'max-h-72 overflow-hidden')}>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <Markdown>{response}</Markdown>
          </div>
          {folded && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent" />
          )}
        </div>
        {foldable && (
          <Button
            variant="link"
            size="sm"
            className="mt-1 h-auto px-0 text-xs"
            onClick={() => setUnfolded((v) => !v)}
          >
            {unfolded ? 'Show less' : 'Show full response'}
          </Button>
        )}
      </Section>

      {result.citations.length > 0 && (
        <Section title={`Citations (${result.citations.length})`} compact={compact}>
          <div className="space-y-2">
            {result.citations.map((cite, i) => (
              <a
                key={i}
                href={cite.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'flex items-start gap-3 rounded-lg border text-sm transition-colors hover:bg-muted/50',
                  compact ? 'px-3 py-2' : 'px-4 py-3',
                )}
              >
                <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{cite.title || cite.url}</p>
                  <p className="truncate text-xs text-muted-foreground">{cite.url}</p>
                </div>
              </a>
            ))}
          </div>
        </Section>
      )}

      {searchQueries.length > 0 && (
        <Section title={`Query fan-out (${searchQueries.length})`} compact={compact}>
          <div className="space-y-2">
            {searchQueries.map((item, i) => (
              <div
                key={`${item.query}-${i}`}
                className={cn('rounded-lg border text-sm', compact ? 'px-3 py-2' : 'px-4 py-3')}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <Search className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <p className="min-w-0 break-words font-medium">{item.query.trim()}</p>
                  </div>
                  <Badge variant="secondary" className="w-fit shrink-0 text-xs">
                    {formatSearchQuerySource(item, result.platform)}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  compact,
  children,
}: {
  title: string;
  compact: boolean;
  children: React.ReactNode;
}) {
  if (compact) {
    return (
      <section>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {children}
      </section>
    );
  }
  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="mb-4 text-sm font-medium">{title}</h2>
        {children}
      </CardContent>
    </Card>
  );
}
