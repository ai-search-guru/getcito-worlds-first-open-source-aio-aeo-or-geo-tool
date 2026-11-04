import { NextResponse } from 'next/server';
import { z } from 'zod';
import { zipChatFiles } from '@/lib/chat/fileStore';
import { ZIP_MAX_FILES } from '@/lib/chat/files';
import { chatActor, runFailure } from '@/lib/chat/runApi';

export const runtime = 'nodejs';

// guid, not uuid: ids made by hand aren't RFC 4122 ones.
const body = z.object({ ids: z.array(z.guid()).min(1).max(ZIP_MAX_FILES) });

/**
 * POST /api/chat/files/zip `{ ids }`
 *
 * Download selected on the Files page (CHAT-06 item 18): the picked files
 * as one .zip, each in its main format, streamed; nothing is kept. 400 for
 * none or more than 50, 413 past 100 MB, 404 when none is the workspace's.
 */
export async function POST(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const input = body.safeParse(await req.json().catch(() => ({})));
    if (!input.success) return runFailure(400, 'failed', 'invalid', 'Pick 1 to 50 files');
    const zip = await zipChatFiles(actor, input.data.ids, new URL(req.url).origin);
    if (!zip.ok) {
      return zip.failure === 'too_big'
        ? runFailure(413, 'failed', 'too_big', 'More than 100 MB')
        : runFailure(404, 'not_found', 'not_found', 'Not found');
    }
    // Streamed as it is made: never held whole (a function's body is capped, a stream isn't).
    return new NextResponse(zip.stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zip.fileName}"`,
        'Cache-Control': 'private, no-store',
        'X-File-Count': String(zip.count),
      },
    });
  } catch (error) {
    console.error('[chat/files] could not zip files:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to download the files');
  }
}
