import { describe, expect, it } from 'vitest';
import {
  createBody,
  defaultAgentName,
  draftFromView,
  firstStepWithProblems,
  formFromAgent,
  formFromPreset,
  newForm,
  newTriggerDraft,
  patchBody,
  refusalPlace,
  parseList,
  scopeOf,
  stepProblems,
  syncConnections,
  triggerError,
  triggerInputOf,
  type AgentFormSetup,
  type AgentFormState,
  type FormContext,
  type TriggerDraft,
} from './agentForm';
import { createAgentInput, updateAgentInput } from './agentRules';
import { readyPreset } from './agents/catalog';
import { AGENT_ID, detail } from './testing/agentFixtures';

/**
 * The create-agent flow as data (CHAT-21 §D, CHAT-27 item 19): a new form
 * and Edit's, each step's checks, the bodies the API takes (parsed by the
 * server's own schemas here), only what changed in a PATCH, and the step a
 * refusal belongs to.
 */

const NOW = new Date('2026-10-30T12:00:00Z');
const BRAND = 'bbbbbbbb-0000-4000-8000-000000000001';
const BRAND_2 = 'bbbbbbbb-0000-4000-8000-000000000002';

const SETUP: AgentFormSetup = {
  role: 'manager',
  brands: [
    { id: BRAND, name: 'GetCito' },
    { id: BRAND_2, name: 'Brand B' },
  ],
  topics: [],
  engines: ['chatgpt-web', 'perplexity-web'],
  fullAuto: 'open',
  planName: 'Growth',
  fullAutoPlan: 'Growth',
  workspaceAgentsAdminsOnly: false,
  runShareDefault: 0.1,
  takenNames: [],
  ownKeyProvider: null,
};

const ctxOf = (over: Partial<AgentFormSetup> = {}, agent: FormContext['agent'] = null) => ({
  setup: { ...SETUP, ...over },
  agent,
  now: NOW,
});

const fresh = (over: Partial<AgentFormState> = {}): AgentFormState => ({
  ...newForm(SETUP, { timeZone: 'UTC', brandId: null, skill: 'winback', triggerKey: 'k0' }),
  name: 'Win back',
  ...over,
});

const schedule = (over: Partial<Extract<TriggerDraft, { kind: 'schedule' }>>) =>
  ({ ...newTriggerDraft('schedule', 'k0', 'UTC'), ...over }) as TriggerDraft;

