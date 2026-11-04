import { Zip, ZipDeflate } from 'fflate';
import { Marked } from 'marked';
import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { createContentDraft } from '@/lib/actions/contentDrafts';
import { escapeHtml } from '@/lib/content/attachments';
import { MAX_BODY_HTML_LENGTH, MAX_TITLE_LENGTH } from '@/lib/content/editor';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { readChat } from './conversations';
import type { ChatActor } from './engine';
import { answerFormats, answerTitle, type ExportAnswer } from './export';
import { exportChatFile, type ChatFileFormat, type StoredChatFile } from './fileExport';
import { fileChatOutput } from './fileOutput';
import { CHAT_FILES_BUCKET, ZIP_MAX_BYTES, ZIP_MAX_FILES } from './files';
import { fileStamp } from './stamp';

/**
 * Answers and chats as files, on the server (CHAT-06 items 30–37): an
 * answer read for its downloads, Save to Files, Export chat, and a filed
 * file read for its card, its Files row and Download selected. Filing
 * itself, and the storage it counts against, is file-output's. The rows and the bucket are the server's to write (00411); the
 * person's access is read as them: a chat is theirs or shared with them;
 * a file, any member's.
 */

/**
 * The answer's Markdown as a page; the draft's own sanitizing keeps only what a page may hold.
 * As the answer shows them (run-answer): an image as its alt text, so the editor fetches no
 * address the model wrote, and raw HTML as its text.
 */
const draftMarked = new Marked({
  renderer: {
    image: ({ text }) => escapeHtml(text),
    html: ({ text }) => escapeHtml(text),
  },
});

const tStamp = createTranslator({ locale: 'en', messages, namespace: 'agentic.resultCard' });

/** A run's answer, as its downloads and Save to Files read it. */
export interface RunAnswerRead {
  answer: ExportAnswer;
  runId: string;
  messageId: string;
  conversationId: string;
  brandId: string | null;
  generatedAt: string;
  dataAsOf: string | null;
  timezone: string | null;
}

/**
 * A finished answer the person may open: their own chat's or one shared
 * with them (readChat, as them). Null for anything else, and for an answer
 * with nothing in it yet. Links to app pages open from the file through
 * `appOrigin`.
 */
export async function readRunAnswer(
  actor: ChatActor,
  runId: string,
  appOrigin: string | null,
): Promise<RunAnswerRead | null> {
  const { data: run, error } = await supabaseAdmin
    .from('chat_runs')
    .select('id, message_id, conversation_id')
    .eq('id', runId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the run: ${error.message}`);
  if (!run?.message_id || !run.conversation_id) return null;
  const chat = await readChat(await createClient(), actor, run.conversation_id);
  if (!chat) return null;

  const [message, conversation] = await Promise.all([
    supabaseAdmin
      .from('chat_messages')
      .select('id, content_md, generated_at, data_as_of, timezone, created_at')
      .eq('id', run.message_id)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_conversations')
      .select('brand_id')
      .eq('id', run.conversation_id)
      .maybeSingle(),
  ]);
  if (message.error) throw new Error(`Could not read the answer: ${message.error.message}`);
  if (conversation.error) throw new Error(`Could not read the chat: ${conversation.error.message}`);
  const answer = message.data;
  if (!answer || !answer.content_md.trim()) return null;

  // The question is the person's message just before the answer.
  const { data: asked, error: askedError } = await supabaseAdmin
    .from('chat_messages')
    .select('content_md')
    .eq('conversation_id', run.conversation_id)
    .eq('role', 'user')
    .lt('created_at', answer.created_at)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (askedError) throw new Error(`Could not read the question: ${askedError.message}`);

  const generatedAt = answer.generated_at ?? answer.created_at;
  return {
    answer: {
      markdown: answer.content_md,
      question: asked?.content_md ?? chat.title ?? '',
      chatTitle: chat.title,
      generatedAt,
      timezone: answer.timezone,
      stamp: fileStamp(
        (key, values) => tStamp(key, values),
        generatedAt,
        answer.data_as_of,
        answer.timezone,
      ),
      appOrigin,
    },
    runId: run.id,
    messageId: answer.id,
    conversationId: run.conversation_id,
    brandId: conversation.data?.brand_id ?? null,
    generatedAt,
    dataAsOf: answer.data_as_of,
    timezone: answer.timezone,
  };
}

export type SaveFileFailure = 'not_found' | 'storage_full' | 'failed';

export type SaveFileResult =
  | { ok: true; file: { id: string; title: string }; already: boolean }
  | { ok: false; failure: SaveFileFailure };

/**
 * Save to Files (items 36–37): the answer filed as a document of the
 * workspace, origin Chat, its Markdown kept and its formats offered later.
 * Once per answer: a filed one answers its file ("In Files").
 */
export async function saveRunAnswer(actor: ChatActor, runId: string): Promise<SaveFileResult> {
  const read = await readRunAnswer(actor, runId, null);
  if (!read) return { ok: false, failure: 'not_found' };

  const { data: filed, error: filedError } = await supabaseAdmin
    .from('chat_files')
    .select('id, title')
    .eq('organization_id', actor.organizationId)
    .eq('message_id', read.messageId)
    .limit(1)
    .maybeSingle();
  if (filedError) throw new Error(`Could not read Files: ${filedError.message}`);
  if (filed) return { ok: true, file: { id: filed.id, title: filed.title }, already: true };

  const title = answerTitle(read.answer).slice(0, 200) || 'Chat answer';
  const filedNow = await fileChatOutput({
    organizationId: actor.organizationId,
    createdBy: actor.userId,
    brandId: read.brandId,
    title,
    type: 'document',
    formats: answerFormats(read.answer.markdown),
    body: new TextEncoder().encode(read.answer.markdown),
    mimeType: 'text/markdown',
    fileName: 'answer.md',
    origin: 'chat',
    conversationId: read.conversationId,
    messageId: read.messageId,
    runId: read.runId,
    generatedAt: read.generatedAt,
    dataAsOf: read.dataAsOf,
    timezone: read.timezone,
  });
  if (!filedNow.ok) return filedNow;
  return { ok: true, file: { id: filedNow.id, title }, already: false };
}

const tChat = createTranslator({ locale: 'en', messages, namespace: 'chatPage' });

/**
 * Export chat (CHAT-23 `chat.export`): the whole chat as one file, each
 * question under "You" and its answer after it, with the time line of its
 * newest answer. The person's own chat or one shared with them; null
 * otherwise, and for a chat with nothing in it.
 */
export async function readChatExport(
  actor: ChatActor,
  chatId: string,
  appOrigin: string | null,
): Promise<ExportAnswer | null> {
  const chat = await readChat(await createClient(), actor, chatId);
  if (!chat) return null;
  const { data: rows, error } = await supabaseAdmin
    .from('chat_messages')
    .select('role, content_md, generated_at, data_as_of, timezone, created_at')
    .eq('conversation_id', chatId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Could not read the chat: ${error.message}`);
  const said = (rows ?? []).filter((row) => row.content_md.trim());
  if (said.length === 0) return null;
  const markdown = said
    .map((row) =>
      row.role === 'user'
        ? `## ${tChat('you')}\n\n${row.content_md.trim()}`
        : row.content_md.trim(),
    )
    .join('\n\n');
  const last = [...said].reverse().find((row) => row.role === 'assistant') ?? said[said.length - 1];
  const generatedAt = last.generated_at ?? last.created_at;
  return {
    markdown,
    question: chat.title ?? tChat('untitledExport'),
    chatTitle: chat.title,
    generatedAt,
    timezone: last.timezone,
    stamp: fileStamp(
      (key, values) => tStamp(key, values),
      generatedAt,
      last.data_as_of,
      last.timezone,
    ),
    appOrigin,
  };
}

