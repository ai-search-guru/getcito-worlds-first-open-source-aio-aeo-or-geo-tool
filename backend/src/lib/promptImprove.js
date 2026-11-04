/**
 * Positions panel → Improve tab (PROMPT-003): platform-specific suggestions to
 * improve one prompt's position.
 *
 * Pure on purpose. The route loads the answers, and what the page checks
 * found on the cited pages lately (storedFeatures); this module, which reads
 * no database (pageFeatures.js, not competitorPages.js), decides each
 * platform's state, gathers the evidence the model may cite, builds the
 * prompt, and checks what comes back against that evidence. The checks are
 * the point of the feature: a suggestion has to name a real sub-query, URL or
 * competitor, and a source the model invented is dropped rather than shown.
 */

import { z } from 'zod';
import { extractHostname } from './responseParser.js';
import { FEATURE_CHECKS, featureGaps } from './action-center/pageFeatures.js';
import { describeSignal } from './audit/rubric.js';
import { opportunityKey } from './audit/opportunities.js';

/** Labels for the engines the Positions panel lists (frontend/src/lib/promptPositions.ts). */
export const IMPROVE_PLATFORM_LABELS = {
  'chatgpt-web': 'ChatGPT',
  'perplexity-web': 'Perplexity',
  'google-aio': 'Google AI Overviews',
  'google-aimode': 'Google AI Mode',
  'gemini-web': 'Gemini',
  'copilot-web': 'Microsoft Copilot',
  'grok-web': 'Grok',
  claude: 'Claude',
};

/**
 * - no_runs        — nothing tracked on this platform in the window
 * - not_mentioned  — tracked, the brand appears in fewer than half the runs
 * - mentioned_late — appears, but not first (or with no stored position)
 * - not_cited      — appears first, but its pages aren't cited, or cited late
 * - doing_well     — first, and cited early: nothing to suggest
 */
export const IMPROVE_STATES = [
  'no_runs',
  'not_mentioned',
  'mentioned_late',
  'not_cited',
  'doing_well',
];

/** States that get suggestions. */
export const ACTIONABLE_STATES = ['not_mentioned', 'mentioned_late', 'not_cited'];

export const SOURCE_TYPES = ['fanout', 'domain', 'answer', 'competitor_url', 'brand_page'];

const MAX_FANOUTS = 12;
const MAX_DOMAINS = 10;
const MAX_COMPETITOR_URLS = 8;
const MAX_COMPETITORS = 6;
const MAX_BRAND_PAGES = 6;
const EXCERPT_CHARS = 1200;

/**
 * Below this share of runs mentioning the brand, the platform counts as not
 * mentioned: a brand in 8 of 120 answers is mostly missing there, and needs
 * coverage advice, not positioning advice, however high those 8 ranked.
 * Mirrored in frontend/src/lib/promptImprove.ts for the Tracked Prompts Positions
 * column — keep the two in sync.
 */
export const MIN_MENTION_RATE = 0.5;

/** Same split as frontend/src/lib/positionTone.ts: first third Early, last third Late. */
export function positionTone(rank, total) {
  const ratio = total > 1 ? (rank - 1) / (total - 1) : 0;
  return ratio <= 1 / 3 ? 'Early' : ratio >= 2 / 3 ? 'Late' : 'Mid';
}

function normalizeDomains(domains) {
  return (domains || [])
    .map(
      (d) =>
        extractHostname(d) ??
        String(d ?? '')
          .trim()
          .toLowerCase(),
    )
    .filter(Boolean);
}

