// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
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
 * Undo (CHAT-20 §10b, §21 "Undo restores the before state or explains the
 * conflict"): each WRITE row's inverse within its §9 window, for the person
 * Chat acted as and Admins, through the same precedence as the tool, with
 * nothing overwritten when the target changed since.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fakeSupabase')).createFakeSupabase(),
}));
vi.mock('@/lib/actions/contentDrafts', () => ({
  createContentDraft: vi.fn(),
  updateContentDraft: vi.fn(),
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

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { createContentDraft, updateContentDraft } = await import('@/lib/actions/contentDrafts');
const { sendDraftToCms } = await import('@/lib/actions/cmsSend');
const { createReport } = await import('@/lib/actions/reports');
const { startSiteAudits } = await import('@/lib/actions/audits');
const { updateOpportunityStatus } = await import('@/lib/actions/content');
const { dismissSuggestion } = await import('@/lib/actions/promptSuggestions');
const { addTopicPrompts, pauseBrandPrompts } = await import('@/lib/actions/prompt');
const { addBrandTopic, renameBrandTopic } = await import('@/lib/actions/topic');
const { addCompetitors, removeBrandCompetitor } = await import('@/lib/actions/competitor');
const { runLoggedWrite } = await import('./write');
const { undoChange, undoRule, UNDO_RULES } = await import('./undo');
const { chatTool, CHAT_TOOLS } = await import('./registry/tools');

const DAY = 24 * 60 * 60 * 1000;
let step = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  seedWorkspace(db);
  vi.mocked(createContentDraft).mockImplementation(fakeCreateDraft(db) as never);
  vi.mocked(updateContentDraft).mockImplementation(fakeUpdateContentDraft(db) as never);
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
});
afterEach(() => vi.unstubAllEnvs());

/** A change Chat made for this person in Full auto; returns its log row. */
async function change(userId: string, name: string, input: unknown) {
  const outcome = await runLoggedWrite({
    tool: chatTool(name)!,
    input,
    ctx: {} as never,
    organizationId: ORG,
    userId,
    brandId: BRAND,
    surface: 'chat',
    mode: 'full_auto',
    // An EXECUTE (a page sent to a CMS) runs on the person's click only.
    approval:
      chatTool(name)!.class === 'execute' ? { kind: 'click' } : { kind: 'auto', via: 'full_auto' },
    place: { conversationId: null, runId: null, stepId: null },
    approvalKey: `step-${++step}`,
  });
  if (outcome.code !== 'ok' || !outcome.activityId) throw new Error('no change');
  return db.tables.chat_activity_log.find((row) => row.id === outcome.activityId)!;
}

const saveDraft = (userId: string = PEOPLE.manager) =>
  change(userId, 'create_draft', {
    brand_id: BRAND,
    title: 'Pricing FAQ',
    page_type: 'docs_faq',
    method: 'create',
    source: { kind: 'content' },
  });
const dismissOpportunity = (userId: string = PEOPLE.manager) =>
  change(userId, 'update_opportunity', {
    opportunity_id: OPPORTUNITY,
    status: 'dismissed',
    reason: 'wrong_angle',
  });
const dismissPromptSuggestion = (userId: string = PEOPLE.manager) =>
  change(userId, 'dismiss_prompt_suggestion', { suggestion_id: SUGGESTION });

const undo = (activityId: unknown, userId: string = PEOPLE.manager, organizationId: string = ORG) =>
  undoChange({ activityId: activityId as string, userId, organizationId, surface: 'chat' });

const draft = () => db.tables.content_drafts[0];
const opportunity = () => db.tables.content_opportunities[0];
const suggestion = () => db.tables.prompt_suggestions[0];
const logRow = (id: unknown) => db.tables.chat_activity_log.find((row) => row.id === id)!;

describe('every WRITE row is recorded, with its Undo where §9 gives one', () => {
  it('with its §9 window, and words for the change and its Undo', () => {
    // An EXECUTE's row only records (push_cms_draft): it has no Undo (§10b).
    const writes = CHAT_TOOLS.filter((tool) => tool.class !== 'read');
    expect(writes.map((tool) => tool.name).sort()).toEqual(Object.keys(UNDO_RULES).sort());
    expect(UNDO_RULES.create_draft.windowMs).toBe(30 * DAY);
    expect(UNDO_RULES.update_opportunity.windowMs).toBe(7 * DAY);
    expect(UNDO_RULES.dismiss_prompt_suggestion.windowMs).toBe(7 * DAY);
    // §9 rows 20–32: pausing keeps the prompts' history, so its Undo stays open 30 days.
    expect(UNDO_RULES.pause_prompts.windowMs).toBe(30 * DAY);
    for (const name of [
      'add_prompts',
      'add_topic',
      'rename_topic',
      'add_competitors',
      'remove_competitor',
    ]) {
      expect(UNDO_RULES[name].windowMs).toBe(7 * DAY);
    }
    // §9 rows 55, 64: a changed draft and a report, 30 days; rows 37, 58: no Undo.
    expect(UNDO_RULES.update_draft.windowMs).toBe(30 * DAY);
    expect(UNDO_RULES.build_report.windowMs).toBe(30 * DAY);
    expect(UNDO_RULES.push_cms_draft.windowMs).toBe(0);
    expect(UNDO_RULES.run_site_audit.windowMs).toBe(0);
    for (const tool of writes) {
      expect(undoRule(tool)).not.toBeNull();
      expect(messages.chatActivity.summary).toHaveProperty(tool.labelKey);
      if (undoRule(tool)!.windowMs > 0) {
        expect(messages.chatActivity.summary).toHaveProperty(`${tool.labelKey}Undo`);
      }
    }
    expect(undoRule(CHAT_TOOLS.find((tool) => tool.class === 'read')!)).toBeNull();
  });
});

describe('create_draft: archive the draft it saved', () => {
  it('archives it, marks the change undone and logs the Undo as the person’s own action', async () => {
    const row = await saveDraft();
    const result = await undo(row.id);
    expect(result).toMatchObject({ code: 'ok', message: 'Undone.' });
    expect(draft().archived_at).toEqual(expect.any(String));
    expect(logRow(row.id)).toMatchObject({ status: 'undone', undone_by: PEOPLE.manager });
    expect(logRow(row.id).undone_at).toEqual(expect.any(String));
    const undoRow = logRow(result.code === 'ok' && result.activityId);
    expect(undoRow).toMatchObject({
      undoes_id: row.id,
      tool_key: 'saveDraft',
      approval_kind: 'run',
      auto_via: null,
      mode: null,
      summary_key: 'saveDraftUndo',
      summary_params: { title: 'Pricing FAQ' },
      undo_json: null,
      undo_until: null,
      target_type: 'content_draft',
      target_id: draft().id,
    });
    // An Undo isn't undone in turn, and the change only once.
    expect(await undo(undoRow.id)).toMatchObject({ code: 'not_undoable' });
    expect(await undo(row.id)).toMatchObject({
      code: 'already_undone',
      message: 'This was already undone.',
    });
  });

  it('explains the conflict when the person changed the draft since, and overwrites nothing', async () => {
    const row = await saveDraft();
    draft().body_html = '<h1>Pricing FAQ</h1><p>My own words.</p>';
    draft().updated_at = new Date(Date.now() + 1000).toISOString();
    const result = await undo(row.id);
    expect(result).toEqual({
      code: 'conflict',
      reason: 'changed',
      href: `/dashboard/content/editor/${draft().id}`,
      message: 'This changed since. Open it to undo by hand.',
    });
    expect(draft().archived_at).toBeNull();
    expect(logRow(row.id).status).toBe('undo_conflict');
    expect(db.tables.chat_activity_log).toHaveLength(1);

    // Back as Chat left it: Undo may try again.
    draft().body_html = '<h1>Pricing FAQ</h1>';
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
    expect(logRow(row.id).status).toBe('undone');
  });

  it.each([
    ['renamed', (d: Record<string, unknown>) => (d.title = 'Pricing questions')],
    ['marked ready', (d: Record<string, unknown>) => (d.status = 'ready')],
    [
      'archived by someone',
      (d: Record<string, unknown>) => (d.archived_at = new Date().toISOString()),
    ],
  ])('a draft %s since is a conflict', async (_what, edit) => {
    const row = await saveDraft();
    edit(draft());
    expect(await undo(row.id)).toMatchObject({ code: 'conflict', reason: 'changed' });
  });

  it('a draft deleted since: nothing to undo, no link', async () => {
    const row = await saveDraft();
    db.tables.content_drafts = [];
    expect(await undo(row.id)).toEqual({
      code: 'conflict',
      reason: 'gone',
      href: null,
      message: "This was deleted since, so there's nothing to undo.",
    });
  });

  it('a draft written between the check and the archive is a conflict, not overwritten', async () => {
    const row = await saveDraft();
    const realFrom = db.from.bind(db);
    db.from = (table: string) => {
      const builder = realFrom(table);
      if (table !== 'content_drafts') return builder;
      const update = builder.update.bind(builder);
      // Someone saves the draft just before the archive's write.
      builder.update = (patch: Record<string, unknown>) => {
        draft().updated_at = new Date(Date.now() + 5000).toISOString();
        return update(patch);
      };
      return builder;
    };
    try {
      expect(await undo(row.id)).toMatchObject({ code: 'conflict', reason: 'changed' });
    } finally {
      db.from = realFrom;
    }
    expect(draft().archived_at).toBeNull();
  });

  it('an Analyst undoes the draft their own run saved, though the Library leaves archiving to Managers', async () => {
    const row = await saveDraft(PEOPLE.analyst);
    expect(await undo(row.id, PEOPLE.analyst)).toMatchObject({ code: 'ok' });
    expect(draft().archived_at).toEqual(expect.any(String));
  });
});

describe('update_opportunity: its status and reason before', () => {
  it('puts back the status and drops the dismiss reason, keeping the rest of source_data', async () => {
    const row = await dismissOpportunity();
    expect(opportunity()).toMatchObject({
      status: 'dismissed',
      source_data: { volume: 1200, dismissReason: 'wrong_angle' },
    });
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
    expect(opportunity()).toMatchObject({ status: 'new', source_data: { volume: 1200 } });
    expect(opportunity().source_data).not.toHaveProperty('dismissReason');
  });

  it('puts back an earlier dismiss reason', async () => {
    Object.assign(opportunity(), {
      status: 'dismissed',
      source_data: { volume: 1200, dismissReason: 'not_relevant' },
    });
    const row = await change(PEOPLE.manager, 'update_opportunity', {
      opportunity_id: OPPORTUNITY,
      status: 'reviewed',
    });
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
    expect(opportunity()).toMatchObject({
      status: 'dismissed',
      source_data: { volume: 1200, dismissReason: 'not_relevant' },
    });
  });

  it('is a conflict once someone set it again', async () => {
    const row = await dismissOpportunity();
    Object.assign(opportunity(), { status: 'in_progress', source_data: { volume: 1200 } });
    expect(await undo(row.id)).toMatchObject({
      code: 'conflict',
      reason: 'changed',
      href: `/dashboard/content/${OPPORTUNITY}`,
    });
    expect(opportunity().status).toBe('in_progress');
  });

  it('has no Undo when it changed nothing', async () => {
    Object.assign(opportunity(), { status: 'reviewed' });
    const row = await change(PEOPLE.manager, 'update_opportunity', {
      opportunity_id: OPPORTUNITY,
      status: 'reviewed',
    });
    expect(row).toMatchObject({ undo_json: null, undo_until: null });
    expect(await undo(row.id)).toMatchObject({
      code: 'not_undoable',
      message: "This change can't be undone here.",
    });
  });
});

describe('dismiss_prompt_suggestion: bring it back', () => {
  it('brings it back as it was', async () => {
    const row = await dismissPromptSuggestion();
    expect(suggestion().status).toBe('dismissed');
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
    expect(suggestion().status).toBe('new');
  });

  it('is a conflict once it was added since', async () => {
    const row = await dismissPromptSuggestion();
    suggestion().status = 'added';
    expect(await undo(row.id)).toMatchObject({
      code: 'conflict',
      reason: 'changed',
      href: '/dashboard/prompts/suggestions',
    });
    expect(suggestion().status).toBe('added');
  });

  it('has no Undo for a suggestion that was dismissed already', async () => {
    suggestion().status = 'dismissed';
    const row = await dismissPromptSuggestion();
    expect(row.undo_until).toBeNull();
    expect(await undo(row.id)).toMatchObject({ code: 'not_undoable' });
  });
});

describe('the window', () => {
  it('is closed once it ended: nothing changes', async () => {
    const row = await dismissPromptSuggestion();
    row.undo_until = new Date(Date.now() - 1000).toISOString();
    expect(await undo(row.id)).toEqual({
      code: 'expired',
      message: 'Undo is no longer available for this change. Change it by hand instead.',
    });
    expect(suggestion().status).toBe('dismissed');
    expect(row.status).toBe('done');
  });

  it('is open until it ends', async () => {
    const row = await saveDraft();
    row.undo_until = new Date(Date.now() + 60_000).toISOString();
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
  });
});

describe('who may undo', () => {
  it('the person Chat acted as and Admins; anyone else finds nothing', async () => {
    const row = await dismissPromptSuggestion();
    expect(await undo(row.id, PEOPLE.otherManager)).toEqual({
      code: 'not_found',
      message: "I couldn't find that change.",
    });
    expect(await undo(row.id, PEOPLE.analyst)).toMatchObject({ code: 'not_found' });
    expect(suggestion().status).toBe('dismissed');
    expect(await undo(row.id, PEOPLE.admin)).toMatchObject({ code: 'ok' });
    expect(logRow(row.id).undone_by).toBe(PEOPLE.admin);
  });

  it('not from another workspace, nor once the person left this one', async () => {
    const row = await dismissPromptSuggestion();
    expect(await undo(row.id, PEOPLE.manager, OTHER_ORG)).toMatchObject({ code: 'not_found' });
    db.tables.profiles.find((p) => p.id === PEOPLE.manager)!.organization_id = OTHER_ORG;
    expect(await undo(row.id)).toMatchObject({ code: 'not_found' });
    expect(suggestion().status).toBe('dismissed');
  });
});

describe('Undo passes the same precedence as the tool (A3)', () => {
  it('a read-only workspace refuses it', async () => {
    const row = await dismissPromptSuggestion();
    db.tables.organizations[0].subscription_status = 'canceled';
    const result = await undo(row.id);
    expect(result).toMatchObject({
      code: 'denied',
      denial: { code: 'subscription_inactive', status: 402 },
    });
    expect(result.message).toMatch(/read-only/);
    expect(suggestion().status).toBe('dismissed');
  });

  it('the live role: a Manager made an Analyst can no longer undo an opportunity change', async () => {
    const row = await dismissOpportunity();
    db.tables.profiles.find((p) => p.id === PEOPLE.manager)!.role = 'analyst';
    expect(await undo(row.id)).toMatchObject({
      code: 'denied',
      denial: { code: 'forbidden_role' },
    });
    expect(opportunity().status).toBe('dismissed');
  });

  it("an Admin's Never on the tool", async () => {
    const row = await dismissPromptSuggestion();
    db.tables.chat_settings = [
      {
        organization_id: ORG,
        tool_policies: { dismissSuggestion: 'never' },
        full_auto_for_members: true,
        dont_ask_again: true,
        manager_execute_off: [],
      },
    ];
    expect(await undo(row.id)).toMatchObject({ code: 'denied', denial: { code: 'policy_never' } });
  });

  it('needs no card, whatever the mode: an Ask policy still undoes', async () => {
    const row = await dismissPromptSuggestion();
    db.tables.chat_settings = [
      {
        organization_id: ORG,
        tool_policies: { dismissSuggestion: 'ask' },
        full_auto_for_members: false,
        dont_ask_again: false,
        manager_execute_off: [],
      },
    ];
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
  });
});

describe('failures', () => {
  it("never throws: a read that fails is 'failed', and nothing is undone", async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const row = await dismissPromptSuggestion();
    db.failures.chat_activity_log = { message: 'connection reset' };
    expect(await undo(row.id)).toEqual({
      code: 'failed',
      message: 'Something went wrong, so nothing was undone. Try again.',
    });
    delete db.failures.chat_activity_log;
    expect(suggestion().status).toBe('dismissed');
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
    errors.mockRestore();
  });

  it('the brand is found again as the tool finds it: a target moved out of the workspace is refused', async () => {
    const row = await dismissPromptSuggestion();
    suggestion().brand_id = '77777777-7777-4777-8777-777777777777';
    expect(await undo(row.id)).toMatchObject({ code: 'denied', denial: { code: 'brand_scope' } });
    expect(suggestion().status).toBe('dismissed');
  });
});

