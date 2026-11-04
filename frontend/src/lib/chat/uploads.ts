/**
 * Chat's attachments (CHAT-02 items 18–22, 00409): what a message may carry.
 * The types and the size are the bucket's (chat-uploads) and the table's
 * checks; the browser, the server action and the database say the same.
 */

/** The bucket attachments go to: {organization_id}/{upload id}. */
export const CHAT_UPLOAD_BUCKET = 'chat-uploads';

/** 10 MB a file (owner decision, 2026-10-18). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** 5 files a message (00409's trigger). */
export const MAX_UPLOADS = 5;

/** Each type an attachment may be, and its tag on the chip. */
export const CHAT_UPLOAD_TYPES = {
  'application/pdf': { tag: 'PDF', ext: ['pdf'] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    tag: 'DOCX',
    ext: ['docx'],
  },
  'text/plain': { tag: 'TXT', ext: ['txt'] },
  'text/markdown': { tag: 'MD', ext: ['md', 'markdown'] },
  'text/csv': { tag: 'CSV', ext: ['csv'] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    tag: 'XLSX',
    ext: ['xlsx'],
  },
  'application/json': { tag: 'JSON', ext: ['json'] },
  'text/html': { tag: 'HTML', ext: ['html', 'htm'] },
  'image/png': { tag: 'PNG', ext: ['png'] },
  'image/jpeg': { tag: 'JPG', ext: ['jpg', 'jpeg'] },
  'image/webp': { tag: 'WEBP', ext: ['webp'] },
} as const;
export type ChatUploadType = keyof typeof CHAT_UPLOAD_TYPES;

/** The file picker's accept list. */
export const UPLOAD_ACCEPT = Object.entries(CHAT_UPLOAD_TYPES)
  .flatMap(([type, { ext }]) => [type, ...ext.map((e) => `.${e}`)])
  .join(',');

export const isUploadType = (type: string): type is ChatUploadType =>
  Object.prototype.hasOwnProperty.call(CHAT_UPLOAD_TYPES, type);

/**
 * A file's type as attachments know it: the browser's, or from its name's
 * extension when the browser gives none (a .md file often has no type).
 * Null for a type an attachment can't be.
 */
export function uploadTypeOf(file: { name: string; type: string }): ChatUploadType | null {
  if (isUploadType(file.type)) return file.type;
  if (file.type && file.type !== 'application/octet-stream') return null;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const found = Object.entries(CHAT_UPLOAD_TYPES).find(([, t]) =>
    (t.ext as readonly string[]).includes(ext),
  );
  return found ? (found[0] as ChatUploadType) : null;
}

/** The first bytes of a file the server reads to tell what it is. */
export const SNIFF_BYTES = 1024;

const startsWith = (head: Uint8Array, bytes: number[], at = 0) =>
  head.length >= at + bytes.length && bytes.every((b, i) => head[at + i] === b);
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

/**
 * Whether a file's first bytes are what its type says: the browser names
 * the type, and the bucket only checks that name, so the server looks at
 * the bytes before it calls a file ready. PDF has %PDF- in its first 1 KB,
 * DOCX and XLSX are zip files, the images have their signatures, and a text
 * type has no NUL byte (UTF-16 with its BOM aside).
 */
export function contentMatchesType(type: ChatUploadType, head: Uint8Array): boolean {
  switch (type) {
    case 'application/pdf': {
      const pdf = ascii('%PDF-');
      for (let at = 0; at + pdf.length <= Math.min(head.length, SNIFF_BYTES); at += 1) {
        if (startsWith(head, pdf, at)) return true;
      }
      return false;
    }
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return startsWith(head, [0x50, 0x4b, 0x03, 0x04]);
    case 'image/png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case 'image/webp':
      return startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8);
    default:
      if (head.length === 0) return false;
      if (startsWith(head, [0xff, 0xfe]) || startsWith(head, [0xfe, 0xff])) return true;
      return !head.subarray(0, SNIFF_BYTES).includes(0);
  }
}

/** Why a file can't be attached (item 21), or null when it can. */
export type UploadProblem = 'type' | 'size' | 'count';

/**
 * The first problem with attaching `file` beside `attached` others: its
 * type, its size, or one too many.
 */
export function uploadProblem(
  file: { name: string; type: string; size: number },
  attached: number,
): UploadProblem | null {
  if (attached >= MAX_UPLOADS) return 'count';
  if (!uploadTypeOf(file)) return 'type';
  if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) return 'size';
  return null;
}