describe('a new agent', () => {
  it('starts on Monday 07:00 on the viewer’s clock, the brand on screen, and its skill’s connections', () => {
    const form = newForm(SETUP, {
      timeZone: 'Europe/Istanbul',
      brandId: BRAND_2,
      skill: 'winback',
      triggerKey: 'k0',
    });
    expect(form.brandIds).toEqual([BRAND_2]);
    expect(form.mode).toBe('auto');
    expect(form.maxRun).toBe('10');
    // /winback writes its drafts without a CMS or Search Console: both Optional.
    expect(form.connections).toEqual([
      { key: 'google_search_console', required: false },
      { key: 'cms', required: false },
    ]);
    expect(triggerInputOf(form.triggers[0])).toEqual({
      kind: 'schedule',
      enabled: true,
      config: {
        type: 'recurring',
        rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0',
        timezone: 'Europe/Istanbul',
      },
    });
    // No brand on screen: the first.
    expect(
      newForm(SETUP, { timeZone: 'UTC', brandId: null, skill: null, triggerKey: 'k' }).brandIds,
    ).toEqual([BRAND]);
  });

  it('is named after its skill, then with its brand, then numbered (§O)', () => {
    expect(defaultAgentName('Win back lost citations', 'GetCito', [])).toBe(
      'Win back lost citations',
    );
    expect(
      defaultAgentName('Win back lost citations', 'GetCito', ['win back LOST citations']),
    ).toBe('Win back lost citations · GetCito');
    expect(
      defaultAgentName('Win back lost citations', 'GetCito', [
        'Win back lost citations',
        'Win back lost citations · GetCito',
      ]),
    ).toBe('Win back lost citations 2');
    expect(defaultAgentName('x'.repeat(70), null, [])).toHaveLength(60);
  });

  it('starts from a ready-to-use agent: its skills, triggers, mode and connections, on the brand on screen', () => {
    const preset = readyPreset('visibility-watch')!;
    const form = formFromPreset(SETUP, preset, { timeZone: 'Europe/Istanbul', brandId: BRAND_2 });
    expect(form.skills).toEqual(['report']);
    expect(form.brandIds).toEqual([BRAND_2]);
    expect(form.mode).toBe('auto');
    expect(form.connections).toEqual([
      { key: 'google_search_console', required: false },
      { key: 'google_analytics', required: false },
    ]);
    expect(form.triggers.map((t) => t.key)).toEqual(['k0', 'k1']);
    expect(form.triggers.map(triggerInputOf)).toEqual([
      {
        kind: 'schedule',
        enabled: true,
        config: {
          type: 'recurring',
          rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
          timezone: 'Europe/Istanbul',
        },
      },
      {
        kind: 'kpi',
        enabled: true,
        config: {
          kpi: 'ai_visibility',
          direction: 'any',
          threshold: 10,
          unit: 'percent',
          period: 'day',
        },
      },
    ]);
    // Nothing named or saved yet: the page names it, the person saves it.
    expect(form).toMatchObject({ name: '', nameEdited: false, visibility: 'private' });
    expect(firstStepWithProblems({ ...form, name: 'Visibility Watch' }, ctxOf())).toBeNull();
    // Manual only: no trigger at all.
    expect(
      formFromPreset(SETUP, readyPreset('ready-to-publish')!, { timeZone: 'UTC', brandId: null })
        .triggers,
    ).toEqual([]);
  });

  it('starts a Full auto preset on Auto, ask before changes where the plan or Settings › Chat keep Full auto closed', () => {
    const preset = readyPreset('weekly-report')!;
    const at = { timeZone: 'UTC', brandId: null };
    expect(formFromPreset(SETUP, preset, at).mode).toBe('full_auto');
    expect(formFromPreset({ ...SETUP, fullAuto: 'plan' }, preset, at).mode).toBe('auto');
    expect(formFromPreset({ ...SETUP, fullAuto: 'policy' }, preset, at).mode).toBe('auto');
  });

  it('keeps Optional connections when its skills change, and only the new skills’ own ones', () => {
    expect(
      syncConnections(
        [
          { key: 'webflow', required: true },
          { key: 'google_analytics', required: false },
        ],
        ['report'],
      ),
    ).toEqual([
      { key: 'google_search_console', required: false },
      { key: 'google_analytics', required: false },
    ]);
  });

  it('asks for any CMS only where a skill sends the page, and for any catalog source for /shopping', () => {
    // /winback drafts without a CMS; /publish then sends it: any CMS becomes Required.
    expect(syncConnections([], ['winback', 'publish'])).toEqual([
      { key: 'google_search_console', required: false },
      { key: 'cms', required: true },
    ]);
    expect(syncConnections([], ['tasks'])).toEqual([{ key: 'cms', required: false }]);
    expect(syncConnections([], ['shopping'])).toEqual([{ key: 'catalog', required: true }]);
    expect(syncConnections([], ['faq', 'quality'])).toEqual([]);
  });

  it("asks for nothing for the focus areas' skills, and keeps what the person added", () => {
    expect(syncConnections([], ['questions', 'listings', 'audit-fix'])).toEqual([]);
    expect(
      syncConnections(
        [
          { key: 'google_search_console', required: false },
          { key: 'google_analytics', required: false },
        ],
        ['rivals', 'report'],
      ),
    ).toEqual([
      { key: 'google_search_console', required: false },
      { key: 'google_analytics', required: false },
    ]);
  });
});

