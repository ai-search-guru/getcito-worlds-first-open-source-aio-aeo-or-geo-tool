import supabaseAdmin from '../config/supabase.js';
import { qualityPhase } from './contentQuality.js';

/**
 * Brief › Your input (Content Editor Quality spec §6, CE-048): what only the
 * person can give a page (content_draft_inputs, 00265) — their first-hand
 * experience, their data (their own tables, and GetCito data they chose)
 * and expert quotes — numbered after the draft's other sources, as the
 * person gave them. The agent writes from them and adds nothing beyond
 * them: a number it writes must be in a source's words (contentSources.js)
 * and a person or a quote in what it was given (contentPeople.js), and
 * these are. Read with Quality's second phase only.
 *
 * Each is { kind: 'input', ref, label, detail }: the label short, as a
 * "Based on" chip shows it; the detail the words the model reads and the
 * guards read numbers, names and quotes from.
 */

/** A table's rows as the model reads them, at most: enough to cite, not a page of cells. */
export const TABLE_CHARS = 3000;
/** An experience's first words, as its chip names it. */
const LABEL_CHARS = 80;

/** Characters, never half of one (an emoji), as many as `max`. */
const cut = (text, max) => Array.from(text).slice(0, max).join('');

/**
 * The person's words as the prompt lists them: on one line (a line break
 * would start a line of its own in the list), straight double quotes as
 * single ones (they'd close the quotes around them), cut to `max`.
 */
const textOf = (value, max) =>
  typeof value === 'string'
    ? cut(value.replace(/\s+/g, ' ').replace(/"/g, "'").trim(), max).trimEnd()
    : '';
const listOf = (value) => (Array.isArray(value) ? value : []);

/** "2026-10-24" as GetCito data is cited: "October 2026". */
function monthOf(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) return null;
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The draft's input as kept, or null: none given, or Quality's second phase not live. */
export async function readDraftInputs(draftId) {
  if (qualityPhase() < 2) return null;
  const { data, error } = await supabaseAdmin
    .from('content_draft_inputs')
    .select('experience, data, getcito_data, quotes')
    .eq('draft_id', draftId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * The input as sources, in the order Brief › Your input lists it: the
 * experience, each table, each prompt's GetCito data, each quote. An item
 * missing what makes it real (a quote without its name, title, words or an
 * http(s) source) is left out. `brandName` is who GetCito data counts.
 *
 * What only places a source (a quote's address, the days GetCito data
 * covers) is its `note`: the model reads it, the guards don't, so its
 * digits are no number the agent may write (sourceWords). Refs are by
 * place in the list, for a chip to open Your input by: an item removed
 * since moves the ones after it, so none is looked up by its ref.
 */
export function inputSources(row, brandName) {
  if (!row) return [];
  const sources = [];

  const experience = textOf(row.experience, 4000);
  if (experience) {
    sources.push({
      kind: 'input',
      ref: 'experience',
      label:
        Array.from(experience).length > LABEL_CHARS
          ? `${cut(experience, LABEL_CHARS).trimEnd()}…`
          : experience,
      detail: `Their experience, first-hand: ${experience}`,
    });
  }

  listOf(row.data)
    .slice(0, 5)
    .forEach((table, i) => {
      const name = textOf(table?.name, 120);
      const all = listOf(table?.rows)
        .filter(Array.isArray)
        .map((cells) => cells.map((cell) => textOf(String(cell ?? ''), 200)).join(' | '))
        .join('; ');
      // A table cut says so: its rows go on past what the model reads.
      const rows =
        Array.from(all).length > TABLE_CHARS ? `${cut(all, TABLE_CHARS)}… (first rows)` : all;
      if (name && rows) {
        sources.push({
          kind: 'input',
          ref: `data:${i + 1}`,
          label: name,
          detail: `Their own data, a table: ${rows}`,
        });
      }
    });

  for (const d of listOf(row.getcito_data).slice(0, 10)) {
    const prompt = textOf(d?.prompt, 500);
    const month = monthOf(d?.asOf);
    if (
      typeof d?.promptId !== 'string' ||
      !prompt ||
      !month ||
      !Number.isInteger(d.answers) ||
      !Number.isInteger(d.mentioned) ||
      !Number.isInteger(d.days)
    ) {
      continue;
    }
    // The share, as a page says it: "named in 3.4% of AI answers".
    const share = d.answers > 0 ? ` (${Math.round((d.mentioned / d.answers) * 1000) / 10}%)` : '';
    sources.push({
      kind: 'input',
      ref: `getcito:${d.promptId}`,
      label: prompt,
      // The days are the data the person chose: the page may say them. The
      // date is a note: its digits are no figure.
      detail: `GetCito data: ${brandName || 'the brand'} was named in ${d.mentioned} of ${d.answers} AI answers to this prompt over the last ${d.days} days${share}. Cite it as "GetCito data, ${month}"`,
      note: `to ${d.asOf}`,
    });
  }

  listOf(row.quotes)
    .slice(0, 10)
    .forEach((q, i) => {
      const name = textOf(q?.name, 120);
      const title = textOf(q?.title, 160);
      const said = textOf(q?.text, 600);
      const url = typeof q?.sourceUrl === 'string' ? q.sourceUrl.trim().slice(0, 2048) : '';
      if (!name || !title || !said || !/^https?:\/\/\S+$/i.test(url)) return;
      sources.push({
        kind: 'input',
        ref: `quote:${i + 1}`,
        label: `${name}, ${title}`,
        detail: `An expert's words, to quote word for word with their name and title: "${said}"`,
        note: `said at ${url}`,
      });
    });

  return sources;
}
