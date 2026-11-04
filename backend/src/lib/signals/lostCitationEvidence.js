/**
 * What a lost citation rests on (AC-001): which of the brand's pages was
 * cited, on which platforms, when it was last cited, and who is cited in its
 * place now.
 *
 * The pulse's detector decides that a prompt lost its citations from day
 * buckets alone (pulse/metrics.js lostCitationPrompts): cited on most result
 * days of the last two weeks, and on none of the latest few. That is enough
 * to raise the signal and not enough to act on it: a user needs the page to
 * fix and the pages to beat. This reads those back for the lost prompts only,
 * from the same answers, so it costs a few small reads per pass rather than
 * a second scan of the brand.
 */

import supabaseAdmin from '../../config/supabase.js';
import { chunkIds } from '../chunkedIn.js';
import { extractHostname, ownDomainMatcher } from '../responseParser.js';

const DAY_MS = 86_400_000;

/**
 * One page however it is written: http or https, with or without www, a
 * trailing slash or a query string. The first spelling seen is the one shown.
 */
function pageKey(url) {
  const host = extractHostname(url) ?? '';
  const path = String(url)
    .replace(/^[a-z]+:\/\/[^/]+/i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  return `${host}${path}`.toLowerCase();
}

/** Pages listed per side: the panel names a few, not every citation. */
const MAX_LISTED = 3;

/** Answers per prompt read back for "cited now": the newest, per platform. */
const TAIL_ANSWERS_PER_PLATFORM = 2;

/**
 * Summarises one lost prompt's answers.
 *
 * `rows` are the prompt's answers over the window, oldest first, each with
 * `citations` when it was read back. Days are UTC result days, as the
 * detector buckets them: the last `quietDays` are the quiet tail, the rest
 * the head the brand was cited in.
 */
export function summarizeLostCitation(rows, isOwn, quietDays) {
  const days = [...new Set(rows.map((r) => r.created_at.slice(0, 10)))].sort();
  const tailDays = new Set(days.slice(-quietDays));
  const head = rows.filter((r) => !tailDays.has(r.created_at.slice(0, 10)));
  const tail = rows.filter((r) => tailDays.has(r.created_at.slice(0, 10)));

  const citedDays = new Set(
    head.filter((r) => (r.citation_count ?? 0) > 0).map((r) => r.created_at.slice(0, 10)),
  );
  const citedRows = head.filter((r) => (r.citation_count ?? 0) > 0);

  // Lost on the platforms and locations that cited the brand before: none
  // of the tail's answers cite it anywhere, or the signal would not exist.
  const platforms = [...new Set(citedRows.map((r) => r.platform))].sort();
  const regions = [...new Set(citedRows.map((r) => r.region).filter(Boolean))].sort();

  // The brand's pages in the latest answers that cited them, newest first.
  const lost = new Map();
  for (const row of [...citedRows].reverse()) {
    (row.citations ?? []).forEach((cite, i) => {
      if (!cite?.url || !isOwn(cite.url)) return;
      const key = pageKey(cite.url);
      const seen = lost.get(key);
      if (!seen) {
        lost.set(key, {
          url: cite.url,
          position: i + 1,
          lastCitedAt: row.created_at,
          platforms: [row.platform],
        });
      } else if (!seen.platforms.includes(row.platform)) {
        seen.platforms.push(row.platform);
      }
    });
  }

  // Who the quiet answers cite instead: by how many answers cite them, then
  // how high they sit. Only the answers read back count, and the count says
  // out of how many, so a sample never reads as every quiet answer.
  const now = new Map();
  const read = tail.filter((row) => row.citations !== null && row.citations !== undefined);
  for (const row of read) {
    const counted = new Set();
    (row.citations ?? []).forEach((cite, i) => {
      const key = cite?.url ? pageKey(cite.url) : '';
      if (!key || isOwn(cite.url) || counted.has(key)) return;
      counted.add(key);
      const entry = now.get(key) ?? {
        url: cite.url,
        domain: extractHostname(cite.url),
        answers: 0,
        bestPosition: i + 1,
      };
      entry.answers += 1;
      entry.bestPosition = Math.min(entry.bestPosition, i + 1);
      now.set(key, entry);
    });
  }

  return {
    platforms,
    regions,
    citedDays: citedDays.size,
    days: days.length - tailDays.size,
    quietDays: tailDays.size,
    lostUrls: [...lost.values()].slice(0, MAX_LISTED),
    citedNow: [...now.values()]
      .sort((a, b) => b.answers - a.answers || a.bestPosition - b.bestPosition)
      .slice(0, MAX_LISTED)
      .map(({ url, domain, answers, bestPosition }) => ({
        url,
        domain,
        answers,
        answersRead: read.length,
        position: bestPosition,
      })),
  };
}

/**
 * The evidence for each lost prompt, by prompt id. Three reads: the prompts'
 * answers over the window (columns only), the brand's domains, and the
 * citations of the answers that matter: the latest one citing the brand per
 * platform, and the newest quiet ones per platform.
 */
export async function lostCitationEvidence(brandId, promptIds, { now, windowDays, quietDays }) {
  const evidence = new Map();
  if (promptIds.length === 0) return evidence;
  const since = new Date(now.getTime() - windowDays * DAY_MS).toISOString();

  const rows = [];
  for (const chunk of chunkIds(promptIds)) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin
        .from('prompt_results')
        .select('id, prompt_id, platform, region, citation_count, created_at')
        .eq('brand_id', brandId)
        .neq('platform', 'chatgpt-shopping')
        .in('prompt_id', chunk)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(`lost-citation evidence scan failed: ${error.message}`);
      rows.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
  }

  const byPrompt = groupBy(rows, (row) => row.prompt_id);

  // Which answers' citations to read: per prompt and platform, the latest
  // answer that cited the brand and the newest answers since it went quiet.
  const wanted = new Set();
  for (const promptRows of byPrompt.values()) {
    const days = [...new Set(promptRows.map((r) => r.created_at.slice(0, 10)))].sort();
    const tailDays = new Set(days.slice(-quietDays));
    for (const platformRows of groupBy(promptRows, (row) => row.platform).values()) {
      const cited = platformRows.filter(
        (r) => (r.citation_count ?? 0) > 0 && !tailDays.has(r.created_at.slice(0, 10)),
      );
      if (cited.length) wanted.add(cited[cited.length - 1].id);
      platformRows
        .filter((r) => tailDays.has(r.created_at.slice(0, 10)))
        .slice(-TAIL_ANSWERS_PER_PLATFORM)
        .forEach((r) => wanted.add(r.id));
    }
  }

  const [domainsRes, citations] = await Promise.all([
    supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brandId),
    readCitations([...wanted]),
  ]);
  if (domainsRes.error) throw new Error(domainsRes.error.message);
  const isOwn = ownDomainMatcher((domainsRes.data ?? []).map((r) => r.domain));

  for (const [promptId, promptRows] of byPrompt) {
    const withCitations = promptRows.map((row) => ({
      ...row,
      citations: citations.get(row.id) ?? null,
    }));
    evidence.set(promptId, summarizeLostCitation(withCitations, isOwn, quietDays));
  }
  return evidence;
}

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

async function readCitations(ids) {
  const byId = new Map();
  for (const chunk of chunkIds(ids)) {
    const { data, error } = await supabaseAdmin
      .from('prompt_results')
      .select('id, citations')
      .in('id', chunk);
    if (error) throw new Error(`lost-citation evidence read failed: ${error.message}`);
    for (const row of data ?? [])
      byId.set(row.id, Array.isArray(row.citations) ? row.citations : []);
  }
  return byId;
}
