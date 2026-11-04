import { z } from 'zod';
import { parseCsv } from '@/lib/promptImport';

/**
 * Brief › Your input (Content Editor Quality spec §6, CE-048): what only the
 * person can give a page, used only as they write it. Their first-hand
 * experience; their data (tables read from a CSV or Excel file in the
 * browser, or pasted, and GetCito data they chose to use); and expert
 * quotes from real people, word for word, each with its source. Kept per
 * draft beside the brief (content_draft_inputs, 00265): a rebuilt brief
 * leaves them.
 */

export const MAX_EXPERIENCE = 4000;
export const MAX_QUOTES = 10;
export const MAX_DATA_TABLES = 5;
/** The rows and columns a table keeps: enough for the agent to cite, small enough to store. */
export const MAX_DATA_ROWS = 100;
export const MAX_DATA_COLUMNS = 12;
export const MAX_DATA_CELL = 200;
export const MAX_GETCITO_DATA = 10;
/** What the database keeps of a draft's tables and its quotes (00265), as jsonb writes them. */
export const MAX_DATA_BYTES = 65_536;
export const MAX_QUOTES_BYTES = 16_384;

const utf8 = new TextEncoder();

/**
 * A value's size as Postgres writes jsonb as text, which its checks measure:
 * JSON with ", " and ": " between items. Kept under the database's limits,
 * a save isn't turned away.
 */
export function jsonbBytes(value: unknown): number {
  if (Array.isArray(value)) {
    return (
      2 +
      value.reduce<number>((sum, v) => sum + jsonbBytes(v), 0) +
      2 * Math.max(0, value.length - 1)
    );
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    return (
      2 +
      entries.reduce<number>(
        (sum, [key, v]) => sum + utf8.encode(JSON.stringify(key)).length + 2 + jsonbBytes(v),
        0,
      ) +
      2 * Math.max(0, entries.length - 1)
    );
  }
  return utf8.encode(JSON.stringify(value) ?? 'null').length;
}

const address = z
  .string()
  .trim()
  .max(2048)
  .pipe(z.url({ protocol: /^https?$/ }));

export const quoteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** Their title and company. */
  title: z.string().trim().min(1).max(160),
  /** The quote word for word. */
  text: z.string().trim().min(1).max(600),
  sourceUrl: address,
});
export type InputQuote = z.infer<typeof quoteSchema>;

export const dataTableSchema = z.object({
  name: z.string().trim().min(1).max(120),
  rows: z
    .array(
      z
        .array(z.string().refine((cell) => Array.from(cell).length <= MAX_DATA_CELL))
        .max(MAX_DATA_COLUMNS),
    )
    .min(1)
    .max(MAX_DATA_ROWS),
});
export type InputTable = z.infer<typeof dataTableSchema>;

/**
 * GetCito data the person chose to use: one tracked prompt's answers and
 * the brand's mentions in them, over the `days` up to `asOf` (Sources'
 * SOURCES_DAYS). Cited as "GetCito data, {month year}" of `asOf`.
 */
export const getcitoDataSchema = z.object({
  promptId: z.guid(),
  prompt: z.string().trim().min(1).max(500),
  answers: z.number().int().min(0),
  mentioned: z.number().int().min(0),
  /** The day it was read, "2026-10-24", in the person's time zone. */
  asOf: z.iso.date(),
  days: z.number().int().min(1).max(366),
});
export type GetCitoData = z.infer<typeof getcitoDataSchema>;

export const draftInputsSchema = z.object({
  experience: z.string().trim().max(MAX_EXPERIENCE),
  data: z
    .array(dataTableSchema)
    .max(MAX_DATA_TABLES)
    .refine((tables) => jsonbBytes(tables) <= MAX_DATA_BYTES),
  getcitoData: z.array(getcitoDataSchema).max(MAX_GETCITO_DATA),
  quotes: z
    .array(quoteSchema)
    .max(MAX_QUOTES)
    .refine((quotes) => jsonbBytes(quotes) <= MAX_QUOTES_BYTES),
});
export type DraftInputs = z.infer<typeof draftInputsSchema>;

export const NO_INPUTS: DraftInputs = { experience: '', data: [], getcitoData: [], quotes: [] };

/**
 * The input as kept, item by item: one that no longer reads as the schema
 * does (a limit tightened since) is left out, not the rest with it, so the
 * next save doesn't write over what still reads.
 */
export function keptInputs(row: {
  experience: unknown;
  data: unknown;
  getcitoData: unknown;
  quotes: unknown;
}): DraftInputs {
  const items = <T>(schema: z.ZodType<T>, value: unknown, max: number): T[] =>
    (Array.isArray(value) ? value : [])
      .flatMap((item) => {
        const read = schema.safeParse(item);
        return read.success ? [read.data] : [];
      })
      .slice(0, max);
  return {
    experience:
      typeof row.experience === 'string' ? row.experience.trim().slice(0, MAX_EXPERIENCE) : '',
    data: items(dataTableSchema, row.data, MAX_DATA_TABLES),
    getcitoData: items(getcitoDataSchema, row.getcitoData, MAX_GETCITO_DATA),
    quotes: items(quoteSchema, row.quotes, MAX_QUOTES),
  };
}

/**
 * Rows as a table keeps them: MAX_DATA_ROWS and MAX_DATA_COLUMNS at most,
 * each cell cut to MAX_DATA_CELL characters (never half of one) and without
 * the NUL character, which the database refuses.
 */
