/**
 * How a draft's live page does now, for the Content Agent (learning B5): the
 * editor's Live page tab numbers (content_page_impact, 00209) over the last
 * 30 days against the 30 before — how often tracked AI answers cite it, for
 * how many prompts and the ones it lost, and its AI visits. The page earns
 * these as it reads now, so the agent keeps the answers and facts AI engines
 * cite from it, and answers a lost prompt's question where a rule's change
 * can. The brand's own page only.
 */

import supabaseAdmin from '../config/supabase.js';

/** The window the agent is told about, as the Live page tab's 30d. */
export const LIVE_PAGE_DAYS = 30;

/** Lost prompts it is told, by name. */
const LOST_SHOWN = 3;
/**
 * A lost prompt's text at most, as it is quoted: a prompt has no length
 * limit where it is kept, and one long one mustn't make the line as long as
 * the page (the CSV import stops at 500).
 */
export const LOST_PROMPT_CHARS = 300;

const n = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const pair = (value) => ({ cur: n(value?.cur), prev: n(value?.prev) });
/** "1 time", "12 times". */
const counted = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
/** A prompt's text on one line, cut to LOST_PROMPT_CHARS. */
const promptText = (text) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > LOST_PROMPT_CHARS ? `${line.slice(0, LOST_PROMPT_CHARS).trimEnd()}…` : line;
};

/**
 * The numbers the agent is told, from content_page_impact's answer; null
 * when the page was neither cited nor visited from AI in either window.
 */
export function livePageSummary(impact, days = LIVE_PAGE_DAYS) {
  if (!impact || typeof impact !== 'object') return null;
  const citations = pair(impact.citations);
  const aiVisits = pair(impact.aiVisits);
  if (!citations.cur && !citations.prev && !aiVisits.cur && !aiVisits.prev) return null;
  const lostPrompts = (Array.isArray(impact.prompts) ? impact.prompts : [])
    .filter((p) => n(p?.cur) === 0 && n(p?.prev) > 0 && typeof p.text === 'string' && p.text.trim())
    .sort((a, b) => n(b.prev) - n(a.prev))
    .slice(0, LOST_SHOWN)
    .map((p) => promptText(p.text));
  return {
    days,
    citations,
    prompts: { cur: n(impact.promptCounts?.cur), lost: n(impact.promptCounts?.lost) },
    lostPrompts,
    aiVisits,
  };
}

/** The live page's summary, read with the service role; null with nothing to tell. */
export async function readLivePage(brandId, page, days = LIVE_PAGE_DAYS) {
  if (!page) return null;
  const { data, error } = await supabaseAdmin.rpc('content_page_impact', {
    p_brand_id: brandId,
    p_page: page,
    p_days: days,
  });
  if (error) throw new Error(`live page read failed: ${error.message}`);
  return livePageSummary(data, days);
}

/** What the agent is told about the live page; empty with nothing to tell. */
export function livePageLine(summary) {
  if (!summary) return '';
  const { days, citations, prompts, lostPrompts, aiVisits } = summary;
  const lost = prompts.lost
    ? ` It lost ${counted(prompts.lost, 'prompt')} it was cited for${
        lostPrompts.length ? `: ${lostPrompts.map((text) => `"${text}"`).join(', ')}` : ''
      }.`
    : '';
  return `How the live page does now (last ${days} days, against the ${days} before): tracked AI answers cited it ${counted(citations.cur, 'time')} (${citations.prev} before), for ${counted(prompts.cur, 'prompt')}, and it had ${counted(aiVisits.cur, 'AI visit')} (${aiVisits.prev} before).${lost}
It earns these as it reads now: keep the answers, facts and names AI engines may cite from it, and change them only where a rule needs it.${prompts.lost ? " Where a rule's change can, answer a lost prompt's question." : ''}`;
}
