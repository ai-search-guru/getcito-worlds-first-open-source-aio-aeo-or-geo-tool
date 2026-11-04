import { describe, expect, it } from 'vitest';
import {
  GETTING_STARTED_STEPS,
  buildGettingStarted,
  firstRunOrder,
  isPageOpenedStep,
  needsFirstAnswers,
  needsTrackingData,
  pageOpenedStep,
  parseGettingStartedFacts,
  type GettingStartedFacts,
  type GettingStartedStepKey,
} from './steps';

/**
 * Getting started (AC-ALT2 §4): seventeen fixed steps whose state follows
 * from the brand's data. Steps unlock when their data is ready, optional
 * steps can be skipped, and Ready waits for everything above it.
 */

const facts = (over: Partial<GettingStartedFacts> = {}): GettingStartedFacts => ({
  startedAt: '2026-10-20T10:00:00Z',
  dismissedAt: null,
  confirmedAt: '2026-10-20T10:00:00Z',
  records: {},
  recordedAt: {},
  kpiSetupAt: null,
  competitors: 0,
  topicPrompts: [],
  gsc: false,
  ga: false,
  firstAnswer: false,
  firstVisit: false,
  dataSuggestions: 0,
  dataTracked: 0,
  contentSuggestions: 0,
  contentPicked: 0,
  contentCreated: 0,
  contentRecent: 0,
  audits: 0,
  draftsCreated: 0,
  draftsOptimized: 0,
  ...over,
});

const step = (f: GettingStartedFacts, key: GettingStartedStepKey) =>
  buildGettingStarted(f).steps.find((s) => s.key === key)!;

describe('the step list', () => {
  it('has the seventeen steps in order, by stage', () => {
    expect(GETTING_STARTED_STEPS.map((s) => `${s.stage}:${s.key}`)).toEqual([
      'setup:kpis',
      'setup:competitors',
      'setup:topics',
      'setup:prompts',
      'setup:gsc',
      'setup:ga',
      'setup:snippet',
      'explore:visibility',
      'explore:answers',
      'explore:data_prompts',
      'explore:mentions',
      'explore:citations',
      'explore:traffic',
      'act:pick_content',
      'act:create_content',
      'act:optimize_page',
      'ready:ready',
    ]);
    expect(GETTING_STARTED_STEPS.filter((s) => s.optional).map((s) => s.key)).toEqual([
      'gsc',
      'ga',
    ]);
  });
});

