import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { content, contentRows, OPPORTUNITIES, SENT_OPPORTUNITY } = await import('./content.js');
const { actionCenterRows } = await import('./actionCenter.js');
const { coreRows } = await import('./core.js');
const { demoId } = await import('./random.js');
const { scopeFingerprint } = await import('../promptClusters.js');
const { VALID_OPPORTUNITY_STATUSES } = await import('../opportunityStatus.js');

/**
 * The demo brand's Content (demo-workflows): clusters over its prompts,
 * opportunities measured on its answers, Editor drafts and Plan marks.
 */

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-10-28T12:00:00Z');
const DAY = 86_400_000;
const core = coreRows({ brandId: BRAND_ID, now: NOW });
const sentAction = demoId(BRAND_ID, `action:opportunity:${SENT_OPPORTUNITY}`);
const rows = contentRows(
  { brandId: BRAND_ID, now: NOW },
  { actionFor: (key) => (key === SENT_OPPORTUNITY ? sentAction : null) },
);

describe('contentRows', () => {
  it('clusters every tracked prompt once, within its own topic', () => {
    expect(rows.members.map((m) => m.prompt_id).sort()).toEqual(
      core.prompts.map((p) => p.id).sort(),
    );
    const clusterTopic = new Map(rows.clusters.map((c) => [c.id, c.topic_id]));
    for (const m of rows.members) {
      expect(clusterTopic.get(m.cluster_id)).toBe(
        core.prompts.find((p) => p.id === m.prompt_id).topic_id,
      );
    }
    expect(rows.scopes).toHaveLength(core.topics.length);
    for (const s of rows.scopes) {
      const inTopic = core.prompts.filter((p) => p.topic_id === s.topic_id);
      expect(s.fingerprint).toBe(scopeFingerprint(inTopic.map(({ id, text }) => ({ id, text }))));
    }
    const clusterIds = new Set(rows.clusters.map((c) => c.id));
    expect(rows.queries.length).toBeGreaterThan(0);
    for (const q of rows.queries) {
      expect(clusterIds.has(q.cluster_id)).toBe(true);
      expect(q.times_searched).toBeGreaterThanOrEqual(2);
    }
  });

  it('writes ten opportunities in the generator’s shape, across their statuses', () => {
    expect(rows.opportunities).toHaveLength(OPPORTUNITIES.length);
    expect(OPPORTUNITIES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(rows.opportunities.map((o) => o.status))).toEqual(
      new Set(['new', 'reviewed', 'in_progress', 'done', 'dismissed']),
    );
    const clusterIds = new Set(rows.clusters.map((c) => c.id));
    for (const o of rows.opportunities) {
      expect(VALID_OPPORTUNITY_STATUSES).toContain(o.status);
      expect(clusterIds.has(o.cluster_id)).toBe(true);
      expect(core.prompts.some((p) => p.id === o.prompt_id)).toBe(true);
      expect(o.opportunity_score).toBeGreaterThan(0);
      expect(o.opportunity_score).toBeLessThanOrEqual(100);
      expect(o.description).not.toMatch(/undefined|NaN/);
      expect(o.source_data).toMatchObject({
        windowDays: 30,
        assets: expect.any(Array),
        scoreComponents: expect.any(Object),
      });
      expect(o.decision).toBe(o.source_data.assets[0].decision);
      for (const page of o.source_data.targetPages)
        expect(page.url).toMatch(/^https:\/\/brewline\.example\//);
    }
    expect(rows.opportunities.filter((o) => o.type === 'earned')).toHaveLength(2);
  });

  it('opens the agent’s draft in the Editor, linked to the action its opportunity was sent as', () => {
    expect(rows.drafts).toHaveLength(3);
    const agent = rows.drafts.find((d) => d.author === 'agent');
    expect(agent).toMatchObject({ status: 'draft', method: 'create', action_id: sentAction });
    expect(agent.body_html).toMatch(/^<h1>/);
    expect(agent.opportunity_id).toBe(demoId(BRAND_ID, `opportunity:${SENT_OPPORTUNITY}`));
    const sent = rows.opportunities.find((o) => o.id === agent.opportunity_id);
    expect(sent).toMatchObject({
      status: 'in_progress',
      source_data: { actions: { all: sentAction } },
    });

    const published = rows.drafts.find((d) => d.status === 'published');
    expect(published.published_url).toMatch(/^https:\/\/brewline\.example\//);
    for (const d of rows.drafts) {
      for (const id of d.prompt_ids) expect(core.prompts.some((p) => p.id === id)).toBe(true);
      expect(d.body_html).not.toMatch(/https?:\/\/(?![\w.-]+\.example\b)/);
    }
  });

  it('marks its priorities on Plan by opportunity, and dates it all in the month', () => {
    const ids = new Set(rows.opportunities.map((o) => o.id));
    expect(rows.marks.length).toBeGreaterThan(0);
    for (const m of rows.marks) expect(ids.has(m.row_key.replace('opportunity:', ''))).toBe(true);
    for (const at of [...rows.opportunities, ...rows.drafts].map((r) => r.created_at)) {
      expect(Date.parse(at)).toBeLessThanOrEqual(NOW.getTime());
      expect(NOW.getTime() - Date.parse(at)).toBeLessThan(31 * DAY);
    }
  });

  it('matches the action the Action Center sends the opportunity as', async () => {
    const ac = await actionCenterRows({ brandId: BRAND_ID, now: NOW });
    const action = ac.actions.find((a) => a.id === sentAction);
    expect(action).toMatchObject({ kind: 'content_opportunity', status: 'in_progress' });
    expect(action.payload.opportunityId).toBe(demoId(BRAND_ID, `opportunity:${SENT_OPPORTUNITY}`));
    expect(action.payload.promptIds).toEqual([
      core.prompts.find((p) => p.text.includes('sensitive')).id,
    ]);
  });
});

describe('content.build', () => {
  it('writes clusters before what points at them, the drafts after their opportunities', async () => {
    const written = [];
    const keys = {};
    const db = {
      from: (table) => ({
        upsert: async (list, { onConflict }) => {
          written.push([table, list]);
          keys[table] = onConflict;
          return { error: null };
        },
      }),
    };
    const built = await content.build({ brandId: BRAND_ID, now: NOW, db });
    expect(keys).toMatchObject({
      prompt_clusters: 'id',
      prompt_cluster_members: 'prompt_id',
      prompt_cluster_queries: 'cluster_id,query',
      prompt_cluster_scopes: 'brand_id,topic_id',
      content_plan_marks: 'brand_id,row_key',
    });
    const order = written.map(([table]) => table);
    expect(order.indexOf('prompt_clusters')).toBeLessThan(order.indexOf('prompt_cluster_members'));
    expect(order.indexOf('content_opportunities')).toBeLessThan(order.indexOf('content_drafts'));
    expect(built).toEqual({ clusters: 11, opportunities: 10, drafts: 3 });
    const drafts = written.find(([table]) => table === 'content_drafts')[1];
    expect(drafts.find((d) => d.author === 'agent').action_id).toBe(sentAction);
  });
});
