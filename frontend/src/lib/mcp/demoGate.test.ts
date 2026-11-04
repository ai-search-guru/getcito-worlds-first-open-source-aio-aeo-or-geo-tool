// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The demo brand (00380) on the MCP surface: every tool that writes, runs or
 * spends answers demo_brand on it, whatever the plan; reading stays open; the
 * brand list marks it, and leaves it out once hidden.
 */

const ORG = 'org-1';

/** The rows the fake database holds, by table and id. */
let rows: Record<string, Record<string, Record<string, unknown>>>;

function from(table: string) {
  const filters: [string, unknown][] = [];
  let demoShown = false;
  const run = () => {
    let list: Record<string, unknown>[] = Object.entries(rows[table] ?? {}).map(([id, row]) => ({
      id,
      ...row,
    }));
    // A filter on an embedded table (brands.organization_id) is the caller's ownership check.
    for (const [key, value] of filters) {
      if (!key.includes('.')) list = list.filter((row) => row[key] === value);
    }
    if (demoShown) list = list.filter((row) => row.is_demo === false || row.demo_hidden_at == null);
    return list;
  };
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => {
      filters.push([key, value]);
      return query;
    },
    or: (expression: string) => {
      expect(expression).toBe('is_demo.eq.false,demo_hidden_at.is.null');
      demoShown = true;
      return query;
    },
    order: () => query,
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: run(), error: null }).then(resolve),
  };
  return query;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from } }));

const data = vi.hoisted(() => ({
  getVisibilitySummaryFor: vi.fn(async () => ({ brand: { id: 'demo-brand', name: 'Brewline' } })),
  runSiteAuditFor: vi.fn(async () => ({ id: 'audit-1', status: 'running' })),
}));
vi.mock('@/lib/mcp/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/data')>()),
  ...data,
}));

const { createMcpServer } = await import('./server');
const { isReadTool } = await import('./subscriptionGate');
const { WRITE_TOOL_BRANDS, DemoBrandError } = await import('./demoGate');
const { listBrandsFor, generateBriefFor } = await import('./data');

const AUTH = {
  userId: 'user-1',
  email: null,
  organizationId: ORG,
  apiKeyId: 'key-1',
  role: 'admin' as const,
};

/** Each tool's arguments for a call on the demo brand. */
const ON_DEMO: Record<string, Record<string, unknown>> = {
  accept_topic_suggestion: { suggestion_id: 'topic-suggestion-1' },
  dismiss_topic_suggestion: { suggestion_id: 'topic-suggestion-1' },
  accept_prompt_suggestion: { suggestion_id: 'prompt-suggestion-1' },
  dismiss_prompt_suggestion: { suggestion_id: 'prompt-suggestion-1' },
  generate_content_brief: { opportunity_id: 'opportunity-1' },
  update_opportunity_status: { opportunity_id: 'opportunity-1', status: 'dismissed' },
  run_site_audit: { brand_id: 'demo-brand', url: 'https://brewline.example/' },
  update_task_status: { task_id: 'task-1', status: 'completed' },
  create_improve_action: { prompt_id: 'prompt-1', range: { preset: '7d' } },
  override_mention_sentiment: { id: 'result-1', sentiment: 'positive' },
  create_content_draft: { brand_id: 'demo-brand', title: 'T', body_html: '<h1>T</h1>' },
  add_content_source: { draft_id: 'draft-1', kind: 'url', ref: 'https://brewline.example/' },
  suggest_content_changes: { draft_id: 'draft-1', suggestions: [] },
  set_content_draft_ready: { draft_id: 'draft-1' },
  mark_content_draft_published: { draft_id: 'draft-1', url: 'https://brewline.example/blog/' },
  approve_task_review: { review_id: 'review-1' },
  dismiss_task_review: { review_id: 'review-1' },
};

/** The handlers the SDK calls once a call's arguments are checked. */
function handlers() {
  const server = createMcpServer(AUTH);
  return (
    server as unknown as {
      _registeredTools: Record<string, { handler: (...args: unknown[]) => unknown }>;
    }
  )._registeredTools;
}

