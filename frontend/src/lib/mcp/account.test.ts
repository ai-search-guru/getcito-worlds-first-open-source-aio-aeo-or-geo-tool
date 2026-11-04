// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * get_me: the person a key acts as, with their role, their work areas by name
 * and whether they choose who sees which menu sections. get_ai_usage: the
 * Billing meter's own numbers, from the server, and no allowance without an
 * active plan.
 */

let profile: Record<string, unknown> | null;
let org: Record<string, unknown> | null;
/** A read that fails, by table. */
let failing: string | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            failing === table
              ? { data: null, error: { message: `${table} read failed` } }
              : { data: table === 'profiles' ? profile : org, error: null },
        }),
      }),
    }),
  },
}));

const { getAiUsageFor, getMeFor } = await import('./account');
const { createMcpServer } = await import('./server');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: 'ada@acme.example',
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

describe('getMeFor', () => {
  beforeEach(() => {
    org = { name: 'Acme' };
    failing = null;
  });

  it('names the role, the work areas and that a manager may change menus', async () => {
    profile = {
      role: 'manager',
      work_areas: ['content', 'leaders', 'gone'],
      can_manage_menus: true,
    };
    expect(await getMeFor(auth)).toEqual({
      user_id: 'user-1',
      email: 'ada@acme.example',
      organization_id: 'org-1',
      organization_name: 'Acme',
      role: 'manager',
      // A work area no longer offered is left out.
      work_areas: [
        { id: 'content', name: 'Content' },
        { id: 'leaders', name: 'Founders & leaders' },
      ],
      can_manage_menus: true,
    });
  });

  it('lets an admin change menus always, an analyst never', async () => {
    profile = { role: 'admin', work_areas: null, can_manage_menus: false };
    expect(await getMeFor(auth)).toMatchObject({ can_manage_menus: true, work_areas: [] });
    profile = { role: 'analyst', work_areas: [], can_manage_menus: true };
    expect(await getMeFor(auth)).toMatchObject({ can_manage_menus: false });
  });

  it('answers without a profile or an organization', async () => {
    profile = null;
    const me = await getMeFor({ ...auth, organizationId: null });
    expect(me).toMatchObject({
      organization_id: null,
      organization_name: null,
      role: null,
      work_areas: [],
      can_manage_menus: false,
    });
  });

  it('fails rather than answer a role it could not read', async () => {
    profile = { role: 'admin', work_areas: [], can_manage_menus: false };
    failing = 'profiles';
    await expect(getMeFor(auth)).rejects.toThrow('profiles read failed');
    failing = 'organizations';
    await expect(getMeFor(auth)).rejects.toThrow('organizations read failed');
  });
});

describe('getAiUsageFor', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('CRON_SECRET', 'secret');
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads the Billing meter's numbers from the server, quality checks in the editor's row", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        success: true,
        usage: {
          plan: 'growth',
          planName: 'Growth',
          trial: false,
          periodStart: '2026-10-01T00:00:00Z',
          periodEnd: '2026-11-01T00:00:00Z',
          unlimited: false,
          percentUsed: 42.5,
          // An older server lists every feature, and the quality checks apart.
          features: [
            { feature: 'improve', percent: 20 },
            { feature: 'content', percent: 10 },
            { feature: 'quality', percent: 2.5 },
            { feature: 'action_center', percent: 10 },
            { feature: 'other', percent: 0 },
          ],
        },
      }),
    );
    expect(await getAiUsageFor(auth)).toEqual({
      active_plan: true,
      plan: 'growth',
      plan_name: 'Growth',
      trial: false,
      period_start: '2026-10-01T00:00:00Z',
      period_end: '2026-11-01T00:00:00Z',
      unlimited: false,
      percent_used: 42.5,
      features: [
        { feature: 'improve', percent: 20 },
        { feature: 'content', percent: 12.5 },
        { feature: 'action_center', percent: 10 },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/internal\/ai-usage\?orgId=org-1$/);
    expect(init).toMatchObject({ headers: { Authorization: 'Bearer secret' } });
  });

  it('says there is no allowance without an active plan', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ success: false, error: 'plan_limit', message: 'No plan' }, { status: 402 }),
    );
    expect(await getAiUsageFor(auth)).toMatchObject({
      active_plan: false,
      percent_used: null,
      features: [],
    });
  });

  it("passes on the server's failure", async () => {
    fetchMock.mockResolvedValue(Response.json({ message: 'boom' }, { status: 500 }));
    await expect(getAiUsageFor(auth)).rejects.toThrow('boom');
  });

  it('answers unlimited self-hosted, without asking the server', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await getAiUsageFor(auth)).toMatchObject({
      active_plan: true,
      plan: 'self_hosted',
      unlimited: true,
      percent_used: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks nothing without an organization, or without the internal secret', async () => {
    expect(await getAiUsageFor({ ...auth, organizationId: null })).toBeNull();
    vi.stubEnv('CRON_SECRET', '');
    await expect(getAiUsageFor(auth)).rejects.toThrow('CRON_SECRET');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the get_me and get_ai_usage tools', () => {
  it('list as read-only tools with a title, and answer as JSON', async () => {
    profile = { role: 'admin', work_areas: ['aeo'], can_manage_menus: false };
    org = { name: 'Acme' };
    failing = null;
    const server = createMcpServer(auth);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    for (const [name, title] of [
      ['get_me', 'Who am I'],
      ['get_ai_usage', 'AI usage this period'],
    ]) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.title, name).toBe(title);
      expect(tool?.annotations, name).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    }

    const result = await client.callTool({ name: 'get_me', arguments: {} });
    expect(JSON.parse((result.content as { text: string }[])[0].text)).toMatchObject({
      role: 'admin',
      work_areas: [{ id: 'aeo', name: 'AEO/GEO & Audit' }],
      can_manage_menus: true,
    });
  });
});
