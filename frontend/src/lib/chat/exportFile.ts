import { strToU8, zipSync } from 'fflate';
import { BYTE_ORDER_MARK } from '@/lib/action-center/export';
import { docxBlocks, docxDocument } from '@/lib/content/draftExport';
import { slugify } from '@/lib/slug';
import {
  answerDocumentBlocks,
  answerFileName,
  answerMarkdown,
  answerSheets,
  answerTables,
  answerTitle,
  tableCsv,
  type AnswerExportFormat,
  type ExportAnswer,
} from './export';

/**
 * Download on an answer, on the server (CHAT-06 items 32–35): the file for a
 * format, written from the stored answer with no model call. Nothing is kept:
 * a download never counts toward storage. Word is written by the Content
 * Editor's export code (draft-export's docxBlocks), Excel by
 * write-excel-file, several CSVs are zipped by fflate, and PDF by
 * @react-pdf/renderer (ExportPdf.tsx), as the app's other exports are.
 */

export interface AnswerFile {
  fileName: string;
  contentType: string;
  body: Uint8Array;
}

export const ANSWER_CONTENT_TYPES = {
  md: 'text/markdown; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
} as const;

/** Export Word: the question and the answer, the line in every page's header and footer. */
export async function answerDocx(answer: ExportAnswer): Promise<Uint8Array> {
  const m = await import('docx');
  const document = docxDocument(
    m,
    answerTitle(answer) || answerFileName(answer, 'docx'),
    [docxBlocks(m, answerDocumentBlocks(answer))],
    answer.stamp,
  );
  return new Uint8Array(await m.Packer.toBuffer(document));
}

/**
 * Export CSV: the first table, or, with several, a .zip of one CSV per table
 * (item 32). Each starts with the line and carries the byte order mark Excel
 * reads UTF-8 by. Null when the answer has no table.
 */
export function answerCsvFile(answer: ExportAnswer): AnswerFile | null {
  const tables = answerTables(answer.markdown);
  if (tables.length === 0) return null;
  const csv = (i: number) => strToU8(BYTE_ORDER_MARK + tableCsv(tables[i], answer.stamp));
  if (tables.length === 1) {
    return {
      fileName: answerFileName(answer, 'csv'),
      contentType: ANSWER_CONTENT_TYPES.csv,
      body: csv(0),
    };
  }
  const base = answerFileName(answer, 'csv').replace(/\.csv$/, '');
  const files: Record<string, Uint8Array> = {};
  tables.forEach((table, i) => {
    const name = slugify(table.name ?? '')
      .slice(0, 40)
      .replace(/-+$/, '');
    let file = `${base}-${i + 1}${name ? `-${name}` : ''}.csv`;
    while (file in files) file = file.replace(/\.csv$/, '-x.csv');
    files[file] = csv(i);
  });
  return {
    fileName: answerFileName(answer, 'zip'),
    contentType: ANSWER_CONTENT_TYPES.zip,
    body: zipSync(files),
  };
}

/** Export Excel: one sheet per table. Null when the answer has no table. */
export async function answerXlsx(answer: ExportAnswer): Promise<Uint8Array | null> {
  const sheets = answerSheets(answer);
  if (sheets.length === 0) return null;
  const { default: writeXlsxFile } = await import('write-excel-file/node');
  return new Uint8Array(await writeXlsxFile(sheets).toBuffer());
}

/**
 * The file Download gives for a format; null when the answer doesn't offer it
 * (CSV and Excel need a table: answerFormats lists what it offers).
 */
export async function exportAnswer(
  answer: ExportAnswer,
  format: AnswerExportFormat,
): Promise<AnswerFile | null> {
  const file = (body: Uint8Array): AnswerFile => ({
    fileName: answerFileName(answer, format),
    contentType: ANSWER_CONTENT_TYPES[format],
    body,
  });
  switch (format) {
    case 'md':
      return file(strToU8(answerMarkdown(answer)));
    case 'docx':
      return file(await answerDocx(answer));
    case 'pdf': {
      // Loaded for a PDF only: the renderer and its fonts are heavy.
      const { answerPdf } = await import('./ExportPdf');
      return file(await answerPdf(answer));
    }
    case 'csv':
      return answerCsvFile(answer);
    case 'xlsx': {
      const body = await answerXlsx(answer);
      return body ? file(body) : null;
    }
  }
}
