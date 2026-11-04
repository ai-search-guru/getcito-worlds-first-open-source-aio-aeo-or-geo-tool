/**
 * Shared helpers for signal evaluators — JSON-LD extraction and link
 * analysis (readability's math is in readability.js). Kept dependency-free
 * (cheerio + plain JS) so signals stay fast and deterministic.
 */

/**
 * Parse every <script type="application/ld+json"> block and flatten @graph /
 * arrays into a single list of typed nodes. Returns `{ nodes, total, valid }`.
 * A @graph's node takes the wrapper's @context when it has none of its own,
 * as JSON-LD reads it: WordPress's SEO plugins write one @graph with the
 * context on the wrapper alone.
 */
export function jsonLd(ctx) {
  const nodes = [];
  let total = 0;
  let valid = 0;

  ctx.$('script[type="application/ld+json"]').each((_, el) => {
    total += 1;
    const raw = ctx.$(el).text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    valid += 1;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray(item['@graph'])) {
        const context = item['@context'];
        for (const n of item['@graph']) {
          if (!n || typeof n !== 'object') continue;
          nodes.push(
            context !== undefined && n['@context'] === undefined
              ? { '@context': context, ...n }
              : n,
          );
        }
      } else {
        nodes.push(item);
      }
    }
  });

  return { nodes, total, valid };
}

/** Normalize a node's @type into a lowercase string array. */
export function typesOf(node) {
  const t = node?.['@type'];
  if (!t) return [];
  return (Array.isArray(t) ? t : [t])
    .filter((x) => typeof x === 'string')
    .map((x) => x.toLowerCase());
}

/** Split the page's anchors into internal vs external absolute URLs. */
export function classifyLinks(ctx) {
  const host = (() => {
    try {
      return new URL(ctx.url).host;
    } catch {
      return '';
    }
  })();

  const internal = [];
  const external = [];

  ctx.$('a[href]').each((_, el) => {
    const href = (ctx.$(el).attr('href') || '').trim();
    if (
      !href ||
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('javascript:')
    ) {
      return;
    }
    try {
      const u = new URL(href, ctx.url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      if (u.host === host) internal.push(u);
      else external.push(u);
    } catch {
      /* ignore malformed hrefs */
    }
  });

  return { internal, external };
}

/** Lowercased content of a <meta> by name or property attribute. */
export function metaContent(ctx, key) {
  const el = ctx.$(`meta[name="${key}"], meta[property="${key}"]`).first();
  const v = el.attr('content');
  return typeof v === 'string' ? v.trim() : null;
}

/** Count occurrences of a list of phrases (case-insensitive) in text. */
export function countPhrases(text, phrases) {
  const lower = text.toLowerCase();
  let count = 0;
  for (const p of phrases) {
    const phrase = p.toLowerCase();
    if (!phrase) continue;

    let idx = lower.indexOf(phrase);
    while (idx !== -1) {
      count += 1;
      idx = lower.indexOf(phrase, idx + phrase.length);
    }
  }
  return count;
}