describe('triggers', () => {
  it('make the RRULE subset the API keeps, and read it back', () => {
    const rule = (repeat: string, time = '09:30') =>
      (triggerInputOf(schedule({ repeat: repeat as never, time }))!.config as { rrule: string })
        .rrule;
    expect(rule('daily')).toBe('FREQ=DAILY;BYHOUR=9;BYMINUTE=30');
    expect(rule('weekdays')).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=30');
    expect(rule('FR')).toBe('FREQ=WEEKLY;BYDAY=FR;BYHOUR=9;BYMINUTE=30');
    expect(rule('month_first')).toBe('FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=30');
    expect(rule('month_last')).toBe('FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=9;BYMINUTE=30');

    const view = (rrule: string) => ({
      kind: 'schedule' as const,
      enabled: true,
      config: { type: 'recurring', rrule, timezone: 'Europe/Istanbul' },
    });
    const weekly = draftFromView(view('FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0'), 'a', 'UTC');
    expect(weekly).toMatchObject({ repeat: 'MO', time: '09:00', timezone: 'Europe/Istanbul' });
    // Kept as read: the same settings go back.
    expect(triggerInputOf(weekly)!.config).toEqual(
      view('FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0').config,
    );
  });

  it('send a kept trigger back exactly, and a rule the token can’t name keeps its days', () => {
    const config = {
      type: 'recurring',
      rrule: 'FREQ=DAILY;BYDAY=MO,WE;BYHOUR=8;BYMINUTE=0',
      timezone: 'UTC',
    };
    const kept = draftFromView({ kind: 'schedule', enabled: true, config }, 'a', 'UTC');
    expect(kept).toMatchObject({ repeat: 'custom' });
    expect(triggerInputOf(kept)).toEqual({ kind: 'schedule', enabled: true, config });
    // Its time changed: the same days at the new time.
    const moved = { ...kept, raw: null, time: '10:15' } as TriggerDraft;
    expect(triggerInputOf(moved)!.config).toEqual({
      ...config,
      rrule: 'FREQ=DAILY;BYDAY=MO,WE;BYHOUR=10;BYMINUTE=15',
    });
  });

  it('place a one-off on its zone’s clock and refuse one in the past, but not a kept one', () => {
    const once = schedule({
      repeat: 'once',
      date: '2026-11-05',
      time: '13:00',
      timezone: 'Europe/Istanbul',
    });
    expect(triggerInputOf(once)!.config).toEqual({ type: 'once', at: '2026-11-05T10:00:00.000Z' });
    expect(triggerError(once, NOW)).toBeNull();
    expect(triggerError({ ...once, date: '2026-10-01' } as TriggerDraft, NOW)).toBe(
      'schedule_past',
    );
    expect(triggerError({ ...once, date: '2028-01-01' } as TriggerDraft, NOW)).toBe(
      'schedule_too_far',
    );
    expect(triggerError({ ...once, date: '' } as TriggerDraft, NOW)).toBe('date_required');
    expect(triggerError({ ...once, time: '' } as TriggerDraft, NOW)).toBe('time_required');
    const fired = draftFromView(
      { kind: 'schedule', enabled: true, config: { type: 'once', at: '2026-10-01T10:00:00.000Z' } },
      'a',
      'Europe/Istanbul',
    );
    expect(fired).toMatchObject({ repeat: 'once', date: '2026-10-01', time: '13:00' });
    expect(triggerError(fired, NOW)).toBeNull();
  });

  it('check a KPI’s threshold and a signal’s category, and keep a watch rule as it is', () => {
    const kpi = newTriggerDraft('kpi', 'a', 'UTC');
    expect(triggerInputOf(kpi)!.config).toEqual({
      kpi: 'citations',
      direction: 'down',
      threshold: 10,
      unit: 'percent',
      period: 'week',
    });
    expect(triggerError({ ...kpi, threshold: '0' } as TriggerDraft, NOW)).toBe('threshold');
    expect(triggerError({ ...kpi, threshold: '' } as TriggerDraft, NOW)).toBe('threshold');
    expect(triggerError({ ...kpi, threshold: '2000' } as TriggerDraft, NOW)).toBe(
      'threshold_percent',
    );
    expect(triggerError({ ...kpi, threshold: '2000', unit: 'absolute' } as TriggerDraft, NOW)).toBe(
      null,
    );
    expect(triggerError({ ...kpi, kpi: '' } as TriggerDraft, NOW)).toBe('kpi_required');
    const signal = newTriggerDraft('signal', 'b', 'UTC');
    expect(triggerInputOf(signal)!.config).toEqual({ category: 'recover' });
    expect(triggerError({ ...signal, category: '' } as TriggerDraft, NOW)).toBe(
      'category_required',
    );
    const rule = draftFromView(
      { kind: 'watch_rule', enabled: false, config: { watch_rule_id: AGENT_ID } },
      'c',
      'UTC',
    );
    expect(triggerInputOf(rule)).toEqual({
      kind: 'watch_rule',
      enabled: false,
      config: { watch_rule_id: AGENT_ID },
    });
    expect(triggerError(rule, NOW)).toBeNull();
  });
});

