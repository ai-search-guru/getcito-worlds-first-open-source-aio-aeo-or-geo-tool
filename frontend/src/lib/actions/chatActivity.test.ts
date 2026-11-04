import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The Activity log page's reads, Undo and CSV (CHAT-20 §10a). */

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ORG = '22222222-2222-4222-8222-222222222222';

interface Call {
  table: string;
  filters: unknown[][];
}
let calls: Call[] = [];
let role = 'manager';
let logRows: Record<string, unknown>[] = [];
let logError: { message: string } | null = null;
/** The sends marked published, for Take down (PR 10). */
let liveSends: Record<string, unknown>[] = [];

function from(table: string) {
  const call: Call = { table, filters: [] };
  calls.push(call);
  const answer = () => {
    if (table === 'chat_activity_log') return { data: logError ? null : logRows, error: logError };
    if (table === 'content_draft_deliveries') return { data: liveSends, error: null };
    if (table === 'profiles') {
      return call.filters.some((f) => f[0] === 'in' || f[1] === 'organization_id')
        ? {
            data: [
              { id: ME, full_name: 'Alex Kim' },
              { id: OTHER, full_name: 'Taylor Brooks' },
            ],
            error: null,
          }
        : { data: { organization_id: ORG, role }, error: null };
    }
    return { data: null, error: null };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    ...Object.fromEntries(
      ['eq', 'neq', 'in', 'lt', 'order', 'limit'].map((name) => [
        name,
        (...args: unknown[]) => {
          call.filters.push([name, ...args]);
          return chain;
        },
      ]),
    ),
    maybeSingle: async () => answer(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
  };
  return chain;
}

const undoChange = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ME } } }) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: (t: string) => from(t) } }));
vi.mock('@/lib/memberEmails', () => ({ readMemberAuth: async () => new Map() }));
vi.mock('@/lib/chat/undo', () => ({ undoChange }));

const { exportActivityCsv, listActivity, undoActivity } = await import('./chatActivity');

const HOUR = 3_600_000;
const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  created_at: '2026-10-29T10:00:00Z',
  user_id: ME,
  surface: 'chat',
  kind: 'change',
  tool_key: 'saveDraft',
  class: 'write',
  mode: 'full_auto',
  approval_kind: 'auto',
  auto_via: 'full_auto',
  denial_code: null,
  summary_key: 'saveDraft',
  summary_params: { title: 'Pricing FAQ' },
  status: 'done',
  undo_until: new Date(Date.now() + HOUR).toISOString(),
  undone_at: null,
  ...over,
});
const logRead = () => calls.find((c) => c.table === 'chat_activity_log')!;

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  calls = [];
  role = 'manager';
  logRows = [row()];
  logError = null;
  liveSends = [];
  undoChange.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('listActivity, Take down (AUTONOMOUS-GO-LIVE PR 10)', () => {
  const DRAFT = '44444444-4444-4444-8444-444444444444';
  const published = (over: Record<string, unknown> = {}) =>
    row({
      tool_key: 'publishToCms',
      class: 'execute',
      approval_kind: 'click',
      auto_via: null,
      summary_key: 'publishToCms',
      target_type: 'content_draft',
      target_id: DRAFT,
      undo_until: null,
      created_at: new Date(Date.now() - HOUR).toISOString(),
      ...over,
    });
  const LIVE = {
    draft_id: DRAFT,
    target: 'wordpress',
    published_url: 'https://acme.example/pricing-faq/',
    content_drafts: { title: 'Pricing FAQ' },
  };

  it('offers Take down on a page a row published that is still live, for 30 days', async () => {
    logRows = [published(), published({ id: 'a2', created_at: '2026-09-01T10:00:00Z' })];
    liveSends = [LIVE];
    const result = await listActivity();
    if (!result.ok) throw new Error('expected rows');
    expect(result.rows.map((r) => r.takeDown)).toEqual([
      {
        draftId: DRAFT,
        title: 'Pricing FAQ',
        url: 'https://acme.example/pricing-faq/',
        target: 'wordpress',
      },
      null,
    ]);
    const read = calls.find((c) => c.table === 'content_draft_deliveries')!;
    expect(read.filters).toContainEqual(['eq', 'organization_id', ORG]);
    expect(read.filters).toContainEqual(['eq', 'status', 'published']);
    expect(read.filters).toContainEqual(['in', 'draft_id', [DRAFT]]);
  });

  it('offers none on a page not live anymore, nor in Framer, nor to an Analyst', async () => {
    logRows = [published()];
    const none = async () => {
      const result = await listActivity();
      if (!result.ok) throw new Error('expected rows');
      return result.rows[0].takeDown;
    };
    expect(await none()).toBeNull();
    liveSends = [{ ...LIVE, target: 'framer' }];
    expect(await none()).toBeNull();
    liveSends = [LIVE];
    role = 'analyst';
    expect(await none()).toBeNull();
  });
});

