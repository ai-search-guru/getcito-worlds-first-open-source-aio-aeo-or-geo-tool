import type { Sheet } from 'write-excel-file/browser';
import { BYTE_ORDER_MARK } from '@/lib/action-center/export';
import { toCsv } from '@/lib/csv';
import { slugify } from '@/lib/slug';
import { withFileWord } from '@/lib/white-label/kit';
import { ELEMENT_NODE, TEXT_NODE, parseHtml } from './dom';
import { safeLinkHref } from './editor';
import { pageFields, withoutLeadingH1 } from './readyToPublish';

/**
 * Export in the Content Editor: the page as Word, Excel, CSV, HTML or
 * Markdown, from the HTML Copy HTML gives (publishableHtml). HTML is that
 * page as a document of its own. Word and Markdown read it as blocks first:
 * headings, paragraphs, quotes, lists, tables, and anything else an HTML
 * block holds. Markdown keeps that last as HTML, Word keeps its text. Excel
 * and CSV hold the page as one row, for a CMS's import (pageSheetRow). The
 * schema JSON-LD is the page's markup, not its text, so only the HTML file
 * carries it.
 */

export type DraftExportFormat = 'docx' | 'xlsx' | 'csv' | 'html' | 'md';

/** The formats, in the order Export lists them. */
export const DRAFT_EXPORT_FORMATS = [
  'docx',
  'xlsx',
  'csv',
  'html',
  'md',
] as const satisfies readonly DraftExportFormat[];

/**
 * The page fields an export carries next to the content (Quality spec §7b,
 * CE-057): Word's as a table on page 1, Markdown's as front matter, HTML's
 * in its head.
 */
export interface ExportFields {
  /** Word's table: each field's label and value, and the line above it. */
  table: { note: string; rows: [label: string, value: string][] };
  /** Markdown's front matter, in order. */
  front: Record<string, string>;
  /** HTML's head. */
  head: { title: string; description: string; author: string; reviewer?: string };
}

/** A stretch of text with one format; a link carries its address. */
export interface DraftRun {
  text: string;
  bold?: boolean;
  italics?: boolean;
  link?: string;
  /** A line break (a <br>), with no text. */
  break?: boolean;
}

export type DraftBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; runs: DraftRun[] }
  | { kind: 'paragraph'; runs: DraftRun[] }
  | { kind: 'quote'; paragraphs: DraftRun[][] }
  /** One list item; `list` tells a numbered list's items from the next list's. */
  | { kind: 'item'; ordered: boolean; level: number; list: number; n: number; runs: DraftRun[] }
  | { kind: 'table'; rows: { header: boolean; cells: DraftRun[][] }[] }
  /** Anything else, as an HTML block holds it: its HTML, and the blocks inside it. */
  | { kind: 'html'; html: string; blocks: DraftBlock[] };

const childrenOf = (el: Element) => Array.from(el.childNodes);

const HEADINGS: Record<string, 1 | 2 | 3> = { h1: 1, h2: 2, h3: 3, h4: 3, h5: 3, h6: 3 };
const SKIPPED = new Set(['script', 'style', 'template', 'noscript']);

function sameFormat(a: DraftRun, b: DraftRun) {
  return !a.break && !b.break && a.bold === b.bold && a.italics === b.italics && a.link === b.link;
}

