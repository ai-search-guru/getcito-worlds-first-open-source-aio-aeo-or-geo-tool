import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ tables: {}, rpc: vi.fn() }));

/** Minimal chainable stand-in for the supabase query builder. */
function query(rows) {
  const result = { data: rows, error: null, count: rows.length };
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    lt: () => chain,
    in: () => chain,
    then: (resolve) => resolve(result),
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => query(db.tables[table] ?? []),
    rpc: (...args) => db.rpc(...args),
  },
}));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../email.js', () => ({ sendEmail: vi.fn() }));

const { probeStatus, findIssues, renderHealthEmail, collectHealthReport, fanoutDropped, PROBES } =
  await import('./report.js');

/** The read probes' calls, without the fan-out check's. */
const probeCalls = () => db.rpc.mock.calls.filter(([name]) => name === 'health_probe');

const NOW = Date.parse('2026-10-06T06:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600_000).toISOString();

beforeEach(() => {
  db.tables = {};
  db.rpc.mockReset();
  process.env.HEALTH_PROBE_BRAND_ID = 'brand-probe';
  process.env.HEALTH_PROBE_USER_ID = 'user-probe';
});

afterEach(() => {
  delete process.env.HEALTH_PROBE_BRAND_ID;
  delete process.env.HEALTH_PROBE_USER_ID;
  delete process.env.CLORO_CHATGPT_FANOUT;
});

describe('probeStatus', () => {
  it('is green under 4s, yellow from 4s, red from the 8s budget or on error', () => {
    expect(probeStatus(3.99)).toBe('green');
    expect(probeStatus(4)).toBe('yellow');
    expect(probeStatus(7.99)).toBe('yellow');
    expect(probeStatus(8)).toBe('red');
    expect(probeStatus(null)).toBe('red');
  });
});

describe('collectHealthReport', () => {
  it('times every probe as the configured member and brand', async () => {
    db.rpc.mockResolvedValue({ data: 0.5, error: null });
    const report = await collectHealthReport(NOW);

    expect(probeCalls()).toHaveLength(PROBES.length);
    expect(db.rpc).toHaveBeenCalledWith('health_probe', {
      p_user_id: 'user-probe',
      p_brand_id: 'brand-probe',
      p_probe: 'citations_domains_daily',
      p_days: 1,
    });
    expect(report.probes.results.every((r) => r.status === 'green')).toBe(true);
  });

  it("times the Topics tab's own reads first: its 24 hours and 90 days", () => {
    expect(PROBES.slice(0, 2)).toEqual([
      { probe: 'topics_overview_window', days: 1 },
      { probe: 'topics_overview_window', days: 90 },
    ]);
    expect(PROBES.some((p) => p.probe === 'topics_overview_aggregates')).toBe(false);
  });

  it("times the Mentions & Sentiment tabs' reads last, at 30 and 90 days", () => {
    expect(PROBES.slice(-6)).toEqual([
      { probe: 'mentions_list', days: 30 },
      { probe: 'mentions_list', days: 90 },
      { probe: 'mentions_perception', days: 30 },
      { probe: 'mentions_perception', days: 90 },
      // Perception's live read too (00241): what a filtered view still costs.
      { probe: 'mentions_perception_live', days: 30 },
      { probe: 'mentions_perception_live', days: 90 },
    ]);
  });

  it('skips the probes when they are not configured', async () => {
    delete process.env.HEALTH_PROBE_BRAND_ID;
    const report = await collectHealthReport(NOW);
    expect(report.probes.skipped).toBeTruthy();
    expect(probeCalls()).toHaveLength(0);
  });

  it('reports failed, stuck and missing nightly runs, ignoring manual ones', async () => {
    db.rpc.mockResolvedValue({ data: 0.1, error: null });
    db.tables.jobs = [
      // ran last week and last night
      {
        brand_id: 'ok',
        status: 'completed',
        created_at: hoursAgo(30),
        updated_at: hoursAgo(29),
        data: {},
      },
      {
        brand_id: 'ok',
        status: 'completed',
        created_at: hoursAgo(4),
        updated_at: hoursAgo(3),
        data: {},
      },
      // killed by a restart last night
      {
        brand_id: 'killed',
        status: 'completed',
        created_at: hoursAgo(30),
        updated_at: hoursAgo(29),
        data: {},
      },
      {
        brand_id: 'killed',
        status: 'failed',
        failed_reason: 'Server restarted during execution',
        created_at: hoursAgo(4),
        updated_at: hoursAgo(3),
        data: {},
      },
      // waiting since the night began
      {
        brand_id: 'stuck',
        status: 'completed',
        created_at: hoursAgo(30),
        updated_at: hoursAgo(29),
        data: {},
      },
      {
        brand_id: 'stuck',
        status: 'waiting',
        created_at: hoursAgo(4),
        updated_at: hoursAgo(4),
        data: {},
      },
      // a manual run does not count as the night's run
      {
        brand_id: 'manual',
        status: 'completed',
        created_at: hoursAgo(30),
        updated_at: hoursAgo(29),
        data: {},
      },
      {
        brand_id: 'manual',
        status: 'completed',
        created_at: hoursAgo(2),
        updated_at: hoursAgo(1),
        data: { immediate: true },
      },
    ];
    db.tables.brands = [
      { id: 'killed', name: 'Killed Co' },
      { id: 'stuck', name: 'Stuck Co' },
      { id: 'manual', name: 'Manual Co' },
    ];

    const { nightly } = await collectHealthReport(NOW);

    expect(nightly.failed).toEqual([
      { brand: 'Killed Co', reason: 'Server restarted during execution' },
    ]);
    expect(nightly.restartKills).toBe(1);
    expect(nightly.stuck).toEqual([{ brand: 'Stuck Co', status: 'waiting' }]);
    expect(nightly.missing.sort()).toEqual(['Killed Co', 'Manual Co', 'Stuck Co']);
  });

  it('keeps reporting when one check fails', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: 'statement timeout' } });
    const report = await collectHealthReport(NOW);
    expect(report.probes.results[0]).toMatchObject({ status: 'red', error: 'statement timeout' });
    expect(report.nightly.counts).toEqual({});
    // The action count check (AC-009) asks for five examples, and says when it can't run.
    expect(db.rpc).toHaveBeenCalledWith('action_count_drift', { p_examples: 5 });
    expect(report.actionCounts).toEqual({ error: 'statement timeout' });
  });
});

