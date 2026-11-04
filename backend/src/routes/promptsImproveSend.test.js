import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * sendImproveActionForKeyUser is what the internal endpoint behind the MCP
 * `create_improve_action` tool runs. An API key has no session, so these pin
 * that the plan check happens before anything is read or written, that the
 * key's user goes through the same org check as the dashboard, and that the
 * action is created from the stored set like the Improve tab's send.
 */

class PlanLimitError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.name = 'PlanLimitError';
    this.statusCode = statusCode;
  }
}

const enforceFeature = vi.fn();
const sendImproveToActionCenter = vi.fn();
const liveImproveSends = vi.fn();

let reads = [];
let rows = {};

function builder(table) {
  let op = 'select';
  const chain = {
    select: () => chain,
    update: () => {
      op = 'update';
      return chain;
    },
    eq: () => chain,
    maybeSingle: async () => {
      reads.push(table);
      return { data: rows[table] ?? null, error: null };
    },
    single: async () => {
      reads.push(table);
      if (op === 'update') return { data: { ...rows[table], updated: true }, error: null };
      return { data: rows[table] ?? null, error: null };
    },
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({ default: { from: (table) => builder(table) } }));
vi.mock('../lib/planGuard.js', () => ({
  PlanLimitError,
  enforceFeature,
  reserveAiBudget: vi.fn(),
  getImproveQuotaStatus: vi.fn(),
  requireFeature: () => (req, res, next) => next(),
}));
vi.mock('../lib/action-center/fromPromptImprove.js', () => ({
  sendImproveToActionCenter,
  liveImproveSends,
}));
vi.mock('../lib/aiProvider.js', () => ({ resolveModel: vi.fn() }));
vi.mock('../lib/gscSuggestions.js', () => ({ getGscSuggestionCandidates: vi.fn() }));
vi.mock('../lib/gaSuggestions.js', () => ({ getGaSuggestionCandidates: vi.fn() }));

const { sendImproveActionForKeyUser } = await import('./prompts.js');

const body = {
  preset: '7d',
  from: '2026-10-06T00:00:00.000Z',
  to: '2026-10-13T00:00:00.000Z',
  region: '',
  idempotencyKey: 'mcp-key-0001',
  suggestions: [
    {
      id: 's1',
      platform: 'perplexity-web',
      title: 'Publish a comparison page',
      body: 'Cover the alternatives Perplexity cites.',
      sources: [{ type: 'domain', ref: 'example.com' }],
    },
  ],
};

describe('sendImproveActionForKeyUser', () => {
  beforeEach(() => {
    reads = [];
    rows = {
      prompts: { id: 'p1', text: 'best crm', prompt_sets: { brand_id: 'b1' } },
      brands: { id: 'b1', organization_id: 'org-1' },
      profiles: { organization_id: 'org-1', role: 'admin' },
      prompt_improve_suggestions: {
        id: 'set-1',
        range_key: '7d',
        region: '',
        generated_at: '2026-10-13T08:00:00.000Z',
        sent_actions: [],
      },
    };
    enforceFeature.mockReset().mockResolvedValue({});
    sendImproveToActionCenter
      .mockReset()
      .mockResolvedValue({ actionId: 'a1', actionNo: 7, created: true });
    liveImproveSends.mockReset().mockResolvedValue({ latest: null, sentSuggestionIds: ['s1'] });
  });

  it('refuses a plan without prompt_improve before reading anything', async () => {
    enforceFeature.mockRejectedValue(new PlanLimitError('Your Starter plan does not include it'));

    await expect(
      sendImproveActionForKeyUser({ promptId: 'p1', userId: 'u1', body }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(enforceFeature).toHaveBeenCalledWith('u1', 'prompt_improve');
    expect(reads).toEqual([]);
    expect(sendImproveToActionCenter).not.toHaveBeenCalled();
  });

  it('rejects a key user from another org with 403', async () => {
    rows.profiles = { organization_id: 'org-2', role: 'admin' };

    await expect(
      sendImproveActionForKeyUser({ promptId: 'p1', userId: 'u1', body }),
    ).rejects.toMatchObject({ status: 403 });
    expect(sendImproveToActionCenter).not.toHaveBeenCalled();
  });

  it("refuses an analyst's key before sending, as the dashboard's Send Actions (2026-10-29)", async () => {
    rows.profiles = { organization_id: 'org-1', role: 'analyst' };

    await expect(
      sendImproveActionForKeyUser({ promptId: 'p1', userId: 'u1', body }),
    ).rejects.toMatchObject({ status: 403, message: 'Only admins and managers can use Improve.' });
    expect(sendImproveToActionCenter).not.toHaveBeenCalled();
  });

  it('rejects bad suggestions with 400 and the validation details', async () => {
    const bad = { ...body, suggestions: [{ ...body.suggestions[0], platform: 'nope' }] };

    await expect(
      sendImproveActionForKeyUser({ promptId: 'p1', userId: 'u1', body: bad }),
    ).rejects.toMatchObject({ status: 400, details: expect.any(Array) });
    expect(reads).toEqual([]);
  });

  it('asks for suggestions first when the range has no stored set', async () => {
    rows.prompt_improve_suggestions = null;

    await expect(
      sendImproveActionForKeyUser({ promptId: 'p1', userId: 'u1', body }),
    ).rejects.toMatchObject({ status: 404, message: /Generate suggestions/ });
    expect(sendImproveToActionCenter).not.toHaveBeenCalled();
  });

  it('creates the action as the key user and records the send', async () => {
    const result = await sendImproveActionForKeyUser({ promptId: 'p1', userId: 'u1', body });

    expect(sendImproveToActionCenter).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.objectContaining({ id: 'p1' }),
        brandId: 'b1',
        idempotencyKey: 'mcp-key-0001',
        suggestions: [expect.objectContaining({ id: 's1', platform: 'perplexity-web' })],
        panelLink: expect.stringContaining('positions=p1'),
        userId: 'u1',
      }),
    );
    expect(liveImproveSends).toHaveBeenCalledWith(expect.objectContaining({ updated: true }));
    expect(result).toEqual({
      actionId: 'a1',
      actionNo: 7,
      created: true,
      taskCount: 1,
      sent: { latest: null, sentSuggestionIds: ['s1'] },
    });
  });

  it('does not record the send again when the key was already used', async () => {
    rows.prompt_improve_suggestions.sent_actions = [{ actionId: 'a1' }];
    sendImproveToActionCenter.mockResolvedValue({ actionId: 'a1', actionNo: 7, created: false });

    const result = await sendImproveActionForKeyUser({ promptId: 'p1', userId: 'u1', body });

    expect(result.created).toBe(false);
    expect(liveImproveSends).toHaveBeenCalledWith(expect.not.objectContaining({ updated: true }));
  });
});