/** A file's row, as its downloads read it. */
const STORED_COLUMNS =
  'id, title, mime_type, formats, storage_path, size_bytes, generated_at, data_as_of, timezone';

interface StoredRow {
  id: string;
  title: string;
  mime_type: string;
  formats: string[];
  storage_path: string;
  size_bytes: number | string;
  generated_at: string;
  data_as_of: string | null;
  timezone: string | null;
}

/** A file's content, read from chat-files, with its row's facts and its time line. */
async function storedFile(row: StoredRow, appOrigin: string | null): Promise<StoredChatFile> {
  const { data: blob, error } = await supabaseAdmin.storage
    .from(CHAT_FILES_BUCKET)
    .download(row.storage_path);
  if (error || !blob) throw new Error(`Could not read the file: ${error?.message ?? 'missing'}`);
  return {
    title: row.title,
    mimeType: row.mime_type,
    formats: row.formats,
    generatedAt: row.generated_at,
    timezone: row.timezone,
    stamp: fileStamp(
      (key, values) => tStamp(key, values),
      row.generated_at,
      row.data_as_of,
      row.timezone,
    ),
    content: await blob.text(),
    appOrigin,
  };
}

/**
 * A run's n-th deliverable (CHAT-06 item 1), as its card downloads it: the
 * file Chat filed as it made it, its content read from chat-files. Null
 * when the person can't open the run's chat, or there is no such file.
 */
export async function readRunFile(
  actor: ChatActor,
  runId: string,
  n: number,
  appOrigin: string | null,
): Promise<StoredChatFile | null> {
  const { data: run, error } = await supabaseAdmin
    .from('chat_runs')
    .select('conversation_id')
    .eq('id', runId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the run: ${error.message}`);
  if (!run?.conversation_id) return null;
  if (!(await readChat(await createClient(), actor, run.conversation_id))) return null;

  const { data: files, error: filesError } = await supabaseAdmin
    .from('chat_files')
    .select(STORED_COLUMNS)
    .eq('organization_id', actor.organizationId)
    .eq('run_id', runId)
    .is('message_id', null)
    .order('created_at', { ascending: true });
  if (filesError) throw new Error(`Could not read Files: ${filesError.message}`);
  const file = ((files ?? []) as unknown as StoredRow[])[n - 1];
  return file ? storedFile(file, appOrigin) : null;
}

/**
 * A file on the Files page (CHAT-06 items 17, 24), as its row downloads
 * it: files belong to the workspace, so any member reads it (its policy,
 * read as them). Null for a file that isn't their workspace's.
 */
export async function readChatFile(
  actor: ChatActor,
  fileId: string,
  appOrigin: string | null,
): Promise<StoredChatFile | null> {
  const { data, error } = await (
    await createClient()
  )
    .from('chat_files')
    .select(STORED_COLUMNS)
    .eq('id', fileId)
    .eq('organization_id', actor.organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the file: ${error.message}`);
  return data ? storedFile(data as unknown as StoredRow, appOrigin) : null;
}

