import { fakeId, type FakeSupabase } from './fakeSupabase';

/**
 * A workspace for the activity log, Undo and idempotency tests: two
 * organizations, people in each role, a brand, an opportunity, a prompt
 * suggestion, a topic with a tracked prompt and a competitor, and stand-ins
 * for the server actions Chat's WRITE rows call, writing to the same tables.
 * Tests only.
 */

export const ORG = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORG = '99999999-9999-4999-8999-999999999999';
export const BRAND = '22222222-2222-4222-8222-222222222222';
export const OPPORTUNITY = '44444444-4444-4444-8444-444444444444';
export const SUGGESTION = '55555555-5555-4555-8555-555555555555';
export const TOPIC = '66666666-6666-4666-8666-666666666661';
export const PROMPT_SET = '66666666-6666-4666-8666-666666666662';
export const PROMPT = '66666666-6666-4666-8666-666666666663';
export const COMPETITOR = '66666666-6666-4666-8666-666666666664';
export const DRAFT = '66666666-6666-4666-8666-666666666665';

export const PEOPLE = {
  admin: 'aaaaaaaa-0000-4000-8000-000000000001',
  manager: 'aaaaaaaa-0000-4000-8000-000000000002',
  analyst: 'aaaaaaaa-0000-4000-8000-000000000003',
  otherManager: 'aaaaaaaa-0000-4000-8000-000000000004',
} as const;

const iso = () => new Date().toISOString();

