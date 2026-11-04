import { strToU8 } from 'fflate';
import {
  docxBlocks,
  docxDocument,
  draftBlocks,
  draftHtmlDocument,
  draftMarkdown,
} from '@/lib/content/draftExport';
import { sanitizeDraftHtml } from '@/lib/content/sanitizeDraftHtml';
import { withContentDom } from '@/lib/content/serverDom';
import { answerFileName, type AnswerExportFormat, type ExportAnswer } from './export';
import { ANSWER_CONTENT_TYPES, exportAnswer, type AnswerFile } from './exportFile';

/**
 * A file in Files, downloaded (CHAT-06 items 2, 35): its canonical content
 * written in a format it offers, on the server, nothing kept. An answer
 * (Markdown) goes through the answer's writers; a page (HTML, a Content
 * draft Chat saved) through the Content Editor's, and its PDF from its
 * Markdown. Each carries the file's time line and is named after its title
 * and the day it was made.
 */

export type ChatFileFormat = AnswerExportFormat | 'html';

/** A file as stored: its row's facts and its content, read from chat-files. */
export interface StoredChatFile {
  title: string;
  mimeType: string;
  formats: string[];
  generatedAt: string;
  timezone: string | null;
  /** "Generated … · Data as of …", worded by the caller. */
  stamp: string;
  content: string;
  appOrigin?: string | null;
}

/** The page's Markdown without its first heading when that heading is its title: the file's title says it. */
function withoutTitle(markdown: string, title: string): string {
  const [first, ...rest] = markdown.split('\n');
  return first.replace(/^#\s+/, '').trim() === title.trim()
    ? rest.join('\n').trimStart()
    : markdown;
}

/** The file in a format, or null when it doesn't offer that format. */
export async function exportChatFile(
  file: StoredChatFile,
  format: ChatFileFormat,
): Promise<AnswerFile | null> {
  if (!file.formats.includes(format)) return null;
  const page = file.mimeType === 'text/html';
  // The editor's HTML helpers read with a DOM: the server's is jsdom's.
  if (page && typeof window === 'undefined') await withContentDom();
  const answer: ExportAnswer = {
    markdown: page
      ? withoutTitle(draftMarkdown(file.title, file.content), file.title)
      : file.content,
    question: file.title,
    chatTitle: null,
    generatedAt: file.generatedAt,
    timezone: file.timezone,
    stamp: file.stamp,
    appOrigin: file.appOrigin,
  };
  if (!page) return format === 'html' ? null : exportAnswer(answer, format);

  const named = (extension: string, contentType: string, body: Uint8Array): AnswerFile => ({
    fileName: answerFileName(answer, extension),
    contentType,
    body,
  });
  switch (format) {
    case 'html':
      // Cleaned again on the way out (CHAT-06: no script in exported HTML), whatever was filed.
      return named(
        'html',
        'text/html; charset=utf-8',
        strToU8(draftHtmlDocument(file.title, sanitizeDraftHtml(file.content))),
      );
    case 'docx': {
      // The editor's own blocks, the file's line in every page's header and footer.
      const m = await import('docx');
      const document = docxDocument(
        m,
        file.title,
        [docxBlocks(m, draftBlocks(file.title, file.content))],
        file.stamp,
      );
      return named(
        'docx',
        ANSWER_CONTENT_TYPES.docx,
        new Uint8Array(await m.Packer.toBuffer(document)),
      );
    }
    case 'md':
      return named(
        'md',
        ANSWER_CONTENT_TYPES.md,
        strToU8(`${file.stamp}\n\n${draftMarkdown(file.title, file.content)}`),
      );
    default:
      return exportAnswer(answer, format);
  }
}