describe('each step’s checks', () => {
  it('step 1: a skill, and instructions up to 2,000 characters', () => {
    expect(stepProblems(0, fresh({ skills: [] }), ctxOf()).fields).toEqual({
      skills: 'skill_required',
    });
    expect(stepProblems(0, fresh({ instructions: 'x'.repeat(2001) }), ctxOf()).fields).toEqual({
      instructions: 'instructions_long',
    });
    expect(stepProblems(0, fresh(), ctxOf()).fields).toEqual({});
  });

  it('step 2: each trigger, at most 5 and none twice, a brand, and the scope’s lists', () => {
    const past = schedule({ key: 'p', repeat: 'once', date: '2026-10-01', time: '09:00' });
    expect(stepProblems(1, fresh({ triggers: [past] }), ctxOf()).triggers).toEqual({
      p: 'schedule_past',
    });
    const twice = [schedule({ key: 'a' }), schedule({ key: 'b' })];
    expect(stepProblems(1, fresh({ triggers: twice }), ctxOf()).fields.triggers).toBe(
      'triggers_same',
    );
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((key, i) => schedule({ key, time: `0${i}:00` }));
    expect(stepProblems(1, fresh({ triggers: six }), ctxOf()).fields.triggers).toBe(
      'triggers_many',
    );
    expect(stepProblems(1, fresh({ brandIds: [] }), ctxOf()).fields.brands).toBe('brand_required');
    expect(stepProblems(1, fresh({ brandIds: [] }), ctxOf({ brands: [] })).fields.brands).toBe(
      'no_brands',
    );
    expect(stepProblems(1, fresh({ allBrands: true, brandIds: [] }), ctxOf()).fields).toEqual({});
    expect(stepProblems(1, fresh({ urlsText: 'getcito.com/pricing' }), ctxOf()).fields.urls).toBe(
      'urls_invalid',
    );
    expect(
      stepProblems(
        1,
        fresh({ urlsText: 'https://getcito.com/pricing\nhttps://getcito.com/' }),
        ctxOf(),
      ).fields,
    ).toEqual({});
    expect(stepProblems(1, fresh({ tagsText: 'x'.repeat(51) }), ctxOf()).fields.tags).toBe(
      'tags_invalid',
    );
    // One address or tag a line: a comma stays in it.
    const commas = fresh({
      urlsText: 'https://getcito.com/compare?a=1,2\nhttps://getcito.com/',
      tagsText: 'pricing, plans\nbrand',
    });
    expect(stepProblems(1, commas, ctxOf()).fields).toEqual({});
    expect(scopeOf(commas)).toMatchObject({
      urls: ['https://getcito.com/compare?a=1,2', 'https://getcito.com/'],
      tags: ['pricing, plans', 'brand'],
    });
    expect(parseList(' a \r\n\n a\nb ')).toEqual(['a', 'b']);
    // Manual only: no trigger kept is fine.
    expect(stepProblems(1, fresh({ triggers: [] }), ctxOf()).fields).toEqual({});
  });

  it('step 3: Full auto only where the plan and Settings › Chat allow it', () => {
    const full = fresh({ mode: 'full_auto' });
    expect(stepProblems(2, full, ctxOf()).fields).toEqual({});
    expect(stepProblems(2, full, ctxOf({ fullAuto: 'plan' })).fields.mode).toBe('full_auto_plan');
    expect(stepProblems(2, full, ctxOf({ fullAuto: 'policy' })).fields.mode).toBe('full_auto_off');
  });

  it('step 4: a name, Max per run 1–50, an Admin’s monthly cap 1–100, sharing as Settings › Chat allows', () => {
    expect(stepProblems(3, fresh({ name: '   ' }), ctxOf()).fields.name).toBe('name_required');
    expect(stepProblems(3, fresh({ name: 'x'.repeat(61) }), ctxOf()).fields.name).toBe('name_long');
    for (const maxRun of ['0', '51', '7.5', '']) {
      expect(stepProblems(3, fresh({ maxRun }), ctxOf()).fields.maxRun).toBe('run_share');
    }
    const capped = fresh({ monthCapOn: true, maxMonth: '101' });
    expect(stepProblems(3, capped, ctxOf({ role: 'admin' })).fields.maxMonth).toBe('month_share');
    // A Manager sends no monthly cap: nothing to check.
    expect(stepProblems(3, capped, ctxOf()).fields.maxMonth).toBeUndefined();
    const shared = fresh({ visibility: 'workspace' });
    expect(
      stepProblems(3, shared, ctxOf({ workspaceAgentsAdminsOnly: true })).fields.visibility,
    ).toBe('workspace_admins_only');
    expect(
      stepProblems(3, shared, ctxOf({ workspaceAgentsAdminsOnly: true, role: 'admin' })).fields,
    ).toEqual({});
  });

  it('finds the first step that isn’t ready', () => {
    expect(firstStepWithProblems(fresh({ skills: [] }), ctxOf())).toBe(0);
    expect(firstStepWithProblems(fresh({ brandIds: [], name: '' }), ctxOf())).toBe(1);
    expect(firstStepWithProblems(fresh({ brandIds: [] }), ctxOf(), 1)).toBeNull();
    expect(firstStepWithProblems(fresh(), ctxOf())).toBeNull();
  });
});

