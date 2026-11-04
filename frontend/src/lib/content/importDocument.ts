import { attachmentKind, textToHtml } from './attachments';
import { cleanHtml } from './cleanHtml';

/** A document file as page content, and what its cleaning took out. */
export interface ImportedDocument {
  html: string;
  /** Scripts and other unsafe tags removed from an HTML file. */
  unsafeRemoved: number;
  /** Images left out of a Word file: they wait for file storage. */
  imagesRemoved: number;
}

/** The file kinds read as page content (not spreadsheets or images). */
export const DOCUMENT_ACCEPT = '.docx,.md,.markdown,.html,.htm,.txt';

/**
 * A Markdown, HTML, Word (.docx) or text file as page content, cleaned like a
 * paste (CE-006); null for any other kind. The Markdown and Word readers load
 * on demand: they are only needed when someone brings a file.
 */
export async function readDocumentFile(file: File): Promise<ImportedDocument | null> {
  switch (attachmentKind(file.name)) {
    case 'markdown': {
      const { marked } = await import('marked');
      const cleaned = cleanHtml(await marked.parse(await file.text()), { keepImages: true });
      return { html: cleaned.html, unsafeRemoved: 0, imagesRemoved: 0 };
    }
    case 'html': {
      const cleaned = cleanHtml(await file.text(), { keepImages: true });
      return { html: cleaned.html, unsafeRemoved: cleaned.unsafeRemoved, imagesRemoved: 0 };
    }
    case 'text':
      return { html: textToHtml(await file.text()), unsafeRemoved: 0, imagesRemoved: 0 };
    case 'word': {
      const { default: mammoth } = await import('mammoth');
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      // Word's images are embedded data: they wait for file storage.
      const cleaned = cleanHtml(value, { keepImages: false });
      return { html: cleaned.html, unsafeRemoved: 0, imagesRemoved: cleaned.imagesRemoved };
    }
    default:
      return null;
  }
}
