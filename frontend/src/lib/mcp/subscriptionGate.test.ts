// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The MCP server on a read-only workspace (GetCito Cloud, plan not active):
 * list_/get_ tools answer, every other tool answers subscription_inactive.
 */

let status: string | null;
let plan: string;
let dbError: { message: string } | null;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () =>
          dbError
            ? { data: null, error: dbError }
            : { data: { plan, subscription_status: status }, error: null },
      };
      return query;
    },
  },
}));

const data = vi.hoisted(() => ({
  listBrandsFor: vi.fn(async () => [{ id: 'brand-1', name: 'Acme' }]),
  dismissTopicSuggestionFor: vi.fn(async () => ({ id: 'suggestion-1', status: 'dismissed' })),
}));
vi.mock('@/lib/mcp/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/data')>()),
  ...data,
}));

const { createMcpServer } = await import('./server');
const {
  isReadTool,
  SubscriptionInactiveError,
  subscriptionActiveFor,
  gateWriteTools,
  mcpWriteAccess,
} = await import('./subscriptionGate');
const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
const { runSiteAuditFor, generateBriefFor } = await import('./data');

const SUGGESTION_ID = '11111111-2222-3333-4444-555555555555';

/** A client talking to a server built for one request, as the MCP route builds it. */
async function connect() {
  const server = createMcpServer({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all' as const,
    role: 'admin',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

/** A tool result's text, read as the JSON it carries. */
const body = (result: Awaited<ReturnType<Client['callTool']>>) =>
  JSON.parse((result.content as { text: string }[])[0].text);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  status = 'canceled';
  plan = 'growth';
  dbError = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the MCP tools on a read-only workspace', () => {
  it('keeps every list_/get_ tool open and gates the ones that write, run or spend', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names.filter(isReadTool)).toHaveLength(48);
    expect(names.filter((name) => !isReadTool(name)).sort()).toEqual([
      'accept_prompt_suggestion',
      'accept_topic_suggestion',
      'add_content_source',
      'approve_task_review',
      'create_content_draft',
      'create_improve_action',
      'dismiss_prompt_suggestion',
      'dismiss_task_review',
      'dismiss_topic_suggestion',
      'generate_content_brief',
      'mark_content_draft_published',
      'override_mention_sentiment',
      'run_site_audit',
      'set_content_draft_ready',
      'suggest_content_changes',
      'update_opportunity_status',
      'update_task_status',
    ]);
  });

  it('answers every gated tool, as registered, with subscription_inactive before it runs', async () => {
    const server = createMcpServer({
      userId: 'user-1',
      email: null,
      organizationId: 'org-1',
      apiKeyId: 'key-1',
      brandAccess: 'all' as const,
      role: 'admin',
    });
    // The handlers the SDK calls once a call's arguments are checked.
    const registered = (
      server as unknown as {
        _registeredTools: Record<string, { handler: (...args: unknown[]) => unknown }>;
      }
    )._registeredTools;
    const gated = Object.keys(registered).filter((name) => !isReadTool(name));
    expect(gated).toHaveLength(17);
    for (const name of gated) {
      const result = (await registered[name].handler({}, {})) as {
        isError?: boolean;
        content: { text: string }[];
      };
      expect(result.isError, name).toBe(true);
      expect(JSON.parse(result.content[0].text), name).toMatchObject({
        code: 'subscription_inactive',
      });
    }
    expect(data.dismissTopicSuggestionFor).not.toHaveBeenCalled();
  });

  it('refuses a tool registered around the gate', () => {
    const server = gateWriteTools(new McpServer({ name: 'test', version: '0' }), 'org-1');
    expect(() => server.tool('update_anything', async () => ({ content: [] }))).toThrow(
      /registerTool/,
    );
  });

  it('keeps a gated tool closed when the plan cannot be read', async () => {
    dbError = { message: 'connection reset' };
    await expect(subscriptionActiveFor('org-1')).rejects.toThrow('connection reset');
    await expect(mcpWriteAccess('org-1')).rejects.toThrow('connection reset');
    const client = await connect();
    const result = await client.callTool({
      name: 'dismiss_topic_suggestion',
      arguments: { suggestion_id: SUGGESTION_ID },
    });
    expect(result.isError).toBe(true);
    expect(data.dismissTopicSuggestionFor).not.toHaveBeenCalled();
  });

  it('answers a read tool', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'list_brands', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(body(result)).toEqual([{ id: 'brand-1', name: 'Acme' }]);
  });

  it('refuses a write tool with subscription_inactive, without running it', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'dismiss_topic_suggestion',
      arguments: { suggestion_id: SUGGESTION_ID },
    });
    expect(result.isError).toBe(true);
    expect(body(result)).toMatchObject({ error: 'plan_limit', code: 'subscription_inactive' });
    expect(data.dismissTopicSuggestionFor).not.toHaveBeenCalled();
  });

  it('runs a write tool once the plan is active', async () => {
    status = 'active';
    const client = await connect();
    const result = await client.callTool({
      name: 'dismiss_topic_suggestion',
      arguments: { suggestion_id: SUGGESTION_ID },
    });
    expect(result.isError).toBeFalsy();
    expect(data.dismissTopicSuggestionFor).toHaveBeenCalledTimes(1);
  });

  it('never gates self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    const client = await connect();
    const result = await client.callTool({
      name: 'dismiss_topic_suggestion',
      arguments: { suggestion_id: SUGGESTION_ID },
    });
    expect(result.isError).toBeFalsy();
    expect(data.dismissTopicSuggestionFor).toHaveBeenCalledTimes(1);
  });
});

