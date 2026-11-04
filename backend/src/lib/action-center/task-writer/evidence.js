/**
 * What an action's tasks can be about (AC-004): the pages, prompts, domains,
 * competitors and topics its signals name, with what each signal recorded
 * about them. The task writer gives the model this and nothing else, and a
 * written task must point back into it — a task with no target here is not
 * concrete, whatever it says.
 *
 * Read from the signals' payloads as the evidence steps write them
 * (signals/record.js): a lost citation's lost and cited-now pages, a
 * competitor's positions, winning sources and page events, uncited mentions,
 * AI-traffic referrals, and a library finding's targets. The web's Affected
 * tab reads the same fields (frontend/src/lib/action-center/affected.ts).
 *
 * Every entity gets a short ref ("page:1", "prompt:3") the model cites.
 */

import { extractHostname } from '../../responseParser.js';
import { IMPROVE_PLATFORM_LABELS } from '../../promptImprove.js';

/** How many of each kind the model is shown: the first ones, most evidence first. */
export const EVIDENCE_LIMITS = Object.freeze({
  pages: 15,
  prompts: 25,
  domains: 12,
  competitors: 6,
  topics: 6,
});

const str = (value) => (typeof value === 'string' ? value.trim() : '');
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);

/** A URL without its scheme and "www.": "acme.example/pricing". */
export function bareUrl(url) {
  return str(url)
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/\/$/, '');
}

/** The path of an absolute URL, or the value itself. */
function pathOf(url) {
  try {
    const { pathname, search } = new URL(url);
    return `${pathname}${search}`;
  } catch {
    return str(url);
  }
}

/** A prompt's first words, lower case and without punctuation: how a task is
 *  told to name it, and how the quality rule recognises it. */
export const PROMPT_LABEL_WORDS = 5;

