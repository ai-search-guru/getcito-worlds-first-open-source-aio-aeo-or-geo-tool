import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * Tasks waiting for review over MCP (AC-010, B4): the Needs review tab's
 * list, Approve and Dismiss, for an admin or a manager of the brand's
 * organization only. Approve fills the fields given over what was written,
 * needs all four, and goes through approve_action_task_review as the key's
 * user (00375).
 */

let brandFound = true;
let reviewRows: Record<string, unknown>[] = [];
/** The review as ownedReview reads it; null for none of the organization's. */
let owned: Record<string, unknown> | null = null;
let rpcResult: { data: unknown; error: { code: string; message: string } | null } = {
  data: 'task-9',
  error: null,
};
const rpcCalls: [string, Record<string, unknown>][] = [];
const deleted: string[] = [];
/** Whether the review is still there when dismiss deletes it. */
let stillThere = true;
const filters: [string, string, unknown][] = [];

function builder(table: string) {
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters.push([table, column, value]);
      return chain;
    },
    is: () => chain,
    not: () => chain,
    order: () => chain,
    limit: async () => ({ data: reviewRows, error: null }),
    maybeSingle: async () => ({
      data: table === 'brands' ? brandFound && { id: 'brand-1' } : owned,
      error: null,
    }),
    delete: () => ({
      eq: (_column: string, id: string) => ({
        select: async () => {
          if (stillThere) deleted.push(id);
          return { data: stillThere ? [{ id }] : [], error: null };
        },
      }),
    }),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push([fn, args]);
      return rpcResult;
    },
  },
}));

const { listTaskReviewsFor, approveTaskReviewFor, dismissTaskReviewFor } =
  await import('./taskReviews');
const { createMcpServer } = await import('./server');
const { RoleRequiredError } = await import('./roleGate');

const manager: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  role: 'manager',
  apiKeyId: 'key-1',
  brandAccess: 'all',
};
let auth = manager;

const WRITTEN = {
  where: 'Pricing page',
  why: 'Lost two citations on ChatGPT',
  url: null,
  change: null,
  how: ['Open the page', 'Add the FAQ'],
  doneWhen: 'FAQ block present',
  check: null,
  evidence: ['signal-1'],
};

beforeEach(() => {
  auth = manager;
  brandFound = true;
  reviewRows = [];
  owned = { id: 'review-1', action_id: 'action-1', title: 'Add an FAQ', details: WRITTEN };
  rpcResult = { data: 'task-9', error: null };
  rpcCalls.length = 0;
  deleted.length = 0;
  stillThere = true;
  filters.length = 0;
});

describe('listTaskReviewsFor', () => {
  it("lists the brand's reviews with what they miss, in the MCP's names", async () => {
    reviewRows = [
      {
        id: 'review-1',
        action_id: 'action-1',
        title: 'Add an FAQ',
        details: WRITTEN,
        missing: ['url', 'change', 'doneWhen', 'check', 'other'],
        source: 'ai',
        created_at: '2026-10-28T09:00:00Z',
        actions: { action_no: 52 },
      },
    ];
    const reviews = await listTaskReviewsFor(auth, { brandId: 'brand-1' });
    expect(reviews).toEqual([
      expect.objectContaining({
        id: 'review-1',
        action_id: 'action-1',
        action_no: 52,
        title: 'Add an FAQ',
        missing: ['url', 'change', 'done_when', 'check'],
        source: 'ai',
        details: expect.objectContaining({ where: 'Pricing page', done_when: 'FAQ block present' }),
      }),
    ]);
    expect(filters).toContainEqual(['action_task_reviews', 'actions.brand_id', 'brand-1']);
  });

  it("answers null for another organization's brand", async () => {
    brandFound = false;
    expect(await listTaskReviewsFor(auth, { brandId: 'brand-2' })).toBeNull();
  });

  it('refuses anyone but an admin or a manager', async () => {
    for (const role of ['analyst', 'agency_partner', null] as const) {
      auth = { ...manager, role };
      await expect(listTaskReviewsFor(auth, { brandId: 'brand-1' })).rejects.toThrow(
        RoleRequiredError,
      );
    }
    auth = { ...manager, role: 'admin' };
    expect(await listTaskReviewsFor(auth, { brandId: 'brand-1' })).toEqual([]);
  });
});

