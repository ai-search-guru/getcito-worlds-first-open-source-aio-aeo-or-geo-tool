import { NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { createMcpServer } from '@/lib/mcp/server';

export const dynamic = 'force-dynamic';
// Node, not the edge: get_content_draft_package reads pages with jsdom.
export const runtime = 'nodejs';

/**
 * Streamable HTTP entry point for the GetCito MCP server. Claude Desktop,
 * Claude Code, Cursor, Zed, and other MCP-aware clients hit this URL with a
 * Bearer API key. Each request gets a fresh `McpServer` + transport bound to
 * the caller's user context, then is discarded — stateless, no session
 * memory between requests.
 */
async function handle(req: Request): Promise<Response> {
  // Every MCP call is a POST: its tools are gated one by one (createMcpServer).
  const auth = await authenticateMcpRequest(req, { gateWrites: false });
  if (auth instanceof NextResponse) return auth;

  const server = createMcpServer(auth);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'MCP request failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}

export async function DELETE(req: Request) {
  return handle(req);
}