describe('a double-clicked Undo', () => {
  it('undoes once and answers both clicks the same', async () => {
    const row = await saveDraft();
    const [a, b] = await Promise.all([undo(row.id), undo(row.id)]);
    expect(a).toMatchObject({ code: 'ok' });
    expect(b).toEqual(a);
    expect(db.tables.chat_activity_log.filter((r) => r.undoes_id === row.id)).toHaveLength(1);
  });
});

describe('request_access: withdraw it while it waits', () => {
  const rule = UNDO_RULES.request_access;
  const REQUEST = '66666666-6666-4666-8666-666666666666';

  it('records the request it sent, and nothing to undo for one it refused', async () => {
    const sent = await rule.record({ asked: 'Change my role' }, { ok: true, id: REQUEST }, null);
    expect(sent).toMatchObject({
      target: { type: 'access_request', id: REQUEST },
      summaryParams: { asked: 'Change my role' },
    });
    expect(sent.undo).not.toBeNull();
    const refused = await rule.record({ asked: 'x' }, { ok: false, reason: 'too_many' }, null);
    expect(refused).toMatchObject({ target: { id: null }, undo: null });
  });

  it('withdraws a waiting request, and leaves one an Admin decided', async () => {
    db.tables.chat_access_requests = [
      { id: REQUEST, status: 'pending', decided_at: null },
      { id: OPPORTUNITY, status: 'approved', decided_at: '2026-10-29T00:00:00Z' },
    ];
    expect(await rule.inverse({ id: REQUEST, brandId: null, data: {} })).toBe('ok');
    expect(db.tables.chat_access_requests[0]).toMatchObject({ status: 'withdrawn' });
    expect(db.tables.chat_access_requests[0].decided_at).toEqual(expect.any(String));
    expect(await rule.inverse({ id: OPPORTUNITY, brandId: null, data: {} })).toBe('changed');
    expect(db.tables.chat_access_requests[1]).toMatchObject({ status: 'approved' });
    expect(await rule.inverse({ id: SUGGESTION, brandId: null, data: {} })).toBe('gone');
  });
});

