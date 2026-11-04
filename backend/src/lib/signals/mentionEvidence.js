/**
 * Where the brand is mentioned without being cited (AC-001): per prompt, the
 * platforms, the brand's position in the answers, their sentiment, and a
 * quote of the newest answer around the mention.
 *
 * The uncited-mentions signal names up to fifty prompts and nothing about
 * them. The panel asks, per mention, for the prompt, platform, position,
 * sentiment and an answer excerpt; this reads those for the prompts it lists
 * first (the most mentioned), from the window's answers that name the brand
 * and cite none of its pages, and the text of one answer per prompt.
 */

import supabaseAdmin from '../../config/supabase.js';
import { mentionExcerpt } from '../responseParser.js';

const DAY_MS = 86_400_000;

/** Prompts the panel describes: the signal's first, the most mentioned. */
const MAX_PROMPTS = 5;

/** Answers tried per prompt for a quote, newest first. */
const QUOTE_TRIES = 3;

/** Pages of answers read per signal, so a busy week is summarised whole. */
const MAX_PAGES = 5;

/** The middle value, or null for none. */
function median(values) {
  const sorted = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The sentiment most answers carry; a tie reads neutral. */
function mostCommonSentiment(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  const ranked = [...counts.entries()].sort(([, a], [, b]) => b - a);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return 'neutral';
  return ranked[0][0];
}

/**
 * One prompt's mentions summarised. `rows` are its answers that name the
 * brand and cite none of its pages, newest first.
 */
export function summarizeMentions(rows) {
  return {
    platforms: [...new Set(rows.map((r) => r.platform))].sort(),
    answers: rows.length,
    position: median(rows.map((r) => r.mention_position)),
    sentiment: mostCommonSentiment(rows.map((r) => r.sentiment)),
  };
}

/**
 * The mention evidence for the first prompts of an uncited-mentions signal,
 * in their order. Four reads: the brand's name and domains, the prompts'
 * texts, their uncited answers over the window (columns only), and the text
 * of the newest such answer per prompt.
 */
export async function mentionEvidence(brandId, promptIds, { now, windowDays }) {
  const ids = promptIds.slice(0, MAX_PROMPTS);
  if (ids.length === 0) return [];
  const since = new Date(now.getTime() - windowDays * DAY_MS).toISOString();

  const [brandRes, domainsRes, promptsRes, answers] = await Promise.all([
    supabaseAdmin.from('brands').select('name').eq('id', brandId).maybeSingle(),
    supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brandId),
    supabaseAdmin.from('prompts').select('id, text').in('id', ids),
    uncitedAnswers(brandId, ids, since),
  ]);
  for (const res of [brandRes, domainsRes, promptsRes]) {
    if (res.error) throw new Error(`mention evidence read failed: ${res.error.message}`);
  }

  const brand = {
    brandName: brandRes.data?.name ?? '',
    domains: (domainsRes.data ?? []).map((r) => r.domain),
  };
  const texts = new Map(
    (promptsRes.data ?? []).map((p) => [p.id, String(p.text ?? '').slice(0, 160)]),
  );
  const byPrompt = new Map();
  for (const row of answers) {
    const list = byPrompt.get(row.prompt_id);
    if (list) list.push(row);
    else byPrompt.set(row.prompt_id, [row]);
  }

  // The newest answers per prompt are tried for a quote, in order. Their
  // text is the heaviest read here, so a failure costs the quotes only.
  const tried = ids.flatMap((id) => (byPrompt.get(id) ?? []).slice(0, QUOTE_TRIES));
  const responses = new Map();
  if (tried.length) {
    const { data, error } = await supabaseAdmin
      .from('prompt_results')
      .select('id, response')
      .in(
        'id',
        tried.map((row) => row.id),
      );
    if (!error) for (const row of data ?? []) responses.set(row.id, row.response);
  }

  return ids
    .filter((id) => byPrompt.has(id))
    .map((id) => {
      const rows = byPrompt.get(id);
      const quote = rows
        .slice(0, QUOTE_TRIES)
        .map((row) => ({ row, excerpt: mentionExcerpt(responses.get(row.id), brand) }))
        .find(({ excerpt }) => excerpt);
      return {
        promptId: id,
        promptText: texts.get(id) ?? '',
        ...summarizeMentions(rows),
        excerpt: quote?.excerpt ?? null,
        excerptPlatform: quote?.row.platform ?? null,
        excerptAt: quote?.row.created_at ?? null,
      };
    });
}

/** The prompts' answers that name the brand and cite none of its pages, newest first. */
async function uncitedAnswers(brandId, ids, since) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabaseAdmin
      .from('prompt_results')
      .select('id, prompt_id, platform, mention_position, sentiment, created_at')
      .eq('brand_id', brandId)
      .neq('platform', 'chatgpt-shopping')
      .in('prompt_id', ids)
      .gt('mention_count', 0)
      .eq('citation_count', 0)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`mention evidence read failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}
