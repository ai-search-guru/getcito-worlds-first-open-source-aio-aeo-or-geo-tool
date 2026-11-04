import { describe, expect, it } from 'vitest';
import type { Signal } from './map';
import { NO_WHERE } from './where';
import {
  currentActionFirst,
  signalChange,
  signalDetailForApi,
  signalLinks,
  signalWhereFields,
} from './detail';

const signal = (over: Partial<Signal>): Signal => ({
  id: 's1',
  category: 'visibility',
  kind: 'platform_drop',
  impact: 'high',
  status: 'new',
  source: ['ai_results'],
  detectedAt: '2026-10-08T10:53:00+00:00',
  lastDetectedAt: '2026-10-09T10:53:00+00:00',
  resolvedAt: null,
  previousValue: null,
  currentValue: null,
  changeValue: null,
  payload: {},
  kpiKeys: [],
  actionId: null,
  where: NO_WHERE,
  ...over,
});

const platformDrop = signal({
  payload: {
    entity: 'platforms',
    platform: 'gemini-web',
    targets: [{ id: 'gemini-web', label: 'gemini-web' }],
  },
  previousValue: 34,
  currentValue: 18,
  changeValue: -16,
  where: { platforms: ['gemini-web'], regions: [], topics: [] },
});

const lostCitation = signal({
  category: 'citation',
  kind: 'lost_citations',
  payload: { promptId: 'p1', promptText: 'Best coffee subscription?' },
  where: { platforms: ['chatgpt-web', 'gemini-web'], regions: ['US'], topics: ['Coffee'] },
});

const source = signal({
  category: 'competitor',
  kind: 'competitor_winning_source',
  payload: {
    entity: 'sources',
    domain: 'yotpo.com',
    prompts: 6,
    results: 251,
    targets: [{ id: 'yotpo.com', label: 'yotpo.com' }],
  },
  previousValue: 0,
  currentValue: 251,
  changeValue: 167,
});

describe('signalChange', () => {
  it('gives a week-over-week change its two windows', () => {
    expect(signalChange(platformDrop)).toEqual({
      period: 'week_over_week',
      figures: [
        { metric: 'mention_rate', role: 'before', value: 34 },
        { metric: 'mention_rate', role: 'after', value: 18 },
      ],
    });
  });

  it("names a source's three counts instead of a before and an after", () => {
    expect(signalChange(source)).toEqual({
      period: 'last_7_days',
      figures: [
        { metric: 'answers_citing', role: 'total', value: 251 },
        { metric: 'answers_citing', role: 'naming_you', value: 0 },
        { metric: 'answers_citing', role: 'competitors_only', value: 167 },
      ],
    });
  });

  it('compares inside one window, naming what is compared', () => {
    expect(
      signalChange(
        signal({
          kind: 'country_gap',
          payload: { entity: 'regions', region: 'TR', bestRegion: 'US' },
          previousValue: 22.5,
          currentValue: 3.1,
        }),
      )?.figures,
    ).toEqual([
      { metric: 'mention_rate', role: 'best', value: 22.5, subject: 'US', subjectType: 'location' },
      { metric: 'mention_rate', role: 'this', value: 3.1, subject: 'TR', subjectType: 'location' },
    ]);
    expect(
      signalChange(
        signal({
          category: 'competitor',
          kind: 'competitor_leads',
          payload: { competitorName: 'Profound' },
          previousValue: 40,
          currentValue: 160,
        }),
      )?.figures,
    ).toEqual([
      {
        metric: 'mentions',
        role: 'competitor',
        value: 160,
        subject: 'Profound',
        subjectType: 'competitor',
      },
      { metric: 'mentions', role: 'you', value: 40 },
    ]);
  });

  it('adds what fell beside AI sessions on a cross-channel finding', () => {
    const figures = signalChange(
      signal({
        category: 'traffic',
        kind: 'cross_channel_risk',
        payload: { entity: 'pages', targets: [{ id: 'site' }], clicksBefore: 900, clicksNow: 600 },
        previousValue: 120,
        currentValue: 80,
      }),
    )?.figures;
    expect(figures?.map((f) => `${f.metric}:${f.role}:${f.value}`)).toEqual([
      'ai_sessions:before:120',
      'ai_sessions:after:80',
      'search_clicks:before:900',
      'search_clicks:after:600',
    ]);
  });

  it("counts a competitor topic finding's prompts", () => {
    expect(
      signalChange(
        signal({
          category: 'competitor',
          kind: 'competitor_topic_lead',
          payload: { entity: 'topics', topicName: 'AEO', targets: [{ id: 't1', label: 'AEO' }] },
          currentValue: 12,
        }),
      ),
    ).toEqual({
      period: 'last_7_days',
      figures: [{ metric: 'prompts', role: 'total', value: 12 }],
    });
  });

  it('has nothing to say when the row records no figures', () => {
    expect(signalChange(lostCitation)).toBeNull();
  });

  it("reads the weekly AI visits drop over seven days, and a new platform's first week (AT-013)", () => {
    expect(
      signalChange(
        signal({
          category: 'traffic',
          kind: 'ai_visits_weekly_drop',
          payload: { entity: 'pages', targets: [{ id: '/menu', label: '/menu' }] },
          previousValue: 50,
          currentValue: 28,
          changeValue: -22,
        }),
      ),
    ).toEqual({
      period: 'week_over_week',
      figures: [
        { metric: 'ai_sessions', role: 'before', value: 50 },
        { metric: 'ai_sessions', role: 'after', value: 28 },
      ],
    });
    expect(
      signalChange(
        signal({
          category: 'traffic',
          kind: 'ai_platform_new',
          payload: { aiSource: 'perplexity.ai' },
          previousValue: 0,
          currentValue: 4,
          changeValue: 4,
        }),
      ),
    ).toEqual({
      period: 'last_7_days',
      figures: [{ metric: 'ai_sessions', role: 'now', value: 4 }],
    });
  });
});