export type ZipResult =
  /** count: the files going in, as the header says it before the stream starts. */
  | { ok: true; fileName: string; stream: ReadableStream<Uint8Array>; count: number }
  | { ok: false; failure: 'not_found' | 'too_big' };

/** "name.ext", then "name (2).ext", for two files of the same name in one .zip. */
function uniqueName(taken: Set<string>, name: string): string {
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let unique = name;
  for (let n = 2; taken.has(unique); n += 1) unique = `${stem} (${n})${ext}`;
  taken.add(unique);
  return unique;
}

/**
 * The files as a .zip, streamed: one file read, written and compressed at a
 * time, as the reader asks for more, so neither the files nor the .zip are
 * ever held whole (a function's response isn't capped this way, as a body
 * is). A file whose main format can't be written is left out.
 */
function zipStream(rows: StoredRow[], appOrigin: string | null): ReadableStream<Uint8Array> {
  let zip: Zip;
  let next = 0;
  const taken = new Set<string>();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((error, chunk, final) => {
        if (error) return controller.error(error);
        controller.enqueue(chunk);
        if (final) controller.close();
      });
    },
    async pull() {
      try {
        while (next < rows.length) {
          const row = rows[next++];
          const file = await exportChatFile(
            await storedFile(row, appOrigin),
            row.formats[0] as ChatFileFormat,
          );
          if (!file) continue;
          const entry = new ZipDeflate(uniqueName(taken, file.fileName), { level: 6 });
          zip.add(entry);
          entry.push(file.body, true);
          return;
        }
        zip.end();
      } catch (error) {
        zip.terminate();
        throw error;
      }
    },
    cancel() {
      zip.terminate();
    },
  });
}

/**
 * Download selected (CHAT-06 item 18): the files picked on the Files page
 * as one .zip, each in its main format, rendered as its own download is and
 * kept nowhere, streamed as it is made. Files the person's workspace
 * doesn't hold are left out; none left is not_found. Past ZIP_MAX_BYTES
 * stored is too_big, before anything is read.
 */
export async function zipChatFiles(
  actor: ChatActor,
  fileIds: string[],
  appOrigin: string | null,
): Promise<ZipResult> {
  const { data, error } = await (
    await createClient()
  )
    .from('chat_files')
    .select(STORED_COLUMNS)
    .in('id', fileIds.slice(0, ZIP_MAX_FILES))
    .eq('organization_id', actor.organizationId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not read the files: ${error.message}`);
  const rows = (data ?? []) as unknown as StoredRow[];
  if (rows.length === 0) return { ok: false, failure: 'not_found' };
  const bytes = rows.reduce((sum, row) => sum + Number(row.size_bytes), 0);
  if (bytes > ZIP_MAX_BYTES) return { ok: false, failure: 'too_big' };
  const day = new Date().toISOString().slice(0, 10);
  return {
    ok: true,
    fileName: `files-${day}.zip`,
    stream: zipStream(rows, appOrigin),
    count: rows.length,
  };
}

/**
 * Open in Content Editor on an answer (CHAT-06 item 6, CHAT-25): a new
 * Content draft with the answer as its page, in the chat's brand (or the
 * brand the person has open, for a chat about none), marked on the
 * answer's file when it is in Files ("Used in Content draft"). The draft is
 * made as the person (createContentDraft: their plan and the demo brand's
 * rule). Null for an answer they can't open.
 */
export async function answerToDraft(
  actor: ChatActor,
  runId: string,
  fallbackBrandId: string | null,
): Promise<{ draftId: string } | { failure: 'not_found' | 'no_brand' }> {
  const read = await readRunAnswer(actor, runId, null);
  if (!read) return { failure: 'not_found' };
  const brandId = read.brandId ?? fallbackBrandId;
  if (!brandId) return { failure: 'no_brand' };
  const html = draftMarked.parse(read.answer.markdown, { async: false }) as string;
  const draftId = await createContentDraft(brandId, {
    method: 'create',
    title: answerTitle(read.answer).slice(0, MAX_TITLE_LENGTH),
    pageType: 'blog_post',
    typePicked: false,
    source: { kind: 'content' },
    bodyHtml: html.slice(0, MAX_BODY_HTML_LENGTH),
  });
  const { error } = await supabaseAdmin
    .from('chat_files')
    .update({ content_draft_id: draftId })
    .eq('organization_id', actor.organizationId)
    .eq('message_id', read.messageId);
  if (error) console.error('[chat-files] could not mark the file as used:', error.message);
  return { draftId };
}
