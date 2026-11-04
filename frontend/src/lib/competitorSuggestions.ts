import type { SuggestedCompetitor } from '@/lib/aiBrandSetup';

export interface ExistingCompetitorIdentity {
  name: string;
  domain: string;
}

export function normalizeCompetitorName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

/** Normalize a saved domain or URL to its host so equivalent URLs deduplicate. */
export function normalizeCompetitorDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z\d+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/, 1)[0]
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

export function competitorSuggestionKey(suggestion: SuggestedCompetitor): string {
  const domain = normalizeCompetitorDomain(suggestion.domain);
  return domain ? `domain:${domain}` : `name:${normalizeCompetitorName(suggestion.name)}`;
}

/**
 * Remove suggestions already tracked by the brand, and duplicate candidates
 * from the AI response. Name and domain matches are case/URL-insensitive.
 */
export function filterNewCompetitorSuggestions(
  suggestions: SuggestedCompetitor[],
  existing: ExistingCompetitorIdentity[],
): SuggestedCompetitor[] {
  const existingNames = new Set(
    existing.map((competitor) => normalizeCompetitorName(competitor.name)).filter(Boolean),
  );
  const existingDomains = new Set(
    existing.map((competitor) => normalizeCompetitorDomain(competitor.domain)).filter(Boolean),
  );
  const seenNames = new Set<string>();
  const seenDomains = new Set<string>();

  return suggestions.filter((suggestion) => {
    const name = normalizeCompetitorName(suggestion.name);
    const domain = normalizeCompetitorDomain(suggestion.domain);
    if (!name || !domain) return false;

    if (
      existingNames.has(name) ||
      existingDomains.has(domain) ||
      seenNames.has(name) ||
      seenDomains.has(domain)
    ) {
      return false;
    }

    seenNames.add(name);
    seenDomains.add(domain);
    return true;
  });
}
