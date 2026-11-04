import type { Sheet } from 'write-excel-file/browser';
import { toCsv } from '@/lib/csv';
import { slugify } from '@/lib/slug';
import { withFileWord } from '@/lib/white-label/kit';
import type { OpportunityDocument, OpportunityLine } from './opportunityMarkdown';

/**
 * An opportunity's Export (the user's spec): the write-up Copy All Data
 * copies (opportunityDocument), as CSV, an Excel sheet or a Word document.
 * CSV and Excel hold one row per line, under its section; Word keeps the
 * headings, fields and lists.
 */

export type OpportunityExportFormat = 'csv' | 'xlsx' | 'docx';

/** The CSV's and the sheet's header, in the same case. */
export const OPPORTUNITY_EXPORT_HEADERS = ['Section', 'Field', 'Value'];

/** The opening facts' section, which the write-up leaves unheaded. */
const OVERVIEW = 'Overview';

export interface OpportunityExportRow {
  section: string;
  field: string;
  value: string;
}

function cells(line: OpportunityLine): { field: string; value: string } {
  switch (line.kind) {
    case 'field':
      return { field: line.label, value: line.value };
    case 'step':
      return {
        field: String(line.n),
        value: [line.text, ...line.points.map((p) => `- ${p}`)].join('\n'),
      };
    default:
      return { field: '', value: line.text };
  }
}

export function opportunityRows(doc: OpportunityDocument): OpportunityExportRow[] {
  return [
    { section: OVERVIEW, field: 'Title', value: doc.title },
    ...(doc.description
      ? [{ section: OVERVIEW, field: 'Description', value: doc.description }]
      : []),
    ...doc.sections.flatMap((s) =>
      s.lines.map((line) => ({ section: s.title ?? OVERVIEW, ...cells(line) })),
    ),
  ];
}

/** Export CSV; the caller adds the byte order mark Excel reads UTF-8 by. */
export function opportunityCsv(doc: OpportunityDocument): string {
  return toCsv(
    opportunityRows(doc).map((row) => ({
      Section: row.section,
      Field: row.field,
      Value: row.value,
    })),
    OPPORTUNITY_EXPORT_HEADERS,
  );
}

const bold = (value: string) => ({ value, fontWeight: 'bold' as const });

/**
 * Export Excel: one sheet, the CSV's rows under a bold header. A value on
 * several lines (an outline step and its points) wraps, so Excel shows them.
 */
export function opportunityWorkbook(doc: OpportunityDocument): Sheet<Blob>[] {
  return [
    {
      sheet: 'Opportunity',
      columns: [{ width: 22 }, { width: 22 }, { width: 100 }],
      data: [
        OPPORTUNITY_EXPORT_HEADERS.map(bold),
        ...opportunityRows(doc).map((row) => [
          row.section,
          row.field,
          row.value.includes('\n') ? { value: row.value, wrap: true } : row.value,
        ]),
      ],
    },
  ];
}

/**
 * Export Word: the title, then each section's heading, fields and lists.
 * `author` is the file's (a white label kit's company, 00429).
 */
export async function opportunityDocx(doc: OpportunityDocument, author?: string): Promise<Blob> {
  // Loaded on the click: the library is only needed to write the file.
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import('docx');
  const paragraphs = (line: OpportunityLine) => {
    switch (line.kind) {
      case 'field':
        return [
          new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({ text: `${line.label}: `, bold: true }),
              new TextRun(line.value),
            ],
          }),
        ];
      case 'item':
        return [new Paragraph({ text: line.text, bullet: { level: 0 } })];
      case 'step':
        return [
          new Paragraph({ text: `${line.n}. ${line.text}` }),
          ...line.points.map((p) => new Paragraph({ text: p, bullet: { level: 1 } })),
        ];
      case 'text':
        return [new Paragraph({ text: line.text })];
    }
  };
  const document = new Document({
    title: doc.title,
    ...(author ? { creator: author, lastModifiedBy: author } : {}),
    sections: [
      {
        children: [
          new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE }),
          ...(doc.description ? [new Paragraph({ text: doc.description })] : []),
          ...doc.sections.flatMap((s) => [
            ...(s.title ? [new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_2 })] : []),
            ...s.lines.flatMap(paragraphs),
          ]),
        ],
      },
    ],
  });
  return Packer.toBlob(document);
}

/**
 * "getcito_opportunity_office-coffee-subscriptions.xlsx"; `word` is a white
 * label kit's in its place, or none.
 */
export function opportunityExportFileName(
  doc: OpportunityDocument,
  extension: OpportunityExportFormat,
  word: string | null = 'getcito',
): string {
  const slug = slugify(doc.title).slice(0, 60).replace(/-+$/, '') || 'export';
  return withFileWord(word, `opportunity_${slug}.${extension}`);
}