function hostMatches(host, domains) {
  return !!host && domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** The brand's first source in an answer, 1-based among sources with a URL. */
export function brandCitationRank(citations, brandDomains) {
  if (!Array.isArray(citations)) return null;
  const domains = normalizeDomains(brandDomains);
  if (domains.length === 0) return null;
  let total = 0;
  let rank = null;
  for (const cite of citations) {
    const url = typeof cite?.url === 'string' ? cite.url.trim() : '';
    if (!url) continue;
    total += 1;
    if (rank === null && hostMatches(extractHostname(url), domains)) rank = total;
  }
  return rank === null ? null : { rank, total };
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10);

/**
 * One platform's state over the window. A platform where the brand appears in
 * fewer than MIN_MENTION_RATE of the runs is not mentioned. Otherwise
 * positions are averaged over the runs that mention the brand, so one lucky
 * #1 among many #4s still reads "late". Rows: prompt_results with
 * mention_count, mention_position, mentioned_entity_count and citations.
 */
export function classifyPlatform(rows, brandDomains) {
  const runs = rows.length;
  if (runs === 0) {
    return {
      state: 'no_runs',
      runs,
      mentionedRuns: 0,
      citedRuns: 0,
      mentionPosition: null,
      citationRank: null,
    };
  }

  const mentioned = rows.filter((r) => (r.mention_count ?? 0) > 0);
  const positions = mentioned
    .map((r) => r.mention_position)
    .filter((p) => typeof p === 'number' && p > 0);
  const totals = mentioned
    .map((r) => r.mentioned_entity_count)
    .filter((t) => typeof t === 'number' && t > 0);
  const citations = rows.map((r) => brandCitationRank(r.citations, brandDomains)).filter(Boolean);

  const mentionPosition = round1(avg(positions));
  const mentionTotal = round1(avg(totals));
  const citationRank = citations.length
    ? {
        rank: round1(avg(citations.map((c) => c.rank))),
        total: round1(avg(citations.map((c) => c.total))),
      }
    : null;

  let state;
  if (mentioned.length < runs * MIN_MENTION_RATE) state = 'not_mentioned';
  else if (mentionPosition === null || Math.round(mentionPosition) > 1) state = 'mentioned_late';
  else if (!citationRank || positionTone(citationRank.rank, citationRank.total) !== 'Early') {
    state = 'not_cited';
  } else state = 'doing_well';

  return {
    state,
    runs,
    mentionedRuns: mentioned.length,
    citedRuns: citations.length,
    mentionPosition,
    mentionTotal,
    citationRank,
  };
}

function topCounts(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

function bump(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

/**
 * Around the brand's first mention when the answer has one, so the model sees
 * which attributes earned the slots above it; otherwise the opening.
 */
export function answerExcerpt(response, brandName) {
  const text = typeof response === 'string' ? response.replace(/\s+/g, ' ').trim() : '';
  if (!text) return '';
  if (text.length <= EXCERPT_CHARS) return text;
  const at = brandName ? text.toLowerCase().indexOf(brandName.toLowerCase()) : -1;
  if (at < 0) return `${text.slice(0, EXCERPT_CHARS)}…`;
  const start = Math.max(0, at - EXCERPT_CHARS * 0.6);
  const end = Math.min(text.length, start + EXCERPT_CHARS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/**
 * The evidence one platform's answers offer: the sub-queries it ran, the
 * domains it cited, the competitors it named and their cited URLs, and the
 * brand's own cited pages. Rows are newest first; `latestResponse` is the
 * newest answer's text.
 */
export function collectEvidence(rows, { brandName, brandDomains, competitors, latestResponse }) {
  const own = normalizeDomains(brandDomains);
  const competitorDomains = (competitors || [])
    .map((c) => ({ name: c.name, domain: extractHostname(c.domain) ?? c.domain?.toLowerCase() }))
    .filter((c) => c.domain);

  const fanouts = new Map();
  const domains = new Map();
  const competitorUrls = new Map();
  const brandPages = new Map();
  const competitorStats = new Map();

  for (const row of rows) {
    const seen = new Set();
    for (const q of Array.isArray(row.search_queries) ? row.search_queries : []) {
      const query = typeof q?.query === 'string' ? q.query.trim() : '';
      if (!query || seen.has(query.toLowerCase())) continue;
      seen.add(query.toLowerCase());
      bump(fanouts, query);
    }
    for (const cite of Array.isArray(row.citations) ? row.citations : []) {
      const url = typeof cite?.url === 'string' ? cite.url.trim() : '';
      const host = extractHostname(url);
      if (!host) continue;
      bump(domains, host);
      if (hostMatches(host, own)) bump(brandPages, url);
      else if (competitorDomains.some((c) => hostMatches(host, [c.domain])))
        bump(competitorUrls, url);
    }
    for (const m of Array.isArray(row.competitor_mentions) ? row.competitor_mentions : []) {
      if (!m?.name || !((m.mention_count ?? 0) > 0)) continue;
      const s = competitorStats.get(m.name) ?? { runs: 0, positions: [] };
      s.runs += 1;
      if (typeof m.mention_position === 'number') s.positions.push(m.mention_position);
      competitorStats.set(m.name, s);
    }
  }

  return {
    fanouts: topCounts(fanouts, MAX_FANOUTS).map(([query, count]) => ({ query, count })),
    citedDomains: topCounts(domains, MAX_DOMAINS).map(([domain, count]) => ({
      domain,
      count,
      own: hostMatches(domain, own),
    })),
    competitorUrls: topCounts(competitorUrls, MAX_COMPETITOR_URLS).map(([url, count]) => ({
      url,
      count,
    })),
    brandPages: topCounts(brandPages, MAX_BRAND_PAGES).map(([url, count]) => ({ url, count })),
    competitors: [...competitorStats.entries()]
      .sort((a, b) => b[1].runs - a[1].runs || a[0].localeCompare(b[0]))
      .slice(0, MAX_COMPETITORS)
      .map(([name, s]) => ({ name, runs: s.runs, avgPosition: round1(avg(s.positions)) })),
    excerpt: answerExcerpt(latestResponse, brandName),
  };
}

const STATE_LABELS = {
  not_mentioned: 'NOT MENTIONED',
  mentioned_late: 'MENTIONED LATE',
  not_cited: 'MENTIONED EARLY BUT NOT CITED / CITED LATE',
};

const STATE_GUIDANCE = {
  not_mentioned:
    'Coverage gaps: pages to create or extend so they answer the sub-queries, and third-party sites (from the cited domains) to get listed on.',
  mentioned_late:
    'Positioning: which attributes or claims earn the top slots in the answer, what the competitors ranked above do on their cited pages, and on-page structure changes.',
  not_cited:
    'Citations: what the cited pages offer that the brand pages do not, and which brand page to strengthen so it becomes a source.',
};

/** The per-item schema the model fills; bounds keep cards short and lists sane. */
export const improveSchema = z.object({
  suggestions: z
    .array(
      z.object({
        platform: z.string().describe('The platform id this suggestion is for, exactly as given'),
        title: z.string().min(5).max(90).describe('Short imperative title'),
        body: z
          .string()
          .min(20)
          .max(420)
          .describe('1-3 sentences: what to do and why, naming the specific evidence'),
        sources: z
          .array(
            z.object({
              type: z.enum(SOURCE_TYPES),
              ref: z
                .string()
                .min(1)
                .max(300)
                .describe(
                  'Copied verbatim from the evidence: a sub-query, a domain, a competitor URL, a brand page URL, or a short quote from the AI answer',
                ),
            }),
          )
          .min(1)
          .max(4),
        confidence: z.enum(['high', 'medium', 'low']),
      }),
    )
    .max(24),
});

function evidenceBlock(evidence) {
  const lines = [];
  if (evidence.fanouts.length) {
    lines.push(
      `Sub-queries it ran (fanout): ${evidence.fanouts.map((f) => `"${f.query}" ×${f.count}`).join('; ')}`,
    );
  } else {
    lines.push(
      'Sub-queries it ran (fanout): none recorded — use the cited sources and the answer.',
    );
  }
  if (evidence.citedDomains.length) {
    lines.push(
      `Cited domains: ${evidence.citedDomains
        .map((d) => `${d.domain} ×${d.count}${d.own ? ' (brand)' : ''}`)
        .join('; ')}`,
    );
  }
  if (evidence.competitors.length) {
    lines.push(
      `Competitors named: ${evidence.competitors
        .map((c) => `${c.name} (${c.runs} runs${c.avgPosition ? `, avg #${c.avgPosition}` : ''})`)
        .join('; ')}`,
    );
  }
  if (evidence.competitorUrls.length) {
    lines.push(`Competitor URLs cited: ${evidence.competitorUrls.map((u) => u.url).join(' ; ')}`);
  }
  if (evidence.brandPages.length) {
    lines.push(`Brand pages cited: ${evidence.brandPages.map((u) => u.url).join(' ; ')}`);
  }
  // What Site Audit's checks found on those pages, read lately (learning C2).
  if (evidence.pageChecks?.length) {
    lines.push(
      `Checks on these pages (Site Audit, read lately): ${evidence.pageChecks
        .map((p) => `${p.url}${p.own ? ' (brand)' : ''}: ${p.passes.join(', ') || 'none of them'}`)
        .join(' ; ')}`,
    );
  }
  if (evidence.checkGaps?.length) {
    lines.push(`The competitor pages have and the brand's don't: ${evidence.checkGaps.join(', ')}`);
  }
  if (evidence.excerpt) lines.push(`Latest AI answer (excerpt): """${evidence.excerpt}"""`);
  return lines.map((l) => `  ${l}`).join('\n');
}

const VERDICT_WORDS = {
  improved: 'improved',
  declined: 'declined',
  unchanged: 'unchanged',
  not_enough_data: 'not enough data',
  too_early: 'too early to read',
};

const SUGGESTION_STATUS_WORDS = {
  done: 'done',
  skipped: 'skipped by the team',
  not_done: 'not done',
};

/** "today", "1 day ago", "48 days ago". */
const ago = (days) => (days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`);

/**
 * Earlier Improve rounds on the prompt (learning B5), newest first: how its
 * platforms moved since and which of its suggestions were done or skipped.
 * Empty with none.
 */
function historyBlock(history) {
  if (!history?.length) return '';
  const name = (id) => IMPROVE_PLATFORM_LABELS[id] ?? id;
  const rounds = history.map((round) => {
    const moved = round.platforms.length
      ? round.platforms
          .map((p) => `${name(p.id)} ${VERDICT_WORDS[p.verdict] ?? p.verdict}`)
          .join(', ')
      : 'not read yet';
    const when = round.open
      ? 'still open'
      : round.final
        ? 'completed, final read'
        : 'completed, read so far';
    const suggestions = round.suggestions
      .map(
        (s) =>
          `[${s.platform ? name(s.platform) : 'any'}] "${s.title.replace(/"/g, "'")}" (${SUGGESTION_STATUS_WORDS[s.status] ?? 'not done'})`,
      )
      .join('; ');
    const sent = round.sent
      ? `${round.sent}${typeof round.daysAgo === 'number' ? `, ${ago(round.daysAgo)}` : ''}`
      : 'earlier';
    return `- Sent ${sent} (${when}): ${moved}.${suggestions ? `\n  Suggestions: ${suggestions}` : ''}`;
  });
  const early = history.some((round) => round.platforms.some((p) => p.verdict === 'too_early'));
  const skipped = history.some((round) => round.suggestions.some((s) => s.status === 'skipped'));
  return `

Earlier Improve rounds on this prompt, newest first:
${rounds.join('\n')}
Build on suggestions that came before an improvement on their platform. Do not suggest again what was done on a platform that did not move, unless the evidence now shows something new.${
    early
      ? ' A platform "too early to read" was sent too recently to tell whether it moved: do not count it as not moving.'
      : ''
  }${skipped ? ' Do not suggest again what the team skipped.' : ''}`;
}