describe('query fan-out', () => {
  const coverage = (recent, before) => (name, args) => {
    if (name !== 'fanout_coverage_by_platform') return Promise.resolve({ data: 0.1, error: null });
    const rows = args.p_until === new Date(NOW).toISOString() ? recent : before;
    return Promise.resolve({ data: rows, error: null });
  };

  it("compares each platform's share of answers with fan-out to the week before", async () => {
    // Every ChatGPT task asks for it here, so a silent day is news.
    process.env.CLORO_CHATGPT_FANOUT = 'all';
    db.rpc.mockImplementation(
      coverage(
        [
          { platform: 'chatgpt-web', answers: 200, answers_with_fanout: 0 },
          { platform: 'copilot-web', answers: 200, answers_with_fanout: 40 },
          { platform: 'gemini-web', answers: 200, answers_with_fanout: 0 },
        ],
        [
          { platform: 'chatgpt-web', answers: 1400, answers_with_fanout: 350 },
          { platform: 'copilot-web', answers: 1400, answers_with_fanout: 280 },
          { platform: 'gemini-web', answers: 1400, answers_with_fanout: 0 },
        ],
      ),
    );
    const report = await collectHealthReport(NOW);

    expect(db.rpc).toHaveBeenCalledWith('fanout_coverage_by_platform', {
      p_since: hoursAgo(24),
      p_until: new Date(NOW).toISOString(),
    });
    expect(db.rpc).toHaveBeenCalledWith('fanout_coverage_by_platform', {
      p_since: hoursAgo(24 * 4),
      p_until: hoursAgo(24),
    });
    expect(report.fanout.platforms).toEqual([
      expect.objectContaining({ platform: 'chatgpt-web', rate: 0, baselineRate: 0.25 }),
      expect.objectContaining({ platform: 'copilot-web', rate: 0.2, baselineRate: 0.2 }),
      expect.objectContaining({ platform: 'gemini-web', rate: 0, baselineRate: 0 }),
    ]);
    // ChatGPT stopped; Copilot held; Gemini never fans out, so it isn't news.
    expect(findIssues(report).filter((i) => i.includes('fan-out'))).toEqual([
      'chatgpt-web returned no query fan-out on any of its 200 answers in the last 24h (25% the days before) — check what Cloro returns',
    ]);
    expect(renderHealthEmail(report).html).toContain('Query fan-out');
  });

  it('flags a partial collapse too, but not a platform with too few answers to judge', () => {
    const base = { platform: 'x', withFanout: 5, baselineAnswers: 500 };
    expect(fanoutDropped({ ...base, answers: 100, rate: 0.05, baselineRate: 0.3 })).toBe(true);
    expect(fanoutDropped({ ...base, answers: 100, rate: 0.2, baselineRate: 0.3 })).toBe(false);
    expect(fanoutDropped({ ...base, answers: 5, rate: 0, baselineRate: 0.3 })).toBe(false);
    expect(fanoutDropped({ ...base, answers: 100, rate: 0, baselineRate: 0.02 })).toBe(false);
  });

  it('keeps flagging an engine that should fan out, however long it has been silent', () => {
    // Nothing for two weeks, so the days before are empty too.
    const silent = {
      platform: 'copilot-web',
      answers: 400,
      withFanout: 0,
      rate: 0,
      baselineAnswers: 1200,
      baselineRate: 0,
    };
    expect(fanoutDropped(silent)).toBe(true);
    // Gemini documents no fan-out, so a silent day is normal for it.
    expect(fanoutDropped({ ...silent, platform: 'gemini-web' })).toBe(false);
    // Nor is it news on ChatGPT, whose default interface carries none (#1119),
    // when nothing asks for its legacy one, or in a report from before it did.
    expect(fanoutDropped({ ...silent, platform: 'chatgpt-web' })).toBe(false);
    expect(fanoutDropped({ ...silent, platform: 'chatgpt-web', chatgptFanout: 'off' })).toBe(false);
    // When every ChatGPT task asks, it should fan out like Copilot.
    expect(fanoutDropped({ ...silent, platform: 'chatgpt-web', chatgptFanout: 'all' })).toBe(true);
    // The OpenAI API model may search rarely or not at all, so a silent day
    // is no news for it either...
    expect(fanoutDropped({ ...silent, platform: 'chatgpt' })).toBe(false);
    // ...but a fall from what it shared the days before is, and it's OpenAI's.
    const fell = { ...silent, platform: 'chatgpt', withFanout: 4, rate: 0.01, baselineRate: 0.3 };
    expect(fanoutDropped(fell)).toBe(true);
    expect(
      findIssues({
        probes: {},
        nightly: {},
        cloro: {},
        fanout: { platforms: [fell] },
      }).filter((i) => i.includes('fan-out')),
    ).toEqual([
      "chatgpt query fan-out fell to 1% of answers (30% the days before) — check what OpenAI's web_search returns",
    ]);
  });

  describe("ChatGPT's sample, one day a week per prompt", () => {
    beforeEach(() => {
      process.env.CLORO_CHATGPT_FANOUT = 'sample';
    });

    /** Rows per window, keyed by the window's start. */
    const windows = (recent, before, older) => (name, args) => {
      if (name !== 'fanout_coverage_by_platform') {
        return Promise.resolve({ data: 0.1, error: null });
      }
      const rows = {
        [hoursAgo(24)]: recent,
        [hoursAgo(24 * 4)]: before,
        [hoursAgo(24 * 7)]: older,
      };
      return Promise.resolve({ data: rows[args.p_since] ?? [], error: null });
    };
    const chatgpt = (answers, withFanout) => [
      { platform: 'chatgpt-web', answers, answers_with_fanout: withFanout },
    ];

    it('is judged on its last 7 days, so a day without a sampled prompt is no alarm', async () => {
      // A small install: none of today's prompts fell on their day.
      db.rpc.mockImplementation(windows(chatgpt(30, 0), chatgpt(90, 14), chatgpt(90, 12)));
      const report = await collectHealthReport(NOW);

      expect(db.rpc).toHaveBeenCalledWith('fanout_coverage_by_platform', {
        p_since: hoursAgo(24 * 7),
        p_until: hoursAgo(24 * 4),
      });
      expect(report.fanout.platforms).toEqual([
        expect.objectContaining({
          platform: 'chatgpt-web',
          answers: 30,
          withFanout: 0,
          chatgptFanout: 'sample',
          weekAnswers: 210,
          weekWithFanout: 26,
        }),
      ]);
      expect(findIssues(report).filter((i) => i.includes('fan-out'))).toEqual([]);
      expect(renderHealthEmail(report).html).toContain('7 days, sampled: 12% (26 / 210)');
    });

    it('nor a day whose share fell below a quarter of the days before', async () => {
      db.rpc.mockImplementation(windows(chatgpt(300, 3), chatgpt(900, 150), chatgpt(900, 140)));
      const report = await collectHealthReport(NOW);
      expect(findIssues(report).filter((i) => i.includes('fan-out'))).toEqual([]);
    });

    it('is flagged when none of the week carried any', async () => {
      db.rpc.mockImplementation(windows(chatgpt(30, 0), chatgpt(90, 0), chatgpt(90, 0)));
      const report = await collectHealthReport(NOW);
      expect(findIssues(report).filter((i) => i.includes('fan-out'))).toEqual([
        "chatgpt-web returned no query fan-out on any of its 210 answers in the last 7 days, though each prompt asks for it one day a week — check what Cloro's legacy ChatGPT interface returns",
      ]);
    });

    it('needs seven times the usual answers in the week to judge, as a seventh asked', () => {
      const sampled = {
        platform: 'chatgpt-web',
        chatgptFanout: 'sample',
        answers: 0,
        withFanout: 0,
      };
      expect(fanoutDropped({ ...sampled, weekAnswers: 139, weekWithFanout: 0 })).toBe(false);
      expect(fanoutDropped({ ...sampled, weekAnswers: 140, weekWithFanout: 0 })).toBe(true);
      expect(fanoutDropped({ ...sampled, weekAnswers: 140, weekWithFanout: 1 })).toBe(false);
    });

    it('judges the last day alone too on an install that large, so it hears the next day', async () => {
      db.rpc.mockImplementation(windows(chatgpt(200, 0), chatgpt(900, 150), chatgpt(900, 140)));
      const report = await collectHealthReport(NOW);
      expect(findIssues(report).filter((i) => i.includes('fan-out'))).toEqual([
        "chatgpt-web returned no query fan-out on any of its 200 answers in the last 24h, though each prompt asks for it one day a week — check what Cloro's legacy ChatGPT interface returns",
      ]);

      const sampled = { platform: 'chatgpt-web', chatgptFanout: 'sample', weekWithFanout: 9 };
      expect(fanoutDropped({ ...sampled, answers: 139, withFanout: 0, weekAnswers: 900 })).toBe(
        false,
      );
      expect(fanoutDropped({ ...sampled, answers: 140, withFanout: 0, weekAnswers: 900 })).toBe(
        true,
      );
    });

    it('leaves only ChatGPT unjudged when its extra days cannot be read', async () => {
      db.rpc.mockImplementation((name, args) => {
        if (name !== 'fanout_coverage_by_platform') {
          return Promise.resolve({ data: 0.1, error: null });
        }
        if (args.p_since === hoursAgo(24 * 7)) {
          return Promise.resolve({ data: null, error: { message: 'timeout' } });
        }
        const rows = [
          { platform: 'chatgpt-web', answers: 300, answers_with_fanout: 0 },
          { platform: 'copilot-web', answers: 200, answers_with_fanout: 0 },
        ];
        return Promise.resolve({ data: rows, error: null });
      });
      const report = await collectHealthReport(NOW);

      expect(report.fanout.error).toBeUndefined();
      expect(report.fanout.platforms[0]).toMatchObject({
        platform: 'chatgpt-web',
        weekError: 'timeout',
      });
      expect(findIssues(report).filter((i) => i.includes('fan-out'))).toEqual([
        'chatgpt-web query fan-out could not be checked: timeout',
        'copilot-web returned no query fan-out on any of its 200 answers in the last 24h (0% the days before) — check what Cloro returns',
      ]);
      expect(renderHealthEmail(report).html).toContain('7 days, sampled: could not check');
    });

    it('is off on self-host unless set, and reads no extra days then', async () => {
      delete process.env.CLORO_CHATGPT_FANOUT;
      db.rpc.mockImplementation(windows(chatgpt(300, 0), chatgpt(900, 150), []));
      const report = await collectHealthReport(NOW);
      const reads = db.rpc.mock.calls.filter(([name]) => name === 'fanout_coverage_by_platform');
      expect(reads).toHaveLength(2);
      expect(report.fanout.platforms[0]).toMatchObject({ chatgptFanout: 'off' });
    });

    it('reads the extra days only on sample', async () => {
      process.env.CLORO_CHATGPT_FANOUT = 'off';
      db.rpc.mockImplementation(windows(chatgpt(300, 0), chatgpt(900, 150), []));
      const report = await collectHealthReport(NOW);

      const reads = db.rpc.mock.calls.filter(([name]) => name === 'fanout_coverage_by_platform');
      expect(reads).toHaveLength(2);
      expect(report.fanout.platforms[0]).not.toHaveProperty('weekAnswers');
      // Off asks for nothing, so its fall to none is no news either.
      expect(findIssues(report).filter((i) => i.includes('fan-out'))).toEqual([]);
    });
  });

  it('says so when the check cannot run', async () => {
    db.rpc.mockImplementation((name) =>
      Promise.resolve(
        name === 'fanout_coverage_by_platform'
          ? { data: null, error: { message: 'timeout' } }
          : { data: 0.1, error: null },
      ),
    );
    const report = await collectHealthReport(NOW);
    expect(findIssues(report)).toContain('Query fan-out could not be checked: timeout');
  });
});