describe('signalWhereFields', () => {
  const keys = (s: Signal) => signalWhereFields(s).map((f) => `${f.key}${f.value ? '' : ' (n/a)'}`);

  it('asks a lost citation which page was cited and who is cited now', () => {
    expect(keys(lostCitation)).toEqual([
      'prompt',
      'topic',
      'trackedOn',
      'trackedIn',
      'lostUrl (n/a)',
      'citedNow (n/a)',
    ]);
    expect(signalWhereFields(lostCitation)[0].value).toEqual({
      type: 'prompt',
      id: 'p1',
      text: 'Best coffee subscription?',
    });
  });

  it("lists a competitor source's open questions as not available", () => {
    expect(keys(source)).toEqual([
      'competitor (n/a)',
      'domain',
      'platforms (n/a)',
      'competitorPositions (n/a)',
      'winningSources (n/a)',
      'competitorPageEvents (n/a)',
    ]);
  });

  it("names a platform signal's scope and platform", () => {
    expect(keys(platformDrop)).toEqual(['scope', 'platforms']);
  });

  it('says a brand-wide finding covers every platform rather than none', () => {
    expect(
      signalWhereFields(
        signal({ kind: 'sharp_drop', previousValue: 24, currentValue: 15, payload: {} }),
      ),
    ).toEqual([
      { key: 'scope', value: { type: 'scope', scope: 'all_prompts' } },
      { key: 'platforms', value: { type: 'all_platforms' } },
    ]);
  });

  it("reads a technical finding's failed checks as its evidence", () => {
    const audit = signal({
      category: 'technical',
      kind: 'outdated_content',
      payload: {
        entity: 'pages',
        targets: [{ id: '/pricing', page: '/pricing', checks: ['dateModified', 'freshness'] }],
      },
      currentValue: 1,
    });
    // Recorded before the checks' evidence: the failed checks by name, page
    // by page, in the same shape. A stale page has no crawlers to name.
    const check = (name: string) => ({ page: '/pricing', check: name, label: name, evidence: {} });
    expect(signalWhereFields(audit)).toEqual([
      { key: 'pages', value: { type: 'list', items: ['/pricing'], total: 1 } },
      { key: 'issue', value: { type: 'list', items: ['dateModified', 'freshness'], total: 2 } },
      {
        key: 'evidence',
        value: { type: 'issues', items: [check('dateModified'), check('freshness')] },
      },
    ]);
    expect(signalDetailForApi(audit, []).where.evidence).toEqual([
      check('dateModified'),
      check('freshness'),
    ]);
  });
});