/**
 * A platform's evidence with what Site Audit's checks found on its cited
 * pages, where they were read lately (learning C2): each page's passing
 * checks by name, and the checks most of the competitor pages pass that
 * the brand's cited page doesn't. Unchanged when none was read.
 *
 * @param {object} evidence as collectEvidence gives it
 * @param {Map<string, { own: boolean, checks: Record<string, string> }>} stored storedFeatures'
 */
export function withPageChecks(evidence, stored) {
  if (!stored?.size) return evidence;
  // collectEvidence counts addresses: one page cited under two (www,
  // tracking parameters) is one page here, its first address kept, or it
  // would count twice toward featureGaps' two pages at least.
  const seen = new Set();
  const read = [
    ...evidence.competitorUrls.map((u) => ({ url: u.url, own: false })),
    ...evidence.brandPages.map((u) => ({ url: u.url, own: true })),
  ].flatMap((page) => {
    const key = opportunityKey(page.url);
    const found = stored.get(key);
    if (!found || seen.has(key)) return [];
    seen.add(key);
    return [{ ...page, checks: found.checks }];
  });
  if (!read.length) return evidence;
  const name = (key) => describeSignal(key)?.label ?? key;
  const theirs = read.filter((p) => !p.own);
  const ours = read.find((p) => p.own) ?? null;
  return {
    ...evidence,
    pageChecks: read.map((p) => ({
      url: p.url,
      own: p.own,
      passes: FEATURE_CHECKS.filter((key) => p.checks[key] === 'pass').map(name),
    })),
    checkGaps: ours && theirs.length ? featureGaps(theirs, ours).map((gap) => gap.label) : [],
  };
}