describe('renderHealthEmail', () => {
  const clean = {
    generatedAt: '2026-10-06T06:00:00.000Z',
    serverUptimeHours: 5,
    probes: { results: [{ probe: 'citations_domains', days: 1, seconds: 0.2, status: 'green' }] },
    nightly: { counts: { completed: 25 }, failed: [], stuck: [], missing: [], restartKills: 0 },
    cloro: { pendingOverAnHour: 0 },
  };

  it('says OK when nothing needs attention', () => {
    const { subject, issues } = renderHealthEmail(clean);
    expect(issues).toEqual([]);
    expect(subject).toBe('[OK] GetCito daily health — 2026-10-06');
  });

  it('lists slow reads and nightly problems, and escapes brand names', () => {
    const report = {
      ...clean,
      probes: {
        results: [{ probe: 'citations_domains', days: 30, seconds: 9.1, status: 'red' }],
      },
      nightly: { ...clean.nightly, failed: [{ brand: '<b>Acme</b>', reason: 'x' }] },
      cloro: { pendingOverAnHour: 3 },
    };
    const { subject, html, issues } = renderHealthEmail(report);
    expect(subject.startsWith('[ISSUES]')).toBe(true);
    expect(issues).toEqual([
      'citations_domains (30d) took 9.1s of its 8s budget',
      '1 nightly run(s) failed',
      '3 Cloro task(s) pending for over an hour',
    ]);
    expect(html).toContain('&lt;b&gt;Acme&lt;/b&gt;');
    expect(html).not.toContain('<b>Acme</b>');
  });

  it('flags a check that could not run', () => {
    expect(findIssues({ ...clean, nightly: { error: 'boom' } })).toEqual([
      'Nightly runs could not be checked: boom',
    ]);
  });

  it('raises actions whose count and kept list disagree, naming a few (AC-009)', () => {
    const actionCounts = {
      checked: 40,
      missing: { count: 0, examples: [] },
      mismatch: { count: 7, examples: [40, 12] },
      tasks: { count: 1, examples: [7] },
    };
    const { issues, html } = renderHealthEmail({ ...clean, actionCounts });
    expect(issues).toEqual([
      '7 open action(s) kept a list of a different size from their count (e.g. AC-40, AC-12)',
      "1 open action(s) have a task that names a different count from the action's (AC-7)",
    ]);
    expect(html).toContain('40 open actions checked.');
    // All zero: nothing to raise.
    const zero = {
      checked: 40,
      missing: { count: 0 },
      mismatch: { count: 0 },
      tasks: { count: 0 },
    };
    expect(findIssues({ ...clean, actionCounts: zero })).toEqual([]);
    expect(findIssues({ ...clean, actionCounts: { error: 'missing function' } })).toEqual([
      'Action counts could not be checked: missing function',
    ]);
  });
});