describe('the tracking setup: prompts, topics and competitors (W2-06)', () => {
  const prompt = (id: unknown) => db.tables.prompts.find((row) => row.id === id)!;
  const topicNamed = (name: string) => db.tables.topics.find((row) => row.name === name);

  it('add_prompts: pauses the prompts it added, and only those', async () => {
    const row = await change(PEOPLE.manager, 'add_prompts', {
      brand_id: BRAND,
      topic_id: TOPIC,
      prompts: ['crm for agencies', 'crm for law firms'],
    });
    expect(row).toMatchObject({
      target_type: 'topic',
      target_id: TOPIC,
      summary_key: 'trackPrompts',
      summary_params: { topic: 'Pricing', prompts: '“crm for agencies”, “crm for law firms”' },
    });
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
    const added = db.tables.prompts.filter((p) => p.id !== PROMPT);
    expect(added.map((p) => p.is_active)).toEqual([false, false]);
    expect(prompt(PROMPT).is_active).toBe(true);
    expect(logRow(row.id).status).toBe('undone');
  });

  it('add_prompts: a conflict once someone paused them since', async () => {
    const row = await change(PEOPLE.manager, 'add_prompts', {
      brand_id: BRAND,
      topic_id: TOPIC,
      prompts: ['crm for agencies'],
    });
    for (const p of db.tables.prompts) if (p.id !== PROMPT) p.is_active = false;
    expect(await undo(row.id)).toMatchObject({
      code: 'conflict',
      reason: 'changed',
      href: `/dashboard/prompts/topics/${TOPIC}`,
    });
  });

  it('pause_prompts: resumes what it paused while the plan has room, and not past it', async () => {
    db.rpcs.org_prompt_location_usage = () => [{ brand_id: BRAND, locations: 0 }];
    const row = await change(PEOPLE.manager, 'pause_prompts', {
      brand_id: BRAND,
      prompt_ids: [PROMPT],
    });
    expect(prompt(PROMPT).is_active).toBe(false);
    expect(row).toMatchObject({ summary_key: 'pauseTracking', target_id: PROMPT });
    // The plan's locations filled up since: nothing is resumed, and it says why (§11a).
    db.rpcs.org_prompt_location_usage = () => [{ brand_id: BRAND, locations: 200 }];
    const full = await undo(row.id);
    expect(full).toMatchObject({ code: 'quota_exceeded' });
    expect(full.message).toContain('active prompt locations');
    expect(prompt(PROMPT).is_active).toBe(false);
    expect(logRow(row.id).status).toBe('done');
    db.rpcs.org_prompt_location_usage = () => [{ brand_id: BRAND, locations: 0 }];
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
    expect(prompt(PROMPT).is_active).toBe(true);
  });

  it('add_topic: takes the topic away, unless prompts were tracked in it since', async () => {
    const row = await change(PEOPLE.manager, 'add_topic', {
      brand_id: BRAND,
      name: 'Integrations',
    });
    const added = topicNamed('Integrations')!;
    expect(row).toMatchObject({ target_type: 'topic', target_id: added.id });
    db.tables.prompts.push({
      id: 'p2',
      prompt_set_id: 'set',
      text: 'crm zapier',
      topic_id: added.id,
      is_active: true,
    });
    expect(await undo(row.id)).toMatchObject({ code: 'conflict', reason: 'changed' });
    expect(topicNamed('Integrations')).toBeDefined();
    db.tables.prompts = db.tables.prompts.filter((p) => p.id !== 'p2');
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
    expect(topicNamed('Integrations')).toBeUndefined();
  });

  it('add_topic then add_prompts: undone in either order', async () => {
    const topicRow = await change(PEOPLE.manager, 'add_topic', {
      brand_id: BRAND,
      name: 'Billing',
    });
    const billing = topicNamed('Billing')!;
    const promptsRow = await change(PEOPLE.manager, 'add_prompts', {
      brand_id: BRAND,
      topic_id: billing.id,
      prompts: ['crm invoicing'],
    });
    // The prompts first: paused, they don't hold the topic.
    expect(await undo(promptsRow.id)).toMatchObject({ code: 'ok' });
    expect(await undo(topicRow.id)).toMatchObject({ code: 'ok' });
    expect(topicNamed('Billing')).toBeUndefined();
  });

  it('rename_topic: puts the name back, unless it was renamed again since', async () => {
    const row = await change(PEOPLE.manager, 'rename_topic', {
      topic_id: TOPIC,
      name: 'Pricing and plans',
    });
    expect(row.summary_params).toEqual({ from: 'Pricing', to: 'Pricing and plans' });
    db.tables.topics[0].name = 'Plans';
    expect(await undo(row.id)).toMatchObject({ code: 'conflict', reason: 'changed' });
    db.tables.topics[0].name = 'Pricing and plans';
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
    expect(db.tables.topics[0].name).toBe('Pricing');
  });

  it('add_competitors: removes the ones it added', async () => {
    const row = await change(PEOPLE.manager, 'add_competitors', {
      brand_id: BRAND,
      competitors: [{ name: 'Profound', domain: 'tryprofound.com' }],
    });
    expect(row.summary_params).toEqual({ competitors: '“Profound (tryprofound.com)”' });
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
    expect(db.tables.competitors.map((c) => c.name)).toEqual(['Peec AI']);
  });

  it('remove_competitor: brings it back as it was, though its row was gone', async () => {
    const before = { ...db.tables.competitors[0] };
    const row = await change(PEOPLE.manager, 'remove_competitor', {
      brand_id: BRAND,
      competitor_id: COMPETITOR,
    });
    expect(db.tables.competitors).toEqual([]);
    expect(row.summary_params).toEqual({ competitor: 'Peec AI (peec.ai)' });
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
    expect(db.tables.competitors).toMatchObject([before]);
  });

  it('remove_competitor: opens its actions’ links again, which its removal closed', async () => {
    db.tables.actions = [{ id: 'a1', brand_id: BRAND }];
    db.tables.action_entities = [
      {
        action_id: 'a1',
        entity_type: 'competitors',
        entity_key: COMPETITOR,
        removed_at: null,
        removed_reason: null,
      },
    ];
    const row = await change(PEOPLE.manager, 'remove_competitor', {
      brand_id: BRAND,
      competitor_id: COMPETITOR,
    });
    // As 00244's trigger does on delete.
    Object.assign(db.tables.action_entities[0], {
      removed_at: '2026-10-30T10:00:00.000Z',
      removed_reason: 'deleted',
    });
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
    expect(db.tables.action_entities[0]).toMatchObject({ removed_at: null, removed_reason: null });
  });

  it('remove_competitor: a conflict once the domain was added again, written any way', async () => {
    const row = await change(PEOPLE.manager, 'remove_competitor', {
      brand_id: BRAND,
      competitor_id: COMPETITOR,
    });
    db.tables.competitors.push({
      id: 'c2',
      brand_id: BRAND,
      name: 'Peec',
      domain: 'https://www.Peec.ai/',
    });
    expect(await undo(row.id)).toMatchObject({
      code: 'conflict',
      reason: 'changed',
      href: '/dashboard/competitors',
    });
    expect(db.tables.competitors).toHaveLength(1);
  });

  it('logs nothing for a change the action refused: nothing changed', async () => {
    const outcome = await runLoggedWrite({
      tool: chatTool('remove_competitor')!,
      input: { brand_id: BRAND, competitor_id: SUGGESTION },
      ctx: {} as never,
      organizationId: ORG,
      userId: PEOPLE.manager,
      brandId: BRAND,
      surface: 'chat',
      mode: 'auto',
      approval: { kind: 'ask' },
      place: { conversationId: null, runId: null, stepId: null },
      approvalKey: `step-${++step}`,
    });
    expect(outcome).toMatchObject({ code: 'ok', activityId: null, output: { ok: false } });
    expect(db.tables.chat_activity_log).toEqual([]);
  });

  it('an Analyst can’t undo a Manager’s setup change, as they can’t make one', async () => {
    const row = await change(PEOPLE.analyst, 'add_topic', { brand_id: BRAND, name: 'Security' });
    expect(await undo(row.id, PEOPLE.analyst)).toMatchObject({ code: 'denied' });
    expect(topicNamed('Security')).toBeDefined();
  });
});