describe('buildGettingStarted', () => {
  it('opens a new brand on the setup steps, with the rest waiting for data', () => {
    const status = buildGettingStarted(facts());
    expect(status.active).toBe(true);
    expect(status.total).toBe(17);
    expect(status.done).toBe(0);
    const states = Object.fromEntries(status.steps.map((s) => [s.key, s.state]));
    expect(states).toEqual({
      kpis: 'new',
      competitors: 'new',
      topics: 'new',
      prompts: 'new',
      gsc: 'new',
      ga: 'new',
      snippet: 'new',
      visibility: 'waiting',
      answers: 'waiting',
      data_prompts: 'waiting',
      mentions: 'waiting',
      citations: 'waiting',
      traffic: 'waiting',
      pick_content: 'waiting',
      create_content: 'waiting',
      optimize_page: 'waiting',
      ready: 'waiting',
    });
  });

  it('counts KPIs saved from the KPI screen, or set up before the start', () => {
    // The ready-made set appeared after the start: not set yet.
    expect(step(facts({ kpiSetupAt: '2026-10-20T11:00:00Z' }), 'kpis').state).toBe('new');
    expect(step(facts({ records: { kpis: 'done' } }), 'kpis').state).toBe('done');
    // An existing customer's KPIs, from before Getting started.
    expect(step(facts({ kpiSetupAt: '2026-09-01T00:00:00Z' }), 'kpis').state).toBe('done');
    expect(step(facts({ startedAt: null, kpiSetupAt: '2026-10-20T11:00:00Z' }), 'kpis').state).toBe(
      'done',
    );
  });

  it('wants three competitors and three topics, with progress', () => {
    expect(step(facts({ competitors: 2 }), 'competitors')).toMatchObject({
      state: 'new',
      progress: { value: 2, target: 3 },
    });
    expect(step(facts({ competitors: 7 }), 'competitors')).toMatchObject({
      state: 'done',
      progress: { value: 3, target: 3 },
    });
    expect(step(facts({ topicPrompts: [0, 0] }), 'topics')).toMatchObject({
      state: 'new',
      progress: { value: 2, target: 3 },
    });
    expect(step(facts({ topicPrompts: [0, 0, 0] }), 'topics').state).toBe('done');
  });

  it('wants three prompts in every topic, and at least three topics of them', () => {
    // Two full topics of three: 6/9 until a third topic has its prompts.
    expect(step(facts({ topicPrompts: [3, 4] }), 'prompts')).toMatchObject({
      state: 'new',
      progress: { value: 6, target: 9 },
    });
    expect(step(facts({ topicPrompts: [3, 5, 3] }), 'prompts')).toMatchObject({
      state: 'done',
      progress: { value: 9, target: 9 },
    });
    // A fourth topic raises the bar; extra prompts elsewhere don't make up for it.
    expect(step(facts({ topicPrompts: [9, 3, 3, 1] }), 'prompts')).toMatchObject({
      state: 'new',
      progress: { value: 10, target: 12 },
    });
  });

  it('lets Search Console and Analytics be skipped, and done when connected anyway', () => {
    const skipped = facts({ records: { gsc: 'skipped', ga: 'skipped' } });
    expect(step(skipped, 'gsc').state).toBe('skipped');
    expect(step(skipped, 'ga').state).toBe('skipped');
    expect(step({ ...skipped, gsc: true }, 'gsc').state).toBe('done');
    expect(buildGettingStarted(skipped).done).toBe(3); // both, and the step that needs them
  });

  it('marks the snippet done on the first AI visit', () => {
    expect(step(facts({ firstVisit: true }), 'snippet').state).toBe('done');
  });

  it('unlocks the explore pages with the first answers, done once opened', () => {
    expect(step(facts({ records: { mentions: 'opened' } }), 'mentions').state).toBe('done');
    const answered = facts({ firstAnswer: true });
    expect(step(answered, 'visibility').state).toBe('new');
    expect(step({ ...answered, records: { visibility: 'opened' } }, 'visibility').state).toBe(
      'done',
    );
    expect(step(answered, 'traffic').state).toBe('new');
  });

  it('waits for prompt suggestions from Search Console or Analytics, done at five tracked', () => {
    const connected = facts({ firstAnswer: true, gsc: true });
    expect(step(connected, 'data_prompts')).toMatchObject({
      state: 'waiting',
      progress: { value: 0, target: 5 },
    });
    expect(
      step({ ...connected, dataSuggestions: 12, dataTracked: 2 }, 'data_prompts'),
    ).toMatchObject({ state: 'new', progress: { value: 2, target: 5 } });
    expect(step({ ...connected, dataSuggestions: 12, dataTracked: 6 }, 'data_prompts').state).toBe(
      'done',
    );
  });

  it('goes with both sources when both are skipped, but not with one', () => {
    expect(step(facts({ records: { gsc: 'skipped', ga: 'skipped' } }), 'data_prompts').state).toBe(
      'skipped',
    );
    expect(step(facts({ records: { gsc: 'skipped' } }), 'data_prompts').state).toBe('waiting');
    // Skipped, then connected after all: the suggestions can still come.
    expect(
      step(facts({ ga: true, records: { gsc: 'skipped', ga: 'skipped' } }), 'data_prompts').state,
    ).toBe('waiting');
  });

  it('unlocks the act steps with the first content suggestions', () => {
    const suggested = facts({ contentSuggestions: 4 });
    expect(step(suggested, 'pick_content').state).toBe('new');
    expect(step(suggested, 'create_content').state).toBe('new');
    expect(step(suggested, 'optimize_page').state).toBe('new');
    expect(step({ ...suggested, contentPicked: 1 }, 'pick_content').state).toBe('done');
    expect(step({ ...suggested, contentCreated: 1 }, 'create_content').state).toBe('done');
    // Done counts before the unlock: an audit run before the suggestions came.
    expect(step(facts({ audits: 1 }), 'optimize_page').state).toBe('done');
  });

  it('opens the Content Plan’s top rows, and counts a draft made ready there (00234)', () => {
    const href = (key: string) => GETTING_STARTED_STEPS.find((s) => s.key === key)!.href;
    expect(href('create_content')).toBe('/dashboard/content/plan?start=create');
    expect(href('optimize_page')).toBe('/dashboard/content/plan?start=optimize');

    const suggested = facts({ contentSuggestions: 4 });
    expect(step({ ...suggested, draftsCreated: 1 }, 'create_content').state).toBe('done');
    expect(step({ ...suggested, draftsOptimized: 1 }, 'optimize_page').state).toBe('done');
    // A draft of the other method completes neither.
    expect(step({ ...suggested, draftsOptimized: 1 }, 'create_content').state).toBe('new');
    expect(step({ ...suggested, draftsCreated: 1 }, 'optimize_page').state).toBe('new');
  });

  it('is ready once every other step is done or skipped', () => {
    const all = facts({
      records: {
        kpis: 'done',
        ga: 'skipped',
        visibility: 'opened',
        answers: 'opened',
        mentions: 'opened',
        citations: 'opened',
        traffic: 'opened',
      },
      competitors: 5,
      topicPrompts: [3, 3, 3],
      gsc: true,
      firstAnswer: true,
      firstVisit: true,
      dataSuggestions: 8,
      dataTracked: 5,
      contentSuggestions: 3,
      contentPicked: 1,
      contentCreated: 1,
      audits: 2,
    });
    const status = buildGettingStarted(all);
    expect(step(all, 'ready').state).toBe('done');
    expect(status.done).toBe(17);
    expect(step({ ...all, audits: 0 }, 'ready').state).toBe('waiting');
  });

  it('dates the steps a person acted on, and only those', () => {
    const f = facts({
      competitors: 4,
      records: { gsc: 'skipped' },
      recordedAt: { gsc: '2026-10-20T12:05:00Z' },
    });
    expect(step(f, 'gsc').updatedAt).toBe('2026-10-20T12:05:00Z');
    expect(step(f, 'competitors').updatedAt).toBeNull();
  });

  it('is inactive for a brand that never started it, or skipped it', () => {
    expect(buildGettingStarted(facts({ startedAt: null })).active).toBe(false);
    expect(buildGettingStarted(facts({ dismissedAt: '2026-10-21T00:00:00Z' })).active).toBe(false);
  });

  it('asks first for a brand added beside others, until someone answers', () => {
    const asking = buildGettingStarted(facts({ confirmedAt: null }));
    expect(asking).toMatchObject({ active: false, asking: true });
    // Skipped from the question: neither running nor asking.
    expect(
      buildGettingStarted(facts({ confirmedAt: null, dismissedAt: '2026-10-21T00:00:00Z' })),
    ).toMatchObject({ active: false, asking: false });
  });

  it('offers it to a brand whose setup is incomplete (AC-ALT2 §5)', () => {
    const complete = {
      competitors: 3,
      topicPrompts: [3, 3, 3],
      gsc: true,
      contentRecent: 1,
    };
    expect(buildGettingStarted(facts(complete)).needsSetup).toBe(false);
    for (const gap of [
      { competitors: 2 },
      { topicPrompts: [3, 3] },
      { gsc: false },
      { contentRecent: 0 },
    ]) {
      expect(buildGettingStarted(facts({ ...complete, ...gap })).needsSetup).toBe(true);
    }
  });
});