describe('signalLinks', () => {
  it('points at the answers behind a signal, or the page that shows its source', () => {
    expect(signalLinks(lostCitation)).toEqual([
      { kind: 'prompt_answers', href: '/dashboard/prompts/p1' },
    ]);
    expect(signalLinks(source)).toEqual([{ kind: 'citations', href: '/dashboard/citations' }]);
    expect(
      signalLinks(
        signal({ kind: 'topic_drop', payload: { entity: 'topics', targets: [{ id: 't1' }] } }),
      ),
    ).toEqual([{ kind: 'topic', href: '/dashboard/topics/t1' }]);
    // Several prompts are each linked in Where; the evidence link is the list.
    expect(
      signalLinks(
        signal({
          kind: 'high_demand_gap',
          payload: { entity: 'prompts', targets: [{ id: 'p1' }, { id: 'p2' }] },
        }),
      ),
    ).toEqual([{ kind: 'prompts', href: '/dashboard/prompts' }]);
  });

  it("points AI Traffic's page findings at AI Traffic and names only their pages (AT-013)", () => {
    const pages = { entity: 'pages', targets: [{ id: '/old-menu', label: '/old-menu' }] };
    const broken = signal({
      category: 'technical',
      kind: 'broken_citation_target',
      payload: pages,
    });
    const unread = signal({
      category: 'technical',
      kind: 'cited_page_uncrawled',
      payload: pages,
      currentValue: 3,
    });
    for (const s of [broken, unread]) {
      expect(signalLinks(s)).toEqual([{ kind: 'traffic', href: '/dashboard/traffic' }]);
      expect(signalWhereFields(s).map((f) => f.key)).toEqual(['pages']);
    }
    // Read over the bot report's 30 days.
    expect(signalChange(unread)?.period).toBe('last_30_days');

    const platform = signal({
      category: 'traffic',
      kind: 'ai_platform_new',
      payload: { aiSource: 'grok.com' },
      currentValue: 3,
    });
    expect(signalWhereFields(platform)).toEqual([
      { key: 'scope', value: { type: 'scope', scope: 'platform' } },
    ]);
    expect(signalLinks(platform)).toEqual([{ kind: 'traffic', href: '/dashboard/traffic' }]);
  });
});