export function seedWorkspace(db: FakeSupabase): void {
  db.failures = {};
  db.log = [];
  db.unique = { chat_idempotency_keys: [['organization_id', 'key']] };
  db.defaults = {
    chat_activity_log: () => ({
      status: 'done',
      undone_at: null,
      undone_by: null,
      undoes_id: null,
      created_at: iso(),
    }),
    chat_idempotency_keys: () => ({ created_at: iso() }),
  };
  db.tables = {
    // Everyone starts with All brands (00388), as profiles.brand_scope's default.
    profiles: [
      { id: PEOPLE.admin, role: 'admin', organization_id: ORG, brand_scope: 'all' },
      { id: PEOPLE.manager, role: 'manager', organization_id: ORG, brand_scope: 'all' },
      { id: PEOPLE.analyst, role: 'analyst', organization_id: ORG, brand_scope: 'all' },
      { id: PEOPLE.otherManager, role: 'manager', organization_id: ORG, brand_scope: 'all' },
    ],
    organizations: [
      { id: ORG, plan: 'growth', subscription_status: 'active', plan_overrides: null },
      { id: OTHER_ORG, plan: 'growth', subscription_status: 'active', plan_overrides: null },
    ],
    brands: [{ id: BRAND, organization_id: ORG }],
    chat_settings: [],
    chat_auto_choices: [],
    chat_activity_log: [],
    chat_idempotency_keys: [],
    content_drafts: [],
    content_opportunities: [
      {
        id: OPPORTUNITY,
        brand_id: BRAND,
        title: 'Pricing page for teams',
        status: 'new',
        source_data: { volume: 1200 },
        updated_at: '2026-10-28T10:00:00.000Z',
      },
    ],
    prompt_suggestions: [
      {
        id: SUGGESTION,
        brand_id: BRAND,
        suggested_text: 'best crm for startups',
        status: 'new',
        updated_at: '2026-10-28T10:00:00.000Z',
      },
    ],
    topics: [{ id: TOPIC, brand_id: BRAND, name: 'Pricing', is_active: true }],
    prompt_sets: [{ id: PROMPT_SET, brand_id: BRAND }],
    prompts: [
      {
        id: PROMPT,
        prompt_set_id: PROMPT_SET,
        text: 'crm pricing',
        topic_id: TOPIC,
        is_active: true,
        regions: ['US'],
      },
    ],
    reports: [],
    content_draft_versions: [],
    competitors: [
      {
        id: COMPETITOR,
        brand_id: BRAND,
        name: 'Peec AI',
        domain: 'peec.ai',
        created_at: '2026-10-01T10:00:00.000Z',
      },
    ],
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** createContentDraft: a new draft row, after a moment, as the real one takes. */
export function fakeCreateDraft(db: FakeSupabase) {
  return async (brandId: string, start: { title: string }) => {
    await sleep(5);
    const id = fakeId();
    db.tables.content_drafts.push({
      id,
      brand_id: brandId,
      title: start.title,
      body_html: `<h1>${start.title}</h1>`,
      status: 'draft',
      archived_at: null,
      updated_at: iso(),
    });
    return id;
  };
}

/** updateOpportunityStatus: the server's PATCH, reason in source_data. */
export function fakeUpdateOpportunity(db: FakeSupabase) {
  return async (id: string, status: string, reason?: string) => {
    const row = db.tables.content_opportunities.find((r) => r.id === id);
    if (!row) throw new Error('Opportunity not found');
    const rest = { ...(row.source_data as Record<string, unknown>) };
    delete rest.dismissReason;
    row.status = status;
    row.source_data = status === 'dismissed' && reason ? { ...rest, dismissReason: reason } : rest;
    row.updated_at = iso();
    return { ...row };
  };
}

/** dismissSuggestion: the server's POST …/dismiss. */
export function fakeDismissSuggestion(db: FakeSupabase) {
  return async (id: string) => {
    const row = db.tables.prompt_suggestions.find((r) => r.id === id);
    if (!row) throw new Error('Not found');
    row.status = 'dismissed';
    row.updated_at = iso();
    return { success: true };
  };
}

/** addTopicPrompts: each new text tracked in the topic, active, at one location. */
export function fakeAddTopicPrompts(db: FakeSupabase) {
  return async (_brandId: string, topicId: string, texts: string[]) => {
    const added = texts.map((text) => {
      const id = fakeId();
      db.tables.prompts.push({
        id,
        prompt_set_id: PROMPT_SET,
        text,
        topic_id: topicId,
        is_active: true,
        regions: ['US'],
      });
      return { id, text };
    });
    return { ok: true, code: 'ok', added, skipped: [], analysisStarted: false };
  };
}

/** pauseBrandPrompts: the prompts paused. */
export function fakePauseBrandPrompts(db: FakeSupabase) {
  return async (_brandId: string, ids: string[]) => {
    const rows = db.tables.prompts.filter((row) => ids.includes(row.id as string));
    for (const row of rows) row.is_active = false;
    return { ok: true, paused: rows.map((row) => row.id) };
  };
}

/** addBrandTopic: a new topic. */
export function fakeAddBrandTopic(db: FakeSupabase) {
  return async (brandId: string, name: string) => {
    const topic = { id: fakeId(), brand_id: brandId, name, is_active: true };
    db.tables.topics.push(topic);
    return { ok: true, topic: { id: topic.id, brandId, name, isActive: true, createdAt: iso() } };
  };
}

/** renameBrandTopic: the topic renamed. */
export function fakeRenameBrandTopic(db: FakeSupabase) {
  return async (id: string, name: string) => {
    const row = db.tables.topics.find((r) => r.id === id);
    if (!row)
      return { ok: false, reason: 'not_found', message: "That topic isn't one of this brand's." };
    row.name = name;
    return {
      ok: true,
      topic: { id, brandId: row.brand_id, name, isActive: true, createdAt: iso() },
    };
  };
}

/** addCompetitors: each competitor added. */
export function fakeAddCompetitors(db: FakeSupabase) {
  return async (brandId: string, items: { name: string; domain: string }[]) => {
    const added = items.map((item) => {
      const row = { id: fakeId(), brand_id: brandId, ...item, created_at: iso() };
      db.tables.competitors.push(row);
      return { id: row.id, brandId, name: item.name, domain: item.domain };
    });
    return { ok: true, code: 'ok', added, skipped: [] };
  };
}

/** removeBrandCompetitor: the competitor gone. */
export function fakeRemoveBrandCompetitor(db: FakeSupabase) {
  return async (brandId: string, id: string) => {
    const row = db.tables.competitors.find((r) => r.id === id && r.brand_id === brandId);
    if (!row)
      return {
        ok: false,
        reason: 'not_found',
        message: "That competitor isn't one of this brand's.",
      };
    db.tables.competitors = db.tables.competitors.filter((r) => r.id !== id);
    return { ok: true, removed: { id, brandId, name: row.name, domain: row.domain } };
  };
}

/** A Library draft, for the rows that change or send one (seeded by the tests that need it). */
export function seedDraft(db: FakeSupabase): void {
  db.tables.content_drafts.push({
    id: DRAFT,
    brand_id: BRAND,
    title: 'Pricing FAQ',
    body_html: '<h1>Pricing FAQ</h1>',
    status: 'draft',
    archived_at: null,
    updated_at: iso(),
  });
}

/** updateContentDraft: History keeps the page before, then the change is saved. */
export function fakeUpdateContentDraft(db: FakeSupabase) {
  return async (id: string, change: { title?: string; bodyHtml?: string }) => {
    const row = db.tables.content_drafts.find((r) => r.id === id);
    if (!row)
      return { ok: false, reason: 'not_found', message: 'That draft isn’t in the Library.' };
    const versionId = fakeId();
    db.tables.content_draft_versions.push({
      id: versionId,
      draft_id: id,
      title: row.title,
      body_html: row.body_html,
      origin: 'agent_before',
      created_at: iso(),
    });
    row.title = change.title ?? row.title;
    row.body_html = change.bodyHtml ?? row.body_html;
    row.updated_at = iso();
    return {
      ok: true,
      updatedAt: row.updated_at,
      bodyHash: '0'.repeat(64),
      beforeVersionId: versionId,
    };
  };
}

/** content_draft_keep_version (00215): the draft as it is now, kept as a version. */
export function fakeKeepDraftVersion(db: FakeSupabase) {
  return ({ p_draft_id, p_origin }: Record<string, unknown>) => {
    const draft = db.tables.content_drafts.find((d) => d.id === p_draft_id);
    if (!draft) return null;
    const id = fakeId();
    db.tables.content_draft_versions.push({
      id,
      draft_id: draft.id,
      title: draft.title,
      body_html: draft.body_html,
      origin: p_origin,
      created_at: iso(),
    });
    return id;
  };
}

/** sendDraftToCms: the page sent, as the CMS's draft. */
export function fakeSendDraftToCms() {
  return async (_draftId: string, target: string) => ({
    ok: true,
    target,
    status: 'sent',
    updated: false,
    live: false,
  });
}

/** createReport: a report row. */
export function fakeCreateReport(db: FakeSupabase) {
  return async (brandId: string) => {
    const id = fakeId();
    db.tables.reports.push({ id, brand_id: brandId, title: 'Weekly Visibility Summary' });
    return { id };
  };
}

/** startSiteAudits: an audit started for each page. */
export function fakeStartSiteAudits() {
  return async (_brandId: string, urls: string[]) => ({
    ok: true,
    started: urls.length,
    audits: urls.map((url) => ({ id: fakeId(), url })),
  });
}
