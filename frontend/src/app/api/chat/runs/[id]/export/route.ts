import { NextResponse } from 'next/server';
import { ANSWER_EXPORT_FORMATS, type AnswerExportFormat } from '@/lib/chat/export';
import { exportAnswer } from '@/lib/chat/exportFile';
import { readRunAnswer } from '@/lib/chat/fileStore';
import { chatActor, runFailure, runIdOf } from '@/lib/chat/runApi';

type Params = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
// A long answer's or chat's PDF takes tens of seconds to lay out (lib/chat/export-pdf).
export const maxDuration = 300;

/**
 * GET /api/chat/runs/{id}/export?format=md|docx|pdf|csv|xlsx
 *
 * Download on an answer (CHAT-06 items 32–35): the answer as the format,
 * rendered from the stored Markdown with no model call, its time line
 * from the stored times. Nothing is kept and nothing counts toward
 * storage or AI usage. Every role may download what it can open: the
 * person's own chat or one shared with them; anything else is 404. CSV
 * and Excel only for an answer with a table.
 */
export async function GET(req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const runId = runIdOf((await params).id);
    if (!runId) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const url = new URL(req.url);
    const format = url.searchParams.get('format') as AnswerExportFormat | null;
    if (!format || !ANSWER_EXPORT_FORMATS.includes(format)) {
      return runFailure(400, 'failed', 'invalid', 'Invalid format');
    }
    const read = await readRunAnswer(actor, runId, url.origin);
    if (!read) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const file = await exportAnswer(read.answer, format);
    if (!file) return runFailure(404, 'not_found', 'format', 'Not offered for this answer');
    return new NextResponse(Buffer.from(file.body), {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[chat/runs] could not export an answer:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to export the answer');
  }
}