type ToolResult = { isError?: boolean; content: { text: string }[] };
const body = (result: unknown) => JSON.parse((result as ToolResult).content[0].text);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  rows = {
    organizations: { [ORG]: { plan: 'growth', subscription_status: 'active' } },
    profiles: { 'user-1': { role: 'admin', organization_id: ORG, brand_scope: 'all' } },
    brands: {
      'demo-brand': { organization_id: ORG, is_demo: true, demo_hidden_at: null, name: 'Brewline' },
      'own-brand': { organization_id: ORG, is_demo: false, demo_hidden_at: null, name: 'Acme' },
      'other-demo': { organization_id: 'org-2', is_demo: true, demo_hidden_at: null },
    },
    topic_suggestions: { 'topic-suggestion-1': { brand_id: 'demo-brand' } },
    prompt_suggestions: { 'prompt-suggestion-1': { brand_id: 'demo-brand' } },
    content_opportunities: { 'opportunity-1': { brand_id: 'demo-brand' } },
    action_tasks: { 'task-1': { action_id: 'action-1' } },
    action_task_reviews: { 'review-1': { action_id: 'action-1' } },
    actions: { 'action-1': { brand_id: 'demo-brand' } },
    prompts: { 'prompt-1': { prompt_set_id: 'set-1' } },
    prompt_sets: { 'set-1': { brand_id: 'demo-brand' } },
    prompt_results: { 'result-1': { brand_id: 'demo-brand' } },
    content_drafts: { 'draft-1': { brand_id: 'demo-brand' } },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the MCP tools on the demo brand', () => {
  it('knows how every tool that writes, runs or spends finds its brand', () => {
    const gated = Object.keys(handlers()).filter((name) => !isReadTool(name));
    // A new such tool fails here until WRITE_TOOL_BRANDS says how it finds its brand.
    expect(Object.keys(WRITE_TOOL_BRANDS).sort()).toEqual(gated.sort());
    expect(Object.keys(ON_DEMO).sort()).toEqual(gated.sort());
  });

  it('refuses each of them on the demo brand, whatever the plan', async () => {
    const registered = handlers();
    for (const [name, args] of Object.entries(ON_DEMO)) {
      const result = (await registered[name].handler(args, {})) as ToolResult;
      expect(result.isError, name).toBe(true);
      expect(body(result), name).toMatchObject({ code: 'demo_brand' });
    }
    expect(data.runSiteAuditFor).not.toHaveBeenCalled();
  });

  it('answers demo_brand before the plan: on Starter too, and on a plan that ended', async () => {
    for (const org of [
      { plan: 'starter', subscription_status: 'active' },
      { plan: 'growth', subscription_status: 'canceled' },
    ]) {
      rows.organizations[ORG] = org;
      const result = (await handlers().run_site_audit.handler(
        ON_DEMO.run_site_audit,
        {},
      )) as ToolResult;
      expect(body(result)).toMatchObject({ code: 'demo_brand' });
    }
    expect(data.runSiteAuditFor).not.toHaveBeenCalled();
  });

  it('runs them on the organization’s own brand', async () => {
    const result = await handlers().run_site_audit.handler(
      { brand_id: 'own-brand', url: 'https://acme.example/' },
      {},
    );
    expect((result as ToolResult).isError).toBeUndefined();
    expect(data.runSiteAuditFor).toHaveBeenCalledWith(AUTH, 'own-brand', 'https://acme.example/');
  });

  it('leaves another organization’s demo brand to the tool’s own check', async () => {
    await handlers().run_site_audit.handler(
      { brand_id: 'other-demo', url: 'https://brewline.example/' },
      {},
    );
    expect(data.runSiteAuditFor).toHaveBeenCalled();
  });

  it('keeps reading open on the demo brand', async () => {
    const result = (await handlers().get_visibility_summary.handler(
      { brand_id: 'demo-brand' },
      {},
    )) as ToolResult;
    expect(result.isError).toBeUndefined();
    expect(data.getVisibilitySummaryFor).toHaveBeenCalled();
  });

  it('checks nothing self-hosted, where there is no demo brand', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    await handlers().run_site_audit.handler(
      { brand_id: 'demo-brand', url: 'https://brewline.example/' },
      {},
    );
    expect(data.runSiteAuditFor).toHaveBeenCalled();
  });

  it('refuses a brief on the demo brand on the REST route’s path too', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(generateBriefFor(AUTH, 'opportunity-1')).rejects.toBeInstanceOf(DemoBrandError);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('listBrandsFor', () => {
  it('marks the demo brand', async () => {
    const brands = await listBrandsFor(AUTH);
    expect(brands.map((b) => [b.id, b.is_demo])).toEqual([
      ['demo-brand', true],
      ['own-brand', false],
    ]);
  });

  it('leaves the demo brand out once hidden', async () => {
    rows.brands['demo-brand'].demo_hidden_at = '2026-10-28T12:00:00Z';
    const brands = await listBrandsFor(AUTH);
    expect(brands.map((b) => b.id)).toEqual(['own-brand']);
  });

  it('lists only the brands shared with a Selected-brands person, and the demo brand (BRAND-ACCESS)', async () => {
    rows.profiles['user-1'] = { role: 'manager', organization_id: ORG, brand_scope: 'selected' };
    rows.member_brands = {};
    expect((await listBrandsFor(AUTH)).map((b) => b.id)).toEqual(['demo-brand']);
    rows.member_brands = {
      grant: { user_id: 'user-1', organization_id: ORG, brand_id: 'own-brand' },
    };
    expect((await listBrandsFor(AUTH)).map((b) => b.id)).toEqual(['demo-brand', 'own-brand']);
    // Someone who isn't a member of the workspace (any more) lists none.
    rows.profiles['user-1'] = { role: 'admin', organization_id: 'org-2' };
    expect(await listBrandsFor(AUTH)).toEqual([]);
  });

  it('takes the brands its caller read already (Chat), reading no profile', async () => {
    delete rows.profiles;
    const brands = await listBrandsFor({ ...AUTH, brandAccess: ['own-brand'] });
    expect(brands.map((b) => b.id)).toEqual(['own-brand']);
  });
});
