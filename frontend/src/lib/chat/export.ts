import { marked, type Token, type Tokens } from 'marked';
import type { Sheet } from 'write-excel-file/node';
import type { DraftBlock, DraftRun } from '@/lib/content/draftExport';
import { safeLinkHref } from '@/lib/content/editor';
import { csvLine } from '@/lib/csv';
import { slugify } from '@/lib/slug';
import { dayIn } from '@/lib/timeZone';

/**
 * Download on an answer (CHAT-06 items 30–42): the answer as Markdown, Word
 * or PDF, and its tables as CSV or Excel, rendered from the stored
 * content_md with no model call. This file reads the answer: its blocks (the
 * Content Editor's export model, so Word is written by the same code), its
 * tables, the formats it offers and its file name. exportFile.ts writes the
 * files on the server.
 *
 * Every file carries the answer's "Generated … · Data as of …" line (item
 * 40): the first line of Markdown, the header and footer of Word and PDF,
 * the first row of a CSV and of each sheet. The caller words it from
 * messages/en.json, as the app shows it under the answer.
 */

export type AnswerExportFormat = 'md' | 'docx' | 'pdf' | 'csv' | 'xlsx';

/** The formats, in the order Download lists them (item 32). */
export const ANSWER_EXPORT_FORMATS = [
  'md',
  'docx',
  'pdf',
  'csv',
  'xlsx',
] as const satisfies readonly AnswerExportFormat[];

/** An answer to export, as chat_messages keeps it. */
export interface ExportAnswer {
  /** The answer's Markdown (content_md). */
  markdown: string;
  /** The question it answered: the file's title, and its slug the file's name. */
  question: string;
  /** The chat's title: the file's name when the question is longer than 60 characters. */
  chatTitle?: string | null;
  /** When it was generated (UTC), and the IANA time zone it was shown in: the file's date. */
  generatedAt: string;
  timezone?: string | null;
  /** "Generated Oct 26, 2026 · 09:14 GMT+3 · Data as of …", worded by the caller. */
  stamp: string;
  /** The app's origin, so a link to an app page ("/dashboard/…") opens from the file. */
  appOrigin?: string | null;
}

/** A table in an answer: the heading above it, if any, its header and its rows, as text. */
export interface AnswerTable {
  name: string | null;
  header: string[];
  rows: string[][];
}

/** A file name's longest slug, and the question length past which the chat's title names it. */
const SLUG_MAX = 60;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Text with the few HTML entities Markdown may hold written out. */
function decode(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * A link's address in a file: a web or mail address as it is, an app page
 * made whole with the app's origin, anything else (javascript:, a page with
 * no origin to open it from) no link at all.
 */
export function exportHref(href: string, appOrigin?: string | null): string | undefined {
  const safe = safeLinkHref(href);
  if (!safe) return undefined;
  if (!safe.startsWith('/')) return safe;
  if (!appOrigin) return undefined;
  try {
    return new URL(safe, appOrigin).href;
  } catch {
    return undefined;
  }
}

type Format = Pick<DraftRun, 'bold' | 'italics' | 'link'>;

const sameFormat = (a: DraftRun, b: DraftRun) =>
  !a.break && !b.break && a.bold === b.bold && a.italics === b.italics && a.link === b.link;

/** The inline tokens as runs; a line break in the text breaks the line, as the app shows it. */
function inlineRuns(tokens: Token[] | undefined, appOrigin?: string | null): DraftRun[] {
  const runs: DraftRun[] = [];
  const push = (text: string, format: Format) => {
    text.split('\n').forEach((part, i) => {
      if (i > 0) runs.push({ text: '', break: true });
      if (!part) return;
      const run: DraftRun = { text: part, ...format };
      const last = runs.at(-1);
      if (last && sameFormat(last, run)) last.text += part;
      else runs.push(run);
    });
  };
  const walk = (list: Token[] | undefined, format: Format) => {
    for (const token of list ?? []) {
      switch (token.type) {
        case 'strong':
          walk((token as Tokens.Strong).tokens, { ...format, bold: true });
          break;
        case 'em':
          walk((token as Tokens.Em).tokens, { ...format, italics: true });
          break;
        case 'del':
          walk((token as Tokens.Del).tokens, format);
          break;
        case 'link': {
          const link = token as Tokens.Link;
          const href = exportHref(link.href, appOrigin);
          walk(link.tokens, href ? { ...format, link: href } : format);
          break;
        }
        case 'image':
          push(decode((token as Tokens.Image).text), format);
          break;
        case 'br':
          runs.push({ text: '', break: true });
          break;
        case 'html': {
          const html = (token as Tokens.HTML).text;
          if (/^<br\s*\/?>$/i.test(html.trim())) runs.push({ text: '', break: true });
          else push(decode(html.replace(/<[^>]*>/g, '')), format);
          break;
        }
        case 'text': {
          const text = token as Tokens.Text;
          if (text.tokens?.length) walk(text.tokens, format);
          else push(decode(text.text), format);
          break;
        }
        case 'codespan':
          push(decode((token as Tokens.Codespan).text), format);
          break;
        default:
          if ('text' in token && typeof token.text === 'string') push(decode(token.text), format);
      }
    }
  };
  walk(tokens, {});
  while (runs.at(-1)?.break) runs.pop();
  while (runs[0]?.break) runs.shift();
  return runs;
}