/** The runs in some nodes: whitespace collapsed as a browser shows it, trimmed at the ends. */
function inlineRuns(nodes: Node[]): DraftRun[] {
  const runs: DraftRun[] = [];
  const walk = (node: Node, format: Omit<DraftRun, 'text'>) => {
    if (node.nodeType === TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ');
      if (!text) return;
      const last = runs.at(-1);
      if (last && sameFormat(last, { text, ...format })) last.text += text;
      else runs.push({ text, ...format });
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIPPED.has(tag)) return;
    if (tag === 'br') {
      runs.push({ text: '', break: true });
      return;
    }
    if (tag === 'img') {
      const src = safeLinkHref(el.getAttribute('src') ?? '');
      const alt = el.getAttribute('alt')?.trim() || 'Image';
      runs.push({ text: `[${alt}]`, ...format, ...(src ? { link: src } : {}) });
      return;
    }
    const next = { ...format };
    if (tag === 'strong' || tag === 'b') next.bold = true;
    if (tag === 'em' || tag === 'i') next.italics = true;
    if (tag === 'a') {
      const href = safeLinkHref(el.getAttribute('href') ?? '');
      if (href) next.link = href;
    }
    el.childNodes.forEach((child) => walk(child, next));
  };
  nodes.forEach((node) => walk(node, {}));
  // Trimmed at the ends, as a browser shows a block's text.
  while (runs.length && !runs[0].break && !runs[0].text.trim()) runs.shift();
  while (runs.length && !runs.at(-1)!.break && !runs.at(-1)!.text.trim()) runs.pop();
  if (runs.length && !runs[0].break) runs[0].text = runs[0].text.trimStart();
  if (runs.length && !runs.at(-1)!.break) runs.at(-1)!.text = runs.at(-1)!.text.trimEnd();
  return runs;
}

/** A list's items in order, a nested list's one level down. */
function listItems(list: Element, level: number, counter: { lists: number }): DraftBlock[] {
  const ordered = list.tagName.toLowerCase() === 'ol';
  const id = counter.lists++;
  const items: DraftBlock[] = [];
  let n = 0;
  for (const li of Array.from(list.children)) {
    if (li.tagName.toLowerCase() !== 'li') continue;
    n += 1;
    // The item's own text, without the lists nested in it.
    const own = li.cloneNode(true) as Element;
    own.querySelectorAll('ul, ol').forEach((nested) => nested.remove());
    items.push({ kind: 'item', ordered, level, list: id, n, runs: inlineRuns(childrenOf(own)) });
    for (const nested of Array.from(li.children)) {
      const tag = nested.tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol') items.push(...listItems(nested, level + 1, counter));
    }
  }
  return items;
}

function tableRows(table: Element): Extract<DraftBlock, { kind: 'table' }>['rows'] {
  return Array.from(table.querySelectorAll('tr'))
    .filter((tr) => tr.closest('table') === table)
    .map((tr) => {
      const cells = Array.from(tr.children).filter((c) => /^t[hd]$/i.test(c.tagName));
      return {
        header: cells.length > 0 && cells.every((c) => c.tagName.toLowerCase() === 'th'),
        cells: cells.map((c) => inlineRuns(childrenOf(c))),
      };
    });
}

function blocksIn(parent: Element, counter: { lists: number }): DraftBlock[] {
  const blocks: DraftBlock[] = [];
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === TEXT_NODE) {
      // Loose text between blocks, as an HTML block may leave it.
      const runs = inlineRuns([node]);
      if (runs.length) blocks.push({ kind: 'paragraph', runs });
      continue;
    }
    if (node.nodeType !== ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIPPED.has(tag)) continue;
    if (tag in HEADINGS) {
      blocks.push({ kind: 'heading', level: HEADINGS[tag], runs: inlineRuns(childrenOf(el)) });
    } else if (tag === 'p') {
      const runs = inlineRuns(childrenOf(el));
      if (runs.length) blocks.push({ kind: 'paragraph', runs });
    } else if (tag === 'blockquote') {
      const inner = el.querySelector('p') ? Array.from(el.querySelectorAll('p')) : [el];
      const paragraphs = inner.map((p) => inlineRuns(childrenOf(p))).filter((runs) => runs.length);
      if (paragraphs.length) blocks.push({ kind: 'quote', paragraphs });
    } else if (tag === 'ul' || tag === 'ol') {
      blocks.push(...listItems(el, 0, counter));
    } else if (tag === 'table') {
      const rows = tableRows(el);
      if (rows.length) blocks.push({ kind: 'table', rows });
    } else if (tag === 'img') {
      blocks.push({ kind: 'paragraph', runs: inlineRuns([el]) });
    } else {
      blocks.push({ kind: 'html', html: el.outerHTML, blocks: blocksIn(el, counter) });
    }
  }
  return blocks;
}

