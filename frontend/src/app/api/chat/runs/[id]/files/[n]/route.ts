import { NextResponse } from 'next/server';
import { exportChatFile, type ChatFileFormat } from '@/lib/chat/fileExport';
import { readRunFile } from '@/lib/chat/fileStore';
import { chatActor, runFailure, runIdOf } from '@/lib/chat/runApi';

type Params = { params: Promise<{ id: string; n: string }> };

export const runtime = 'nodejs';

const FORMATS: readonly ChatFileFormat[] = ['md', 'html', 'docx', 'pdf', 'csv', 'xlsx'];

/**
 * GET /api/chat/runs/{id}/files/{n}?format=
 *
 * Download on an output card (CHAT-06 items 1–4): the run's n-th
 * deliverable, from its file in Files, in a format it offers. Nothing is
 * kept and no AI is used. The person's own chat or one shared with them;
 * anything else is 404.
 */
export async function GET(req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const { id, n } = await params;
    const runId = runIdOf(id);
    const position = Number.parseInt(n, 10);
    if (!runId || !Number.isInteger(position) || position < 1 || position > 100) {
      return runFailure(404, 'not_found', 'not_found', 'Not found');
    }
    const url = new URL(req.url);
    const format = url.searchParams.get('format') as ChatFileFormat | null;
    if (!format || !FORMATS.includes(format)) {
      return runFailure(400, 'failed', 'invalid', 'Invalid format');
    }
    const file = await readRunFile(actor, runId, position, url.origin);
    if (!file) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const out = await exportChatFile(file, format);
    if (!out) return runFailure(404, 'not_found', 'format', 'Not offered for this file');
    return new NextResponse(Buffer.from(out.body), {
      headers: {
        'Content-Type': out.contentType,
        'Content-Disposition': `attachment; filename="${out.fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[chat/runs] could not download a deliverable:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to download the file');
  }
}
