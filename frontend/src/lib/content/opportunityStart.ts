import type { ContentOpportunity } from '@/types';

/** Opportunities still open to write for, as New content lists them. */
const OPEN_STATUSES: readonly string[] = ['new', 'reviewed', 'sent', 'in_progress'];

/**
 * Whether Generate Content can start a page for this opportunity: owned
 * work (earned content lives on other sites) that is still open, so New
 * content lists it.
 */
export function canWriteOpportunity(
  opportunity: Pick<ContentOpportunity, 'type' | 'status'>,
): boolean {
  return opportunity.type === 'owned' && OPEN_STATUSES.includes(opportunity.status);
}

/**
 * Start for an opportunity (Generate Content), as the Content plan opens it:
 * a new page when it decided to create one or names no page, else the page
 * it works on (optimize, expand, refresh, consolidate or defend), the first
 * of its target pages.
 */
export function opportunityStart(
  opportunity: Pick<ContentOpportunity, 'id' | 'decision' | 'sourceData'>,
): { kind: 'opportunity'; id: string; page: { url: string; title: string | null } | null } {
  const target = (opportunity.sourceData?.targetPages ?? []).find((p) => p?.url);
  const create = !opportunity.decision || opportunity.decision === 'create' || !target;
  return {
    kind: 'opportunity',
    id: opportunity.id,
    page: create ? null : { url: target.url, title: target.title || null },
  };
}