export function promptWords(text) {
  return str(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** "ChatGPT" for "chatgpt-web"; the slug when it has no name. */
export function platformLabel(slug) {
  return IMPROVE_PLATFORM_LABELS[slug] ?? slug;
}

/**
 * The entities an action's signals name.
 *
 * @param {Array<{ id: string, kind: string, payload: Record<string, unknown> | null }>} signals
 * @param {{ domains?: string[] }} [brand] the brand's domains, so a page named by
 *   its path ("/pricing") and by its URL is one page
 * @returns {{
 *   pages: object[], prompts: object[], domains: object[], competitors: object[],
 *   topics: object[], byRef: Map<string, object>
 * }}
 */
export function buildEvidence(signals, { domains: brandDomains = [] } = {}) {
  const pages = new Map();
  const prompts = new Map();
  const domains = new Map();
  const competitors = new Map();
  const topics = new Map();

  const home = bareUrl(brandDomains[0] ?? '').toLowerCase();
  const page = (url) => {
    const bare = bareUrl(url).toLowerCase();
    if (!bare) return null;
    // A path is the brand's own page: keyed as its URL would be.
    const key = bare.startsWith('/') && home ? `${home}${bare}` : bare;
    let entry = pages.get(key);
    if (entry && entry.url.startsWith('/') && !str(url).startsWith('/')) entry.url = str(url);
    if (!entry) {
      entry = {
        url: str(url),
        prompts: new Set(),
        platforms: new Set(),
        citedInstead: new Set(),
        issues: new Set(),
        lostPosition: null,
        sessions: null,
        before: null,
        evidence: 0,
      };
      pages.set(key, entry);
    }
    entry.evidence += 1;
    return entry;
  };
  const prompt = (id, text) => {
    const key = str(id) || (str(text) ? `text:${str(text)}` : '');
    if (!key) return null;
    let entry = prompts.get(key);
    if (!entry) {
      entry = {
        id: str(id) || null,
        text: str(text),
        platforms: new Set(),
        lostPages: new Set(),
        citedInstead: new Set(),
        leaders: [],
        mentionedOn: new Set(),
        evidence: 0,
      };
      prompts.set(key, entry);
    } else if (!entry.text && str(text)) {
      entry.text = str(text);
    }
    entry.evidence += 1;
    return entry;
  };
  const domain = (name) => {
    const key = str(name)
      .toLowerCase()
      .replace(/^www\./, '');
    if (!key) return null;
    let entry = domains.get(key);
    if (!entry) {
      entry = { domain: key, prompts: new Set(), urls: new Set(), answers: 0, evidence: 0 };
      domains.set(key, entry);
    }
    entry.evidence += 1;
    return entry;
  };
  const competitor = (name) => {
    const key = str(name);
    if (!key) return null;
    let entry = competitors.get(key.toLowerCase());
    if (!entry) {
      entry = {
        name: key,
        prompts: new Set(),
        sources: new Set(),
        pageEvents: new Map(),
        evidence: 0,
      };
      competitors.set(key.toLowerCase(), entry);
    }
    entry.evidence += 1;
    return entry;
  };
  const topic = (name) => {
    const key = str(name);
    if (!key) return null;
    let entry = topics.get(key.toLowerCase());
    if (!entry) {
      entry = { name: key, evidence: 0 };
      topics.set(key.toLowerCase(), entry);
    }
    entry.evidence += 1;
    return entry;
  };

  for (const signal of signals) {
    const p = signal.payload ?? {};
    const mine = [];

    // One prompt, as a lost citation names it.
    const single = prompt(p.promptId, p.promptText);
    if (single) mine.push(single);
    const platforms = list(p.platforms).map(str).filter(Boolean);

    // The brand's pages that stopped being cited, and who is cited instead.
    const lostPages = [];
    for (const lost of list(p.lostUrls)) {
      const entry = page(lost?.url);
      if (!entry) continue;
      lostPages.push(entry);
      for (const slug of [...list(lost.platforms), ...platforms]) entry.platforms.add(str(slug));
      entry.lostPosition ??= num(lost.position);
      for (const row of mine) {
        entry.prompts.add(row);
        row.lostPages.add(entry);
      }
    }
    for (const cited of list(p.citedNow)) {
      const entry = domain(cited?.domain || extractHostname(cited?.url));
      if (!entry) continue;
      if (str(cited.url)) entry.urls.add(str(cited.url));
      entry.answers += num(cited.answers) ?? 0;
      for (const row of mine) {
        entry.prompts.add(row);
        row.citedInstead.add(entry);
      }
      for (const lost of lostPages) lost.citedInstead.add(entry);
    }
    for (const row of mine) for (const slug of platforms) row.platforms.add(slug);

    // A competitor ahead, prompt by prompt, and the sources it wins with.
    const rival = competitor(p.competitorName);
    for (const pos of list(p.positions)) {
      const row = prompt(pos?.promptId, pos?.promptText);
      if (!row) continue;
      if (str(pos.platform)) row.platforms.add(str(pos.platform));
      if (rival) {
        rival.prompts.add(row);
        row.leaders.push({
          competitor: rival.name,
          platform: str(pos.platform),
          them: num(pos.competitor?.now),
          you: num(pos.you?.now),
        });
      }
    }
    for (const source of list(p.winningSources)) {
      const entry = domain(source?.domain);
      if (!entry) continue;
      entry.answers += num(source.answers) ?? 0;
      rival?.sources.add(entry);
    }
    // What happened to its pages lately (learning C3), once per event.
    for (const event of list(p.pageEvents)) {
      const url = str(event?.url);
      const day = str(event?.at).slice(0, 10);
      if (!rival || !url || !day) continue;
      if (event.kind !== 'first_cited' && event.kind !== 'changed') continue;
      rival.pageEvents.set(`${event.kind}|${url}|${day}`, {
        kind: event.kind,
        url,
        day,
        detail: event.detail ?? {},
      });
    }

    // Answers that name the brand without citing it.
    for (const mention of list(p.mentions)) {
      const row = prompt(mention?.promptId, mention?.promptText);
      if (!row) continue;
      for (const slug of list(mention.platforms)) {
        row.platforms.add(str(slug));
        row.mentionedOn.add(str(slug));
      }
    }

    // AI visits to pages.
    for (const referral of list(p.referrals)) {
      const entry = page(referral?.page);
      if (!entry) continue;
      entry.sessions ??= num(referral.sessions);
      entry.before ??= num(referral.before);
      for (const visit of list(referral.platforms)) {
        if (str(visit?.platform)) entry.platforms.add(str(visit.platform));
      }
    }

    // A library finding's targets, by what they are.
    const entity = str(p.entity);
    for (const target of list(p.targets)) {
      const label = str(target?.label) || str(target?.id);
      if (!label) continue;
      if (entity === 'prompts') {
        prompt(target.id, target.label);
      } else if (entity === 'pages') {
        if (str(target.id) === 'site') continue;
        const entry = page(label);
        if (!entry) continue;
        entry.sessions ??= num(target.now);
        entry.before ??= num(target.before);
        const issues = list(target.issues).length
          ? list(target.issues).map((i) => str(i?.label) || str(i?.check))
          : list(target.checks).map(str);
        for (const issue of issues) if (issue) entry.issues.add(issue);
      } else if (entity === 'competitors') {
        competitor(label);
      } else if (entity === 'topics') {
        topic(label);
      } else if (entity === 'domains' || entity === 'sources') {
        domain(extractHostname(label) ?? label);
      }
    }
  }

  const ranked = (map, limit) =>
    [...map.values()].sort((a, b) => b.evidence - a.evidence).slice(0, limit);

  const out = {
    pages: ranked(pages, EVIDENCE_LIMITS.pages),
    prompts: ranked(prompts, EVIDENCE_LIMITS.prompts).filter((row) => row.text),
    domains: ranked(domains, EVIDENCE_LIMITS.domains),
    competitors: ranked(competitors, EVIDENCE_LIMITS.competitors),
    topics: ranked(topics, EVIDENCE_LIMITS.topics),
    byRef: new Map(),
  };
  out.pages.forEach((entry, i) => {
    entry.ref = `page:${i + 1}`;
    entry.labels = [bareUrl(entry.url), pathOf(entry.url)].filter((l) => l && l !== '/');
  });
  out.prompts.forEach((entry, i) => {
    entry.ref = `prompt:${i + 1}`;
    entry.words = promptWords(entry.text).slice(0, PROMPT_LABEL_WORDS);
    entry.labels = [];
  });
  out.domains.forEach((entry, i) => {
    entry.ref = `domain:${i + 1}`;
    entry.labels = [entry.domain];
  });
  out.competitors.forEach((entry, i) => {
    entry.ref = `competitor:${i + 1}`;
    entry.labels = [entry.name];
  });
  out.topics.forEach((entry, i) => {
    entry.ref = `topic:${i + 1}`;
    entry.labels = [entry.name];
  });
  for (const kind of ['pages', 'prompts', 'domains', 'competitors', 'topics']) {
    for (const entry of out[kind]) out.byRef.set(entry.ref, entry);
  }
  return out;
}

/** Whether there is anything to write a concrete task about. */
export function hasTargets(evidence) {
  return evidence.byRef.size > 0;
}

const refsOf = (set) => [...set].map((entry) => entry.ref).filter(Boolean);

/** Page events shown per competitor, newest first. */
const PAGE_EVENTS_SHOWN = 5;

/** Check names from a page event's gained or lost list. */
const checkLabels = (checks) =>
  list(checks)
    .map((check) => str(check?.label) || str(check?.key))
    .filter(Boolean);

/** A competitor's page events as the model reads them: what, when, on which page. */
function pageEventsForPrompt(events) {
  return [...events.values()]
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, PAGE_EVENTS_SHOWN)
    .map((event) => {
      const base = { date: event.day, page: bareUrl(event.url) };
      if (event.kind === 'first_cited') {
        return { ...base, event: 'first cited in your tracked answers' };
      }
      const gained = checkLabels(event.detail.gained);
      const lost = checkLabels(event.detail.lost);
      return {
        ...base,
        event: 'page changed',
        ...(gained.length ? { nowHas: gained } : {}),
        ...(lost.length ? { noLongerHas: lost } : {}),
      };
    });
}

/**
 * The evidence as the model reads it: plain objects, refs instead of
 * cross-links, platform names instead of slugs.
 */
export function evidenceForPrompt(evidence) {
  const names = (set) => [...set].filter(Boolean).map(platformLabel);
  return {
    pages: evidence.pages.map((entry) => ({
      ref: entry.ref,
      url: bareUrl(entry.url),
      ...(entry.prompts.size ? { lostOnPrompts: refsOf(entry.prompts) } : {}),
      ...(entry.platforms.size ? { platforms: names(entry.platforms) } : {}),
      ...(entry.lostPosition !== null ? { citedAtBefore: entry.lostPosition } : {}),
      ...(entry.citedInstead.size ? { citedInstead: refsOf(entry.citedInstead) } : {}),
      ...(entry.sessions !== null ? { aiVisitsNow: entry.sessions } : {}),
      ...(entry.before !== null ? { aiVisitsBefore: entry.before } : {}),
      ...(entry.issues.size ? { auditIssues: [...entry.issues] } : {}),
    })),
    prompts: evidence.prompts.map((entry) => ({
      ref: entry.ref,
      text: entry.text,
      ...(entry.platforms.size ? { platforms: names(entry.platforms) } : {}),
      ...(entry.lostPages.size ? { lostPages: refsOf(entry.lostPages) } : {}),
      ...(entry.citedInstead.size ? { citedInstead: refsOf(entry.citedInstead) } : {}),
      ...(entry.leaders.length
        ? {
            competitorsAhead: entry.leaders.map((l) => ({
              competitor: l.competitor,
              platform: platformLabel(l.platform),
              theirPosition: l.them,
              yourPosition: l.you,
            })),
          }
        : {}),
      ...(entry.mentionedOn.size ? { namedWithoutCitationOn: names(entry.mentionedOn) } : {}),
    })),
    domains: evidence.domains.map((entry) => ({
      ref: entry.ref,
      domain: entry.domain,
      ...(entry.urls.size ? { citedUrls: [...entry.urls].slice(0, 3).map(bareUrl) } : {}),
      ...(entry.answers ? { answers: entry.answers } : {}),
      ...(entry.prompts.size ? { citedOnPrompts: refsOf(entry.prompts) } : {}),
    })),
    competitors: evidence.competitors.map((entry) => ({
      ref: entry.ref,
      name: entry.name,
      ...(entry.prompts.size ? { aheadOnPrompts: refsOf(entry.prompts) } : {}),
      ...(entry.sources.size ? { winsWith: refsOf(entry.sources) } : {}),
      ...(entry.pageEvents.size ? { pageEvents: pageEventsForPrompt(entry.pageEvents) } : {}),
    })),
    topics: evidence.topics.map((entry) => ({ ref: entry.ref, name: entry.name })),
  };
}