const text = (runs: DraftRun[]) => runs.map((r) => (r.break ? '\n' : r.text)).join('');

/**
 * The page as blocks. A page without an H1 opens with its title as one, so
 * the file says what it is.
 */
export function draftBlocks(
  title: string,
  html: string,
  /** Shared by pages that go in one file, so each list numbers on its own. */
  counter: { lists: number } = { lists: 0 },
): DraftBlock[] {
  const doc = parseHtml(`<body>${html}</body>`);
  const blocks = blocksIn(doc.body, counter);
  const hasTitle = blocks.some((b) => b.kind === 'heading' && b.level === 1);
  return hasTitle || !title.trim()
    ? blocks
    : [{ kind: 'heading', level: 1, runs: [{ text: title.trim() }] }, ...blocks];
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A value for an attribute in double quotes: its quotes escaped too. */
const escapeAttribute = (value: string) => escapeHtml(value).replace(/"/g, '&quot;');

/** Export HTML: Copy HTML's page as a document of its own, titled. */
export function draftHtmlDocument(title: string, html: string, fields?: ExportFields): string {
  const head = fields?.head;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml((head?.title || title).trim())}</title>`,
    ...(head?.description
      ? [`<meta name="description" content="${escapeAttribute(head.description)}">`]
      : []),
    ...(head?.author ? [`<meta name="author" content="${escapeAttribute(head.author)}">`] : []),
    ...(head?.reviewer
      ? [`<meta name="reviewed-by" content="${escapeAttribute(head.reviewer)}">`]
      : []),
    '</head>',
    '<body>',
    html.trim(),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** Characters Markdown would read as its own: escaped, so the text reads as written. */
function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>|])/g, '\\$1').replace(/^(\s*)([#+-]|\d+\.)(?=\s)/, '$1\\$2');
}

function markdownRuns(runs: DraftRun[], lineBreak: string): string {
  return runs
    .map((run) => {
      if (run.break) return lineBreak;
      if (!run.text.trim()) return run.text;
      // The marks hug the words: "**bold** text", not "** bold **text".
      const lead = run.text.match(/^\s*/)![0];
      const tail = run.text.match(/\s*$/)![0];
      let out = escapeMarkdown(run.text.trim());
      if (run.bold) out = `**${out}**`;
      if (run.italics) out = `*${out}*`;
      if (run.link) out = `[${out}](${run.link.replace(/[()\s]/g, encodeURIComponent)})`;
      return lead + out + tail;
    })
    .join('');
}

function markdownBlock(block: DraftBlock): string {
  switch (block.kind) {
    case 'heading':
      return `${'#'.repeat(block.level)} ${markdownRuns(block.runs, ' ')}`;
    case 'paragraph':
      return markdownRuns(block.runs, '  \n');
    case 'quote':
      return block.paragraphs.map((p) => `> ${markdownRuns(p, '  \n> ')}`).join('\n>\n');
    case 'item':
      return `${'    '.repeat(block.level)}${block.ordered ? `${block.n}.` : '-'} ${markdownRuns(block.runs, ' ')}`;
    case 'table': {
      const width = Math.max(...block.rows.map((r) => r.cells.length));
      const line = (cells: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
      const rows = block.rows.map((r) => r.cells.map((c) => markdownRuns(c, '<br>')));
      return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
    }
    case 'html':
      return block.html;
  }
}

/** Front matter as YAML: each value quoted, so a colon or a quote in it reads as written. */
function frontMatter(front: Record<string, string>): string {
  const quoted = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const lines = Object.entries(front)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${quoted(value)}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}

/** Export Markdown: headings, emphasis, links, lists, quotes and tables; an HTML block as HTML. */
export function draftMarkdown(title: string, html: string, fields?: ExportFields): string {
  // With front matter, the title is there: not an H1 as well.
  const blocks = draftBlocks(title, html).filter(
    (block, i) => !(fields && i === 0 && block.kind === 'heading' && block.level === 1),
  );
  const parts: string[] = fields ? [frontMatter(fields.front)] : [];
  blocks.forEach((block, i) => {
    // A list's items one under the other; a blank line between other blocks.
    const prev = blocks[i - 1];
    if (i > 0) parts.push(block.kind === 'item' && prev?.kind === 'item' ? '\n' : '\n\n');
    parts.push(markdownBlock(block));
  });
  return `${parts.join('')}\n`;
}

export type Docx = typeof import('docx');
type DocxChild = InstanceType<Docx['Paragraph']> | InstanceType<Docx['Table']>;

/**
 * The blocks as Word paragraphs and tables, the lists numbered and bulleted
 * as on the page. Chat's answer export (lib/chat/exportFile.ts) writes its
 * Word file with it too.
 */
export function docxBlocks(m: Docx, blocks: DraftBlock[]): DocxChild[] {
  const HEADING = {
    1: m.HeadingLevel.HEADING_1,
    2: m.HeadingLevel.HEADING_2,
    3: m.HeadingLevel.HEADING_3,
  } as const;

  const children = (runs: DraftRun[], extra: { bold?: boolean; italics?: boolean } = {}) =>
    runs.map((run) => {
      if (run.break) return new m.TextRun({ text: '', break: 1 });
      const textRun = new m.TextRun({
        text: run.text,
        bold: run.bold || extra.bold,
        italics: run.italics || extra.italics,
        ...(run.link ? { style: 'Hyperlink' } : {}),
      });
      return run.link ? new m.ExternalHyperlink({ link: run.link, children: [textRun] }) : textRun;
    });

  const content = (list: DraftBlock[]): DocxChild[] =>
    list.flatMap((block) => {
      switch (block.kind) {
        case 'heading':
          return [
            new m.Paragraph({ heading: HEADING[block.level], children: children(block.runs) }),
          ];
        case 'paragraph':
          return [new m.Paragraph({ children: children(block.runs) })];
        case 'quote':
          return block.paragraphs.map(
            (p) =>
              new m.Paragraph({ indent: { left: 720 }, children: children(p, { italics: true }) }),
          );
        case 'item':
          return [
            new m.Paragraph({
              children: children(block.runs),
              ...(block.ordered
                ? { numbering: { reference: 'numbered', level: block.level, instance: block.list } }
                : { bullet: { level: block.level } }),
            }),
          ];
        case 'table':
          return [
            new m.Table({
              width: { size: 100, type: m.WidthType.PERCENTAGE },
              rows: block.rows.map(
                (row) =>
                  new m.TableRow({
                    tableHeader: row.header,
                    children: row.cells.map(
                      (cell) =>
                        new m.TableCell({
                          children: [
                            new m.Paragraph({ children: children(cell, { bold: row.header }) }),
                          ],
                        }),
                    ),
                  }),
              ),
            }),
          ];
        case 'html':
          return content(block.blocks);
      }
    });
  return content(blocks);
}

/**
 * A Word document of sections, each starting on a page of its own, with the
 * lists' numbering; `note`, when given, is a small grey line in every page's
 * header and footer (Chat's "Generated …" line, CHAT-06 item 40). `author`,
 * when given, is its author (a white label kit's company, 00429).
 */
export function docxDocument(
  m: Docx,
  title: string,
  sections: DocxChild[][],
  note?: string,
  author?: string,
) {
  const noteLine = () => [
    new m.Paragraph({ children: [new m.TextRun({ text: note, size: 16, color: '6B7280' })] }),
  ];
  return new m.Document({
    title,
    ...(author ? { creator: author, lastModifiedBy: author } : {}),
    numbering: {
      config: [
        {
          reference: 'numbered',
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: m.LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: m.AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: sections.map((children) => ({
      children,
      ...(note
        ? {
            headers: { default: new m.Header({ children: noteLine() }) },
            footers: { default: new m.Footer({ children: noteLine() }) },
          }
        : {}),
    })),
  });
}

/**
 * Export Word: the blocks as a document, the lists numbered and bulleted as
 * on the page; the page fields, if any, as a table on page 1 to delete or
 * keep.
 */
export async function draftDocx(
  title: string,
  html: string,
  fields?: ExportFields,
  author?: string,
): Promise<Blob> {
  // Loaded on the click: the library is only needed to write the file.
  const m = await import('docx');
  const blocks = draftBlocks(title, html);
  const name = title.trim() || text(blocks.find((b) => b.kind === 'heading')?.runs ?? []);
  const table: DraftBlock[] = fields
    ? [
        { kind: 'paragraph', runs: [{ text: fields.table.note, italics: true }] },
        {
          kind: 'table',
          rows: fields.table.rows.map(([label, value]) => ({
            header: false,
            cells: [[{ text: label, bold: true }], [{ text: value }]],
          })),
        },
      ]
    : [];
  const sections = table.length
    ? [docxBlocks(m, table), docxBlocks(m, blocks)]
    : [docxBlocks(m, blocks)];
  return m.Packer.toBlob(docxDocument(m, name, sections, undefined, author));
}

/**
 * The file for a format: Word and Excel built on the click, CSV, HTML and
 * Markdown as UTF-8 text; with the page fields, each carries them its own way.
 * `sourceUrl` is the live page an optimize draft is for: without Export's
 * fields, Excel's and CSV's slug is its, as Export's is. `author` is the Word
 * file's (a white label kit's company).
 */
export async function draftExportBlob(
  format: DraftExportFormat,
  title: string,
  html: string,
  fields?: ExportFields,
  sourceUrl: string | null = null,
  author?: string,
): Promise<Blob> {
  if (format === 'docx') return draftDocx(title, html, fields, author);
  if (format === 'csv') {
    // The mark tells Excel the file is UTF-8, as the Library's CSV does.
    return new Blob([BYTE_ORDER_MARK, pageCsv(title, html, fields, sourceUrl)], {
      type: 'text/csv;charset=utf-8;',
    });
  }
  if (format === 'xlsx') {
    // Loaded on the click: the library is only needed to write the file.
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    return writeXlsxFile(pageWorkbook(title, html, fields, sourceUrl)).toBlob();
  }
  return format === 'html'
    ? new Blob([draftHtmlDocument(title, html, fields)], { type: 'text/html;charset=utf-8' })
    : new Blob([draftMarkdown(title, html, fields)], { type: 'text/markdown;charset=utf-8' });
}

/**
 * "getcito_content_pipeline-forecasting.docx"; `word` is a white label
 * kit's in its place (exportFileWord), or none.
 */
export function draftExportFileName(
  title: string,
  format: DraftExportFormat,
  word: string | null = 'getcito',
): string {
  const slug = slugify(title).slice(0, 60).replace(/-+$/, '') || 'page';
  return withFileWord(word, `content_${slug}.${format}`);
}

// ─── The Library's Export (CE-002) ──────────────────────────────────────────

export type LibraryExportFormat = 'csv' | 'xlsx' | 'docx';

/** A draft as the Library's Export writes it: its labels as the Library shows them. */
export interface LibraryExportItem {
  title: string;
  status: string;
  method: string;
  pageType: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  /** The live page an optimize draft is for. */
  url: string | null;
  /** The page as Copy HTML gives it. */
  html: string;
}

/** The CSV's and the sheet's header. */
export const LIBRARY_EXPORT_HEADERS = [
  'Title',
  'Status',
  'Method',
  'Page type',
  'By',
  'Created',
  'Updated',
  'Page URL',
  'Characters',
  'Content',
];

/** A spreadsheet cell holds at most this many characters (Excel's limit). */
const CELL_LIMIT = 32_767;

/** A sheet's cell: a text past Excel's limit cut, and says so; one with lines wrapped. */
function sheetCell(value: string | number) {
  if (typeof value !== 'string') return value;
  const cell = value.length > CELL_LIMIT ? `${value.slice(0, CELL_LIMIT - 1)}…` : value;
  // A page is a block a line: wrapped, so Excel doesn't run them together.
  return cell.includes('\n') ? { value: cell, wrap: true } : cell;
}

/** "2026-10-22": a date that sorts as text. */
const day = (iso: string) => iso.slice(0, 10);

/**
 * The page's text, a block a line: list items marked and indented, quotes
 * with ">", a table's cells joined with " | ", an HTML block's text.
 */
export function draftText(title: string, html: string): string {
  const lines: string[] = [];
  const add = (blocks: DraftBlock[]) => {
    for (const block of blocks) {
      switch (block.kind) {
        case 'heading':
        case 'paragraph':
          lines.push(text(block.runs));
          break;
        case 'quote':
          for (const p of block.paragraphs) lines.push(`> ${text(p)}`);
          break;
        case 'item':
          lines.push(
            `${'  '.repeat(block.level)}${block.ordered ? `${block.n}.` : '-'} ${text(block.runs)}`,
          );
          break;
        case 'table':
          for (const row of block.rows) lines.push(row.cells.map(text).join(' | '));
          break;
        case 'html':
          add(block.blocks);
          break;
      }
    }
  };
  add(draftBlocks(title, html));
  return lines.join('\n');
}

/** One row a draft, in the header's order: its page's text in full. */
export function libraryRows(items: LibraryExportItem[]): Record<string, string | number>[] {
  return items.map((item) => {
    const content = draftText(item.title, item.html);
    const values: (string | number)[] = [
      item.title,
      item.status,
      item.method,
      item.pageType,
      item.author,
      day(item.createdAt),
      day(item.updatedAt),
      item.url ?? '',
      content.replace(/\n/g, '').length,
      content,
    ];
    return Object.fromEntries(LIBRARY_EXPORT_HEADERS.map((header, i) => [header, values[i]]));
  });
}

/** Export CSV: one row a draft. */
export function libraryCsv(items: LibraryExportItem[]): string {
  return toCsv(libraryRows(items), LIBRARY_EXPORT_HEADERS);
}

/** Export Excel: one row a draft; a page past a cell's limit is cut, and says so. */
export function libraryWorkbook(items: LibraryExportItem[]): Sheet<Blob>[] {
  const bold = (value: string) => ({ value, fontWeight: 'bold' as const });
  return [
    {
      sheet: 'Library',
      columns: [
        { width: 40 },
        { width: 12 },
        { width: 10 },
        { width: 18 },
        { width: 18 },
        { width: 12 },
        { width: 12 },
        { width: 40 },
        { width: 11 },
        { width: 80 },
      ],
      data: [
        LIBRARY_EXPORT_HEADERS.map(bold),
        ...libraryRows(items).map((row) =>
          LIBRARY_EXPORT_HEADERS.map((header) => sheetCell(row[header])),
        ),
      ],
    },
  ];
}

/**
 * Export Word: every draft in one document, each from a page of its own,
 * under a line saying where it stands.
 */
export async function libraryDocx(items: LibraryExportItem[], author?: string): Promise<Blob> {
  const m = await import('docx');
  // One count for the whole file, so a list doesn't go on from another page's.
  const counter = { lists: 0 };
  const sections = items.map((item) => [
    new m.Paragraph({
      children: [
        new m.TextRun({
          text: [
            item.status,
            item.method,
            item.pageType,
            `Updated ${day(item.updatedAt)}`,
            item.url,
          ]
            .filter(Boolean)
            .join(' · '),
          italics: true,
          color: '666666',
        }),
      ],
    }),
    ...docxBlocks(m, draftBlocks(item.title, item.html, counter)),
  ]);
  return m.Packer.toBlob(docxDocument(m, 'Content Library', sections, undefined, author));
}

/**
 * "getcito_content_library_in-review_2026-10-22.xlsx"; `word` is a white
 * label kit's in its place, or none.
 */
export function libraryExportFileName(
  tab: string,
  format: LibraryExportFormat,
  now: Date,
  word: string | null = 'getcito',
): string {
  return withFileWord(
    word,
    `content_library_${tab.replace(/_/g, '-')}_${now.toISOString().slice(0, 10)}.${format}`,
  );
}

// ─── One page as a spreadsheet row ──────────────────────────────────────────

/**
 * The page's CSV and sheet header: a CMS's CSV import maps each to a field.
 * A new column goes last, so an import that maps them by position still fits.
 */
export const PAGE_SHEET_HEADERS = [
  'Title',
  'Meta title',
  'Meta description',
  'Slug',
  'Author',
  'Featured image',
  'Characters',
  'Content',
  'HTML',
  'Reviewed by',
];

/** Export's page fields as front matter, read from the page where Export gives none. */
function frontOf(
  title: string,
  html: string,
  fields: ExportFields | undefined,
  sourceUrl: string | null,
): Record<string, string> {
  if (fields) return fields.front;
  // As Export reads them, with no author: an optimize draft's slug is its
  // live page's, so a CMS import updates that page, not a new one.
  const read = pageFields({ title, html, sourceUrl, author: null, teamByline: '' });
  return {
    title: read.metaTitle,
    description: read.metaDescription,
    slug: read.slug,
    author: read.author,
    reviewed_by: read.reviewer,
    image: read.featuredImage ?? '',
  };
}

/**
 * The page as one row: its title, its page fields (Export's, else read from
 * the page as Export reads them: frontOf), its text a block a line, and its
 * HTML without the H1 the Title column holds, as a CMS's title field does.
 * A list item's text starts with "•", not "-": a cell starting with "-"
 * would be guarded as a formula (toCsv), its text starting "'-".
 */
export function pageSheetRow(
  title: string,
  html: string,
  fields?: ExportFields,
  sourceUrl: string | null = null,
): Record<string, string | number> {
  const body = withoutLeadingH1(html);
  const content = draftText('', body).replace(/^(\s*)- /gm, '$1• ');
  const front = frontOf(title, html, fields, sourceUrl);
  const values: (string | number)[] = [
    title,
    front.title ?? '',
    front.description ?? '',
    front.slug ?? '',
    front.author ?? '',
    front.image ?? '',
    content.replace(/\n/g, '').length,
    content,
    body,
    front.reviewed_by ?? '',
  ];
  return Object.fromEntries(PAGE_SHEET_HEADERS.map((header, i) => [header, values[i]]));
}

/** Export CSV: the page as one row. */
export function pageCsv(
  title: string,
  html: string,
  fields?: ExportFields,
  sourceUrl: string | null = null,
): string {
  return toCsv([pageSheetRow(title, html, fields, sourceUrl)], PAGE_SHEET_HEADERS);
}

/** Export Excel: the page as one row; a text past a cell's limit is cut, and says so. */
export function pageWorkbook(
  title: string,
  html: string,
  fields?: ExportFields,
  sourceUrl: string | null = null,
): Sheet<Blob>[] {
  const row = pageSheetRow(title, html, fields, sourceUrl);
  return [
    {
      sheet: 'Page',
      columns: [
        { width: 40 },
        { width: 40 },
        { width: 60 },
        { width: 30 },
        { width: 20 },
        { width: 40 },
        { width: 11 },
        { width: 80 },
        { width: 80 },
        { width: 38 },
      ],
      data: [
        PAGE_SHEET_HEADERS.map((value) => ({ value, fontWeight: 'bold' as const })),
        PAGE_SHEET_HEADERS.map((header) => sheetCell(row[header])),
      ],
    },
  ];
}