describe('approveTaskReviewFor', () => {
  it('fills the fields given over what was written, and approves as the key’s user', async () => {
    const result = await approveTaskReviewFor(auth, 'review-1', {
      url: 'https://acme.example/pricing',
      change: { after: '<h2>FAQ</h2>' },
      check: 'auto',
    });
    expect(result).toEqual({ task_id: 'task-9', action_id: 'action-1', title: 'Add an FAQ' });
    expect(rpcCalls).toEqual([
      [
        'approve_action_task_review',
        {
          p_review_id: 'review-1',
          p_title: 'Add an FAQ',
          p_details: expect.objectContaining({
            url: 'https://acme.example/pricing',
            change: { before: null, after: '<h2>FAQ</h2>' },
            doneWhen: 'FAQ block present',
            check: 'auto',
            where: 'Pricing page',
            how: ['Open the page', 'Add the FAQ'],
            // What the writer stored beside them stays.
            evidence: ['signal-1'],
          }),
          p_user_id: 'user-1',
        },
      ],
    ]);
  });

  it('says what is still missing, without calling the database', async () => {
    const result = await approveTaskReviewFor(auth, 'review-1', { url: '/pricing' });
    expect(result).toEqual({
      error: 'incomplete',
      message: 'The task still misses: change, check',
    });
    expect(rpcCalls).toEqual([]);
  });

  const complete = {
    url: '/pricing',
    change: { after: 'FAQ' },
    check: 'manual' as const,
  };

  it('refuses anyone but an admin or a manager, before reading the review', async () => {
    auth = { ...manager, role: 'analyst' };
    await expect(approveTaskReviewFor(auth, 'review-1', complete)).rejects.toThrow(
      RoleRequiredError,
    );
    expect(filters).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it('answers forbidden when the database refuses the approval', async () => {
    rpcResult = { data: null, error: { code: '42501', message: 'not allowed' } };
    expect(await approveTaskReviewFor(auth, 'review-1', complete)).toMatchObject({
      error: 'forbidden',
    });
  });

  it("reads the review within the key's organization", async () => {
    await approveTaskReviewFor(auth, 'review-1', complete);
    expect(filters).toContainEqual([
      'action_task_reviews',
      'actions.brands.organization_id',
      'org-1',
    ]);
  });

  it("reads another organization's review, or one gone, as missing", async () => {
    owned = null;
    expect(await approveTaskReviewFor(auth, 'review-1', complete)).toMatchObject({
      error: 'missing',
    });
    owned = { id: 'review-1', action_id: 'action-1', title: 'T', details: WRITTEN };
    rpcResult = { data: null, error: null };
    expect(await approveTaskReviewFor(auth, 'review-1', complete)).toMatchObject({
      error: 'missing',
    });
  });

  it("says so when the review's action is closed", async () => {
    rpcResult = { data: null, error: { code: '55000', message: 'action closed' } };
    expect(await approveTaskReviewFor(auth, 'review-1', complete)).toMatchObject({
      error: 'closed',
    });
  });

  it('passes on any other database failure', async () => {
    rpcResult = { data: null, error: { code: '57014', message: 'statement timeout' } };
    await expect(approveTaskReviewFor(auth, 'review-1', complete)).rejects.toThrow(
      'statement timeout',
    );
  });
});

describe('dismissTaskReviewFor', () => {
  it("drops the organization's review", async () => {
    expect(await dismissTaskReviewFor(auth, 'review-1')).toEqual({
      id: 'review-1',
      dismissed: true,
    });
    expect(deleted).toEqual(['review-1']);
    expect(filters).toContainEqual([
      'action_task_reviews',
      'actions.brands.organization_id',
      'org-1',
    ]);
  });

  it('says missing when the review went meanwhile', async () => {
    stillThere = false;
    expect(await dismissTaskReviewFor(auth, 'review-1')).toMatchObject({ error: 'missing' });
  });

  it("refuses an analyst, and leaves another organization's review alone", async () => {
    auth = { ...manager, role: 'analyst' };
    await expect(dismissTaskReviewFor(auth, 'review-1')).rejects.toThrow(RoleRequiredError);
    expect(deleted).toEqual([]);
    auth = { ...manager, role: 'admin' };
    owned = null;
    expect(await dismissTaskReviewFor(auth, 'review-1')).toMatchObject({ error: 'missing' });
    expect(deleted).toEqual([]);
  });
});

describe('the task review tools', () => {
  it('list with a title, the list as a read and the others as writes', async () => {
    const server = createMcpServer(auth);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    const tool = (name: string) => tools.find((t) => t.name === name);
    expect(tool('list_task_reviews')?.annotations).toMatchObject({ readOnlyHint: true });
    expect(tool('approve_task_review')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(tool('dismiss_task_review')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    for (const name of ['list_task_reviews', 'approve_task_review', 'dismiss_task_review']) {
      expect(tool(name)?.title, name).toBeTruthy();
    }
  });

  it("answer an analyst's call with the role refusal, as a tool error", async () => {
    const server = createMcpServer({ ...manager, role: 'analyst' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    for (const [name, args] of [
      ['list_task_reviews', { brand_id: '11111111-1111-4111-8111-111111111111' }],
      ['approve_task_review', { review_id: '11111111-1111-4111-8111-111111111111' }],
      ['dismiss_task_review', { review_id: '11111111-1111-4111-8111-111111111111' }],
    ] as const) {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: { text: string }[];
      };
      expect(result.isError, name).toBe(true);
      expect(result.content[0].text, name).toContain('Only an admin or a manager can do this');
    }
    expect(rpcCalls).toEqual([]);
    expect(deleted).toEqual([]);
  });
});
