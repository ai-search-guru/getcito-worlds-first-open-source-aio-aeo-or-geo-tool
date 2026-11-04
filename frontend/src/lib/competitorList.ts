/** A competitor on the brand-setup competitor step, suggested or typed in. */
export interface CompetitorChoice {
  name: string;
  domain: string;
  selected: boolean;
}

/** Same cleanup addCompetitor applies before saving. */
export function normalizeCompetitorDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

function domainKey(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '');
}

/** Same domain, or same name when either side has no domain. */
function findChoice(list: CompetitorChoice[], name: string, domain: string): number {
  return list.findIndex((c) =>
    domain && c.domain
      ? domainKey(c.domain) === domainKey(domain)
      : c.name.trim().toLowerCase() === name.toLowerCase(),
  );
}

/**
 * Add a typed competitor to the top of the step's list, right under the field
 * it was typed into. One already listed — same domain, or same name when
 * either side has no domain — is selected instead of added twice, and
 * returned as `duplicate` so the caller can say so.
 */
export function addCompetitorChoice(
  list: CompetitorChoice[],
  rawName: string,
  rawDomain: string,
): { list: CompetitorChoice[]; duplicate: CompetitorChoice | null } {
  const name = rawName.trim();
  if (!name) return { list, duplicate: null };
  const domain = normalizeCompetitorDomain(rawDomain);

  const index = findChoice(list, name, domain);
  if (index !== -1) {
    const duplicate = list[index];
    return {
      list: list.map((c, i) => (i === index ? { ...c, selected: true } : c)),
      duplicate,
    };
  }
  return { list: [{ name, domain, selected: true }, ...list], duplicate: null };
}

/**
 * Fold freshly fetched suggestions into the list without dropping anything
 * already on it: the user can type competitors in while suggestions load,
 * and a retry must not wipe them. Suggestions already listed are skipped.
 */
export function mergeCompetitorSuggestions(
  list: CompetitorChoice[],
  suggestions: { name: string; domain: string }[],
): CompetitorChoice[] {
  const merged = [...list];
  for (const s of suggestions) {
    const domain = normalizeCompetitorDomain(s.domain);
    if (findChoice(merged, s.name, domain) === -1) {
      merged.push({ name: s.name, domain, selected: true });
    }
  }
  return merged;
}
