import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { ACTION_PLAN, actionCenter, actionCenterRows, PAGE_STEPS, PRESET_KPIS, presetTarget } =
  await import('./actionCenter.js');
const { coreRows } = await import('./core.js');
const { demoId } = await import('./random.js');
const { loadDefinitions } = await import('../action-center/definitions/index.js');

/**
 * The demo brand's Action Center (demo-workflows): a month of actions raised
 * from signals counted on the demo's own answers, in the engine's shapes.
 */

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-10-28T12:00:00Z');
const DAY = 86_400_000;
const rows = await actionCenterRows({ brandId: BRAND_ID, now: NOW });
const core = coreRows({ brandId: BRAND_ID, now: NOW });
const count = (list, key) =>
  list.reduce((acc, row) => ({ ...acc, [row[key]]: (acc[row[key]] ?? 0) + 1 }), {});

describe('actionCenterRows', () => {
  it('raises nine actions across the families, in every status', () => {
    expect(rows.actions).toHaveLength(ACTION_PLAN.length + 1);
    expect(count(rows.actions, 'status')).toEqual({
      new: 2,
      in_progress: 2,
      completed: 4,
      dismissed: 1,
    });
    expect(new Set(rows.actions.map((a) => a.category))).toEqual(
      new Set(['growth', 'protect', 'recover', 'compete']),
    );
    for (const a of rows.actions) {
      expect(a.priority_score).toBeGreaterThanOrEqual(0);
      expect(a.priority_score).toBeLessThanOrEqual(100);
      expect(['critical', 'high', 'medium', 'low']).toContain(a.priority_level);
    }
  });

  it('measures what it closed: improved, no meaningful change, and one still pending', () => {
    const closed = rows.actions.filter((a) => a.status === 'completed');
    expect(count(closed, 'outcome')).toEqual({
      improved: 2,
      no_meaningful_change: 1,
      pending_measurement: 1,
    });
    for (const a of closed.filter((x) => x.outcome !== 'pending_measurement')) {
      expect(a.validation.metrics.length).toBeGreaterThan(0);
      expect(a.validation.afterWindow.to < a.validated_at.slice(0, 10)).toBe(true);
      expect(a.validation.signals).toMatchObject({ total: 1, ended: 1 });
      expect(rows.events).toContainEqual(
        expect.objectContaining({ action_id: a.id, event: 'outcome_measured' }),
      );
    }
  });

  it('builds each action from a real definition, with its planned tasks', async () => {
    const definitions = await loadDefinitions();
    for (const a of rows.actions) {
      if (a.kind === 'content_opportunity') continue;
      const definition = definitions.find((d) => d.id === a.kind);
      expect(definition, a.kind).toBeTruthy();
      expect(a.category).toBe(definition.category);
      expect(a.definition_version).toBe(definition.version);
    }
    for (const a of rows.actions) {
      const tasks = rows.tasks.filter((t) => t.action_id === a.id);
      expect(tasks.length, a.kind).toBeGreaterThan(3);
      expect(tasks.map((t) => t.position)).toEqual(tasks.map((_, i) => i + 1));
      if (a.status === 'completed') expect(tasks.every((t) => t.status === 'completed')).toBe(true);
      if (a.status === 'new') expect(tasks.every((t) => t.status === 'todo')).toBe(true);
      if (a.status === 'in_progress') {
        expect(tasks.filter((t) => t.status === 'in_progress')).toHaveLength(1);
      }
    }
  });

  it('ties its signals, prompts and competitors to the core rows', () => {
    const actionIds = new Set(rows.actions.map((a) => a.id));
    const promptIds = new Set(core.prompts.map((p) => p.id));
    for (const s of rows.signals) {
      expect(s.brand_id).toBe(BRAND_ID);
      expect(actionIds.has(s.action_id)).toBe(true);
      expect(rows.links).toContainEqual(
        expect.objectContaining({ action_id: s.action_id, signal_id: s.id }),
      );
    }
    const promptTargets = rows.actions
      .filter((a) => a.payload.targetEntity === 'prompts')
      .flatMap((a) => [
        ...(a.payload.targets ?? []).filter((t) => typeof t === 'object').map((t) => t.id),
        ...(a.payload.promptIds ?? []),
      ]);
    expect(promptTargets.length).toBeGreaterThan(0);
    for (const id of promptTargets) expect(promptIds.has(id)).toBe(true);

    const leads = rows.signals.find((s) => s.kind === 'competitor_leads');
    expect(leads.payload.competitorId).toBe(core.competitors[0].id);
    expect(leads.current_value).toBeGreaterThan(leads.previous_value);
    for (const t of rows.tasks) expect(actionIds.has(t.action_id)).toBe(true);
    for (const e of rows.events) expect(actionIds.has(e.action_id)).toBe(true);
    expect(rows.reviews).toHaveLength(1);
    expect(actionIds.has(rows.reviews[0].action_id)).toBe(true);
  });

  it('dates everything within the demo’s month, before now', () => {
    const stamps = [
      ...rows.actions.flatMap((a) => [a.created_at, a.updated_at, a.completed_at]),
      ...rows.signals.flatMap((s) => [s.detected_at, s.last_detected_at, s.resolved_at]),
      ...rows.tasks.map((t) => t.updated_at),
      ...rows.events.map((e) => e.created_at),
    ].filter(Boolean);
    for (const at of stamps) {
      expect(Date.parse(at)).toBeLessThanOrEqual(NOW.getTime());
      expect(NOW.getTime() - Date.parse(at)).toBeLessThan(31 * DAY);
    }
  });

  it('is the same every time but for its dates, under its own brand’s ids', async () => {
    const later = await actionCenterRows({
      brandId: BRAND_ID,
      now: new Date(NOW.getTime() + 2 * DAY + 5 * 3_600_000),
    });
    const shape = (list) =>
      list.map(({ kind, status, outcome, payload }) => ({ kind, status, outcome, payload }));
    expect(shape(later.actions)).toEqual(shape(rows.actions));
    expect(rows.actions[0].id).toBe(demoId(BRAND_ID, `action:${ACTION_PLAN[0].key}`));
  });

  it('sets up the ready-made KPIs, so the KPI tab never seeds them', () => {
    expect(rows.kpis.map((k) => k.kpi_key)).toEqual(PRESET_KPIS);
    for (const k of rows.kpis) {
      expect(k).toMatchObject({ brand_id: BRAND_ID, timeframe: 'monthly', is_active: true });
      expect(k.target).toBeGreaterThan(0);
    }
    expect(presetTarget('ai_visibility', 50.24)).toBe(60.3);
    expect(presetTarget('positive_sentiment', 90)).toBe(100);
    expect(presetTarget('mentions', 391)).toBe(470);
    expect(Date.parse(rows.kpiSetupAt)).toBeLessThan(NOW.getTime());
  });

  it('runs Getting started with its KPI step done and every page step opened', () => {
    expect(rows.gettingStarted).toEqual([
      expect.objectContaining({ brand_id: BRAND_ID, dismissed_at: null }),
    ]);
    expect(rows.gettingStarted[0].confirmed_at).toBeTruthy();
    const states = Object.fromEntries(rows.gettingStartedSteps.map((s) => [s.step, s.state]));
    expect(states.kpis).toBe('done');
    for (const step of PAGE_STEPS) expect(states[step], step).toBe('opened');
    for (const s of rows.gettingStartedSteps) expect(s.step).toMatch(/^[a-z_]{1,40}$/);
  });
});

