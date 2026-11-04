// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Chat and the GetCito MCP Server do the same work through the same rows
 * (CHAT-20 §17): every MCP tool a row names is registered on the server, and
 * the server agrees with the row on whether it only reads.
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
// The write rows' server actions; nothing here calls them.
vi.mock('@/lib/actions/content', () => ({ updateOpportunityStatus: vi.fn() }));
vi.mock('@/lib/actions/contentDrafts', () => ({ createContentDraft: vi.fn() }));
vi.mock('@/lib/actions/promptSuggestions', () => ({ dismissSuggestion: vi.fn() }));

const { CHAT_TOOLS } = await import('./tools');
const { createMcpServer } = await import('@/lib/mcp/server');
const { isReadTool } = await import('@/lib/mcp/subscriptionGate');

type McpTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];
let mcpTools: Map<string, McpTool>;

beforeAll(async () => {
  // role: the MCP context's since #1762; a const, so it compiles before it too.
  const auth = {
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all' as const,
    role: 'admin' as const,
  };
  const server = createMcpServer(auth);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  mcpTools = new Map(tools.map((tool) => [tool.name, tool]));
});

const mapped = CHAT_TOOLS.filter((tool) => tool.mcpTool);

describe('the registry against the MCP Server', () => {
  it('names only MCP tools the server registers', () => {
    const unknown = mapped.filter((tool) => !mcpTools.has(tool.mcpTool!));
    expect(unknown.map((tool) => `${tool.name} → ${tool.mcpTool}`)).toEqual([]);
  });

  it('maps a read to an MCP read and a write to an MCP write', () => {
    // isReadTool is the server's own split: what stays open on a read-only workspace.
    const crossed = mapped.filter((tool) => isReadTool(tool.mcpTool!) !== (tool.class === 'read'));
    expect(crossed.map((tool) => `${tool.name} (${tool.class}) → ${tool.mcpTool}`)).toEqual([]);
  });

  it("agrees with the MCP tools' readOnlyHint wherever they state one", () => {
    // On main only a few tools state it; #1732 adds it to every tool, and then this covers all.
    const disagree = mapped.filter((tool) => {
      const hint = mcpTools.get(tool.mcpTool!)?.annotations?.readOnlyHint;
      return hint !== undefined && hint !== (tool.class === 'read');
    });
    expect(disagree.map((tool) => `${tool.name} → ${tool.mcpTool}`)).toEqual([]);
  });
});
