// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * Brand access over MCP (BRAND-ACCESS §5.3, PR 10). A key carries its
 * owner's access, since keys belong to people: a Selected-brands person's key
 * reads a brand that wasn't shared with them, and every row of it, as another
 * organization's. It gets not found, nothing is written, and no database
 * function or internal endpoint runs. With All brands nothing changes; the
 * tools' own tests read as the organization's brands.
 */

type Row = Record<string, unknown>;

/** What a table answers, the tables read, and the writes and functions asked for. */
const db = vi.hoisted(() => ({
  rows: {} as Record<string, Row | null>,
  lists: {} as Record<string, Row[]>,
  reads: [] as string[],
  writes: [] as unknown[][],
  rpcs: [] as string[],
}));

vi.mock('@/lib/supabase/admin', () => {
  const from = (table: string) => {
    db.reads.push(table);
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const name of [
      'select',
      'eq',
      'in',
      'is',
      'or',
      'order',
      'limit',
      'range',
      'gte',
      'lte',
    ]) {
      chain[name] = self;
    }
    chain.update = (value: unknown) => (db.writes.push([table, 'update', value]), chain);
    chain.insert = (value: unknown) => (db.writes.push([table, 'insert', value]), chain);
    chain.delete = () => (db.writes.push([table, 'delete']), chain);
    chain.maybeSingle = async () => ({ data: db.rows[table] ?? null, error: null });
    chain.single = async () => ({ data: db.rows[table] ?? null, error: null });
    chain.then = (resolve: (value: unknown) => void) =>
      resolve({ data: db.lists[table] ?? [], error: null, count: 0 });
    return chain;
  };
  const rpc = async (fn: string) => (db.rpcs.push(fn), { data: null, error: null });
  return { supabaseAdmin: { from, rpc } };
});

const data = await import('./data');
const mentions = await import('./mentions');
const content = await import('./content');
const taskReviews = await import('./taskReviews');
const { exportActionFor } = await import('./actionExport');
const { getContentDraftPackageFor } = await import('./contentPackage');
const { getContentPlanFor } = await import('./contentPlan');
const { explainChangeFor } = await import('./why');
const { createMcpServer } = await import('./server');

const ALL: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  role: 'manager',
  apiKeyId: 'key-1',
  brandAccess: 'all',
};
/** A Selected-brands Manager's key: b2 was shared with them, b1 wasn't. */
const SELECTED: McpAuthContext = { ...ALL, brandAccess: ['b2'] };

const fetchSpy = vi.spyOn(globalThis, 'fetch');

beforeEach(() => {
  // b1 is the organization's: found by id and organization, as every tool reads it.
  db.rows = { brands: { id: 'b1', name: 'Acme', brand_domains: [] } };
  db.lists = {};
  db.reads = [];
  db.writes = [];
  db.rpcs = [];
  fetchSpy.mockReset();
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
});

describe('brandAllowed', () => {
  it('lets in a brand of the organization that the access reaches', async () => {
    expect(await data.brandAllowed(ALL, 'b1')).toBe(true);
    expect(await data.brandAllowed({ ...SELECTED, brandAccess: ['b1'] }, 'b1')).toBe(true);
  });

  it("refuses one that wasn't shared, or that isn't the organization's", async () => {
    expect(await data.brandAllowed(SELECTED, 'b1')).toBe(false);
    db.rows.brands = null;
    expect(await data.brandAllowed(ALL, 'b9')).toBe(false);
    expect(await data.brandAllowed({ ...ALL, organizationId: null }, 'b1')).toBe(false);
    // Someone no longer in the workspace reaches none.
    db.rows.brands = { id: 'b1' };
    expect(await data.brandAllowed({ ...ALL, brandAccess: null }, 'b1')).toBe(false);
  });
});

describe('mayUseBrand', () => {
  it('reaches every brand with All brands, the shared ones otherwise', async () => {
    expect(await data.mayUseBrand(ALL, 'b1')).toBe(true);
    expect(await data.mayUseBrand(ALL, undefined)).toBe(true);
    expect(await data.mayUseBrand(SELECTED, 'b2')).toBe(true);
    expect(await data.mayUseBrand(SELECTED, 'b1')).toBe(false);
    expect(await data.mayUseBrand(SELECTED, null)).toBe(false);
    expect(await data.mayUseBrand({ ...ALL, brandAccess: null }, 'b1')).toBe(false);
  });
});

