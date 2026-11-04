import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getActionFor } from '@/lib/mcp/data';
import { exportActionFor } from '@/lib/mcp/actionExport';
import { BYTE_ORDER_MARK } from '@/lib/action-center/export';

const FORMATS = ['json', 'markdown', 'csv'] as const;

/**
 * GET /api/mcp/actions/[id] — REST mirror of the `get_action` MCP tool.
 * `?format=markdown` or `?format=csv` returns the action as the dashboard's
 * Copy Data and Export CSV write it (AC-005); `json`, the default, the fields.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  const format = new URL(req.url).searchParams.get('format') ?? 'json';
  if (!(FORMATS as readonly string[]).includes(format)) {
    return NextResponse.json(
      { error: `format must be one of ${FORMATS.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    if (format === 'markdown' || format === 'csv') {
      const exported = await exportActionFor(auth, id, format);
      if (!exported) {
        return NextResponse.json({ error: 'Action not found' }, { status: 404 });
      }
      // The CSV starts with a byte order mark, so Excel reads it as UTF-8.
      return new Response(format === 'csv' ? BYTE_ORDER_MARK + exported.body : exported.body, {
        headers: {
          'Content-Type':
            format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8',
          'Content-Disposition': `${format === 'csv' ? 'attachment' : 'inline'}; filename="${exported.fileName}"`,
        },
      });
    }
    const action = await getActionFor(auth, id);
    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }
    return NextResponse.json(action);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