describe('what is sent', () => {
  it('sends a name the person didn’t type as the skill’s title, for the server to name by §O', () => {
    const auto = createAgentInput.parse(
      createBody(fresh({ nameEdited: false }), 'manager', 'Win back lost citations'),
    );
    expect(auto).toMatchObject({ name: 'Win back lost citations', autoName: true });
    const typed = createAgentInput.parse(
      createBody(fresh({ nameEdited: true }), 'manager', 'Win back lost citations'),
    );
    expect(typed).toMatchObject({ name: 'Win back', autoName: false });
  });

  it('creates a draft the server’s own schema takes, the monthly cap only from an Admin', () => {
    const body = createBody(
      fresh({
        urlsText: 'https://getcito.com/pricing',
        engines: ['perplexity-web'],
        instructions: '  Be brief  ',
      }),
      'manager',
    );
    expect(body).not.toHaveProperty('maxMonthShare');
    const parsed = createAgentInput.parse(body);
    expect(parsed).toMatchObject({
      name: 'Win back',
      visibility: 'private',
      maxRunShare: 0.1,
      skills: ['winback'],
      instructions: 'Be brief',
      mode: 'auto',
      model: 'auto',
      scope: {
        brand_ids: [BRAND],
        engines: ['perplexity-web'],
        urls: ['https://getcito.com/pricing'],
      },
    });
    expect(parsed.triggers).toHaveLength(1);
    expect(
      createAgentInput.parse(createBody(fresh({ monthCapOn: true, maxMonth: '25' }), 'admin'))
        .maxMonthShare,
    ).toBe(0.25);
    expect(createBody(fresh(), 'admin').maxMonthShare).toBeNull();
  });

  it('opens Edit on the agent’s version, and sends nothing when nothing changed', () => {
    const agent = detail();
    const form = formFromAgent(agent, SETUP, { timeZone: 'UTC', triggerKey: (i) => `k${i}` })!;
    expect(form).toMatchObject({
      skills: ['winback', 'refresh'],
      name: 'Citation win-back',
      nameEdited: true,
      visibility: 'workspace',
      maxRun: '10',
      monthCapOn: false,
      brandIds: [BRAND],
      engines: ['perplexity-web'],
    });
    expect(form.triggers.map((d) => d.kind)).toEqual(['schedule', 'signal']);
    expect(patchBody(form, agent, 'manager')).toBeNull();
  });

  it('patches only what changed, with the version it opened', () => {
    const agent = detail();
    const form = formFromAgent(agent, SETUP, { timeZone: 'UTC', triggerKey: (i) => `k${i}` })!;
    const renamed = patchBody({ ...form, name: '  Win  back ' }, agent, 'manager');
    // With the version and the moment it opened: a save in between refuses this one.
    expect(renamed).toEqual({
      expectedVersion: 2,
      expectedUpdatedAt: '2026-10-29T10:00:00.000Z',
      name: 'Win back',
    });
    expect(updateAgentInput.safeParse(renamed).success).toBe(true);

    const changed = patchBody(
      {
        ...form,
        mode: 'ask_first',
        skills: ['winback'],
        triggers: form.triggers.map((d, i) => (i === 1 ? { ...d, enabled: false } : d)),
        maxRun: '15',
      },
      agent,
      'manager',
    )!;
    expect(changed).toMatchObject({
      expectedVersion: 2,
      mode: 'ask_first',
      skills: ['winback'],
      maxRunShare: 0.15,
    });
    expect((changed.triggers as { enabled: boolean }[]).map((t) => t.enabled)).toEqual([
      true,
      false,
    ]);
    expect(updateAgentInput.safeParse(changed).success).toBe(true);
    // An Admin's monthly cap, set and taken off.
    expect(patchBody({ ...form, monthCapOn: true, maxMonth: '30' }, agent, 'admin')).toEqual({
      expectedVersion: 2,
      expectedUpdatedAt: '2026-10-29T10:00:00.000Z',
      maxMonthShare: 0.3,
    });
  });
});

