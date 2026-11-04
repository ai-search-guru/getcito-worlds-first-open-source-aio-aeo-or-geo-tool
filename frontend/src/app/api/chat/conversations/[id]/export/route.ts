import { NextResponse } from 'next/server';
import { chatIdOf } from '@/lib/chat/conversations';
import { exportAnswer } from '@/lib/chat/exportFile';
import { readChatExport } from '@/lib/chat/fileStore';
import { chatActor, runFailure } from '@/lib/chat/runApi';

type Params = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
// A long answer's or chat's PDF takes tens of seconds to lay out (lib/chat/export-pdf).
export const maxDuration = 300;

/** What Export chat offers (CHAT-23 `chat.export`): the chat as one document. */
const CHAT_EXPORT_FORMATS = ['md', 'docx', 'pdf'] as const;
type ChatExportFormat = (typeof CHAT_EXPORT_FORMATS)[number];

/**
 * GET /api/chat/conversations/{id}/export?format=md|docx|pdf
 *
 * Export chat: the whole chat as Markdown, Word or PDF, from what is
 * stored, with no model call and nothing kept. The person's own chat or
 * one shared with them; anything else, or an empty chat, is 404.
 */
export async function GET(req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = chatIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const url = new URL(req.url);
    const format = url.searchParams.get('format') as ChatExportFormat | null;
    if (!format || !CHAT_EXPORT_FORMATS.includes(format)) {
      return runFailure(400, 'failed', 'invalid', 'Invalid format');
    }
    const chat = await readChatExport(actor, id, url.origin);
    if (!chat) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const file = await exportAnswer(chat, format);
    if (!file) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return new NextResponse(Buffer.from(file.body), {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[chat/conversations] could not export a chat:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to export the chat');
  }
}