describe("a Selected-brands key on a brand that wasn't shared", () => {
  const byBrand: [string, () => Promise<unknown>][] = [
    ['getVisibilitySummaryFor', () => data.getVisibilitySummaryFor(SELECTED, { brandId: 'b1' })],
    ['listTopicsFor', () => data.listTopicsFor(SELECTED, 'b1')],
    ['listTopicSuggestionsFor', () => data.listTopicSuggestionsFor(SELECTED, 'b1')],
    ['listPromptSuggestionsFor', () => data.listPromptSuggestionsFor(SELECTED, 'b1')],
    ['listPromptsFor', () => data.listPromptsFor(SELECTED, { brandId: 'b1' })],
    [
      'listContentOpportunitiesFor',
      () => data.listContentOpportunitiesFor(SELECTED, { brandId: 'b1' }),
    ],
    ['listSiteAuditsFor', () => data.listSiteAuditsFor(SELECTED, 'b1')],
    ['getPromptUsageFor', () => data.getPromptUsageFor(SELECTED, 'b1')],
    ['runSiteAuditFor', () => data.runSiteAuditFor(SELECTED, 'b1', 'https://acme.example/')],
    [
      'getCompetitorComparisonFor',
      () => data.getCompetitorComparisonFor(SELECTED, { brandId: 'b1' }),
    ],
    ['listCitationsFor', () => data.listCitationsFor(SELECTED, { brandId: 'b1' })],
    ['getVisibilityTrendFor', () => data.getVisibilityTrendFor(SELECTED, { brandId: 'b1' })],
    ['getAiTrafficFor', () => data.getAiTrafficFor(SELECTED, { brandId: 'b1' })],
    ['getPromptVolumesFor', () => data.getPromptVolumesFor(SELECTED, { brandId: 'b1' })],
    ['listShoppingCards', () => data.listShoppingCards(SELECTED, { brandId: 'b1' })],
    [
      'getProductVisibility',
      () => data.getProductVisibility(SELECTED, { brandId: 'b1', productTitle: 'Beans' }),
    ],
    ['getPromptPerformanceFor', () => data.getPromptPerformanceFor(SELECTED, { brandId: 'b1' })],
    ['listActionsFor', () => data.listActionsFor(SELECTED, { brandId: 'b1' })],
    ['listSignalsFor', () => data.listSignalsFor(SELECTED, { brandId: 'b1' })],
    ['listActionHistoryFor', () => data.listActionHistoryFor(SELECTED, { brandId: 'b1' })],
    ['listCompetitorsFor', () => data.listCompetitorsFor(SELECTED, 'b1')],
    ['listReportsFor', () => data.listReportsFor(SELECTED, 'b1')],
    ['getMentionsSummaryFor', () => mentions.getMentionsSummaryFor(SELECTED, { brandId: 'b1' })],
    ['listContentDraftsFor', () => content.listContentDraftsFor(SELECTED, 'b1')],
    ['getContentPlanFor', () => getContentPlanFor(SELECTED, { brandId: 'b1', days: 30 })],
    [
      'explainChangeFor',
      () => explainChangeFor(SELECTED, { brandId: 'b1', metric: 'mention_rate' }),
    ],
    ['listTaskReviewsFor', () => taskReviews.listTaskReviewsFor(SELECTED, { brandId: 'b1' })],
  ];

  it.each(byBrand)('%s reads it as not found, reading nothing of it', async (_name, call) => {
    await expect(call()).resolves.toBeNull();
    // Only the brand itself was looked up: none of its data, no function.
    expect(new Set(db.reads)).toEqual(new Set(['brands']));
    expect(db.rpcs).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it('still reads a brand that was shared', async () => {
    db.rows.brands = { id: 'b2', name: 'Shared' };
    await expect(data.listTopicsFor(SELECTED, 'b2')).resolves.toEqual([]);
    expect(db.reads).toContain('topics');
  });
});

describe("a Selected-brands key on a row of a brand that wasn't shared", () => {
  beforeEach(() => {
    const ofB1 = { id: 'row-1', brand_id: 'b1', brands: { organization_id: 'org-1' } };
    db.rows = {
      topic_suggestions: { ...ofB1, name: 'Espresso', status: 'new' },
      prompt_suggestions: { ...ofB1, suggested_text: 'Best beans?', status: 'new' },
      content_opportunities: { ...ofB1, status: 'new' },
      site_audits: ofB1,
      actions: { ...ofB1, kind: 'content_gap', payload: {} },
      action_tasks: { id: 'task-1', action_id: 'row-1', actions: { brand_id: 'b1' } },
      action_task_reviews: {
        id: 'review-1',
        action_id: 'row-1',
        title: 'Fix the page',
        details: {},
        actions: { brand_id: 'b1' },
      },
      prompts: { id: 'prompt-1', prompt_sets: { brand_id: 'b1' } },
      reports: { ...ofB1, title: 'Monthly' },
      content_drafts: { ...ofB1, archived_at: null, brands: { name: 'Acme' } },
      prompt_results: ofB1,
    };
  });

  const byRow: [string, () => Promise<unknown>, unknown][] = [
    ['dismissTopicSuggestionFor', () => data.dismissTopicSuggestionFor(SELECTED, 'row-1'), null],
    ['acceptTopicSuggestionFor', () => data.acceptTopicSuggestionFor(SELECTED, 'row-1'), null],
    ['dismissPromptSuggestionFor', () => data.dismissPromptSuggestionFor(SELECTED, 'row-1'), null],
    ['acceptPromptSuggestionFor', () => data.acceptPromptSuggestionFor(SELECTED, 'row-1'), null],
    ['generateBriefFor', () => data.generateBriefFor(SELECTED, 'row-1'), null],
    ['getSiteAuditFor', () => data.getSiteAuditFor(SELECTED, 'row-1'), null],
    ['getContentOpportunityFor', () => data.getContentOpportunityFor(SELECTED, 'row-1'), null],
    [
      'updateOpportunityStatusFor',
      () => data.updateOpportunityStatusFor(SELECTED, 'row-1', 'reviewed'),
      null,
    ],
    ['getActionFor', () => data.getActionFor(SELECTED, 'row-1'), null],
    ['updateTaskStatusFor', () => data.updateTaskStatusFor(SELECTED, 'task-1', 'completed'), null],
    [
      'createImproveActionFor',
      () =>
        data.createImproveActionFor(SELECTED, {
          promptId: 'prompt-1',
          range: { preset: '7d', from: '2026-10-25' },
          idempotencyKey: 'k-1',
          suggestions: [],
        }),
      null,
    ],
    ['getReportFor', () => data.getReportFor(SELECTED, 'row-1'), null],
    ['exportActionFor', () => exportActionFor(SELECTED, 'row-1', 'markdown'), null],
    ['getContentDraftFor', () => content.getContentDraftFor(SELECTED, 'row-1'), null],
    [
      'getContentDraftPackageFor',
      () => getContentDraftPackageFor(SELECTED, 'row-1'),
      { error: 'not_found', message: 'Draft not found' },
    ],
    ['getMentionFor', () => mentions.getMentionFor(SELECTED, 'row-1'), null],
    [
      'overrideMentionSentimentFor',
      () => mentions.overrideMentionSentimentFor(SELECTED, 'row-1', 'neutral'),
      { error: 'missing', message: 'Answer not found' },
    ],
    [
      'approveTaskReviewFor',
      () => taskReviews.approveTaskReviewFor(SELECTED, 'review-1', {}),
      expect.objectContaining({ error: 'missing' }),
    ],
    [
      'dismissTaskReviewFor',
      () => taskReviews.dismissTaskReviewFor(SELECTED, 'review-1'),
      expect.objectContaining({ error: 'missing' }),
    ],
  ];

  it.each(byRow)('%s reads it as not found, changing nothing', async (_name, call, answer) => {
    await expect(call()).resolves.toEqual(answer);
    expect(db.rpcs).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it('lets a shared brand’s row through', async () => {
    db.rows.topic_suggestions = { ...db.rows.topic_suggestions, brand_id: 'b2' };
    await expect(data.dismissTopicSuggestionFor(SELECTED, 'row-1')).resolves.not.toBeNull();
    expect(db.writes).toContainEqual(['topic_suggestions', 'update', expect.anything()]);
  });
});

describe('the MCP server for a Selected-brands key', () => {
  async function connect(auth: McpAuthContext) {
    const server = createMcpServer(auth);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    return client;
  }
  const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
    (result.content as { text: string }[])[0]?.text;

  it('lists only the brands shared with its owner', async () => {
    db.lists.brands = [
      { id: 'b1', name: 'Acme', is_demo: false },
      { id: 'b2', name: 'Shared', is_demo: false },
    ];
    const client = await connect(SELECTED);
    const result = await client.callTool({ name: 'list_brands', arguments: {} });
    expect(JSON.parse(text(result)).map((b: { id: string }) => b.id)).toEqual(['b2']);

    const all = await (await connect(ALL)).callTool({ name: 'list_brands', arguments: {} });
    expect(JSON.parse(text(all)).map((b: { id: string }) => b.id)).toEqual(['b1', 'b2']);
  });

  it('answers a brand it may not use as not found', async () => {
    // The tools take brand ids as UUIDs.
    const hidden = '11111111-1111-4111-8111-111111111111';
    db.rows.brands = { id: hidden, name: 'Acme' };
    const client = await connect(SELECTED);
    const result = await client.callTool({ name: 'list_topics', arguments: { brand_id: hidden } });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('Brand not found');
  });
});
