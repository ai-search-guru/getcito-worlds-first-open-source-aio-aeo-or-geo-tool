// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';
import {
  BRAND,
  OPPORTUNITY,
  ORG,
  OTHER_ORG,
  PEOPLE,
  COMPETITOR,
  DRAFT,
  PROMPT,
  SUGGESTION,
  TOPIC,
  fakeCreateDraft,
  fakeCreateReport,
  fakeKeepDraftVersion,
  fakeSendDraftToCms,
  fakeStartSiteAudits,
  fakeUpdateContentDraft,
  fakeAddBrandTopic,
  fakeAddCompetitors,
  fakeAddTopicPrompts,
  fakePauseBrandPrompts,
  fakeRemoveBrandCompetitor,
  fakeRenameBrandTopic,
  fakeDismissSuggestion,
  fakeUpdateOpportunity,
  seedDraft,
  seedWorkspace,
} from './testing/chatFixtures';

/**
 * A change Chat makes, logged once (CHAT-20 §10a, §11c, §21): every WRITE
 * that ran lands in the Activity log with its mode, approval and Undo; a
 * double-clicked approval makes one object.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fakeSupabase')).createFakeSupabase(),
}));
vi.mock('@/lib/actions/contentDrafts', () => ({
  createContentDraft: vi.fn(),
  updateContentDraft: vi.fn(),
}));
vi.mock('@/lib/chat/actor/drafts', () => ({
  createContentDraftFor: vi.fn(),
  updateContentDraftFor: vi.fn(),
}));
vi.mock('@/lib/chat/actor/apiWrites', () => ({
  updateOpportunityStatusFor: vi.fn(),
  dismissSuggestionFor: vi.fn(),
}));
vi.mock('@/lib/actions/cmsSend', () => ({ sendDraftToCms: vi.fn() }));
vi.mock('@/lib/actions/reports', () => ({ createReport: vi.fn() }));
vi.mock('@/lib/actions/audits', () => ({ startSiteAudits: vi.fn(), getAuditQuota: vi.fn() }));
vi.mock('@/lib/actions/content', () => ({ updateOpportunityStatus: vi.fn() }));
vi.mock('@/lib/actions/promptSuggestions', () => ({ dismissSuggestion: vi.fn() }));
vi.mock('@/lib/actions/prompt', () => ({ addTopicPrompts: vi.fn(), pauseBrandPrompts: vi.fn() }));
vi.mock('@/lib/actions/topic', () => ({ addBrandTopic: vi.fn(), renameBrandTopic: vi.fn() }));
vi.mock('@/lib/actions/competitor', () => ({
  addCompetitors: vi.fn(),
  removeBrandCompetitor: vi.fn(),
}));
vi.mock('@/lib/actions/chatActionCenter', () => ({
  createChatAction: vi.fn(),
  attachToAction: vi.fn(),
  attachFileToTask: vi.fn(),
  setTaskReadyForReview: vi.fn(),
  checkChatActionCover: vi.fn(),
}));

vi.mock('@/lib/actions/chatSkills', () => ({ saveChatSkill: vi.fn() }));
vi.mock('@/lib/actions/chatMemory', () => ({
  saveChatMemory: vi.fn(),
  forgetChatMemory: vi.fn(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { createContentDraft, updateContentDraft } = await import('@/lib/actions/contentDrafts');
const { createContentDraftFor, updateContentDraftFor } = await import('@/lib/chat/actor/drafts');
const { updateOpportunityStatusFor } = await import('@/lib/chat/actor/apiWrites');
const { sendDraftToCms } = await import('@/lib/actions/cmsSend');
const { createReport } = await import('@/lib/actions/reports');
const { startSiteAudits } = await import('@/lib/actions/audits');
const { updateOpportunityStatus } = await import('@/lib/actions/content');
const { dismissSuggestion } = await import('@/lib/actions/promptSuggestions');
const { addTopicPrompts, pauseBrandPrompts } = await import('@/lib/actions/prompt');
const { addBrandTopic, renameBrandTopic } = await import('@/lib/actions/topic');
const { addCompetitors, removeBrandCompetitor } = await import('@/lib/actions/competitor');
const chatActionCenter = await import('@/lib/actions/chatActionCenter');
const { saveChatSkill } = await import('@/lib/actions/chatSkills');
const skillStore = await import('./skills/store');
const { saveChatMemory, forgetChatMemory } = await import('@/lib/actions/chatMemory');
const memoryStore = await import('./memory/store');
const acFixtures = await import('./testing/actionCenterFixtures');
const { runLoggedWrite } = await import('./write');
const { activitySummary, approvalFor, logActivity, recordActivity } = await import('./activity');
const { allowedTools, decideToolCall, listingDenial } = await import('./precedence');
const { readPrecedenceContext, readToolCall } = await import('./precedenceContext');
const { chatTool, CHAT_TOOLS } = await import('./registry/tools');
const { UNDO_RULES } = await import('./undo');

type ChatMode = import('./precedence').ChatMode;
type ChatTool = import('./registry/defineTool').ChatTool;

const WRITES = CHAT_TOOLS.filter((tool) => tool.class === 'write');
/** The Admin's own Me line, which forget_memory removes. */
const MEMORY_LINE = 'dddddddd-0000-4000-8000-000000000001';
const INPUTS: Record<string, unknown> = {
  create_draft: {
    brand_id: BRAND,
    title: 'Pricing FAQ',
    page_type: 'docs_faq',
    method: 'create',
    source: { kind: 'opportunity', id: OPPORTUNITY },
  },
  update_opportunity: { opportunity_id: OPPORTUNITY, status: 'dismissed', reason: 'not_relevant' },
  dismiss_prompt_suggestion: { suggestion_id: SUGGESTION },
  add_prompts: { brand_id: BRAND, topic_id: TOPIC, prompts: ['crm for agencies'] },
  pause_prompts: { brand_id: BRAND, prompt_ids: [PROMPT] },
  add_topic: { brand_id: BRAND, name: 'Integrations' },
  rename_topic: { topic_id: TOPIC, name: 'Pricing and plans' },
  add_competitors: {
    brand_id: BRAND,
    competitors: [{ name: 'Profound', domain: 'tryprofound.com' }],
  },
  remove_competitor: { brand_id: BRAND, competitor_id: COMPETITOR },
  // W2-10: Chat's Action Center changes (testing/actionCenterFixtures.ts).
  create_action: {
    brand_id: BRAND,
    title: 'Win back pricing citations on /pricing',
    category: 'recover',
    why: 'Google AI Overviews stopped citing /pricing.',
    pages: ['/pricing'],
    prompt_ids: [],
    competitor_ids: [],
    platforms: [],
    create_anyway: false,
    tasks: [
      {
        title: 'Add a pricing FAQ block to /pricing',
        type: 'on_page',
        url: '/pricing',
        done_when: 'The FAQ block is live',
      },
    ],
  },
  attach_to_action: {
    action_id: '88888888-8888-4888-8888-888888888888',
    finding: 'Lost 6 citations.',
  },
  attach_file_to_task: {
    brand_id: BRAND,
    task_id: '99999999-9999-4999-8999-999999999999',
    file_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  },
  set_task_ready_for_review: { brand_id: BRAND, task_id: '99999999-9999-4999-8999-999999999999' },
  update_draft: { draft_id: DRAFT, title: 'Pricing FAQ for teams' },
  push_cms_draft: { draft_id: DRAFT, destination: 'webflow' },
  publish_cms: { draft_id: DRAFT, destination: 'webflow' },
  build_report: {
    brand_id: BRAND,
    template: 'weekly_visibility',
    date_from: '2026-10-01',
    date_to: '2026-10-07',
  },
  run_site_audit: { brand_id: BRAND, urls: ['https://acme.example/pricing'] },
  save_skill: {
    name: 'pricing-faq',
    description: 'Writes a pricing FAQ in our tone.',
    instructions: 'Read the pricing page first. Answer in two sentences.',
  },
  save_memory: { scope: 'user', text: 'Write blog posts in US English' },
  forget_memory: { memory_id: MEMORY_LINE },
};
/** The rows that change or send a Library draft find one. */
const NEEDS_DRAFT = new Set(['update_draft', 'push_cms_draft', 'publish_cms']);
const toolCtx = {} as never;
let step = 0;
const nextStep = () => `step-${++step}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  seedWorkspace(db);
  vi.mocked(createContentDraft).mockImplementation(fakeCreateDraft(db) as never);
  vi.mocked(updateContentDraft).mockImplementation(fakeUpdateContentDraft(db) as never);
  vi.mocked(createContentDraftFor).mockImplementation((_actor, brandId, start) =>
    fakeCreateDraft(db)(brandId, start),
  );
  vi.mocked(updateContentDraftFor).mockImplementation(
    (_actor, id, change) => fakeUpdateContentDraft(db)(id, change) as never,
  );
  vi.mocked(sendDraftToCms).mockImplementation(fakeSendDraftToCms() as never);
  vi.mocked(createReport).mockImplementation(fakeCreateReport(db) as never);
  vi.mocked(startSiteAudits).mockImplementation(fakeStartSiteAudits() as never);
  db.rpcs.content_draft_keep_version = fakeKeepDraftVersion(db);
  vi.mocked(updateOpportunityStatus).mockImplementation(fakeUpdateOpportunity(db) as never);
  vi.mocked(dismissSuggestion).mockImplementation(fakeDismissSuggestion(db) as never);
  vi.mocked(addTopicPrompts).mockImplementation(fakeAddTopicPrompts(db) as never);
  vi.mocked(pauseBrandPrompts).mockImplementation(fakePauseBrandPrompts(db) as never);
  vi.mocked(addBrandTopic).mockImplementation(fakeAddBrandTopic(db) as never);
  vi.mocked(renameBrandTopic).mockImplementation(fakeRenameBrandTopic(db) as never);
  vi.mocked(addCompetitors).mockImplementation(fakeAddCompetitors(db) as never);
  vi.mocked(removeBrandCompetitor).mockImplementation(fakeRemoveBrandCompetitor(db) as never);
  acFixtures.seedActionCenter(db);
  vi.mocked(chatActionCenter.createChatAction).mockImplementation(
    acFixtures.fakeCreateChatAction(db) as never,
  );
  vi.mocked(chatActionCenter.attachToAction).mockImplementation(
    acFixtures.fakeAttachToAction(db) as never,
  );
  vi.mocked(chatActionCenter.attachFileToTask).mockImplementation(
    acFixtures.fakeAttachFileToTask(db) as never,
  );
  vi.mocked(chatActionCenter.setTaskReadyForReview).mockImplementation(
    acFixtures.fakeSetTaskReadyForReview(db) as never,
  );
  // The session's person is the test's Admin; the store's rules are the real ones.
  vi.mocked(saveChatSkill).mockImplementation(async (input) =>
    skillStore.saveSkill(
      (await skillStore.readSkillViewer({ userId: PEOPLE.admin, organizationId: ORG }))!,
      input,
    ),
  );
  db.tables.chat_memory_items = [
    {
      id: MEMORY_LINE,
      organization_id: ORG,
      scope: 'user',
      user_id: PEOPLE.admin,
      brand_id: null,
      text: 'Write in UK English',
      source: 'chat',
      edited: false,
      created_at: '2026-11-01T10:00:00.000Z',
      deleted_at: null,
    },
  ];
  const admin = async () =>
    (await memoryStore.readMemoryViewer({ userId: PEOPLE.admin, organizationId: ORG }))!;
  vi.mocked(saveChatMemory).mockImplementation(async (input) => {
    const saved = await memoryStore.saveMemory(
      await admin(),
      { scope: input.scope, text: input.text, replaces: input.replaces ?? null },
      'chat',
    );
    return saved.ok ? saved.value : memoryStore.saidRefusal(saved.refusal);
  });
  vi.mocked(forgetChatMemory).mockImplementation(async (input) => {
    const removed = await memoryStore.deleteMemory(await admin(), input.memory_id);
    return removed.ok ? removed.value : memoryStore.saidRefusal(removed.refusal);
  });
});
afterEach(() => vi.unstubAllEnvs());

/** The engine's path: decide the call, act on the decision, run and log it. */
async function runAs(
  userId: string,
  tool: ChatTool,
  mode: ChatMode,
  options: { approvalKey?: string; input?: unknown; approved?: boolean } = {},
) {
  const input = (options.input ?? INPUTS[tool.name]) as Record<string, unknown>;
  const ctx = await readPrecedenceContext({ userId, organizationId: ORG, mode, surface: 'chat' });
  const call = await readToolCall(ctx!, tool, input, false);
  const decision = decideToolCall(tool, ctx!, call);
  if (decision.kind === 'ask' && !options.approved) return { decision, outcome: null };
  const approval = approvalFor(decision);
  if (!approval || approval.kind === 'run') return { decision, outcome: null };
  const outcome = await runLoggedWrite({
    tool,
    input,
    ctx: toolCtx,
    organizationId: ORG,
    userId,
    brandId: call.brandId,
    surface: 'chat',
    mode,
    approval,
    place: { conversationId: null, runId: null, stepId: null },
    approvalKey: options.approvalKey ?? nextStep(),
  });
  return { decision, outcome };
}

describe('every WRITE that ran is in the Activity log (§21)', () => {
  // Ask your Admin is always a card, in Full auto too (CHAT-20 row 80a).
  it.each(
    WRITES.filter((tool) => !tool.flags.alwaysCard && !tool.flags.costCard).map(
      (tool) => [tool.name, tool] as const,
    ),
  )(
    '%s in Full auto: mode, approval, Undo window, label key, target and summary',
    async (name, tool) => {
      if (NEEDS_DRAFT.has(name)) seedDraft(db);
      const { decision, outcome } = await runAs(PEOPLE.admin, tool, 'full_auto');
      expect(decision).toEqual({ kind: 'run', via: 'full_auto' });
      expect(outcome).toMatchObject({ code: 'ok', repeated: false });

      const rows = db.tables.chat_activity_log;
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row).toMatchObject({
        organization_id: ORG,
        user_id: PEOPLE.admin,
        // A skill is the workspace's, not a brand's.
        brand_id: tool.brandOf ? BRAND : null,
        surface: 'chat',
        tool_key: tool.labelKey,
        class: 'write',
        mode: 'full_auto',
        approval_kind: 'auto',
        auto_via: 'full_auto',
        target_type: UNDO_RULES[name].targetType,
        summary_key: tool.labelKey,
        status: 'done',
      });
      // The label key, never the tool's name (CHAT-03 item 22).
      expect(JSON.stringify(row)).not.toContain(name);
      expect(row.target_id).toEqual(expect.any(String));
      if (UNDO_RULES[name].windowMs === 0) {
        // §9 gives it no Undo (a page sent to a CMS, an audit): recorded, nothing to put back.
        expect(row).toMatchObject({ undo_json: null, undo_until: null });
      } else {
        expect(row.undo_json).toEqual(expect.any(Object));
        const window = Date.parse(row.undo_until as string) - Date.now();
        expect(window).toBeGreaterThan(UNDO_RULES[name].windowMs - 60_000);
        expect(window).toBeLessThanOrEqual(UNDO_RULES[name].windowMs);
      }
      expect(outcome && 'activityId' in outcome && outcome.activityId).toBe(row.id);
      expect(activitySummary(row.summary_key as string, row.summary_params as never)).not.toBe('');
    },
  );

  it('records why a change ran without a card: Always, Full auto or "Don\'t ask again"', async () => {
    const tool = chatTool('dismiss_prompt_suggestion')!;
    db.tables.chat_auto_choices = [
      { user_id: PEOPLE.manager, organization_id: ORG, tool_key: tool.labelKey },
    ];
    await runAs(PEOPLE.manager, tool, 'auto');
    db.tables.prompt_suggestions[0].status = 'new';
    db.tables.chat_auto_choices = [];
    db.tables.chat_settings = [
      {
        organization_id: ORG,
        tool_policies: { [tool.labelKey]: 'always' },
        full_auto_for_members: true,
        dont_ask_again: true,
        manager_execute_off: [],
      },
    ];
    await runAs(PEOPLE.manager, tool, 'auto');
    expect(
      db.tables.chat_activity_log.map((row) => [row.mode, row.approval_kind, row.auto_via]),
    ).toEqual([
      ['auto', 'auto', 'dont_ask_again'],
      ['auto', 'auto', 'always'],
    ]);
  });

  it('records a change approved on its card as ask, in the mode it ran in', async () => {
    const tool = chatTool('create_draft')!;
    const first = await runAs(PEOPLE.manager, tool, 'ask_first');
    expect(first.decision.kind).toBe('ask');
    expect(db.tables.content_drafts).toHaveLength(0); // Nothing before the OK.
    await runAs(PEOPLE.manager, tool, 'ask_first', { approved: true });
    expect(db.tables.chat_activity_log[0]).toMatchObject({
      mode: 'ask_first',
      approval_kind: 'ask',
      auto_via: null,
    });
  });

  it('says what changed in words', () => {
    expect(activitySummary('saveDraft', { title: 'Pricing FAQ' })).toBe(
      'Saved the draft “Pricing FAQ”',
    );
    expect(activitySummary('opportunityStatus', { title: 'Teams', status: 'dismissed' })).toBe(
      'Dismissed the opportunity “Teams”',
    );
    expect(activitySummary('opportunityStatus', { title: 'Teams', status: 'reviewed' })).toBe(
      'Marked reviewed the opportunity “Teams”',
    );
    expect(activitySummary('dismissSuggestionUndo', { text: 'best crm' })).toBe(
      'Brought back the prompt suggestion “best crm”',
    );
  });
});

describe('a change with no session behind it (an agent run on its own)', () => {
  /** The run's person, as the engine's tool context names them. */
  const person = {
    userId: PEOPLE.admin,
    email: 'admin@example.com',
    organizationId: ORG,
    role: 'admin' as const,
    apiKeyId: 'agent-internal',
  };
  const write = (tool: ChatTool, approvalKey: string) =>
    runLoggedWrite({
      tool,
      input: tool.inputSchema.parse(INPUTS[tool.name]),
      ctx: person,
      organizationId: ORG,
      userId: PEOPLE.admin,
      brandId: BRAND,
      surface: 'chat',
      mode: 'full_auto',
      approval: { kind: 'auto', via: 'full_auto' },
      place: { conversationId: 'chat-1', runId: 'run-1', stepId: approvalKey },
      approvalKey,
      withoutSession: true,
    });

  it.each([
    ['create_draft', () => createContentDraftFor, () => createContentDraft],
    ['update_draft', () => updateContentDraftFor, () => updateContentDraft],
  ] as const)(
    '%s: its runFor makes it as the run’s person, logged with its Undo',
    async (name, ownWrite, sessionAction) => {
      if (NEEDS_DRAFT.has(name)) seedDraft(db);
      const outcome = await write(chatTool(name)!, 'step-1');
      expect(outcome).toMatchObject({ code: 'ok', repeated: false });
      expect(sessionAction()).not.toHaveBeenCalled();
      expect(ownWrite()).toHaveBeenCalledTimes(1);
      // The person comes from the run's context, never from the input.
      expect(vi.mocked(ownWrite()).mock.calls[0][0]).toEqual({
        userId: PEOPLE.admin,
        organizationId: ORG,
      });
      const [row] = db.tables.chat_activity_log;
      expect(row).toMatchObject({
        user_id: PEOPLE.admin,
        approval_kind: 'auto',
        auto_via: 'full_auto',
        run_id: 'run-1',
        tool_key: chatTool(name)!.labelKey,
      });
      expect(row.undo_json).toEqual(expect.any(Object));
      // A repeat of the approval makes nothing again.
      expect(await write(chatTool(name)!, 'step-1')).toMatchObject({ code: 'ok', repeated: true });
      expect(ownWrite()).toHaveBeenCalledTimes(1);
    },
  );

  it('refuses a row whose way is closed or that has none, before anything runs', async () => {
    // Through the API server, with no CHAT_ACTING_SECRET here; and a row with no runFor.
    for (const name of ['update_opportunity', 'add_topic']) {
      await expect(write(chatTool(name)!, 'step-2')).rejects.toThrow(
        /only with its person's session/,
      );
    }
    expect(updateOpportunityStatus).not.toHaveBeenCalled();
    expect(updateOpportunityStatusFor).not.toHaveBeenCalled();
    expect(addBrandTopic).not.toHaveBeenCalled();
    expect(db.tables.chat_activity_log).toEqual([]);
    expect(db.tables.chat_idempotency_keys ?? []).toEqual([]);
  });

  it('writes through the API server as the run’s person while that way is open, with its Undo', async () => {
    vi.stubEnv('CHAT_ACTING_SECRET', 'k'.repeat(64));
    vi.mocked(updateOpportunityStatusFor).mockImplementation(
      (_actor, id, status, reason) => fakeUpdateOpportunity(db)(id, status, reason) as never,
    );
    expect(await write(chatTool('update_opportunity')!, 'step-3')).toMatchObject({ code: 'ok' });
    expect(updateOpportunityStatus).not.toHaveBeenCalled();
    expect(vi.mocked(updateOpportunityStatusFor).mock.calls[0]).toEqual([
      { userId: PEOPLE.admin, organizationId: ORG },
      OPPORTUNITY,
      'dismissed',
      'not_relevant',
    ]);
    const [row] = db.tables.chat_activity_log;
    expect(row).toMatchObject({ user_id: PEOPLE.admin, tool_key: 'opportunityStatus' });
    expect(row.undo_json).toEqual(expect.any(Object));
  });
});

describe('a double-clicked approval creates one object (§21)', () => {
  it('two calls at once with the same approval save one draft and write one row', async () => {
    const tool = chatTool('create_draft')!;
    const [a, b] = await Promise.all([
      runAs(PEOPLE.manager, tool, 'auto', { approved: true, approvalKey: 'card-1' }),
      runAs(PEOPLE.manager, tool, 'auto', { approved: true, approvalKey: 'card-1' }),
    ]);
    expect(db.tables.content_drafts).toHaveLength(1);
    expect(db.tables.chat_activity_log).toHaveLength(1);
    expect(createContentDraft).toHaveBeenCalledTimes(1);
    expect(a.outcome).toMatchObject({ code: 'ok', output: db.tables.content_drafts[0].id });
    expect(b.outcome).toMatchObject({ code: 'ok', output: db.tables.content_drafts[0].id });
    expect([a.outcome, b.outcome].map((o) => o && 'repeated' in o && o.repeated).sort()).toEqual([
      false,
      true,
    ]);
  });

  it('a retry after the first call finished gets its result and log row back', async () => {
    const tool = chatTool('create_draft')!;
    const first = await runAs(PEOPLE.manager, tool, 'full_auto', { approvalKey: 'card-2' });
    const again = await runAs(PEOPLE.manager, tool, 'full_auto', { approvalKey: 'card-2' });
    expect(again.outcome).toEqual({ ...first.outcome, repeated: true });
    expect(db.tables.content_drafts).toHaveLength(1);
  });

  it('two approvals make two drafts', async () => {
    const tool = chatTool('create_draft')!;
    await runAs(PEOPLE.manager, tool, 'full_auto');
    await runAs(PEOPLE.manager, tool, 'full_auto');
    expect(db.tables.content_drafts).toHaveLength(2);
    expect(db.tables.chat_activity_log).toHaveLength(2);
  });

  it('an approval used for another change is a mismatch: nothing is made', async () => {
    const tool = chatTool('create_draft')!;
    await runAs(PEOPLE.manager, tool, 'full_auto', { approvalKey: 'card-3' });
    const other = await runAs(PEOPLE.manager, tool, 'full_auto', {
      approvalKey: 'card-3',
      input: { ...(INPUTS.create_draft as object), title: 'Something else' },
    });
    expect(other.outcome).toEqual({ code: 'approval_mismatch' });
    expect(db.tables.content_drafts).toHaveLength(1);
  });
});

describe('failures', () => {
  it('a WRITE that failed is not logged, and its approval may be tried again', async () => {
    const tool = chatTool('create_draft')!;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(createContentDraft).mockRejectedValueOnce(new Error('server down'));
    const failed = await runAs(PEOPLE.manager, tool, 'full_auto', { approvalKey: 'card-4' });
    expect(failed.outcome).toEqual({ code: 'failed', reason: 'server down' });
    expect(db.tables.chat_activity_log).toHaveLength(0);
    errors.mockRestore();
    const retry = await runAs(PEOPLE.manager, tool, 'full_auto', { approvalKey: 'card-4' });
    expect(retry.outcome).toMatchObject({ code: 'ok', repeated: false });
    expect(db.tables.content_drafts).toHaveLength(1);
  });

  it("a log row that can't be written never makes the change twice", async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tool = chatTool('create_draft')!;
    db.failures.chat_activity_log = { message: 'insert failed' };
    const first = await runAs(PEOPLE.manager, tool, 'full_auto', { approvalKey: 'card-5' });
    expect(first.outcome).toMatchObject({ code: 'ok', activityId: null });
    const again = await runAs(PEOPLE.manager, tool, 'full_auto', { approvalKey: 'card-5' });
    expect(again.outcome).toMatchObject({ code: 'ok', repeated: true });
    expect(db.tables.content_drafts).toHaveLength(1);
    errors.mockRestore();
  });

  it("logs a change without its Undo when what Undo needs can't be read", async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tool = chatTool('update_opportunity')!;
    const realFrom = db.from.bind(db);
    let changed = false;
    const update = fakeUpdateOpportunity(db);
    vi.mocked(updateOpportunityStatus).mockImplementationOnce((async (
      ...args: Parameters<typeof update>
    ) => {
      const row = await update(...args);
      changed = true;
      return row;
    }) as never);
    db.from = (table: string) => {
      // The reads before the change work; the one after it fails.
      if (table === 'content_opportunities' && changed) throw new Error('read failed');
      return realFrom(table);
    };
    try {
      await runAs(PEOPLE.manager, tool, 'full_auto');
    } finally {
      db.from = realFrom;
    }
    expect(db.tables.chat_activity_log).toHaveLength(1);
    expect(db.tables.chat_activity_log[0]).toMatchObject({ undo_json: null, undo_until: null });
    errors.mockRestore();
  });
});

describe('what is logged', () => {
  it('a read is never logged, and an EXECUTE only on a click and without Undo', async () => {
    const read = CHAT_TOOLS.find((tool) => tool.class === 'read')!;
    await expect(
      runLoggedWrite({
        tool: read,
        input: {},
        ctx: toolCtx,
        organizationId: ORG,
        userId: PEOPLE.admin,
        brandId: BRAND,
        surface: 'chat',
        mode: 'full_auto',
        approval: { kind: 'auto', via: 'full_auto' },
        place: { conversationId: null, runId: null, stepId: null },
        approvalKey: 'x',
      }),
    ).rejects.toThrow();
    const execute = {
      ...chatTool('create_draft')!,
      class: 'execute' as const,
      labelKey: 'publishCms',
    };
    await expect(
      runLoggedWrite({
        tool: execute,
        input: {},
        ctx: toolCtx,
        organizationId: ORG,
        userId: PEOPLE.admin,
        brandId: BRAND,
        surface: 'chat',
        mode: 'full_auto',
        approval: { kind: 'auto', via: 'full_auto' },
        place: { conversationId: null, runId: null, stepId: null },
        approvalKey: 'x',
      }),
    ).rejects.toThrow("An EXECUTE runs on the person's click only");
    const entry = {
      organizationId: ORG,
      userId: PEOPLE.admin,
      brandId: BRAND,
      place: { conversationId: null, runId: null, stepId: null },
      surface: 'chat' as const,
      tool: execute,
      mode: 'auto' as const,
      approval: { kind: 'click' as const },
      target: { type: 'cms_item', id: 'item-1' },
      summary: { key: 'publishCms', params: {} },
      undo: null,
    };
    await expect(
      logActivity({ ...entry, undo: { data: {}, until: new Date() } }),
    ).rejects.toThrow();
    expect(await logActivity(entry)).toEqual(expect.any(String));
  });

  it('maps each decision to its approval', () => {
    expect(approvalFor({ kind: 'run', via: 'read' })).toBeNull();
    expect(approvalFor({ kind: 'run', via: 'always' })).toEqual({ kind: 'auto', via: 'always' });
    expect(approvalFor({ kind: 'ask', reason: 'mode', offerDontAskAgain: true })).toEqual({
      kind: 'ask',
    });
    expect(approvalFor({ kind: 'click' })).toEqual({ kind: 'click' });
    expect(approvalFor({ kind: 'deny', denial: { code: 'policy_never' } })).toBeNull();
  });
});

describe('going live on its own (AUTONOMOUS-GO-LIVE §5.4)', () => {
  const AGENT = '12121212-1212-4212-8212-121212121212';
  const AGENT_RUN = '34343434-3434-4434-8434-343434343434';
  const RUN = '56565656-5656-4656-8656-565656565656';
  const SLOT = '78787878-7878-4878-8878-787878787878';
  const page = {
    draftId: DRAFT,
    title: 'Pricing FAQ',
    slug: 'pricing-faq',
    metaTitle: 'Pricing FAQ',
    metaDescription: '',
    html: '<p>Prices.</p>',
    author: null,
    reviewer: null,
    featuredImage: null,
  };
  const sent = vi.fn();
  const request = (over: Record<string, unknown> = {}) => ({
    tool: chatTool('push_cms_draft')!,
    input: INPUTS.push_cms_draft,
    ctx: toolCtx,
    organizationId: ORG,
    userId: PEOPLE.admin,
    brandId: BRAND,
    surface: 'chat' as const,
    mode: 'full_auto' as const,
    approval: { kind: 'auto' as const, via: 'go_live' as const },
    place: { conversationId: null, runId: RUN, stepId: null, agentRunId: AGENT_RUN },
    approvalKey: nextStep(),
    goLive: { agentId: AGENT, reservationId: SLOT, page },
    ...over,
  });
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'secret');
    sent.mockReset();
    sent.mockImplementation(async () =>
      Response.json({ success: true, delivery: { id: 'd1', status: 'sent', updated: false } }),
    );
    vi.stubGlobal('fetch', sent);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the checked page through the API as the run’s person, logged as gone live on its own', async () => {
    const first = request();
    const outcome = await runLoggedWrite(first);
    expect(outcome).toMatchObject({
      code: 'ok',
      output: { ok: true, target: 'webflow', status: 'sent' },
    });
    // Never the person's own send: no session is behind the run.
    expect(sendDraftToCms).not.toHaveBeenCalled();
    expect(sent).toHaveBeenCalledTimes(1);
    const [url, init] = sent.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/internal\/chat\/go-live\/send$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body as string)).toEqual({
      orgId: ORG,
      agentRunId: AGENT_RUN,
      runId: RUN,
      actingUserId: PEOPLE.admin,
      draftId: DRAFT,
      target: 'webflow',
      kind: 'cms_draft',
      reservationId: SLOT,
      page,
    });
    expect(db.tables.chat_activity_log).toEqual([
      expect.objectContaining({
        class: 'execute',
        tool_key: 'sendToCms',
        approval_kind: 'auto',
        auto_via: 'go_live',
        agent_id: AGENT,
        agent_run_id: AGENT_RUN,
        undo_json: null,
        undo_until: null,
      }),
    ]);
    // A repeat of the same approval (a reconnect) sends nothing again.
    expect(await runLoggedWrite({ ...first })).toMatchObject({ code: 'ok', repeated: true });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(db.tables.chat_activity_log).toHaveLength(1);
  });

  it('runs an EXECUTE without a click only for an agent run with its slot, and only a row that may', async () => {
    const refused = [
      request({ place: { conversationId: null, runId: RUN, stepId: null } }),
      request({
        place: { conversationId: null, runId: null, stepId: null, agentRunId: AGENT_RUN },
      }),
      request({ goLive: undefined }),
      // A row that can't go out on its own, and a WRITE: never.
      request({ tool: { ...chatTool('push_cms_draft')!, goLive: undefined } }),
      request({ tool: chatTool('update_draft')!, input: INPUTS.update_draft }),
    ];
    for (const req of refused) {
      await expect(runLoggedWrite(req as never)).rejects.toThrow(/on its own|click only/);
    }
    // Full auto is not a click either.
    await expect(
      runLoggedWrite(request({ approval: { kind: 'auto', via: 'full_auto' } })),
    ).rejects.toThrow("An EXECUTE runs on the person's click only");
    expect(sent).not.toHaveBeenCalled();
    expect(db.tables.chat_activity_log ?? []).toEqual([]);
  });

  it('logs nothing for a send the API or the CMS refused, and says why', async () => {
    sent.mockImplementationOnce(async () =>
      Response.json({ success: false, code: 'switch_off' }, { status: 403 }),
    );
    expect(await runLoggedWrite(request())).toMatchObject({
      code: 'ok',
      output: { ok: false, reason: 'forbidden_role' },
    });
    sent.mockImplementationOnce(async () =>
      Response.json({
        success: true,
        delivery: { id: 'd2', status: 'failed', error: 'Collection is archived' },
      }),
    );
    expect(await runLoggedWrite(request())).toMatchObject({
      code: 'ok',
      output: {
        ok: false,
        reason: 'failed',
        message: 'Webflow refused it: Collection is archived',
      },
    });
    expect(db.tables.chat_activity_log ?? []).toEqual([]);
  });

  it('publishes a new page through the same route, and answers where it went live (PR 9)', async () => {
    sent.mockImplementationOnce(async () =>
      Response.json({
        success: true,
        delivery: {
          id: 'd3',
          status: 'published',
          published_url: 'https://acme.example/blog/pricing-faq',
        },
      }),
    );
    const outcome = await runLoggedWrite(
      request({ tool: chatTool('publish_cms')!, input: INPUTS.publish_cms }),
    );
    expect(outcome).toMatchObject({
      code: 'ok',
      output: { ok: true, target: 'webflow', url: 'https://acme.example/blog/pricing-faq' },
    });
    const body = JSON.parse((sent.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ kind: 'publish', target: 'webflow', draftId: DRAFT });
    expect(db.tables.chat_activity_log).toEqual([
      expect.objectContaining({ tool_key: 'publishToCms', auto_via: 'go_live' }),
    ]);
    // A page live already: said as it is, nothing logged.
    sent.mockImplementationOnce(async () =>
      Response.json(
        { success: false, code: 'live_item', message: 'Live already.' },
        { status: 409 },
      ),
    );
    expect(
      await runLoggedWrite(request({ tool: chatTool('publish_cms')!, input: INPUTS.publish_cms })),
    ).toMatchObject({ output: { ok: false, reason: 'live_item' } });
    // The CMS refused the publish itself: its words, never "not connected".
    sent.mockImplementationOnce(async () =>
      Response.json(
        { success: false, code: 'publish_refused', message: 'Wix didn’t publish it.' },
        { status: 502 },
      ),
    );
    expect(
      await runLoggedWrite(request({ tool: chatTool('publish_cms')!, input: INPUTS.publish_cms })),
    ).toMatchObject({
      output: { ok: false, reason: 'publish_refused', message: 'Wix didn’t publish it.' },
    });
  });

  it('frees its slot when the API has no secret to be reached with: nothing went', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const finished: unknown[] = [];
    db.rpcs.finish_agent_go_live = (args) => {
      finished.push(args);
      return true;
    };
    expect(await runLoggedWrite(request())).toMatchObject({
      output: { ok: false, reason: 'failed' },
    });
    expect(sent).not.toHaveBeenCalled();
    expect(finished).toEqual([expect.objectContaining({ p_id: SLOT, p_status: 'failed' })]);
  });

  it('keeps go_live in the log to an agent run’s EXECUTE', async () => {
    const entry = {
      organizationId: ORG,
      userId: PEOPLE.admin,
      brandId: BRAND,
      place: { conversationId: null, runId: RUN, stepId: null },
      surface: 'chat' as const,
      tool: chatTool('push_cms_draft')!,
      mode: 'full_auto' as const,
      approval: { kind: 'auto' as const, via: 'go_live' as const },
      target: { type: 'content_draft', id: DRAFT },
      summary: { key: 'sendToCms', params: {} },
      undo: null,
    };
    await expect(logActivity(entry)).rejects.toThrow(/agent run/);
    await expect(
      logActivity({ ...entry, agentRunId: AGENT_RUN, tool: chatTool('update_draft')! }),
    ).rejects.toThrow(/Only an EXECUTE/);
    expect(await logActivity({ ...entry, agentRunId: AGENT_RUN })).toEqual(expect.any(String));
    expect(approvalFor({ kind: 'run', via: 'go_live' })).toEqual({ kind: 'auto', via: 'go_live' });
  });
});

describe('access.denied rows (§4c, §10a)', () => {
  it("records a refusal in the person's log: its reason, no approval, target or Undo", async () => {
    const tool = chatTool('update_opportunity')!;
    const ctx = await readPrecedenceContext({
      userId: PEOPLE.analyst,
      organizationId: ORG,
      mode: 'auto',
      surface: 'chat',
    });
    const decision = decideToolCall(
      tool,
      ctx!,
      await readToolCall(ctx!, tool, INPUTS.update_opportunity as Record<string, unknown>, false),
    );
    expect(decision.kind).toBe('deny');
    if (decision.kind !== 'deny') return;
    // The shape accessLog.ts's accessDeniedEvent builds.
    const { code, ...detail } = decision.denial;
    const id = await recordActivity({
      kind: 'access.denied',
      userId: PEOPLE.analyst,
      organizationId: ORG,
      brandId: BRAND,
      toolKey: tool.labelKey,
      toolClass: tool.class,
      surface: 'chat',
      reason: code,
      detail,
      conversationId: null,
      runId: null,
    });
    expect(db.tables.chat_activity_log).toEqual([
      expect.objectContaining({
        id,
        kind: 'access.denied',
        user_id: PEOPLE.analyst,
        brand_id: BRAND,
        tool_key: 'opportunityStatus',
        class: 'write',
        denial_code: 'forbidden_role',
        denial_json: { role: 'analyst', roles: ['admin', 'manager'] },
        summary_key: 'accessDenied',
        summary_params: { tool: 'Review or dismiss opportunities' },
      }),
    ]);
    // Nothing ran: no approval, target or Undo (00402 holds the same).
    for (const column of ['approval_kind', 'target_type', 'undo_json', 'undo_until']) {
      expect(db.tables.chat_activity_log[0][column] ?? null).toBeNull();
    }
    expect(activitySummary('accessDenied', { tool: 'Review or dismiss opportunities' })).toBe(
      'Not allowed: Review or dismiss opportunities',
    );
  });

  it('a denial is never undone', async () => {
    const { undoChange } = await import('./undo');
    const id = await recordActivity({
      kind: 'access.denied',
      userId: PEOPLE.manager,
      organizationId: ORG,
      brandId: null,
      toolKey: 'saveDraft',
      toolClass: 'write',
      surface: 'mcp',
      reason: 'brand_scope',
      detail: {},
      conversationId: null,
      runId: null,
    });
    expect(
      await undoChange({
        activityId: id,
        userId: PEOPLE.manager,
        organizationId: ORG,
        surface: 'chat',
      }),
    ).toMatchObject({ code: 'not_undoable' });
  });
});

describe('00402', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../../../supabase/migrations/00402_chat_activity.sql'),
    'utf8',
  );

  it('lets a person read their own rows and an Admin the workspace’s; only the server writes', () => {
    expect(sql).toMatch(/alter table public\.chat_activity_log enable row level security/);
    expect(sql).toMatch(/alter table public\.chat_idempotency_keys enable row level security/);
    expect(sql).toMatch(/p\.role = 'admin' or chat_activity_log\.user_id = auth\.uid\(\)/);
    // No write grant or policy for members, and keys not readable at all.
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*to authenticated/);
    expect(sql).not.toMatch(/for (insert|update|delete)/);
    expect(sql).not.toMatch(/grant[^;]*chat_idempotency_keys to authenticated/);
  });

  it('keeps undo_json from members', () => {
    const grant = sql.match(/grant select \(([^)]*)\) on table public\.chat_activity_log/);
    expect(grant).not.toBeNull();
    const columns = grant![1].split(',').map((column) => column.trim());
    expect(columns).not.toContain('undo_json');
    for (const column of ['tool_key', 'mode', 'approval_kind', 'undo_until', 'status']) {
      expect(columns).toContain(column);
    }
  });
});

describe('Ask your Admin in Full auto', () => {
  it('is still a card: only the person’s click sends it', async () => {
    const tool = chatTool('request_access')!;
    const { decision, outcome } = await runAs(PEOPLE.manager, tool, 'full_auto', {
      input: { asked: 'Change my role', rule_kind: 'role' },
    });
    expect(decision).toMatchObject({ kind: 'ask', reason: 'always_card' });
    expect(outcome).toBeNull();
    expect(db.tables.chat_activity_log ?? []).toHaveLength(0);
  });
});

describe('the tracking setup, by role and mode (W2-06, CHAT-20 §9 rows 20–32)', () => {
  const SETUP = [
    'add_prompts',
    'pause_prompts',
    'add_topic',
    'rename_topic',
    'add_competitors',
    'remove_competitor',
  ];
  async function decide(userId: string, name: string, mode: ChatMode, input = INPUTS[name]) {
    const tool = chatTool(name)!;
    const ctx = await readPrecedenceContext({ userId, organizationId: ORG, mode, surface: 'chat' });
    const call = await readToolCall(ctx!, tool, input as Record<string, unknown>, false);
    return decideToolCall(tool, ctx!, call);
  }

  it.each(SETUP)(
    '%s: Admins and Managers, from a card unless Full auto; an Analyst is refused in every mode',
    async (name) => {
      const tool = chatTool(name)!;
      for (const userId of [PEOPLE.admin, PEOPLE.manager]) {
        expect(await decide(userId, name, 'ask_first')).toMatchObject({ kind: 'ask' });
        expect(await decide(userId, name, 'auto')).toMatchObject({ kind: 'ask' });
        expect(await decide(userId, name, 'full_auto')).toMatchObject(
          tool.flags.alwaysCard
            ? { kind: 'ask', reason: 'always_card' }
            : { kind: 'run', via: 'full_auto' },
        );
      }
      for (const mode of ['ask_first', 'auto', 'full_auto'] as const) {
        expect(await decide(PEOPLE.analyst, name, mode)).toMatchObject({
          kind: 'deny',
          denial: { code: 'forbidden_role', roles: ['admin', 'manager'] },
        });
      }
    },
  );

  it('pauses more than 5 prompts only from a card, Full auto too (§9 row 22)', async () => {
    const six = Array.from({ length: 6 }, (_, i) => `66666666-6666-4666-8666-00000000000${i}`);
    expect(
      await decide(PEOPLE.admin, 'pause_prompts', 'full_auto', {
        brand_id: BRAND,
        prompt_ids: six.slice(0, 5),
      }),
    ).toMatchObject({ kind: 'run' });
    expect(
      await decide(PEOPLE.admin, 'pause_prompts', 'full_auto', {
        brand_id: BRAND,
        prompt_ids: six,
      }),
    ).toMatchObject({ kind: 'ask', reason: 'always_card', offerDontAskAgain: false });
  });

  it('refuses another workspace’s topic or brand: out of the person’s scope', async () => {
    db.tables.brands.push({ id: 'b-elsewhere', organization_id: OTHER_ORG });
    db.tables.topics.push({
      id: '77777777-7777-4777-8777-777777777777',
      brand_id: 'b-elsewhere',
      name: 'Theirs',
      is_active: true,
    });
    expect(
      await decide(PEOPLE.admin, 'rename_topic', 'full_auto', {
        topic_id: '77777777-7777-4777-8777-777777777777',
        name: 'Ours now',
      }),
    ).toMatchObject({ kind: 'deny', denial: { code: 'brand_scope' } });
    expect(
      await decide(PEOPLE.admin, 'remove_competitor', 'full_auto', {
        brand_id: 'b-elsewhere',
        competitor_id: COMPETITOR,
      }),
    ).toMatchObject({ kind: 'deny', denial: { code: 'brand_scope' } });
  });

  it('refuses them on a read-only workspace', async () => {
    db.tables.organizations[0].subscription_status = 'canceled';
    for (const name of SETUP) {
      expect(await decide(PEOPLE.admin, name, 'full_auto')).toMatchObject({
        kind: 'deny',
        denial: { code: 'subscription_inactive' },
      });
    }
  });

  it('keeps the competitor rows to plans with competitor tracking, as the Competitors page is', async () => {
    for (const name of ['add_competitors', 'remove_competitor']) {
      const tool = chatTool(name)!;
      const ctx = await readPrecedenceContext({
        userId: PEOPLE.admin,
        organizationId: ORG,
        mode: 'full_auto',
        surface: 'chat',
      });
      const without = {
        ...ctx!,
        plan: {
          ...ctx!.plan,
          features: ctx!.plan.features.filter((f) => f !== 'competitor_tracking'),
        },
      };
      const call = await readToolCall(
        without,
        tool,
        INPUTS[name] as Record<string, unknown>,
        false,
      );
      expect(decideToolCall(tool, without, call), name).toMatchObject({
        kind: 'deny',
        denial: { code: 'plan_locked' },
      });
      expect(decideToolCall(tool, ctx!, call), name).not.toMatchObject({ kind: 'deny' });
    }
  });
});

describe('content, reports and Site Audit, by role and mode (W2-07, CHAT-20 §9 rows 37–64)', () => {
  const OUTPUT = ['update_draft', 'build_report'];
  async function decide(
    userId: string,
    name: string,
    mode: ChatMode,
    input = INPUTS[name],
    before = 0,
  ) {
    const tool = chatTool(name)!;
    const ctx = await readPrecedenceContext({ userId, organizationId: ORG, mode, surface: 'chat' });
    const call = await readToolCall(ctx!, tool, input as Record<string, unknown>, false, before);
    return decideToolCall(tool, ctx!, call);
  }
  beforeEach(() => seedDraft(db));

  it.each(OUTPUT)(
    '%s: Admins and Managers, from a card unless Full auto; an Analyst is refused in every mode',
    async (name) => {
      for (const userId of [PEOPLE.admin, PEOPLE.manager]) {
        expect(await decide(userId, name, 'ask_first')).toMatchObject({ kind: 'ask' });
        expect(await decide(userId, name, 'auto')).toMatchObject({ kind: 'ask' });
        expect(await decide(userId, name, 'full_auto')).toMatchObject({
          kind: 'run',
          via: 'full_auto',
        });
      }
      for (const mode of ['ask_first', 'auto', 'full_auto'] as const) {
        expect(await decide(PEOPLE.analyst, name, mode)).toMatchObject({
          kind: 'deny',
          denial: { code: 'forbidden_role', roles: ['admin', 'manager'] },
        });
      }
    },
  );

  /** An Admin's Chat settings row (00401): a stored Always, and the go-live groups off for Managers. */
  const cmsSettings = (managerExecuteOff: string[]) => {
    db.tables.chat_settings = [
      {
        organization_id: ORG,
        tool_policies: { [chatTool('push_cms_draft')!.labelKey]: 'always' },
        full_auto_for_members: true,
        dont_ask_again: true,
        manager_execute_off: managerExecuteOff,
      },
    ];
  };
  const AGENCY = 'aaaaaaaa-0000-4000-8000-000000000005';

  it('sends a draft to a CMS as an EXECUTE in the publishing group: only on a click, even under an Admin Always', async () => {
    expect(chatTool('push_cms_draft')).toMatchObject({
      class: 'execute',
      executeGroup: 'publishing',
      defaultPolicy: 'click',
      maxPolicy: 'click',
    });
    // An Admin's stored Always lifts nothing: an EXECUTE is a click.
    cmsSettings([]);
    for (const userId of [PEOPLE.admin, PEOPLE.manager]) {
      for (const mode of ['ask_first', 'auto', 'full_auto'] as const) {
        expect(await decide(userId, 'push_cms_draft', mode), `${userId} ${mode}`).toEqual({
          kind: 'click',
        });
      }
    }
  });

  it('refuses a Manager’s CMS send once an Admin turned publishing off for Managers; an Admin still clicks', async () => {
    cmsSettings(['publishing']);
    for (const mode of ['ask_first', 'auto', 'full_auto'] as const) {
      expect(await decide(PEOPLE.manager, 'push_cms_draft', mode)).toEqual({
        kind: 'deny',
        denial: { code: 'execute_off', group: 'publishing' },
      });
      expect(await decide(PEOPLE.admin, 'push_cms_draft', mode)).toEqual({ kind: 'click' });
    }
    // Not offered to that Manager either, with the reason the explainer gives.
    const ctx = await readPrecedenceContext({
      userId: PEOPLE.manager,
      organizationId: ORG,
      mode: 'full_auto',
      surface: 'chat',
    });
    const scope = { brandId: BRAND, brandIsDemo: false };
    const tool = chatTool('push_cms_draft')!;
    expect(allowedTools([tool], ctx!, scope)).toEqual([]);
    expect(listingDenial(tool, ctx!, scope)).toEqual({ code: 'execute_off', group: 'publishing' });
    // Another group switched off leaves publishing to Managers.
    cmsSettings(['email_outreach', 'code_prs', 'feeds']);
    expect(await decide(PEOPLE.manager, 'push_cms_draft', 'auto')).toEqual({ kind: 'click' });
  });

  it('never offers a CMS send to an Analyst or an Agency partner, in any mode', async () => {
    db.tables.profiles.push({
      id: AGENCY,
      role: 'agency_partner',
      organization_id: ORG,
      brand_scope: 'all',
    });
    const tool = chatTool('push_cms_draft')!;
    for (const userId of [PEOPLE.analyst, AGENCY]) {
      for (const mode of ['ask_first', 'auto', 'full_auto'] as const) {
        expect(await decide(userId, 'push_cms_draft', mode)).toMatchObject({
          kind: 'deny',
          denial: { code: 'forbidden_role', roles: ['admin', 'manager'] },
        });
        const ctx = await readPrecedenceContext({
          userId,
          organizationId: ORG,
          mode,
          surface: 'chat',
        });
        expect(allowedTools([tool], ctx!, { brandId: BRAND, brandIsDemo: false })).toEqual([]);
      }
    }
  });

  it('a CMS send clicked through is in the Activity log as an EXECUTE, with no Undo', async () => {
    const tool = chatTool('push_cms_draft')!;
    const { decision, outcome } = await runAs(PEOPLE.manager, tool, 'full_auto');
    expect(decision).toEqual({ kind: 'click' });
    expect(outcome).toMatchObject({ code: 'ok' });
    expect(sendDraftToCms).toHaveBeenCalledWith(DRAFT, 'webflow');
    expect(db.tables.chat_activity_log).toHaveLength(1);
    expect(db.tables.chat_activity_log[0]).toMatchObject({
      tool_key: 'sendToCms',
      class: 'execute',
      approval_kind: 'click',
      target_type: 'content_draft',
      target_id: DRAFT,
      summary_params: { cms: 'Webflow' },
      undo_json: null,
      undo_until: null,
    });
  });

  it('an Analyst still saves a draft (DECISIONS T), but changes none', async () => {
    expect(await decide(PEOPLE.analyst, 'create_draft', 'full_auto')).toMatchObject({
      kind: 'run',
    });
    expect(await decide(PEOPLE.analyst, 'update_draft', 'full_auto')).toMatchObject({
      kind: 'deny',
    });
  });

  it('starts an audit only from a card, with its cost, in every mode (§9 row 37)', async () => {
    expect(chatTool('run_site_audit')!.flags.costCard).toBe(true);
    for (const userId of [PEOPLE.admin, PEOPLE.manager]) {
      for (const mode of ['ask_first', 'auto', 'full_auto'] as const) {
        expect(await decide(userId, 'run_site_audit', mode)).toMatchObject({
          kind: 'ask',
          reason: 'always_card',
          offerDontAskAgain: false,
        });
      }
    }
    for (const mode of ['ask_first', 'auto', 'full_auto'] as const) {
      expect(await decide(PEOPLE.analyst, 'run_site_audit', mode)).toMatchObject({
        kind: 'deny',
        denial: { code: 'forbidden_role', roles: ['admin', 'manager'] },
      });
    }
  });

  it('an audit approved on its card is in the Activity log, with no Undo', async () => {
    const { decision, outcome } = await runAs(
      PEOPLE.admin,
      chatTool('run_site_audit')!,
      'full_auto',
      {
        approved: true,
      },
    );
    expect(decision).toMatchObject({ kind: 'ask', reason: 'always_card' });
    expect(outcome).toMatchObject({ code: 'ok' });
    expect(db.tables.chat_activity_log[0]).toMatchObject({
      tool_key: 'startAudit',
      approval_kind: 'ask',
      undo_json: null,
    });
  });

  it('counts the run’s earlier pauses: one prompt at a time asks from the sixth (§9 row 22)', async () => {
    const one = { brand_id: BRAND, prompt_ids: [PROMPT] };
    expect(await decide(PEOPLE.admin, 'pause_prompts', 'full_auto', one, 4)).toMatchObject({
      kind: 'run',
    });
    expect(await decide(PEOPLE.admin, 'pause_prompts', 'full_auto', one, 5)).toMatchObject({
      kind: 'ask',
      reason: 'always_card',
    });
  });

  it.each([...OUTPUT, 'push_cms_draft', 'run_site_audit'])(
    '%s: refused on another workspace’s brand or draft, and on a read-only workspace',
    async (name) => {
      db.tables.brands.push({ id: 'b-elsewhere', organization_id: OTHER_ORG });
      const theirDraft = '88888888-8888-4888-8888-888888888888';
      db.tables.content_drafts.push({ id: theirDraft, brand_id: 'b-elsewhere', title: 'Theirs' });
      const input = INPUTS[name] as Record<string, unknown>;
      const theirs =
        'draft_id' in input
          ? { ...input, draft_id: theirDraft }
          : { ...input, brand_id: 'b-elsewhere' };
      expect(await decide(PEOPLE.admin, name, 'full_auto', theirs)).toMatchObject({
        kind: 'deny',
        denial: { code: 'brand_scope' },
      });
      db.tables.organizations[0].subscription_status = 'canceled';
      expect(await decide(PEOPLE.admin, name, 'full_auto')).toMatchObject({
        kind: 'deny',
        denial: { code: 'subscription_inactive' },
      });
    },
  );

  it('sends to no webhook: it goes out of GetCito, so only the editor sends there', () => {
    const tool = chatTool('push_cms_draft')!;
    expect(tool.inputSchema.safeParse({ draft_id: DRAFT, destination: 'webhook' }).success).toBe(
      false,
    );
    expect(tool.description).not.toMatch(/webhook\)/);
  });

  it('publishes a new page live only as an EXECUTE, never in Framer nor to a webhook (AUTONOMOUS-GO-LIVE PR 9)', () => {
    expect(CHAT_TOOLS.filter((tool) => tool.class === 'execute').map((tool) => tool.name)).toEqual([
      'push_cms_draft',
      'publish_cms',
      'unpublish_cms',
    ]);
    const publish = chatTool('publish_cms')!;
    expect(publish.executeGroup).toBe('publishing');
    for (const destination of ['webflow', 'wordpress', 'wix']) {
      expect(publish.inputSchema.safeParse({ draft_id: DRAFT, destination }).success).toBe(true);
    }
    for (const destination of ['framer', 'webhook']) {
      expect(publish.inputSchema.safeParse({ draft_id: DRAFT, destination }).success).toBe(false);
    }
  });
});

describe('saving a skill, by role and mode (W3-06, CHAT-20 §9 row 75)', () => {
  const AGENCY = 'aaaaaaaa-0000-4000-8000-000000000005';
  async function decide(userId: string, mode: ChatMode, tainted = false) {
    const tool = chatTool('save_skill')!;
    const ctx = await readPrecedenceContext({ userId, organizationId: ORG, mode, surface: 'chat' });
    const call = await readToolCall(ctx!, tool, INPUTS.save_skill as never, tainted);
    return decideToolCall(tool, ctx!, call);
  }

  it('Admins and Managers, from a card unless Full auto; Analysts and Agency partners are refused', async () => {
    db.tables.profiles.push({ id: AGENCY, role: 'agency_partner', organization_id: ORG });
    for (const userId of [PEOPLE.admin, PEOPLE.manager]) {
      expect(await decide(userId, 'ask_first')).toMatchObject({ kind: 'ask' });
      expect(await decide(userId, 'auto')).toMatchObject({ kind: 'ask' });
      expect(await decide(userId, 'full_auto')).toEqual({ kind: 'run', via: 'full_auto' });
    }
    for (const userId of [PEOPLE.analyst, AGENCY]) {
      for (const mode of ['ask_first', 'auto', 'full_auto'] as const) {
        expect(await decide(userId, mode)).toMatchObject({
          kind: 'deny',
          denial: { code: 'forbidden_role', roles: ['admin', 'manager'] },
        });
      }
    }
  });

  it('shows its card even in Full auto once outside text, an imported skill too, shaped it (§16a)', async () => {
    expect(await decide(PEOPLE.admin, 'full_auto', true)).toMatchObject({
      kind: 'ask',
      reason: 'tainted',
    });
  });

  it('is in the Activity log, and Undo deletes it while it is still private and as saved', async () => {
    const tool = chatTool('save_skill')!;
    await runAs(PEOPLE.admin, tool, 'full_auto');
    const [log] = db.tables.chat_activity_log;
    const [saved] = db.tables.chat_skills;
    expect(log).toMatchObject({
      target_type: 'chat_skill',
      target_id: saved.id,
      summary_params: { name: '/pricing-faq' },
    });
    expect(activitySummary(log.summary_key as string, log.summary_params as never)).toBe(
      'Saved the skill /pricing-faq',
    );
    const undo = (id: string) =>
      UNDO_RULES.save_skill.inverse({ id, brandId: null, data: log.undo_json as never });

    // Shared with the workspace since: someone else's to keep.
    saved.visibility = 'workspace';
    expect(await undo(saved.id as string)).toBe('changed');
    saved.visibility = 'private';
    expect(await undo(saved.id as string)).toBe('ok');
    expect(db.tables.chat_skills).toEqual([]);
    expect(await undo(saved.id as string)).toBe('gone');
  });
});

describe('memory, by role and mode (W3-11, CHAT-20 §9 rows 73–74)', () => {
  const AGENCY = 'aaaaaaaa-0000-4000-8000-000000000005';
  async function decide(userId: string, name: string, mode: ChatMode, tainted = false) {
    const tool = chatTool(name)!;
    const ctx = await readPrecedenceContext({ userId, organizationId: ORG, mode, surface: 'chat' });
    const call = await readToolCall(ctx!, tool, INPUTS[name] as never, tainted);
    return decideToolCall(tool, ctx!, call);
  }

  it('shows save_memory’s card to every role in every mode, Full auto included (item 10)', async () => {
    db.tables.profiles.push({ id: AGENCY, role: 'agency_partner', organization_id: ORG });
    for (const userId of [PEOPLE.admin, PEOPLE.manager, PEOPLE.analyst, AGENCY]) {
      for (const mode of ['ask_first', 'auto', 'full_auto'] as const) {
        expect(await decide(userId, 'save_memory', mode)).toMatchObject({
          kind: 'ask',
          reason: 'always_card',
          offerDontAskAgain: false,
        });
      }
    }
    // An Admin can't set it to Always (CHAT-20 §5 step 4).
    expect(chatTool('save_memory')!.maxPolicy).toBe('ask');
  });

  it('removes in Full auto, with a card otherwise, and on a card once outside text shaped the run', async () => {
    expect(await decide(PEOPLE.admin, 'forget_memory', 'auto')).toMatchObject({ kind: 'ask' });
    expect(await decide(PEOPLE.admin, 'forget_memory', 'full_auto')).toEqual({
      kind: 'run',
      via: 'full_auto',
    });
    expect(await decide(PEOPLE.admin, 'forget_memory', 'full_auto', true)).toMatchObject({
      kind: 'ask',
      reason: 'tainted',
    });
  });

  it('logs a save, and Undo takes it out, or gives a replaced line its old words', async () => {
    const tool = chatTool('save_memory')!;
    await runAs(PEOPLE.admin, tool, 'full_auto', { approved: true });
    const [log] = db.tables.chat_activity_log;
    const saved = db.tables.chat_memory_items.find((row) => row.id !== MEMORY_LINE)!;
    expect(log).toMatchObject({ target_type: 'chat_memory_item', target_id: saved.id });
    expect(activitySummary(log.summary_key as string, log.summary_params as never)).toBe(
      'Saved “Write blog posts in US English” to Me memory',
    );
    const undo = (id: string, data: unknown) =>
      UNDO_RULES.save_memory.inverse({ id, brandId: null, data: data as never });
    saved.text = 'Changed since';
    expect(await undo(saved.id as string, log.undo_json)).toBe('changed');
    saved.text = 'Write blog posts in US English';
    expect(await undo(saved.id as string, log.undo_json)).toBe('ok');
    expect(db.tables.chat_memory_items.map((row) => row.id)).toEqual([MEMORY_LINE]);

    db.tables.chat_activity_log = [];
    await runAs(PEOPLE.admin, tool, 'full_auto', {
      approved: true,
      input: { scope: 'user', text: 'Write in US English', replaces: MEMORY_LINE },
    });
    const [replaced] = db.tables.chat_activity_log;
    expect(db.tables.chat_memory_items[0].text).toBe('Write in US English');
    expect(await undo(MEMORY_LINE, replaced.undo_json)).toBe('ok');
    expect(db.tables.chat_memory_items[0].text).toBe('Write in UK English');
  });

  it('logs a removal, and Undo brings the line back while it is there', async () => {
    const tool = chatTool('forget_memory')!;
    await runAs(PEOPLE.admin, tool, 'full_auto');
    const [log] = db.tables.chat_activity_log;
    expect(db.tables.chat_memory_items[0].deleted_at).toEqual(expect.any(String));
    expect(activitySummary(log.summary_key as string, log.summary_params as never)).toBe(
      'Removed “Write in UK English” from Me memory',
    );
    const undo = () =>
      UNDO_RULES.forget_memory.inverse({
        id: MEMORY_LINE,
        brandId: null,
        data: log.undo_json as never,
      });
    expect(await undo()).toBe('ok');
    expect(db.tables.chat_memory_items[0].deleted_at).toBeNull();
    expect(await undo()).toBe('changed');
    db.tables.chat_memory_items = [];
    expect(await undo()).toBe('gone');
  });
});