describe('currentActionFirst', () => {
  const byLink = [{ id: 'b' }, { id: 'a' }, { id: 'c' }];

  it("puts the signal's current action first and keeps the others by latest link", () => {
    // A signal that rejoined a reopened action keeps that link's first date.
    expect(currentActionFirst(byLink, 'a').map((a) => a.id)).toEqual(['a', 'b', 'c']);
    expect(currentActionFirst(byLink, 'b').map((a) => a.id)).toEqual(['b', 'a', 'c']);
  });

  it('leaves the order when the current action is not among them', () => {
    expect(currentActionFirst(byLink, null).map((a) => a.id)).toEqual(['b', 'a', 'c']);
    expect(currentActionFirst(byLink, 'z').map((a) => a.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('signalDetailForApi', () => {
  it('returns the same detail with snake_case keys, units and named platforms', () => {
    const detail = signalDetailForApi({ ...lostCitation, actionId: 'a1' }, [
      { id: 'a1', action_no: 52, kind: 'recover_lost_citations', status: 'new' },
    ]);
    expect(detail.where).toEqual({
      prompt: { id: 'p1', text: 'Best coffee subscription?' },
      topic: 'Coffee',
      tracked_on: [
        { slug: 'chatgpt-web', name: 'ChatGPT' },
        { slug: 'gemini-web', name: 'Gemini' },
      ],
      tracked_in: [{ code: 'US', name: 'United States' }],
      lost_url: null,
      cited_now: null,
    });
    expect(detail.change).toBeNull();
    expect(detail.evidence).toEqual({
      first_detected_at: '2026-10-08T10:53:00+00:00',
      last_detected_at: '2026-10-09T10:53:00+00:00',
      links: [{ kind: 'prompt_answers', path: '/dashboard/prompts/p1' }],
    });
    expect(detail.used_by_actions).toHaveLength(1);
    expect(signalDetailForApi(platformDrop, []).change?.figures[0]).toEqual({
      metric: 'mention_rate',
      role: 'before',
      value: 34,
      unit: 'percent',
      subject: null,
      subject_type: null,
      of: null,
      period: 'week_over_week',
    });
  });
});

describe('a lost citation with its evidence recorded', () => {
  const recorded = signal({
    category: 'citation',
    kind: 'lost_citations',
    payload: {
      promptId: 'p1',
      promptText: 'Best coffee subscription?',
      platforms: ['chatgpt-web'],
      regions: ['US'],
      citedDays: 9,
      days: 11,
      quietDays: 3,
      lostUrls: [
        { url: 'https://coffee.example/guide', position: 2, lastCitedAt: '2026-10-08T05:00:00Z' },
      ],
      citedNow: [
        { url: 'https://rival.example/best', domain: 'rival.example', answers: 3, position: 1 },
      ],
    },
    where: { platforms: ['chatgpt-web'], regions: ['US'], topics: ['Coffee'] },
  });

  it('names the page lost and the pages cited now, on the platforms it was lost on', () => {
    expect(signalWhereFields(recorded).map((f) => f.key)).toEqual([
      'prompt',
      'topic',
      'platforms',
      'locations',
      'lostUrl',
      'citedNow',
    ]);
    const byKey = Object.fromEntries(signalWhereFields(recorded).map((f) => [f.key, f.value]));
    expect(byKey.lostUrl).toEqual({
      type: 'citations',
      items: [
        { url: 'https://coffee.example/guide', position: 2, lastCitedAt: '2026-10-08T05:00:00Z' },
      ],
    });
    expect(byKey.citedNow).toEqual({
      type: 'citations',
      items: [{ url: 'https://rival.example/best', position: 1, answers: 3 }],
    });
  });

  it('counts its cited days before and since', () => {
    expect(signalChange(recorded)).toEqual({
      period: 'last_14_days',
      figures: [
        { metric: 'cited_days', role: 'earlier', value: 9, of: 11 },
        { metric: 'cited_days', role: 'latest', value: 0, of: 3 },
      ],
    });
  });
});

describe('a competitor signal with its evidence recorded', () => {
  const recorded = signal({
    category: 'competitor',
    kind: 'competitor_momentum',
    payload: {
      entity: 'competitors',
      competitorName: 'Profound',
      competitorId: 'c1',
      targets: [{ id: 'c1', label: 'Profound' }],
      positions: [
        {
          promptId: 'p1',
          promptText: 'Best AI rank tracker?',
          platform: 'chatgpt-web',
          competitor: { now: 1, before: 3 },
          you: { now: 3, before: 2 },
        },
      ],
      winningSources: [{ domain: 'g2.example', answers: 2, answersRead: 3 }],
    },
    previousValue: 12,
    currentValue: 31,
  });

  it('shows its positions by prompt, the sources behind its wins, and where it leads', () => {
    const byKey = Object.fromEntries(signalWhereFields(recorded).map((f) => [f.key, f.value]));
    expect(byKey.competitor).toEqual({ type: 'text', text: 'Profound' });
    expect(byKey.platforms).toEqual({ type: 'platforms', slugs: ['chatgpt-web'] });
    expect(byKey.competitorPositions).toEqual({
      type: 'positions',
      competitor: 'Profound',
      items: [
        {
          promptId: 'p1',
          promptText: 'Best AI rank tracker?',
          platform: 'chatgpt-web',
          competitor: { now: 1, before: 3 },
          you: { now: 3, before: 2 },
        },
      ],
    });
    expect(byKey.winningSources).toEqual({
      type: 'sources',
      items: [{ domain: 'g2.example', answers: 2, answersRead: 3 }],
    });
  });

  it("lists a competitor's page events newest first, and none as a finding too", () => {
    const withEvents = {
      ...recorded,
      payload: {
        ...recorded.payload,
        competitorId: 'c1',
        pageEventDays: 28,
        pageEvents: [
          {
            kind: 'first_cited',
            at: '2026-10-03T00:00:00Z',
            url: 'https://profound.example/guide',
            domain: 'profound.example',
            detail: { answers: 2 },
          },
          {
            kind: 'changed',
            at: '2026-10-12T03:00:00Z',
            url: 'https://profound.example/pricing',
            domain: 'profound.example',
            detail: { gained: [{ key: 'faq', label: 'FAQ section' }], lost: [] },
          },
          { kind: 'changed', at: 'not a date', url: 'https://x.example' },
        ],
      },
    };
    const events = (signal: typeof recorded) =>
      signalWhereFields(signal).find((f) => f.key === 'competitorPageEvents')?.value;
    expect(events(withEvents)).toEqual({
      type: 'pageEvents',
      competitorId: 'c1',
      days: 28,
      items: [
        {
          kind: 'changed',
          at: '2026-10-12T03:00:00Z',
          url: 'https://profound.example/pricing',
          domain: 'profound.example',
          answers: null,
          gained: [{ key: 'faq', label: 'FAQ section' }],
          lost: [],
        },
        {
          kind: 'first_cited',
          at: '2026-10-03T00:00:00Z',
          url: 'https://profound.example/guide',
          domain: 'profound.example',
          answers: 2,
          gained: [],
          lost: [],
        },
      ],
    });
    expect(events({ ...recorded, payload: { ...recorded.payload, pageEvents: [] } })).toMatchObject(
      { type: 'pageEvents', items: [], days: 28 },
    );
    // Recorded before page events were read: not looked at, not none.
    expect(events(recorded)).toBeNull();

    const { where } = signalDetailForApi(withEvents, []);
    expect(where.competitor_page_events).toEqual({
      days: 28,
      items: [
        {
          kind: 'changed',
          at: '2026-10-12T03:00:00Z',
          url: 'https://profound.example/pricing',
          gained: [{ key: 'faq', label: 'FAQ section' }],
          lost: [],
        },
        {
          kind: 'first_cited',
          at: '2026-10-03T00:00:00Z',
          url: 'https://profound.example/guide',
          answers: 2,
        },
      ],
    });
  });

  it('returns the same over the API', () => {
    const { where } = signalDetailForApi(recorded, []);
    expect(where.competitor_positions).toEqual([
      {
        prompt_id: 'p1',
        prompt_text: 'Best AI rank tracker?',
        platform: { slug: 'chatgpt-web', name: 'ChatGPT' },
        competitor: { now: 1, before: 3 },
        you: { now: 3, before: 2 },
      },
    ]);
    expect(where.winning_sources).toEqual([{ domain: 'g2.example', answers: 2, answers_read: 3 }]);
  });
});

describe('an uncited-mentions signal', () => {
  const base = {
    category: 'mention' as const,
    kind: 'uncited_mentions' as const,
    currentValue: 4,
    where: { platforms: ['chatgpt-web', 'claude'], regions: ['US'], topics: [] },
  };
  const mention = {
    promptId: 'p1',
    promptText: 'Best coffee subscription?',
    platforms: ['gemini-web'],
    answers: 3,
    position: 2,
    sentiment: 'positive',
    excerpt: '…Acme Coffee ships beans weekly.',
    excerptPlatform: 'gemini-web',
    excerptAt: '2026-10-14T05:00:00Z',
  };

  it('asks for position, sentiment and an excerpt until its evidence is recorded', () => {
    const keys = signalWhereFields(signal({ ...base, payload: { promptIds: ['p1', 'p2'] } })).map(
      (f) => `${f.key}${f.value ? '' : ' (n/a)'}`,
    );
    expect(keys).toEqual([
      'prompts',
      'trackedOn',
      'trackedIn',
      'position (n/a)',
      'sentiment (n/a)',
      'excerpt (n/a)',
    ]);
  });

  it('gives them per prompt once recorded, on the platforms that mention it', () => {
    const recorded = signal({ ...base, payload: { promptIds: ['p1', 'p2'], mentions: [mention] } });
    const fields = signalWhereFields(recorded);
    // The evidence names the platforms; the locations are still where the
    // prompts are tracked.
    expect(fields.map((f) => f.key)).toEqual([
      'prompts',
      'platforms',
      'trackedIn',
      'mentionDetails',
    ]);
    expect(fields.find((f) => f.key === 'platforms')?.value).toEqual({
      type: 'platforms',
      slugs: ['gemini-web'],
    });
    expect(signalDetailForApi(recorded, []).where.mention_details).toEqual([
      {
        prompt_id: 'p1',
        prompt_text: 'Best coffee subscription?',
        platforms: [{ slug: 'gemini-web', name: 'Gemini' }],
        answers: 3,
        position: 2,
        sentiment: 'positive',
        excerpt: '…Acme Coffee ships beans weekly.',
        excerpt_platform: 'gemini-web',
        excerpt_at: '2026-10-14T05:00:00Z',
      },
    ]);
  });
});

describe("a technical finding with its checks' evidence", () => {
  const issue = {
    check: 'ai-bot-access',
    label: 'AI bot access (robots.txt)',
    evidence: { aiBotsMentioned: ['gptbot', 'claudebot'], blocked: true, blockedBots: ['gptbot'] },
  };
  const blocked = signal({
    category: 'technical',
    kind: 'crawler_blocked',
    payload: {
      entity: 'pages',
      targets: [{ id: '/pricing', label: '/pricing', checks: ['ai-bot-access'], issues: [issue] }],
    },
    currentValue: 1,
  });

  it('names the issue, the crawlers it blocks, and what the check found', () => {
    expect(signalWhereFields(blocked)).toEqual([
      { key: 'pages', value: { type: 'list', items: ['/pricing'], total: 1 } },
      { key: 'issue', value: { type: 'list', items: ['AI bot access (robots.txt)'], total: 1 } },
      { key: 'crawlers', value: { type: 'crawlers', agents: ['gptbot'] } },
      {
        key: 'evidence',
        value: { type: 'issues', items: [{ page: '/pricing', ...issue }] },
      },
    ]);
    expect(signalDetailForApi(blocked, []).where.crawlers).toEqual(['gptbot']);
  });

  it("doesn't guess the crawlers from an audit that only said one was blocked", () => {
    // That audit also listed bots robots.txt allows.
    const older = signal({
      ...blocked,
      payload: {
        entity: 'pages',
        targets: [
          {
            id: '/pricing',
            issues: [
              { ...issue, evidence: { aiBotsMentioned: ['gptbot', 'claudebot'], blocked: true } },
            ],
          },
        ],
      },
    });
    const byKey = Object.fromEntries(signalWhereFields(older).map((f) => [f.key, f.value]));
    expect(byKey.crawlers).toBeNull();
  });
});

describe('a traffic signal with its referrals and prompts', () => {
  const referrals = {
    page: '/pricing',
    source: 'analytics',
    sessions: 4,
    before: 9,
    platforms: [{ platform: 'chatgpt.com', sessions: 4, before: 9 }],
  };
  const opportunity = signal({
    category: 'traffic',
    kind: 'page_opportunity',
    payload: {
      landingPage: '/pricing',
      valueRank: 3,
      referrals: [referrals],
      referralDays: 14,
      citablePrompts: [{ id: 'p1', text: 'Best coffee subscription?' }],
      citablePromptsTotal: 1,
    },
    currentValue: 120,
  });

  it('gives the AI referrals by platform and the prompts the page could be cited on', () => {
    const byKey = Object.fromEntries(signalWhereFields(opportunity).map((f) => [f.key, f.value]));
    expect(byKey.url).toEqual({ type: 'text', text: '/pricing' });
    expect(byKey.aiReferrals).toEqual({ type: 'referrals', items: [referrals], days: 14 });
    expect(byKey.citablePrompts).toEqual({
      type: 'prompts',
      items: [{ id: 'p1', text: 'Best coffee subscription?' }],
      total: 1,
    });
    expect(signalDetailForApi(opportunity, []).where.ai_referrals).toEqual({
      days: 14,
      items: [
        {
          ...referrals,
          platforms: [{ platform: 'chatgpt.com', name: 'ChatGPT', sessions: 4, before: 9 }],
        },
      ],
    });
  });

  it('says none were found once looked for, and "Not available" before', () => {
    const none = signal({
      ...opportunity,
      payload: {
        landingPage: '/pricing',
        referrals: [],
        citablePrompts: [],
        citablePromptsTotal: 0,
      },
    });
    const byKey = Object.fromEntries(signalWhereFields(none).map((f) => [f.key, f.value]));
    expect(byKey.citablePrompts).toEqual({ type: 'prompts', items: [], total: 0 });
    expect(byKey.aiReferrals).toBeNull();

    const older = signal({ ...opportunity, payload: { landingPage: '/pricing', valueRank: 3 } });
    const fields = Object.fromEntries(signalWhereFields(older).map((f) => [f.key, f.value]));
    expect(fields.aiReferrals).toBeNull();
    expect(fields.citablePrompts).toBeNull();
  });
});

describe('the AI-traffic windows', () => {
  it('says the traffic findings compare 14 days, not 7', () => {
    const slipping = signal({
      category: 'traffic',
      kind: 'ai_traffic_slipping',
      payload: { entity: 'pages', targets: [{ id: '/a' }, { id: '/b' }] },
      currentValue: 2,
    });
    expect(signalChange(slipping)?.period).toBe('last_fortnight');
    const drop = signal({
      ...slipping,
      kind: 'ai_traffic_drop',
      previousValue: 90,
      currentValue: 40,
    });
    expect(signalChange(drop)?.period).toBe('fortnight_over_fortnight');
  });

  const crossChannel = signal({
    category: 'traffic',
    kind: 'cross_channel_risk',
    payload: { entity: 'pages', targets: [{ id: 'site' }], clicksBefore: 900, clicksNow: 600 },
    previousValue: 120,
    currentValue: 80,
  });
  const trafficLoss = signal({
    category: 'traffic',
    kind: 'visibility_traffic_loss',
    payload: { entity: 'pages', targets: [{ id: 'site' }], mentionsBefore: 40, mentionsNow: 25 },
    previousValue: 120,
    currentValue: 80,
  });

  it('gives a cross-channel finding the window each of its figures was read over', () => {
    // AI sessions over 14 days, search clicks over Search Console's 28.
    const risk = signalChange(crossChannel);
    expect(risk?.period).toBe('fortnight_over_fortnight');
    expect(risk?.figures.map((f) => f.period)).toEqual([
      undefined,
      undefined,
      'four_weeks_over_four_weeks',
      'four_weeks_over_four_weeks',
    ]);
    // AI sessions over 14 days, mentions over the library's 7.
    const loss = signalChange(trafficLoss);
    expect(loss?.period).toBe('fortnight_over_fortnight');
    expect(loss?.figures.map((f) => f.period)).toEqual([
      undefined,
      undefined,
      'week_over_week',
      'week_over_week',
    ]);
  });

  it("gives every figure's window to the MCP tools", () => {
    const windows = (s: Signal) =>
      signalDetailForApi(s, []).change?.figures.map((f) => `${f.metric}:${f.period}`);
    expect(windows(crossChannel)).toEqual([
      'ai_sessions:fortnight_over_fortnight',
      'ai_sessions:fortnight_over_fortnight',
      'search_clicks:four_weeks_over_four_weeks',
      'search_clicks:four_weeks_over_four_weeks',
    ]);
    expect(windows(trafficLoss)).toEqual([
      'ai_sessions:fortnight_over_fortnight',
      'ai_sessions:fortnight_over_fortnight',
      'mentions:week_over_week',
      'mentions:week_over_week',
    ]);
  });

  it('asks a site-wide finding where its visits come from, not which prompts', () => {
    const site = signal({
      category: 'traffic',
      kind: 'visibility_traffic_loss',
      payload: { entity: 'pages', targets: [{ id: 'site', label: '' }] },
      previousValue: 120,
      currentValue: 80,
    });
    expect(signalWhereFields(site).map((f) => f.key)).toEqual(['scope', 'aiReferrals']);
  });
});

describe("an AI-traffic finding's pages", () => {
  const winner = signal({
    category: 'traffic',
    kind: 'ai_landing_page_winner',
    payload: {
      entity: 'pages',
      targets: [
        {
          id: '/pricing',
          label: '/pricing',
          before: 42,
          now: 40,
          engagedRate: 0.75,
          keyEvents: 8,
          keyEventsBefore: 5,
          keyRate: 0.2,
        },
      ],
      siteEngagedRate: 0.444,
      siteKeyRate: 0.089,
    },
    currentValue: 1,
  });

  it('gives each page its sessions and what its AI visitors did, beside the site', () => {
    const pages = signalWhereFields(winner).find((f) => f.key === 'pages')?.value;
    expect(pages).toEqual({
      type: 'trafficPages',
      items: [
        {
          page: '/pricing',
          sessions: 40,
          before: 42,
          engagedRate: 0.75,
          keyRate: 0.2,
          keyEvents: 8,
          keyEventsBefore: 5,
        },
      ],
      total: 1,
      metrics: ['keyEvents', 'keyRate'],
      siteEngagedRate: 0.444,
      siteKeyRate: 0.089,
    });
    // `items` stays the page list other signals give; the figures ride beside.
    expect(signalDetailForApi(winner, []).where.pages).toEqual({
      total: 1,
      items: ['/pricing'],
      traffic: [
        {
          page: '/pricing',
          sessions: 40,
          sessions_before: 42,
          engaged_rate: 0.75,
          key_events: 8,
          key_events_before: 5,
          key_events_per_session: 0.2,
        },
      ],
      site_engaged_rate: 0.444,
      site_key_events_per_session: 0.089,
    });
  });

  it("counts a drop's pages, not its sessions, and reads a snippet page's visits only", () => {
    const drop = signal({
      category: 'traffic',
      kind: 'ai_traffic_drop',
      payload: {
        entity: 'pages',
        targets: [{ id: '/blog', label: '/blog', before: 20, now: 6 }],
        pageCount: 120,
      },
      previousValue: 120,
      currentValue: 70,
    });
    expect(signalWhereFields(drop).find((f) => f.key === 'pages')?.value).toEqual({
      type: 'trafficPages',
      items: [
        {
          page: '/blog',
          sessions: 6,
          before: 20,
          engagedRate: null,
          keyRate: null,
          keyEvents: null,
          keyEventsBefore: null,
        },
      ],
      total: 120,
      metrics: [],
      siteEngagedRate: null,
      siteKeyRate: null,
    });
  });

  it('leaves out sessions a target does not record', () => {
    const bare = signal({
      category: 'traffic',
      kind: 'ai_traffic_slipping',
      payload: { entity: 'pages', targets: [{ id: '/blog', label: '/blog' }] },
      currentValue: 1,
    });
    const pages = signalWhereFields(bare).find((f) => f.key === 'pages')?.value;
    expect(pages?.type === 'trafficPages' && pages.items[0]).toMatchObject({
      sessions: null,
      before: null,
    });
  });
});

describe('the Search Console windows', () => {
  it('says the Search Console findings count queries over 28 days, not 7', () => {
    const kinds = [
      'gsc_demand_gap',
      'search_ai_misalignment',
      'gsc_low_ctr',
      'gsc_risk',
      'gsc_decline',
    ] as const;
    for (const kind of kinds) {
      const queries = signal({
        category: 'traffic',
        kind,
        payload: { entity: 'queries', targets: [{ id: 'aeo tools' }, { id: 'aeo audit' }] },
        currentValue: 2,
      });
      expect(signalChange(queries)).toEqual({
        period: 'last_four_weeks',
        figures: [{ metric: 'queries', role: 'total', value: 2 }],
      });
    }
  });
});