/**
 * While the brand's first tracking run goes on, the steps that need none of
 * its data come first, "Ready now"; the rest wait for it.
 */
describe('the first run', () => {
  it('needs the first answers for the explore pages and the suggestions for the act steps', () => {
    expect(GETTING_STARTED_STEPS.filter(needsFirstAnswers).map((s) => s.key)).toEqual([
      'visibility',
      'answers',
      'mentions',
      'citations',
      'traffic',
    ]);
    const needs = GETTING_STARTED_STEPS.filter(needsTrackingData).map((s) => s.key);
    expect(needs).toEqual([
      'visibility',
      'answers',
      'mentions',
      'citations',
      'traffic',
      'pick_content',
      'create_content',
      'optimize_page',
    ]);
  });

  it('lists the steps ready now first, then the rest, each in their usual order', () => {
    // Competitors, topics and prompts set in onboarding; Search Console
    // suggestions in; an early answer already opened Brand Visibility.
    const { steps } = buildGettingStarted(
      facts({
        competitors: 3,
        topicPrompts: [3, 3, 3],
        gsc: true,
        dataSuggestions: 4,
        firstAnswer: true,
      }),
    );
    expect(firstRunOrder(steps).map((s) => s.key)).toEqual([
      'kpis',
      'ga',
      'snippet',
      'data_prompts',
      'competitors',
      'topics',
      'prompts',
      'gsc',
      'visibility',
      'answers',
      'mentions',
      'citations',
      'traffic',
      'pick_content',
      'create_content',
      'optimize_page',
      'ready',
    ]);
  });
});