/** A run list's text on one line. */
export function runsText(runs: DraftRun[]): string {
  return runs
    .map((run) => (run.break ? ' ' : run.text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The answer's Markdown as blocks: headings, paragraphs, quotes, list items and tables. */
export function answerBlocks(markdown: string, appOrigin?: string | null): DraftBlock[] {
  const blocks: DraftBlock[] = [];
  const counter = { lists: 0 };

  const paragraph = (tokens: Token[] | undefined) => {
    const runs = inlineRuns(tokens, appOrigin);
    if (runs.length) blocks.push({ kind: 'paragraph', runs });
  };

  const list = (token: Tokens.List, level: number) => {
    const id = ++counter.lists;
    const start = typeof token.start === 'number' ? token.start : 1;
    token.items.forEach((item, i) => {
      const lead: DraftRun[] = item.task ? [{ text: item.checked ? '[x] ' : '[ ] ' }] : [];
      let first = true;
      for (const child of item.tokens) {
        if (child.type === 'checkbox') continue;
        if (first && (child.type === 'text' || child.type === 'paragraph')) {
          const runs = [
            ...lead,
            ...inlineRuns((child as Tokens.Text).tokens ?? [child], appOrigin),
          ];
          blocks.push({
            kind: 'item',
            ordered: token.ordered,
            level,
            list: id,
            n: start + i,
            runs,
          });
          first = false;
        } else if (child.type === 'list') {
          list(child as Tokens.List, Math.min(level + 1, 3));
        } else {
          block(child);
        }
      }
      if (first) {
        blocks.push({
          kind: 'item',
          ordered: token.ordered,
          level,
          list: id,
          n: start + i,
          runs: lead,
        });
      }
    });
  };

  const block = (token: Token) => {
    switch (token.type) {
      case 'heading': {
        const heading = token as Tokens.Heading;
        const runs = inlineRuns(heading.tokens, appOrigin);
        if (runs.length) {
          blocks.push({ kind: 'heading', level: Math.min(heading.depth, 3) as 1 | 2 | 3, runs });
        }
        break;
      }
      case 'paragraph':
      case 'text':
        paragraph((token as Tokens.Paragraph).tokens ?? [token]);
        break;
      case 'blockquote': {
        const paragraphs = (token as Tokens.Blockquote).tokens
          .map((child) =>
            inlineRuns(
              'tokens' in child && Array.isArray(child.tokens) ? child.tokens : [child],
              appOrigin,
            ),
          )
          .filter((runs) => runs.length);
        if (paragraphs.length) blocks.push({ kind: 'quote', paragraphs });
        break;
      }
      case 'list':
        list(token as Tokens.List, 0);
        break;
      case 'table': {
        const table = token as Tokens.Table;
        blocks.push({
          kind: 'table',
          rows: [
            { header: true, cells: table.header.map((cell) => inlineRuns(cell.tokens, appOrigin)) },
            ...table.rows.map((row) => ({
              header: false,
              cells: row.map((cell) => inlineRuns(cell.tokens, appOrigin)),
            })),
          ],
        });
        break;
      }
      case 'code': {
        const lines = (token as Tokens.Code).text.split('\n');
        const runs = lines.flatMap((line, i): DraftRun[] =>
          i === 0 ? [{ text: line }] : [{ text: '', break: true }, { text: line }],
        );
        blocks.push({ kind: 'paragraph', runs: runs.filter((run) => run.break || run.text) });
        break;
      }
      case 'html': {
        const text = decode((token as Tokens.HTML).text.replace(/<[^>]*>/g, '')).trim();
        if (text) blocks.push({ kind: 'paragraph', runs: [{ text }] });
        break;
      }
      // space, hr, def: nothing to write.
    }
  };

  for (const token of marked.lexer(markdown ?? '')) block(token);
  return blocks;
}

/** The answer's blocks under its question, as Word and PDF lay them out. */
export function answerDocumentBlocks(answer: ExportAnswer): DraftBlock[] {
  const title = answerTitle(answer);
  return [
    ...(title ? [{ kind: 'heading' as const, level: 1 as const, runs: [{ text: title }] }] : []),
    ...answerBlocks(answer.markdown, answer.appOrigin),
  ];
}

/** The answer's tables, each named by the heading above it (none above: null). */
export function answerTables(markdown: string): AnswerTable[] {
  const tables: AnswerTable[] = [];
  let heading: string | null = null;
  for (const block of answerBlocks(markdown)) {
    if (block.kind === 'heading') heading = runsText(block.runs) || null;
    if (block.kind !== 'table') continue;
    const [head, ...rows] = block.rows;
    const header = head.cells.map(runsText);
    tables.push({
      name: heading,
      header,
      rows: rows.map((row) => header.map((_, i) => runsText(row.cells[i] ?? []))),
    });
  }
  return tables;
}

/** What Download offers for an answer (item 32): CSV and Excel only when it has a table. */
export function answerFormats(markdown: string): AnswerExportFormat[] {
  const hasTable = answerTables(markdown).length > 0;
  return ANSWER_EXPORT_FORMATS.filter(
    (format) => hasTable || (format !== 'csv' && format !== 'xlsx'),
  );
}

/** The question the file is titled by; the chat's title when there is no question. */
export function answerTitle(answer: ExportAnswer): string {
  return answer.question.trim() || answer.chatTitle?.trim() || '';
}

/**
 * "why-perplexity-dropped-2026-10-26.pdf" (item 34): the question's slug, or
 * the chat title's when the question is longer than 60 characters, and the
 * day it was generated in its time zone.
 */
export function answerFileName(answer: ExportAnswer, extension: string): string {
  const question = answer.question.trim();
  const source =
    question.length > SLUG_MAX
      ? answer.chatTitle?.trim() || question
      : question || answer.chatTitle || '';
  const slug = slugify(source).slice(0, SLUG_MAX).replace(/-+$/, '') || 'answer';
  return `${slug}-${dayIn(answer.generatedAt, answer.timezone || 'UTC')}.${extension}`;
}

/** Markdown's app-page links made whole, so they open from the downloaded file. */
function wholeLinks(markdown: string, appOrigin?: string | null): string {
  if (!appOrigin) return markdown;
  const origin = appOrigin.replace(/\/+$/, '');
  return markdown
    .replace(/\]\((\/(?![/\\])[^)\s]*)/g, (_, path: string) => `](${origin}${path}`)
    .replace(
      /^(\s*\[[^\]]+\]:\s*)(\/(?![/\\])\S*)/gm,
      (_, label: string, path: string) => `${label}${origin}${path}`,
    );
}

/** Export Markdown: the line first, the question as its title, then the answer as stored. */
export function answerMarkdown(answer: ExportAnswer): string {
  const title = answerTitle(answer);
  const body = wholeLinks(answer.markdown ?? '', answer.appOrigin).trim();
  return [answer.stamp, ...(title ? [`# ${title}`] : []), body].join('\n\n') + '\n';
}

/** One table as CSV: the line first, then its header and rows. The caller adds the byte order mark. */
export function tableCsv(table: AnswerTable, stamp: string): string {
  return [csvLine([stamp]), csvLine(table.header), ...table.rows.map(csvLine)].join('\n');
}

/** A cell's value in a sheet: a plain number as a number, Excel's to sum; anything else as text. */
function sheetValue(text: string): string | number {
  const plain = /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(text);
  return plain ? Number(text.replace(/,/g, '')) : text;
}

/** A sheet's name, as Excel takes one: 31 characters, none of []:*?/\, and once per file. */
function sheetName(name: string | null, n: number, taken: Set<string>): string {
  const base =
    (name ?? '')
      .replace(/[[\]:*?/\\]/g, ' ')
      .replace(/^'+|'+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 31)
      .trim() || `Table ${n}`;
  let candidate = base;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) {
    const suffix = ` (${i})`;
    candidate = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** Export Excel: one sheet per table (item 32), the line first, then a bold header and the rows. */
export function answerSheets(answer: ExportAnswer): Sheet<Buffer>[] {
  const taken = new Set<string>();
  return answerTables(answer.markdown).map((table, i) => {
    const widths = table.header.map((head, c) =>
      Math.min(60, Math.max(10, head.length, ...table.rows.map((row) => row[c].length)) + 2),
    );
    return {
      sheet: sheetName(table.name, i + 1, taken),
      columns: widths.map((width) => ({ width })),
      data: [
        [{ value: answer.stamp, color: '#6B7280' }],
        table.header.map((value) => ({ value, fontWeight: 'bold' as const })),
        ...table.rows.map((row) => row.map(sheetValue)),
      ],
    };
  });
}
