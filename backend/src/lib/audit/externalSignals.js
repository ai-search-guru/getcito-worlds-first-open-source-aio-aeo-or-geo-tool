/**
 * External-data audit signals (Faz 2). Currently just brand-entity, which
 * checks whether the brand has a Wikidata entity (a Q-number) that AI engines
 * can dereference as a trust anchor. No LLM — a single Wikidata search API
 * call. Degrades to 'na' on any failure so it never sinks the audit.
 */

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

/**
 * @param {string|null|undefined} brandName
 * @returns {Promise<{ key: string, status: string, score: number|null, evidence: object }>}
 */
export async function evaluateBrandEntity(brandName) {
  const key = 'brand-entity';
  const name = (brandName || '').trim();
  if (!name) {
    return { key, status: 'na', score: null, evidence: { reason: 'no brand name' } };
  }

  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: name,
    language: 'en',
    format: 'json',
    limit: '5',
    type: 'item',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${WIKIDATA_API}?${params.toString()}`, {
      signal: controller.signal,
      headers: { 'user-agent': 'GetCitoSiteAudit/1.0 (+https://getcito.com)' },
    });
    if (!res.ok) {
      return { key, status: 'na', score: null, evidence: { error: `wikidata ${res.status}` } };
    }
    const data = await res.json();
    const hits = Array.isArray(data.search) ? data.search : [];

    // Case-insensitive exact label match → confident entity; near match → warn.
    const lower = name.toLowerCase();
    const exact = hits.find((h) => (h.label || '').toLowerCase() === lower);
    const match = exact || hits[0];

    if (exact) {
      return {
        key,
        status: 'pass',
        score: 1,
        evidence: { qid: exact.id, label: exact.label, description: exact.description ?? null },
      };
    }
    if (match) {
      return {
        key,
        status: 'warn',
        score: 0.5,
        evidence: { qid: match.id, label: match.label, note: 'no exact label match' },
      };
    }
    return { key, status: 'fail', score: 0, evidence: { matches: 0 } };
  } catch (err) {
    return { key, status: 'na', score: null, evidence: { error: err.message } };
  } finally {
    clearTimeout(timer);
  }
}