/**
 * System and user prompt for one generation. `platforms` are the actionable
 * ones: [{ id, state, mentionPosition, mentionTotal, citationRank, evidence }].
 * `history`: the brand's earlier Improve rounds on the prompt (loadImproveRounds).
 */
export function buildImprovePrompt({ promptText, brand, platforms, history = [] }) {
  const system = `You are an AI search (answer engine) optimization strategist. For one tracked prompt, you tell a brand what to do on each AI platform where it is missing or ranked late.

Rules:
- Every suggestion must be specific to the evidence given for ITS platform: name the sub-query, URL, domain, competitor or answer attribute it is based on. No generic SEO advice ("improve your content", "add schema markup", "build backlinks") unless tied to a named page, query or domain.
- Each source's "ref" must be copied verbatim from that platform's evidence. Source types: fanout = a listed sub-query; domain = a listed cited domain; competitor_url = a listed competitor URL; brand_page = a listed brand page; answer = a short quote (under 20 words) from the answer excerpt.
- When a platform has no sub-queries, base it on the cited sources and the answer text instead.
- Never output placeholders such as "prompt [0]", "[1]" or "<brand>". Use real names.
- 1-3 suggestions per platform, most impactful first. Write in English.`;

  const blocks = platforms
    .map((p) => {
      const where =
        p.state === 'not_mentioned' && p.mentionedRuns > 0
          ? ` — mentioned in only ${p.mentionedRuns} of ${p.runs} runs`
          : p.state === 'mentioned_late' && p.mentionPosition
            ? ` — mentioned at avg #${p.mentionPosition}${p.mentionTotal ? ` of ${p.mentionTotal} brands` : ''}`
            : p.state === 'not_cited' && p.citationRank
              ? ` — cited at avg #${p.citationRank.rank} of ${p.citationRank.total} sources`
              : '';
      return `Platform "${p.id}" (${IMPROVE_PLATFORM_LABELS[p.id] ?? p.id}): ${STATE_LABELS[p.state]}${where}
  Kind of suggestion: ${STATE_GUIDANCE[p.state]}
${evidenceBlock(p.evidence)}`;
    })
    .join('\n\n');

  const prompt = `Brand: ${brand.name}${brand.domains?.length ? ` (${brand.domains.join(', ')})` : ''}
${brand.description ? `About the brand: ${brand.description}\n` : ''}Tracked prompt: "${promptText}"

${blocks}${historyBlock(history)}

Write the suggestions. Use each platform id exactly as given.`;

  return { system, prompt };
}

