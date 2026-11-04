import { NextResponse } from 'next/server';
import { exportChatFile, type ChatFileFormat } from '@/lib/chat/fileExport';
import { readChatFile } from '@/lib/chat/fileStore';
import { chatActor, runFailure, runIdOf } from '@/lib/chat/runApi';

type Params = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';

const FORMATS: readonly ChatFileFormat[] = ['md', 'html', 'docx', 'pdf', 'csv', 'xlsx'];

/**
 * GET /api/chat/files/{id}?format=
 *
 * Copy and Download on a Files row (CHAT-06 items 17, 19): the file in a
 * format it offers, its main one without `format`. Nothing is kept and no
 * AI is used. Any member of the workspace; anything else is 404.
 */
export async function GET(req: Request, { params }: Params) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const fileId = runIdOf((await params).id);
    if (!fileId) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const url = new URL(req.url);
    const asked = url.searchParams.get('format') as ChatFileFormat | null;
    if (asked && !FORMATS.includes(asked)) {
      return runFailure(400, 'failed', 'invalid', 'Invalid format');
    }
    const file = await readChatFile(actor, fileId, url.origin);
    if (!file) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const out = await exportChatFile(file, asked ?? (file.formats[0] as ChatFileFormat));
    if (!out) return runFailure(404, 'not_found', 'format', 'Not offered for this file');
    return new NextResponse(Buffer.from(out.body), {
      headers: {
        'Content-Type': out.contentType,
        'Content-Disposition': `attachment; filename="${out.fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[chat/files] could not download a file:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to download the file');
  }
}
