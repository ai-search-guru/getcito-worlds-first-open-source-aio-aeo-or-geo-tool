'use client';

import { useTranslations } from 'next-intl';
import type { AuditOpportunity, OpportunityReason } from '@/lib/actions/audits';
import { cn } from '@/lib/utils';

/**
 * The Opportunities inbox's filters (customer priorities item 11), by why a
 * page is listed: every row, the pages without a current audit (never
 * audited, or not in `staleDays`), those AI sends no visitors to, and those
 * a competitor is cited on. A template's row shows under All only.
 */
export const OPPORTUNITY_FILTERS = ['all', 'notAudited', 'noAiTraffic', 'competitorCited'] as const;
export type OpportunityFilter = (typeof OPPORTUNITY_FILTERS)[number];

const REASONS: Record<Exclude<OpportunityFilter, 'all'>, OpportunityReason['type'][]> = {
  notAudited: ['never_audited', 'stale_audit'],
  noAiTraffic: ['no_ai_traffic'],
  competitorCited: ['competitor_cited'],
};

/** Whether a row shows under the filter. */
export function matchesFilter(
  row: Pick<AuditOpportunity, 'reasons'>,
  filter: OpportunityFilter,
): boolean {
  if (filter === 'all') return true;
  return row.reasons.some((reason) => REASONS[filter].includes(reason.type));
}

/**
 * The filters as chips with their counts, All and those with rows; with Not
 * audited picked, what it means. `action` sits at the row's end (Audit all).
 */
export function OpportunityFilterChips({
  opportunities,
  filter,
  onFilter,
  staleDays,
  action,
}: {
  opportunities: Pick<AuditOpportunity, 'reasons'>[];
  filter: OpportunityFilter;
  onFilter: (filter: OpportunityFilter) => void;
  staleDays: number;
  action?: React.ReactNode;
}) {
  const t = useTranslations('audit.opportunities.filter');
  const chips = OPPORTUNITY_FILTERS.map((key) => ({
    key,
    count: opportunities.filter((row) => matchesFilter(row, key)).length,
  })).filter((chip) => chip.key === 'all' || chip.count > 0 || chip.key === filter);
  // No filter that would narrow the list: nothing to pick between.
  const narrows = chips.some(
    (chip) => chip.key !== 'all' && chip.count > 0 && chip.count < opportunities.length,
  );
  if (!narrows && filter === 'all') return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pb-3">
      <div role="radiogroup" aria-label={t('label')} className="flex flex-wrap gap-1.5">
        {chips.map(({ key, count }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={filter === key}
            onClick={() => onFilter(key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
              filter === key
                ? 'border-foreground bg-foreground text-background'
                : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {t(key)}
            <span
              className={cn(
                'tabular-nums',
                filter === key ? 'text-background/70' : 'text-muted-foreground/70',
              )}
            >
              {count}
            </span>
          </button>
        ))}
      </div>
      <span className="flex-1" />
      {filter === 'notAudited' && (
        <span className="text-xs text-muted-foreground">
          {t('notAuditedHint', { days: staleDays })}
        </span>
      )}
      {action}
    </div>
  );
}