describe('content, reports and Site Audit (W2-07)', () => {
  const theDraft = () => db.tables.content_drafts.find((row) => row.id === DRAFT)!;
  beforeEach(() => seedDraft(db));

  it('update_draft: puts the page before back from History', async () => {
    const row = await change(PEOPLE.manager, 'update_draft', {
      draft_id: DRAFT,
      title: 'Pricing FAQ for teams',
      body_html: '<h1>Pricing FAQ for teams</h1><p>New.</p>',
    });
    expect(row).toMatchObject({
      target_type: 'content_draft',
      target_id: DRAFT,
      summary_key: 'reviseDraft',
      summary_params: { title: 'Pricing FAQ for teams' },
    });
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
    expect(theDraft()).toMatchObject({ title: 'Pricing FAQ', body_html: '<h1>Pricing FAQ</h1>' });
  });

  it('update_draft: leaves a page edited since alone, and links it', async () => {
    const row = await change(PEOPLE.manager, 'update_draft', {
      draft_id: DRAFT,
      body_html: '<h1>Pricing FAQ</h1><p>New.</p>',
    });
    theDraft().body_html = '<h1>Pricing FAQ</h1><p>Edited by hand.</p>';
    expect(await undo(row.id)).toMatchObject({
      code: 'conflict',
      reason: 'changed',
      href: `/dashboard/content/editor/${DRAFT}`,
    });
    expect(theDraft().body_html).toContain('Edited by hand.');
  });

  it('update_draft: keeps the page now in History, then restores only over the page it read', async () => {
    const row = await change(PEOPLE.manager, 'update_draft', {
      draft_id: DRAFT,
      body_html: '<h1>Pricing FAQ</h1><p>New.</p>',
    });
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
    // History has the page Chat made, kept before the Undo, as a restore does.
    expect(db.tables.content_draft_versions.at(-1)).toMatchObject({
      draft_id: DRAFT,
      body_html: '<h1>Pricing FAQ</h1><p>New.</p>',
      origin: 'restore',
    });
  });

  it('update_draft: leaves a page the agent is writing, or one saved in between, alone', async () => {
    const row = await change(PEOPLE.manager, 'update_draft', {
      draft_id: DRAFT,
      body_html: '<h1>Pricing FAQ</h1><p>New.</p>',
    });
    theDraft().agent_state = 'writing';
    expect(await undo(row.id)).toMatchObject({ code: 'conflict', reason: 'changed' });
    theDraft().agent_state = null;
    // A save lands while the Undo keeps the page now: the save wins.
    db.rpcs.content_draft_keep_version = () => {
      theDraft().updated_at = '2099-01-01T00:00:00.000Z';
      return 'version-x';
    };
    expect(await undo(row.id)).toMatchObject({ code: 'conflict', reason: 'changed' });
    expect(theDraft().body_html).toContain('New.');
  });

  it('update_draft: brings back only a version of this draft, within History’s 90 days', async () => {
    const row = await change(PEOPLE.manager, 'update_draft', {
      draft_id: DRAFT,
      body_html: '<h1>Pricing FAQ</h1><p>New.</p>',
    });
    const version = db.tables.content_draft_versions[0];
    version.draft_id = '99999999-9999-4999-8999-999999999999';
    expect(await undo(row.id)).toMatchObject({ code: 'conflict', reason: 'gone' });
    version.draft_id = DRAFT;
    version.created_at = new Date(Date.now() - 91 * DAY).toISOString();
    expect(await undo(row.id)).toMatchObject({ code: 'conflict', reason: 'gone' });
    expect(theDraft().body_html).toContain('New.');
  });

  it('build_report: takes the report out of Reports', async () => {
    const row = await change(PEOPLE.manager, 'build_report', {
      brand_id: BRAND,
      template: 'weekly_visibility',
      date_from: '2026-10-01',
      date_to: '2026-10-07',
    });
    expect(row.summary_params).toEqual({ title: 'Weekly Visibility Summary' });
    expect(await undo(row.id)).toMatchObject({ code: 'ok' });
    expect(db.tables.reports).toEqual([]);
  });

  it('push_cms_draft: names the CMS in Activity as the app does, never its key', async () => {
    const row = await change(PEOPLE.manager, 'push_cms_draft', {
      draft_id: DRAFT,
      destination: 'wordpress',
    });
    expect(row.summary_params).toEqual({ title: 'Pricing FAQ', cms: 'WordPress' });
  });

  it.each([
    ['push_cms_draft', { draft_id: DRAFT, destination: 'webflow' }],
    ['run_site_audit', { brand_id: BRAND, urls: ['https://acme.example/pricing'] }],
  ])('%s: recorded, with no Undo (§9)', async (name, input) => {
    const row = await change(PEOPLE.manager, name, input);
    expect(row).toMatchObject({ undo_json: null, undo_until: null });
    expect(await undo(row.id)).toMatchObject({ code: 'not_undoable' });
  });
});