export function keptRows(rows: string[][]): string[][] {
  return rows
    .slice(0, MAX_DATA_ROWS)
    .map((row) =>
      row
        .slice(0, MAX_DATA_COLUMNS)
        .map((cell) => Array.from(cell.replaceAll('\0', '')).slice(0, MAX_DATA_CELL).join('')),
    );
}

/**
 * Numbers pasted as rows: a copy from Excel or Google Sheets is separated by
 * tabs, a CSV by commas or semicolons.
 */
export function pastedRows(text: string): string[][] {
  const first = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  if (!first.includes('\t')) return parseCsv(text);
  return text
    .split(/\r?\n/)
    .map((line) => line.split('\t').map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell !== ''));
}

/**
 * A new table as the draft can keep it beside its others: its rows from the
 * first, as many as fit in MAX_DATA_BYTES (none when none do).
 */
export function tableThatFits(tables: InputTable[], table: InputTable): InputTable {
  let rows = table.rows.length;
  while (
    rows > 0 &&
    jsonbBytes([...tables, { ...table, rows: table.rows.slice(0, rows) }]) > MAX_DATA_BYTES
  ) {
    rows--;
  }
  return { ...table, rows: table.rows.slice(0, rows) };
}

/** Which kinds of input the person gave, used or not. */
export interface InputsGiven {
  experience: boolean;
  data: boolean;
  quote: boolean;
}

/** Which kinds of input the person gave, used or not. */
export function inputsGiven(inputs: DraftInputs): InputsGiven {
  return {
    experience: inputs.experience.trim().length > 0,
    data: inputs.data.length > 0 || inputs.getcitoData.length > 0,
    quote: inputs.quotes.length > 0,
  };
}

/** Text as the checks compare it: lower case, no double quotes, one kind of dash, single spaces. */
const plain = (text: string) =>
  text
    .toLowerCase()
    .replace(/[“”„«»"]/g, '')
    .replace(/[‘’`']/g, "'")
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();

/** Thousands separators out ("1,250" and "1250" alike), and dates, whose pieces are no one's data. */
const numbersOnly = (text: string) =>
  text
    .replace(/\b\d{4}-\d{1,2}(?:-\d{1,2})?\b/g, ' ')
    .replace(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g, ' ')
    .replace(/(?<=\d)[.,](?=\d{3}(?!\d))/g, '');

/**
 * The figures in a text that can only be someone's data: a share ("42%",
 * "%42"), a decimal ("3.5"), or three digits or more that aren't a year.
 * "3 steps", "28 days" and "in 2026" are anyone's.
 */
function figuresIn(text: string): string[] {
  const figures: string[] = [];
  for (const m of numbersOnly(text).matchAll(/(%\s?)?(\d+(?:[.,]\d+)?)(\s?%)?/g)) {
    const n = m[2].replace(',', '.');
    const decimal = n.includes('.');
    if (m[1] || m[3]) {
      if (decimal || n.length >= 2) figures.push(`${n}%`);
    } else if (decimal || (n.length >= 3 && !/^(19|20)\d{2}$/.test(n))) {
      figures.push(n);
    }
  }
  return figures;
}

/** The page's sentences, each with its whole numbers. */
const sentenceNumbers = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => new Set(numbersOnly(sentence).match(/\d+/g) ?? []));

/**
 * The experience's runs of three words that say something (a word of five
 * letters or more among them): a page that only shares its topic or common
 * words with it doesn't use it.
 */
function runsOf(text: string): Set<string> {
  const words = plain(text).match(/[\p{L}\p{N}']+/gu) ?? [];
  const runs = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) {
    const run = words.slice(i, i + 3);
    if (run.some((word) => word.length >= 5)) runs.add(run.join(' '));
  }
  return runs;
}

/** The share of the experience's runs the page must have, and the fewest. */
const EXPERIENCE_SHARE = 0.3;
const EXPERIENCE_RUNS = 3;

/** A quote as said, without the marks around it: "…we work." and "…we work," alike. */
const saidOf = (text: string) => plain(text).replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');

/**
 * What the page uses of the person's input, only as far as it can be read:
 * - a quote word for word;
 * - a figure from their data (figuresIn), or a prompt's answers and mentions
 *   from GetCito data in one sentence;
 * - their experience by its own words: EXPERIENCE_SHARE of its runs of three
 *   words, EXPERIENCE_RUNS at least.
 * An input not given isn't used.
 */
export function inputsUsed(
  pageText: string,
  inputs: DraftInputs,
): { experience: boolean; data: boolean; quote: boolean } {
  const page = plain(pageText);

  const runs = runsOf(inputs.experience);
  const pageRuns = runsOf(pageText);
  const shared = [...runs].filter((run) => pageRuns.has(run)).length;
  const experience =
    runs.size >= EXPERIENCE_RUNS &&
    shared >= Math.max(EXPERIENCE_RUNS, Math.ceil(runs.size * EXPERIENCE_SHARE));

  const pageFigures = new Set(figuresIn(pageText));
  const sentences = sentenceNumbers(pageText);
  const data =
    inputs.data.some((table) =>
      table.rows
        .flat()
        .flatMap(figuresIn)
        .some((n) => pageFigures.has(n)),
    ) ||
    inputs.getcitoData.some((d) =>
      sentences.some(
        (numbers) => numbers.has(String(d.answers)) && numbers.has(String(d.mentioned)),
      ),
    );

  const quote = inputs.quotes.some((q) => {
    const said = saidOf(q.text);
    return said.length > 0 && page.includes(said);
  });
  return { experience, data, quote };
}