describe('parseGettingStartedFacts', () => {
  it('reads the RPC jsonb', () => {
    expect(
      parseGettingStartedFacts({
        started_at: '2026-10-20T10:00:00+00:00',
        dismissed_at: null,
        confirmed_at: '2026-10-20T10:00:00+00:00',
        steps: {
          kpis: { state: 'done', at: '2026-10-20T12:00:00+00:00' },
          gsc: { state: 'skipped', at: '2026-10-20T12:05:00+00:00' },
          visibility: { state: 'opened', at: null },
          odd: { state: 'maybe', at: '2026-10-20T12:10:00+00:00' },
        },
        kpi_setup_at: '2026-10-20T11:00:00+00:00',
        competitors: 4,
        topic_prompts: [3, '2', null],
        gsc: true,
        ga: false,
        first_answer: true,
        first_visit: false,
        data_suggestions: 7,
        data_tracked: 1,
        content_suggestions: 3,
        content_picked: 0,
        content_created: 0,
        content_recent: 2,
        audits: 1,
        drafts_created: 1,
        drafts_optimized: 3,
      }),
    ).toEqual({
      startedAt: '2026-10-20T10:00:00+00:00',
      dismissedAt: null,
      confirmedAt: '2026-10-20T10:00:00+00:00',
      records: { kpis: 'done', gsc: 'skipped', visibility: 'opened' },
      recordedAt: { kpis: '2026-10-20T12:00:00+00:00', gsc: '2026-10-20T12:05:00+00:00' },
      kpiSetupAt: '2026-10-20T11:00:00+00:00',
      competitors: 4,
      topicPrompts: [3, 2, 0],
      gsc: true,
      ga: false,
      firstAnswer: true,
      firstVisit: false,
      dataSuggestions: 7,
      dataTracked: 1,
      contentSuggestions: 3,
      contentPicked: 0,
      contentCreated: 0,
      contentRecent: 2,
      audits: 1,
      draftsCreated: 1,
      draftsOptimized: 3,
    });
  });

  // gkhngyk on #1243: until 00197 is applied, the facts have no confirmed_at,
  // and every running brand would ask "Run Getting started?".
  it('reads a running brand as confirmed on a database without 00197', () => {
    const facts = parseGettingStartedFacts({ started_at: '2026-10-20T10:00:00+00:00' });
    expect(facts?.confirmedAt).toBe('2026-10-20T10:00:00+00:00');
    expect(
      parseGettingStartedFacts({ started_at: '2026-10-20T10:00:00+00:00', confirmed_at: null })
        ?.confirmedAt,
    ).toBeNull();
  });

  it('gives null for a brand the caller can’t see', () => {
    expect(parseGettingStartedFacts(null)).toBeNull();
  });
});

describe('pageOpenedStep', () => {
  it('maps the explore pages, their subpages included', () => {
    expect(pageOpenedStep('/dashboard/insights')).toBe('visibility');
    expect(pageOpenedStep('/dashboard/prompts')).toBe('answers');
    expect(pageOpenedStep('/dashboard/prompts/tracked')).toBe('answers');
    expect(pageOpenedStep('/dashboard/mentions')).toBe('mentions');
    expect(pageOpenedStep('/dashboard/citations/domains')).toBe('citations');
    expect(pageOpenedStep('/dashboard/traffic')).toBe('traffic');
  });

  it('leaves every other page alone', () => {
    expect(pageOpenedStep('/dashboard/prompts/insights')).toBeNull();
    expect(pageOpenedStep('/dashboard/prompts/suggestions')).toBeNull();
    expect(pageOpenedStep('/dashboard/insightsx')).toBeNull();
    expect(pageOpenedStep('/dashboard/action-center/actions')).toBeNull();
  });

  it('accepts only page steps from the client', () => {
    expect(isPageOpenedStep('mentions')).toBe(true);
    expect(isPageOpenedStep('kpis')).toBe(false);
    expect(isPageOpenedStep('mentions; drop table')).toBe(false);
  });
});
