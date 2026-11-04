import { csvLine, toCsv } from '@/lib/csv';
import { mentionPlatformLabel } from '@/lib/mentionsHeadline';
import type { MentionRow } from '@/lib/mentionsList';
import { withFileWord } from '@/lib/white-label/kit';

/**
 * Export CSV on the Mentions & Sentiment page (MS-13): the mentions under the
 * page's filters, one row per answer naming the brand, under a few lines that
 * say what the file holds (the filters and the n values, spec §16), so a file
 * read later or elsewhere still says what it was taken over.
 */

/** The most mentions one file holds: 50 of the table's pages. */
export const MENTIONS_EXPORT_CAP = 5000;

/** A line above the rows: a label and its value, in the reader's language. */
export interface ExportFact {
  label: string;
  value: string | number;
}

export const MENTION_EXPORT_HEADERS = [
  'date_utc',
  'prompt',
  'topic',
  'platform',
  'model',
  'country',
  'sentiment',
  'times_named',
  'position',
  'brands_named',
  'co_mentioned',
  'excerpt',
];

function exportRow(row: MentionRow): Record<string, string | number | null> {
  return {
    date_utc: utcMinute(row.createdAt),
    prompt: row.promptText,
    topic: row.topicName,
    platform: mentionPlatformLabel(row.platform),
    model: row.model,
    country: row.region,
    sentiment: row.sentiment,
    times_named: row.occurrences,
    position: row.position,
    brands_named: row.brandsNamed,
    co_mentioned: row.coMentioned.map((c) => c.name).join('; '),
    excerpt: row.excerpt,
  };
}

/** The file: the facts, a blank line, then the rows under their header. */
export function mentionsCsv(facts: ExportFact[], rows: MentionRow[]): string {
  const head = facts.map((fact) => csvLine([fact.label, fact.value]));
  return [...head, '', toCsv(rows.map(exportRow), MENTION_EXPORT_HEADERS)].join('\n');
}

/**
 * "getcito_acme-coffee_mentions_2026-10-17.csv", as the other pages name
 * theirs; `word` is a white label kit's in GetCito's place, or none.
 */
export function mentionsExportFileName(
  slug: string,
  now = new Date(),
  word: string | null = 'getcito',
): string {
  return withFileWord(word, `${slug || 'brand'}_mentions_${now.toISOString().slice(0, 10)}.csv`);
}

/** A moment as the file states it: "2026-10-17 09:12", in UTC. */
export function utcMinute(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16).replace('T', ' ');
}
