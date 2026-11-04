import { PLATFORM_LABELS } from '@/config/platformLabels';
import type { AIPlatform, ObservedSearchQuery } from '@/types';

export function visibleSearchQueries(items: ObservedSearchQuery[] | undefined) {
  return (items ?? []).filter((item) => typeof item.query === 'string' && item.query.trim());
}

export function formatSearchQuerySource(item: ObservedSearchQuery, fallbackPlatform: AIPlatform) {
  const sourcePlatform = item.source_platform || fallbackPlatform;
  const platformLabel = PLATFORM_LABELS[sourcePlatform] ?? sourcePlatform;
  const engine = typeof item.engine === 'string' ? item.engine.trim() : '';
  const isPerplexity = sourcePlatform.includes('perplexity');

  return isPerplexity && engine ? `${platformLabel} - ${engine}` : platformLabel;
}