describe('listActivity', () => {
  it("gives a member their own rows, in words, with Undo while it's open", async () => {
    logRows = [
      row(),
      row({ id: 'a2', undo_until: new Date(Date.now() - HOUR).toISOString() }),
      row({
        id: 'a3',
        kind: 'access.denied',
        tool_key: 'saveDraft',
        denial_code: 'forbidden_role',
      }),
    ];
    const read = await listActivity();
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.isAdmin).toBe(false);
    expect(read.people).toEqual([]);
    expect(logRead().filters).toContainEqual(['eq', 'user_id', ME]);
    expect(read.rows.map((r) => [r.id, r.canUndo])).toEqual([
      ['a1', true],
      ['a2', false],
      ['a3', false],
    ]);
    expect(read.rows[0]).toMatchObject({
      person: 'Alex Kim',
      isYou: true,
      area: 'content',
      summaryKey: 'saveDraft',
      summaryParams: { title: 'Pricing FAQ' },
    });
    // What Undo restores stays on the server; a tool goes by its label key.
    expect(JSON.stringify(read)).not.toMatch(/undo_json|create_draft/);
  });

  it("gives an Admin everyone's rows, one person's, the people, and Undo on others'", async () => {
    role = 'admin';
    logRows = [row({ user_id: OTHER })];
    const read = await listActivity();
    if (!read.ok) throw new Error('expected rows');
    expect(logRead().filters.some((f) => f[1] === 'user_id')).toBe(false);
    expect(read.rows[0]).toMatchObject({ person: 'Taylor Brooks', isYou: false, canUndo: true });
    expect(read.people.map((p) => p.name)).toEqual(['Alex Kim', 'Taylor Brooks']);
    calls = [];
    await listActivity({ userId: OTHER });
    expect(logRead().filters).toContainEqual(['eq', 'user_id', OTHER]);
  });

  it('filters by area, class or denials, auto changes, and pages on', async () => {
    await listActivity({
      area: 'prompts',
      kind: 'write',
      autoOnly: true,
      before: '2026-10-29T09:00:00Z',
    });
    const filters = logRead().filters;
    expect(filters).toContainEqual([
      'in',
      'tool_key',
      expect.arrayContaining(['dismissSuggestion']),
    ]);
    expect(filters).toContainEqual(['eq', 'class', 'write']);
    expect(filters).toContainEqual(['neq', 'kind', 'access.denied']);
    expect(filters).toContainEqual(['eq', 'approval_kind', 'auto']);
    expect(filters).toContainEqual(['lt', 'created_at', '2026-10-29T09:00:00Z']);
    calls = [];
    await listActivity({ kind: 'denied' });
    expect(logRead().filters).toContainEqual(['eq', 'kind', 'access.denied']);
  });

  it('says there is more past a page', async () => {
    logRows = Array.from({ length: 51 }, (_, i) => row({ id: `a${i}` }));
    const read = await listActivity();
    if (!read.ok) throw new Error('expected rows');
    expect(read.rows).toHaveLength(50);
    expect(read.hasMore).toBe(true);
  });

  it('answers a failed read or Chat off in its result, never by throwing', async () => {
    logError = { message: 'db down' };
    expect(await listActivity()).toEqual({ ok: false, failure: 'failed' });
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await listActivity()).toEqual({ ok: false, failure: 'chat_off' });
  });
});

describe('undoActivity', () => {
  it('undoes as the signed-in person and passes on what Undo says, and where to fix a conflict', async () => {
    undoChange.mockResolvedValue({
      code: 'conflict',
      reason: 'changed',
      href: '/dashboard/content/d1',
      message: 'This changed since. Open it to undo by hand.',
    });
    expect(await undoActivity('a1')).toEqual({
      ok: true,
      code: 'conflict',
      message: 'This changed since. Open it to undo by hand.',
      href: '/dashboard/content/d1',
    });
    expect(undoChange).toHaveBeenCalledWith({
      activityId: 'a1',
      userId: ME,
      organizationId: ORG,
      surface: 'chat',
    });
  });

  it('keeps a denial’s internals off the page', async () => {
    undoChange.mockResolvedValue({
      code: 'denied',
      denial: { code: 'forbidden_role', asked: 'x' },
      message: 'Your role is Analyst.',
    });
    expect(await undoActivity('a1')).toEqual({
      ok: true,
      code: 'denied',
      message: 'Your role is Analyst.',
      href: null,
    });
  });
});

describe('exportActivityCsv', () => {
  it("is an Admin's, in words and the tools' labels", async () => {
    expect(await exportActivityCsv()).toEqual({ ok: false, failure: 'forbidden' });
    role = 'admin';
    logRows = [row({ summary_params: { title: '=HYPERLINK("x")' } })];
    const result = await exportActivityCsv();
    if (!result.ok) throw new Error('expected a CSV');
    const [header, line] = result.csv.split('\n');
    expect(header).toBe('time,person,surface,event,tool,class,mode,approval,status');
    expect(line).toContain('Alex Kim');
    expect(line).toContain('Save drafts in Content');
    expect(line).toContain('Auto · Full auto');
    expect(line).not.toContain('create_draft');
    expect(logRead().filters).toContainEqual(['limit', 5000]);
  });
});
