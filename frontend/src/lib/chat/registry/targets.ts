import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * What a write's card names as its target when its input is a list or an id
 * (defineTool.ts `target`): the prompts, topic or competitor, read from
 * the data in the person's words. A read is scoped to the call's brand, which
 * the precedence found in the person's scope before any card opens. Server
 * only; a failed read names nothing, and the engine falls back to the input.
 */

/** Some texts in quotes, the first few, and how many more: “a”, “b” +3. */
export function listWords(items: readonly string[], shown = 2): string | null {
  const words = items.map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (words.length === 0) return null;
  const head = words
    .slice(0, shown)
    .map((word) => `“${word.length > 60 ? `${word.slice(0, 59)}…` : word}”`);
  return words.length > shown ? `${head.join(', ')} +${words.length - shown}` : head.join(', ');
}

/** A topic's name, as the brand has it; null when it isn't the brand's. */
export async function topicName(topicId: string, brandId?: string): Promise<string | null> {
  let read = supabaseAdmin.from('topics').select('name').eq('id', topicId);
  if (brandId) read = read.eq('brand_id', brandId);
  const { data, error } = await read.maybeSingle();
  if (error) throw new Error(`Could not read the topic: ${error.message}`);
  return (data?.name as string | undefined) ?? null;
}

/** The ids of a brand's prompt sets: a prompt names its set, the set its brand. */
export async function brandPromptSets(brandId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);
  if (error) throw new Error(`Could not read the prompt sets: ${error.message}`);
  return (data ?? []).map((row) => row.id as string);
}

/** The texts of the brand's prompts among the ids. */
export async function promptTexts(brandId: string, ids: readonly string[]): Promise<string[]> {
  const sets = await brandPromptSets(brandId);
  if (sets.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('prompts')
    .select('text')
    .in('prompt_set_id', sets)
    .in('id', [...ids]);
  if (error) throw new Error(`Could not read the prompts: ${error.message}`);
  return (data ?? []).map((row) => row.text as string);
}

/** A competitor as it is shown: its name, and its domain when it has one. */
export function competitorWords(competitor: { name: string; domain?: string | null }): string {
  return competitor.domain ? `${competitor.name} (${competitor.domain})` : competitor.name;
}

/** One of the brand's competitors, in words; null when it isn't the brand's. */
export async function competitorName(
  competitorId: string,
  brandId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('competitors')
    .select('name, domain')
    .eq('id', competitorId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the competitor: ${error.message}`);
  return data ? competitorWords(data as { name: string; domain: string }) : null;
}

/** A Library draft's title; null when it isn't there. */
export async function draftTitle(draftId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('content_drafts')
    .select('title')
    .eq('id', draftId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the draft: ${error.message}`);
  return (data?.title as string | undefined) ?? null;
}

/** A Library draft's title and page; null when it isn't there. */
export async function draftPage(
  draftId: string,
): Promise<{ title: string; bodyHtml: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('content_drafts')
    .select('title, body_html')
    .eq('id', draftId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the draft: ${error.message}`);
  return data ? { title: String(data.title ?? ''), bodyHtml: String(data.body_html ?? '') } : null;
}

/**
 * Each `open` match with the text up to its `</name>` close, found by
 * searches that only go forward: a page full of unclosed tags stays linear
 * (a lazy `[\s\S]*?` up to a close that never comes is quadratic).
 */
function* closedBlocks(html: string, open: RegExp, name: (match: RegExpExecArray) => string) {
  const lower = html.toLowerCase();
  const unclosed = new Set<string>();
  open.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = open.exec(html))) {
    const tag = name(match).toLowerCase();
    if (unclosed.has(tag)) continue;
    const close = lower.indexOf(`</${tag}>`, open.lastIndex);
    if (close === -1) {
      unclosed.add(tag);
      continue;
    }
    yield {
      start: match.index,
      inner: html.slice(open.lastIndex, close),
      end: close + tag.length + 3,
    };
    open.lastIndex = close + tag.length + 3;
  }
}

/** HTML's text, roughly: its tags and entities dropped, its spaces folded. No DOM on the server. */
function plainText(html: string): string {
  let kept = '';
  let at = 0;
  for (const block of closedBlocks(html, /<(script|style)\b/gi, (match) => match[1])) {
    kept += `${html.slice(at, block.start)} `;
    at = block.end;
  }
  kept += html.slice(at);
  return kept
    .replace(/<[^<>]*>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A page's words and its H1–H3 headings' texts, from its HTML. */
function pageShape(html: string): { words: number; headings: string[] } {
  const text = plainText(html);
  const headings = Array.from(
    closedBlocks(html, /<h([1-3])\b[^<>]*>/gi, (match) => `h${match[1]}`),
    (block) => plainText(block.inner),
  ).filter(Boolean);
  return { words: text ? text.split(' ').length : 0, headings };
}

/**
 * What a change does to a page, for its card (update_draft): "Page changes:
 * 820 → 940 words · headings: +“Pricing for teams”, −“Old FAQ”". The full
 * difference is the editor's History.
 */
export function pageChanges(before: string, after: string): string {
  const was = pageShape(before);
  const now = pageShape(after);
  const added = now.headings.filter((heading) => !was.headings.includes(heading));
  const removed = was.headings.filter((heading) => !now.headings.includes(heading));
  const headings =
    added.length + removed.length === 0
      ? 'headings unchanged'
      : `headings: ${[
          ...added.slice(0, 2).map((heading) => `+${listWords([heading])}`),
          ...removed.slice(0, 2).map((heading) => `−${listWords([heading])}`),
          ...(added.length + removed.length > 4
            ? [`+${added.length + removed.length - 4} more`]
            : []),
        ].join(', ')}`;
  return `Page changes: ${was.words} → ${now.words} words · ${headings}`;
}
