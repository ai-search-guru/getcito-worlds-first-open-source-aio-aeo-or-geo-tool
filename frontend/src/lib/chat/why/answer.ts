import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Citation } from '@/types';
import type { WhyResult } from './explain';

/**
 * One answer a Why cause's row shows (CHAT-22 §1 item 4, the evidence
 * drawer): its engine, its day, a short passage with the brand named, and
 * the pages it cited. Found from the analysis the run kept, read as the
 * person (00420: readable where its chat is), by its places — the run's
 * n-th analysis, the cause, the row — so no answer's id reaches the
 * browser. Its text is an engine's, shown as text. Server only.
 */

export interface WhyAnswer {
  engine: string;
  date: string;
  /** The passage, cut around the brand's first mention: `mark` parts name it. */
  passage: { text: string; mark: boolean }[];
  citations: { url: string; own: boolean }[];
}

/** Characters of the answer shown around the brand's name. */
const PASSAGE = 320;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};

/** The passage around a name's first mention, the name marked; the start when it isn't named. */
export function passageAround(text: string, name: string): WhyAnswer['passage'] {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = name ? flat.toLowerCase().indexOf(name.toLowerCase()) : -1;
  const start = at < 0 ? 0 : Math.max(0, at - PASSAGE / 2);
  const piece = flat.slice(start, start + PASSAGE);
  const prefix = start > 0 ? '…' : '';
  const suffix = start + PASSAGE < flat.length ? '…' : '';
  if (!name) return [{ text: `${prefix}${piece}${suffix}`, mark: false }];
  const parts: WhyAnswer['passage'] = [];
  const lower = piece.toLowerCase();
  let from = 0;
  for (
    let i = lower.indexOf(name.toLowerCase());
    i >= 0;
    i = lower.indexOf(name.toLowerCase(), from)
  ) {
    if (i > from) parts.push({ text: piece.slice(from, i), mark: false });
    parts.push({ text: piece.slice(i, i + name.length), mark: true });
    from = i + name.length;
  }
  if (from < piece.length) parts.push({ text: piece.slice(from), mark: false });
  if (prefix) parts.unshift({ text: prefix, mark: false });
  if (suffix) parts.push({ text: suffix, mark: false });
  return parts;
}

/** The answer behind a row of the run's n-th analysis; null when there's none to show. */
export async function readWhyAnswer(
  runId: string,
  n: number,
  causeIndex: number,
  rowIndex: number,
): Promise<WhyAnswer | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('chat_why_analyses')
    .select('brand_id, result_json')
    .eq('run_id', runId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(`Could not read the analysis: ${error.message}`);
  const analysis = (data ?? [])[n - 1] as unknown as
    | { brand_id: string; result_json: WhyResult }
    | undefined;
  const ref = analysis?.result_json.causes?.[causeIndex]?.rows?.[rowIndex]?.answer;
  if (!analysis || !ref || ref.type !== 'answer') return null;

  const [answer, brand, domains] = await Promise.all([
    supabaseAdmin
      .from('prompt_results')
      .select('platform, model_used, created_at, response, citations')
      .eq('id', ref.id)
      .eq('brand_id', analysis.brand_id)
      .maybeSingle(),
    // The brand's sites are its brand_domains: brands has no domain column.
    supabaseAdmin.from('brands').select('name').eq('id', analysis.brand_id).maybeSingle(),
    supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', analysis.brand_id),
  ]);
  if (answer.error) throw new Error(`Could not read the answer: ${answer.error.message}`);
  const row = answer.data as {
    platform: string | null;
    model_used: string | null;
    created_at: string;
    response: string | null;
    citations: Citation[] | null;
  } | null;
  if (!row) return null;
  const name = (brand.data as { name?: string } | null)?.name ?? '';
  const own = ((domains.data ?? []) as { domain: string | null }[])
    .map(({ domain: d }) => (d ? hostOf(d.includes('://') ? d : `https://${d}`) : null))
    .filter((d): d is string => !!d);
  return {
    engine: row.model_used ?? row.platform ?? '',
    date: row.created_at.slice(0, 10),
    passage: passageAround(row.response ?? '', name),
    citations: (row.citations ?? [])
      .map((citation) => (typeof citation?.url === 'string' ? citation.url : null))
      .filter((url): url is string => !!url)
      .slice(0, 8)
      .map((url) => {
        const host = hostOf(url);
        return {
          url: url.replace(/^https?:\/\//i, '').replace(/^www\./i, ''),
          own: !!host && own.some((site) => host === site || host.endsWith(`.${site}`)),
        };
      }),
  };
}
