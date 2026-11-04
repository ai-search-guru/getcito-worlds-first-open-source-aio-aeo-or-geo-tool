// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '../testing/fakeSupabase';
import { BRAND, ORG, PEOPLE, seedWorkspace } from '../testing/chatFixtures';
import { planFactsFromOrgRow } from '../planFacts';

/**
 * Making a scheduled job from its card (CHAT-12 items 1–9; W3-02): read on
 * the person's clock, checked for them now (an Admin or a Manager, a skill
 * that's on, room in the plan's active jobs) and written as theirs, its
 * first run set, Auto · Normal. A refusal writes nothing and says why.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('../testing/fakeSupabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const store = await import('./store');

const IST = 'Europe/Istanbul';
// Friday 16 October 2026, 14:00 in Istanbul.
const NOW = new Date('2026-10-16T11:00:00.000Z');
const maker = (userId: string = PEOPLE.manager) => ({
  userId,
  organizationId: ORG,
  timezone: IST,
  runId: null,
});
const job = (over: Partial<Parameters<typeof store.createSchedule>[1]> = {}) => ({
  title: 'Weekly visibility report',
  when: 'every Monday at 9:00',
  skill: 'report',
  prompt: 'Summarise last week for the team',
  brandId: BRAND,
  deliver: 'chat' as const,
  changeOnly: true,
  ...over,
});
const jobs = () => db.tables.chat_schedules;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  seedWorkspace(db);
  db.tables.chat_schedules = [];
});

describe('createSchedule', () => {
  it('makes a recurring job as its maker: its rule, zone, first slot, Auto · Normal', async () => {
    const made = await store.createSchedule(maker(), job(), NOW);
    expect(made).toMatchObject({
      ok: true,
      title: 'Weekly visibility report',
      when: 'Every Monday, 09:00 · Europe/Istanbul',
      next_run_at: '2026-10-19T06:00:00.000Z',
      deliver: 'Chat',
      ready_by: false,
    });
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]).toMatchObject({
      organization_id: ORG,
      kind: 'recurring',
      run_mode: 'run_at',
      due_at: null,
      next_run_at: '2026-10-19T06:00:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
      timezone: IST,
      skill_name: 'report',
      prompt: 'Summarise last week for the team',
      brand_id: BRAND,
      created_by: PEOPLE.manager,
      deliver_to: ['chat'],
      recipient_ids: [],
      change_only: true,
      mode: 'auto',
      model: 'auto',
      effort: 'normal',
      created_via: 'card',
    });
    expect(store.madeStep(made as never)).toEqual({
      label: 'Scheduled: Weekly visibility report',
      detail: 'Every Monday, 09:00 · Europe/Istanbul · Chat',
    });
  });

  it('starts a ready-by job now and keeps its due time; change-only stays off a one-time job', async () => {
    const made = await store.createSchedule(
      maker(),
      job({ when: 'Have it ready by Monday', deliver: 'both' }),
      NOW,
    );
    expect(made).toMatchObject({ ok: true, ready_by: true, deliver: 'Chat + Email' });
    expect(jobs()[0]).toMatchObject({
      kind: 'once',
      run_mode: 'ready_by',
      due_at: '2026-10-19T06:00:00.000Z',
      next_run_at: NOW.toISOString(),
      rrule: null,
      change_only: false,
      deliver_to: ['chat', 'email'],
    });
    expect(store.madeStep(made as never).detail).toBe(
      'Due Mon 19 Oct, 09:00 · Europe/Istanbul · Starts now · Chat + Email',
    );
  });

  it('refuses, writing nothing, a phrase that could mean two dates, with what to ask', async () => {
    const made = await store.createSchedule(maker(), job({ when: 'next Friday' }), NOW);
    expect(made).toMatchObject({ ok: false, reason: 'invalid' });
    expect((made as { message: string }).message).toContain('“23 Oct 2026 at 09:00”');
    expect((made as { message: string }).message).toContain('“30 Oct 2026 at 09:00”');
    expect(jobs()).toEqual([]);
  });

  it('refuses an Analyst, a skill that is not on and a phrase that passed', async () => {
    expect(await store.createSchedule(maker(PEOPLE.analyst), job(), NOW)).toMatchObject({
      ok: false,
      reason: 'forbidden_role',
    });
    expect(await store.createSchedule(maker(), job({ skill: 'no-such-skill' }), NOW)).toMatchObject(
      { ok: false, reason: 'not_found' },
    );
    expect(await store.createSchedule(maker(), job({ when: 'today at 9' }), NOW)).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: expect.stringContaining('has passed'),
    });
    expect(jobs()).toEqual([]);
  });

  it('keeps to the plan’s active jobs: a trial has one, and follow-up checks don’t count', async () => {
    db.tables.organizations[0] = {
      ...db.tables.organizations[0],
      plan: 'starter',
      subscription_status: 'trialing',
    };
    db.tables.chat_schedules.push({
      id: 'check-1',
      organization_id: ORG,
      kind: 'followup_check',
      enabled: true,
    });
    expect(await store.createSchedule(maker(), job(), NOW)).toMatchObject({ ok: true });
    const second = await store.createSchedule(maker(), job({ title: 'Another' }), NOW);
    expect(second).toMatchObject({ ok: false, reason: 'quota_exceeded' });
    expect((second as { message: string }).message).toContain('up to 1 scheduled jobs');
    // One turned off makes room again.
    jobs().find((j) => j.kind === 'recurring')!.enabled = false;
    expect(await store.createSchedule(maker(), job({ title: 'Another' }), NOW)).toMatchObject({
      ok: true,
    });
  });

  it('leaves a one-time job that has run out of the count: nothing is due on it', async () => {
    db.tables.organizations[0] = {
      ...db.tables.organizations[0],
      plan: 'starter',
      subscription_status: 'trialing',
    };
    expect(
      await store.createSchedule(maker(), job({ when: 'tomorrow at 3pm', changeOnly: false }), NOW),
    ).toMatchObject({ ok: true });
    expect(await store.countActiveSchedules(ORG)).toBe(1);
    // The worker ran it: still on, its next run cleared.
    jobs()[0].next_run_at = null;
    expect(await store.countActiveSchedules(ORG)).toBe(0);
    // One waiting on its retry still counts.
    jobs()[0].retry_at = '2026-10-17T12:00:00.000Z';
    expect(await store.countActiveSchedules(ORG)).toBe(1);
    jobs()[0].retry_at = null;
    expect(await store.createSchedule(maker(), job(), NOW)).toMatchObject({ ok: true });
  });

  it('makes one of two made at once when one place is left, and undoes the other', async () => {
    db.tables.organizations[0] = {
      ...db.tables.organizations[0],
      plan: 'starter',
      subscription_status: 'trialing',
    };
    const made = await Promise.all([
      store.createSchedule(maker(), job(), NOW),
      store.createSchedule(maker(), job({ title: 'Another' }), NOW),
    ]);
    expect(made.filter((m) => m.ok)).toHaveLength(1);
    expect(made.filter((m) => !m.ok)).toEqual([
      expect.objectContaining({ ok: false, reason: 'quota_exceeded' }),
    ]);
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0].id).toBe((made.find((m) => m.ok) as { schedule_id: string }).schedule_id);
  });
});

describe('activeScheduleLimit', () => {
  it('is 1 in the trial, 5 · 25 · 100 by plan, the contract’s on Enterprise, none self-hosted', () => {
    const facts = (row: Record<string, unknown>) => planFactsFromOrgRow(row as never);
    expect(
      store.activeScheduleLimit(facts({ plan: 'growth', subscription_status: 'trialing' })),
    ).toBe(1);
    expect(
      store.activeScheduleLimit(facts({ plan: 'starter', subscription_status: 'active' })),
    ).toBe(5);
    expect(
      store.activeScheduleLimit(facts({ plan: 'growth', subscription_status: 'active' })),
    ).toBe(25);
    expect(
      store.activeScheduleLimit(facts({ plan: 'enterprise', subscription_status: 'active' })),
    ).toBe(100);
    expect(
      store.activeScheduleLimit(
        facts({
          plan: 'enterprise',
          subscription_status: 'active',
          plan_overrides: { maxActiveSchedules: 250 },
        }),
      ),
    ).toBe(250);
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(store.activeScheduleLimit(facts({ plan: 'self_hosted' }))).toBeNull();
  });
});
