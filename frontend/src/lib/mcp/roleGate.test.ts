// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@/types';

/**
 * The MCP tools write with the service role, so they check the key's role
 * themselves: adding a prompt or a topic, and dismissing, are an admin's or a
 * manager's; recording an opportunity's progress is any member's. A refused
 * call writes nothing.
 */

/** Each row read or written, by table and kind. */
const calls: { table: string; op: 'select' | 'update' | 'insert' }[] = [];
/** The opportunity the status tool finds, with the status it has now. */
let opportunity: { id: string; status: string } | null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      let op: 'select' | 'update' | 'insert' = 'select';
      let written: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        update: (values: Record<string, unknown>) => {
          op = 'update';
          written = values;
          return chain;
        },
        insert: () => {
          op = 'insert';
          return chain;
        },
        eq: () => chain,
        // A suggestion is never found: past the role check, the tool answers "not found".
        maybeSingle: async () => {
          calls.push({ table, op });
          return { data: table === 'content_opportunities' ? opportunity : null, error: null };
        },
        single: async () => {
          calls.push({ table, op });
          return { data: { id: opportunity?.id, ...written }, error: null };
        },
      };
      return chain;
    },
  },
}));

const { createMcpServer } = await import('./server');
const { RoleRequiredError, requireManager, requireRole, MEMBER_ROLES } = await import('./roleGate');

const ID = '11111111-2222-3333-4444-555555555555';

/** A client on a server built for a key whose user has `role`. */
async function connect(role: UserRole | null) {
  const server = createMcpServer({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    role,
    apiKeyId: 'key-1',
    brandAccess: 'all',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as { text: string }[])[0].text;

beforeEach(() => {
  // Self-hosted: the plan gate lets every tool through without a read.
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
  calls.length = 0;
  opportunity = { id: ID, status: 'new' };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requireManager', () => {
  it('lets an admin and a manager through', () => {
    expect(() => requireManager({ role: 'admin' })).not.toThrow();
    expect(() => requireManager({ role: 'manager' })).not.toThrow();
  });

  it('refuses an analyst, an agency partner and a user without a role, saying who can', () => {
    for (const role of ['analyst', 'agency_partner', null] as const) {
      expect(() => requireManager({ role })).toThrow(RoleRequiredError);
    }
    expect(() => requireManager({ role: 'analyst' })).toThrow(
      'Only an admin or a manager can do this. This API key acts as an analyst: ask an admin or a manager of the organization to do it.',
    );
  });

  it('names every role allowed when more than two are', () => {
    expect(() => requireRole({ role: 'agency_partner' }, MEMBER_ROLES)).toThrow(
      'Only an admin, a manager or an analyst can do this. This API key acts as an agency partner',
    );
    expect(() => requireRole({ role: 'analyst' }, MEMBER_ROLES)).not.toThrow();
  });
});

describe('the tools only an admin or a manager may call', () => {
  const managerTools = [
    'accept_prompt_suggestion',
    'accept_topic_suggestion',
    'dismiss_topic_suggestion',
  ];

  it('refuses an analyst before anything is read or written', async () => {
    const client = await connect('analyst');
    for (const name of managerTools) {
      const result = await client.callTool({ name, arguments: { suggestion_id: ID } });
      expect(result.isError, name).toBe(true);
      expect(text(result), name).toMatch(/^Only an admin or a manager can do this/);
    }
    expect(calls).toEqual([]);
  });

  it('lets a manager through to the suggestion', async () => {
    const client = await connect('manager');
    for (const name of managerTools) {
      const result = await client.callTool({ name, arguments: { suggestion_id: ID } });
      expect(text(result), name).toBe('Suggestion not found, not pending, or already processed');
    }
    expect(calls.map((call) => call.table)).toEqual([
      'prompt_suggestions',
      'topic_suggestions',
      'topic_suggestions',
    ]);
  });
});

describe('the tools that cost AI: generate_content_brief and create_improve_action', () => {
  const improveArgs = {
    prompt_id: ID,
    range: { preset: '7d', from: '2026-10-21T00:00:00.000Z' },
    idempotency_key: 'key-000001',
    suggestions: [{ id: 's1', platform: 'perplexity-web', title: 'Publish a comparison page' }],
  };
  const call = (client: Client) =>
    Promise.all([
      client.callTool({ name: 'generate_content_brief', arguments: { opportunity_id: ID } }),
      client.callTool({ name: 'create_improve_action', arguments: improveArgs }),
    ]);

  for (const role of ['analyst', 'agency_partner'] as const) {
    it(`refuse an ${role} before anything is read or generated`, async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      try {
        const client = await connect(role);
        for (const result of await call(client)) {
          expect(result.isError).toBe(true);
          expect(text(result)).toMatch(/^Only an admin or a manager can do this/);
        }
        expect(calls).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  }

  it('let a manager through to the opportunity and the prompt', async () => {
    const client = await connect('manager');
    const [brief, improve] = await call(client);
    expect(text(brief)).not.toMatch(/^Only an admin/);
    expect(text(improve)).toBe('Prompt not found');
    expect(calls.map((c) => c.table)).toEqual(['content_opportunities', 'prompts']);
  });
});

describe('dismiss_prompt_suggestion', () => {
  it('refuses an agency partner', async () => {
    const client = await connect('agency_partner');
    const result = await client.callTool({
      name: 'dismiss_prompt_suggestion',
      arguments: { suggestion_id: ID },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Only an admin, a manager or an analyst can do this/);
    expect(calls).toEqual([]);
  });

  it('lets an analyst through, as the table does', async () => {
    const client = await connect('analyst');
    const result = await client.callTool({
      name: 'dismiss_prompt_suggestion',
      arguments: { suggestion_id: ID },
    });
    expect(text(result)).toBe('Suggestion not found, not pending, or already processed');
    expect(calls).toEqual([{ table: 'prompt_suggestions', op: 'select' }]);
  });
});

describe('update_opportunity_status', () => {
  const update = (client: Client, status: string) =>
    client.callTool({
      name: 'update_opportunity_status',
      arguments: { opportunity_id: ID, status },
    });
  const updates = () => calls.filter((call) => call.op === 'update');

  it("records an analyst's progress", async () => {
    const client = await connect('analyst');
    const result = await update(client, 'in_progress');
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toMatchObject({ id: ID, status: 'in_progress' });
    expect(updates()).toHaveLength(1);
  });

  it('refuses an analyst a dismissal, or bringing a dismissed one back, without a write', async () => {
    const client = await connect('analyst');
    const dismissed = await update(client, 'dismissed');
    expect(dismissed.isError).toBe(true);
    expect(text(dismissed)).toMatch(/^Only an admin or a manager can do this/);

    opportunity = { id: ID, status: 'dismissed' };
    const restored = await update(client, 'new');
    expect(restored.isError).toBe(true);
    expect(updates()).toEqual([]);
  });

  it('lets a manager dismiss one', async () => {
    const client = await connect('manager');
    const result = await update(client, 'dismissed');
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toMatchObject({ status: 'dismissed' });
    expect(updates()).toHaveLength(1);
  });

  it('says not found, not forbidden, for an opportunity outside the organization', async () => {
    opportunity = null;
    const client = await connect('analyst');
    const result = await update(client, 'dismissed');
    expect(text(result)).toBe('Content opportunity not found');
  });
});