describe('the MCP tools per plan (DECISIONS S, 2026-10-30)', () => {
  const call = async (name: string, args: Record<string, unknown>) => {
    const client = await connect();
    return client.callTool({ name, arguments: args });
  };

  it.each([
    ['starter', 'active', false],
    ['starter', 'trialing', false],
    ['growth', 'trialing', false],
    ['growth', 'active', true],
    ['enterprise', 'trialing', true],
    ['enterprise', 'active', true],
  ])('%s %s: reads, and writes only from Growth, paid (%s)', async (p, s, writes) => {
    plan = p;
    status = s;
    const read = await call('list_brands', {});
    expect(read.isError).toBeFalsy();
    const write = await call('dismiss_topic_suggestion', { suggestion_id: SUGGESTION_ID });
    if (writes) {
      expect(write.isError).toBeFalsy();
      expect(data.dismissTopicSuggestionFor).toHaveBeenCalledTimes(1);
    } else {
      expect(write.isError).toBe(true);
      expect(body(write)).toEqual({
        error: 'plan_limit',
        code: 'plan_required',
        required_plan: 'growth',
        message: expect.stringContaining('need the Growth plan or above'),
      });
      expect(data.dismissTopicSuggestionFor).not.toHaveBeenCalled();
    }
  });

  it('answers a plan that ended with subscription_inactive before the plan it needs', async () => {
    plan = 'starter';
    status = 'canceled';
    const write = await call('dismiss_topic_suggestion', { suggestion_id: SUGGESTION_ID });
    expect(body(write)).toMatchObject({ code: 'subscription_inactive' });
  });

  it('keeps every write tool listed on Starter, for the host to say why', async () => {
    plan = 'starter';
    status = 'active';
    const { tools } = await (await connect()).listTools();
    expect(tools.filter((tool) => !isReadTool(tool.name))).toHaveLength(17);
  });

  it('says whether a write may go through, and never gates self-hosted', async () => {
    plan = 'starter';
    status = 'active';
    await expect(mcpWriteAccess('org-1')).resolves.toBe('plan');
    await expect(mcpWriteAccess(null)).resolves.toBe('ok');
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    await expect(mcpWriteAccess('org-1')).resolves.toBe('ok');
    const write = await call('dismiss_topic_suggestion', { suggestion_id: SUGGESTION_ID });
    expect(write.isError).toBeFalsy();
  });
});

describe('the costly internal calls on a read-only workspace', () => {
  const auth = {
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'agent-internal',
    brandAccess: 'all' as const,
    role: 'admin' as const,
  };
  const fetchMock = vi.fn(async () =>
    Response.json({
      audit: { id: 'audit-1', brandId: 'brand-1', url: 'https://getcito.com', status: 'running' },
    }),
  );

  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'secret');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses a Site Audit before the server is asked, whoever calls it', async () => {
    await expect(runSiteAuditFor(auth, 'brand-1', 'https://getcito.com')).rejects.toBeInstanceOf(
      SubscriptionInactiveError,
    );
    await expect(generateBriefFor(auth, 'opportunity-1')).rejects.toMatchObject({
      code: 'subscription_inactive',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts one once the plan is active', async () => {
    status = 'active';
    await expect(runSiteAuditFor(auth, 'brand-1', 'https://getcito.com')).resolves.toMatchObject({
      id: 'audit-1',
      status: 'running',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never gates self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    await runSiteAuditFor(auth, 'brand-1', 'https://getcito.com');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