const PLACEHOLDER_RE = /\bprompt\s*\[\d+\]|\[\d+\]|<brand>/i;
const norm = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');

/** Whether a source points at something that platform's evidence really contains. */
export function isKnownSource(source, evidence) {
  const ref = norm(source.ref);
  if (!ref) return false;
  switch (source.type) {
    case 'fanout':
      return evidence.fanouts.some((f) => norm(f.query) === ref);
    case 'domain': {
      const host = extractHostname(source.ref) ?? ref;
      return (
        evidence.citedDomains.some((d) => d.domain === host) ||
        evidence.competitorUrls.some((u) => extractHostname(u.url) === host)
      );
    }
    case 'competitor_url':
      return evidence.competitorUrls.some((u) => norm(u.url) === ref);
    case 'brand_page':
      return evidence.brandPages.some((u) => norm(u.url) === ref);
    case 'answer':
      // A quote has to appear in the excerpt the model was shown.
      return ref.length >= 3 && norm(evidence.excerpt).includes(ref.replace(/^["'“]|["'”]$/g, ''));
    default:
      return false;
  }
}

/**
 * Keeps what the model returned only where it holds up: a known actionable
 * platform, no placeholder text, and at least one source found in that
 * platform's evidence (invented sources are dropped). Ids are stable within a
 * set so the panel can track edits.
 */
export function sanitizeSuggestions(raw, platforms) {
  const byId = new Map(platforms.map((p) => [p.id, p]));
  const perPlatform = new Map();
  const out = [];
  for (const s of raw ?? []) {
    const platform = byId.get(s?.platform);
    if (!platform || !ACTIONABLE_STATES.includes(platform.state)) continue;
    if (PLACEHOLDER_RE.test(`${s.title} ${s.body}`)) continue;
    const sources = (s.sources ?? [])
      .filter((src) => isKnownSource(src, platform.evidence))
      .map((src) => ({ type: src.type, ref: String(src.ref).trim() }));
    if (sources.length === 0) continue;
    const n = perPlatform.get(platform.id) ?? 0;
    if (n >= 3) continue;
    perPlatform.set(platform.id, n + 1);
    out.push({
      id: `${platform.id}:${n}`,
      platform: platform.id,
      state: platform.state,
      title: s.title.trim(),
      body: s.body.trim(),
      sources,
      confidence: s.confidence,
    });
  }
  return out;
}

/** The cache key for a panel range: a preset, or the custom bounds. */
export function improveRangeKey({ preset, from, to }) {
  if (preset !== 'custom') return preset;
  return `custom:${from ?? ''}:${to ?? ''}`;
}