describe('the server’s refusals', () => {
  it('land on the step they belong to', () => {
    expect(refusalPlace('name_taken', null)).toEqual({ step: 3, field: 'name' });
    expect(refusalPlace('name_taken_hidden', null)).toEqual({ step: 3, field: 'name' });
    expect(refusalPlace('schedule_past', null)).toEqual({ step: 1, field: 'triggers' });
    expect(refusalPlace('topic_not_found', null)).toEqual({ step: 1, field: 'brands' });
    expect(refusalPlace('demo_brand', null)).toEqual({ step: 1, field: 'brands' });
    expect(refusalPlace('plan_locked', 'fullAuto')).toEqual({ step: 2, field: 'mode' });
    expect(refusalPlace('plan_locked', 'engines')).toEqual({ step: 1, field: 'engines' });
    expect(refusalPlace('policy_never', 'workspace')).toEqual({ step: 3, field: 'visibility' });
    // The go-live box on Mode & approvals (AUTONOMOUS-GO-LIVE §7.2).
    expect(refusalPlace('go_live_off', null)).toEqual({ step: 2, field: 'form' });
    expect(refusalPlace('go_live_mode', null)).toEqual({ step: 2, field: 'form' });
    expect(refusalPlace('forbidden_role', 'goLive')).toEqual({ step: 2, field: 'form' });
    expect(refusalPlace('forbidden_role', 'monthCap')).toEqual({ step: 3, field: 'maxMonth' });
    expect(refusalPlace('agent_limit', null)).toEqual({ step: 3, field: 'form' });
    expect(refusalPlace('version_conflict', null)).toEqual({ step: 3, field: 'form' });
    expect(refusalPlace(null, null)).toEqual({ step: 3, field: 'form' });
  });
});