describe('actionCenter.build', () => {
  it('writes actions before the signals pointing at them, then what hangs off them', async () => {
    const written = [];
    const keys = {};
    const db = {
      from: (table) => ({
        upsert: async (list, { onConflict }) => {
          written.push([table, list.length]);
          keys[table] = onConflict;
          return { error: null };
        },
        update: (patch) => ({
          eq: async (column, value) => {
            written.push([`${table}:update`, { patch, [column]: value }]);
            return { error: null };
          },
        }),
      }),
    };
    const built = await actionCenter.build({ brandId: BRAND_ID, now: NOW, db });
    const order = written.map(([table]) => table);
    // The brand reads as set up before its KPIs land.
    expect(order[0]).toBe('brands:update');
    expect(written[0][1]).toEqual({ patch: { kpi_setup_at: rows.kpiSetupAt }, id: BRAND_ID });
    expect(order.indexOf('actions')).toBeLessThan(order.indexOf('signals'));
    expect(order.indexOf('signals')).toBeLessThan(order.indexOf('action_signals'));
    expect(order).toContain('action_task_reviews');
    expect(built).toEqual({ signals: 8, actions: 9, tasks: rows.tasks.length });
    for (const table of actionCenter.tables) expect(order).toContain(table);
    // Written over by key: what a new brand's trigger made, and an old build's rows.
    expect(keys).toMatchObject({
      actions: 'id',
      getting_started: 'brand_id',
      getting_started_steps: 'brand_id,step',
      action_signals: 'action_id,signal_id',
    });
  });
});
