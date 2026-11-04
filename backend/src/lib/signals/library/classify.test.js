import { describe, expect, it } from 'vitest';
import * as c from './classify.js';
import { LIBRARY_KINDS, SIGNAL_CATEGORIES } from './kinds.js';
import { ENGINE_THRESHOLDS } from '../../../config/actionEngine.js';

const t = ENGINE_THRESHOLDS.library;

const prompt = (over = {}) => ({
  prompt_id: 'p',
  topic_id: null,
  cur_days: 7,
  cur_mention_days: 0,
  cur_citation_days: 0,
  prev_days: 7,
  prev_mention_days: 0,
  prev_citation_days: 0,
  last_mention_day: null,
  last_citation_day: null,
  volume: 0,
  has_target_url: false,
  ...over,
});

describe('classifyPrompt', () => {
  it('calls a prompt that was visible and is not a lost mention', () => {
    expect(c.classifyPrompt(prompt({ prev_mention_days: 5 }), t)).toBe('lost_mentions');
  });

  it('calls it a high-value loss when the prompt has demand', () => {
    expect(c.classifyPrompt(prompt({ prev_mention_days: 5, volume: 500 }), t)).toBe(
      'high_value_prompt_lost',
    );
  });

  /** Spec G15 against G04: demand with no page is content to create; demand
   *  with a page, or a citation history, is visibility to win. */
  it('sends demand with no page to content creation', () => {
    expect(c.classifyPrompt(prompt({ volume: 500 }), t)).toBe('uncovered_demand');
  });

  it('sends demand with a page to the demand gap', () => {
    expect(c.classifyPrompt(prompt({ volume: 500, has_target_url: true }), t)).toBe(
      'high_demand_gap',
    );
  });

  /** Spec G17: a page exists and the brand is still not visible — optimise. */
  it('sends an invisible prompt with a mapped page to optimisation', () => {
    expect(c.classifyPrompt(prompt({ has_target_url: true }), t)).toBe('content_underperforming');
  });

  it('sends an invisible, never-cited, unmapped prompt to content coverage', () => {
    expect(c.classifyPrompt(prompt(), t)).toBe('prompt_unmapped');
  });

  it('calls the rest a plain visibility gap', () => {
    expect(c.classifyPrompt(prompt({ last_citation_day: '2026-09-01' }), t)).toBe(
      'prompt_visibility_gap',
    );
  });

  it('says nothing about a prompt the brand is visible on', () => {
    expect(c.classifyPrompt(prompt({ cur_mention_days: 2 }), t)).toBeNull();
  });

  it('says nothing about a prompt tracked too few days to judge', () => {
    expect(c.classifyPrompt(prompt({ cur_days: t.promptMinDays - 1 }), t)).toBeNull();
  });

  /**
   * A new brand's first run: one day, every platform. Invisible on all of
   * them is a finding, and waiting three days to say so left new brands with
   * an empty Action Center.
   */
  it('judges a prompt answered enough times on a single day', () => {
    expect(
      c.classifyPrompt(prompt({ cur_days: 1, cur_answers: t.promptMinAnswers, volume: 500 }), t),
    ).toBe('uncovered_demand');
  });

  it('still waits on a single day with too few answers', () => {
    expect(
      c.classifyPrompt(prompt({ cur_days: 1, cur_answers: t.promptMinAnswers - 1 }), t),
    ).toBeNull();
  });
});

describe('isTracked', () => {
  it('accepts enough days, whatever the answers', () => {
    expect(c.isTracked(prompt({ cur_days: t.promptMinDays, cur_answers: 0 }), t)).toBe(true);
  });

  it('accepts enough answers, whatever the days', () => {
    expect(c.isTracked(prompt({ cur_days: 1, cur_answers: t.promptMinAnswers }), t)).toBe(true);
  });

  /** Rows from before the field existed read as no answers, not as an error. */
  it('treats a missing answer count as none', () => {
    const { cur_answers: _, ...row } = prompt({ cur_days: 1 });
    expect(c.isTracked(row, t)).toBe(false);
  });
});

describe('groupPrompts', () => {
  /** A target counted twice would put the same work in front of the user
   *  under two titles. */
  it('puts each prompt in at most one absence group', () => {
    const prompts = Array.from({ length: 12 }, (_, i) =>
      prompt({
        prompt_id: `p${i}`,
        volume: i % 3 === 0 ? 500 : 0,
        has_target_url: i % 2 === 0,
      }),
    );
    const groups = c.groupPrompts(prompts, t);
    const seen = new Map();
    for (const [kind, rows] of Object.entries(groups)) {
      if (kind === 'citation_at_risk') continue;
      for (const row of rows) {
        expect(seen.get(row.prompt_id)).toBeUndefined();
        seen.set(row.prompt_id, kind);
      }
    }
  });

  /** Three prompts nobody sees is a pattern; one is a prompt. */
  it('drops an absence group too small to be an action', () => {
    const groups = c.groupPrompts([prompt({ prompt_id: 'a' })], t);
    expect(groups.prompt_unmapped).toBeUndefined();
  });

  it('keeps a single high-value loss, which is an action on its own', () => {
    const groups = c.groupPrompts([prompt({ prev_mention_days: 5, volume: 500 })], t);
    expect(groups.high_value_prompt_lost).toHaveLength(1);
  });
});

describe('isCitationAtRisk', () => {
  it('flags citations thinning to under half', () => {
    expect(c.isCitationAtRisk(prompt({ prev_citation_days: 6, cur_citation_days: 2 }), t)).toBe(
      true,
    );
  });

  /** Gone is lost, which the original detector owns. */
  it('leaves citations that are gone to the loss detector', () => {
    expect(c.isCitationAtRisk(prompt({ prev_citation_days: 6, cur_citation_days: 0 }), t)).toBe(
      false,
    );
  });
});

describe('classifyTopic', () => {
  const topic = (tracked, visible, prevTracked, prevVisible) => ({
    tracked,
    visible,
    prevTracked,
    prevVisible,
  });

  it('calls a strong topic losing a little of its coverage slipping', () => {
    expect(c.classifyTopic(topic(10, 7, 10, 8), t)).toBe('topic_slipping');
  });

  it('calls a large fall a drop', () => {
    expect(c.classifyTopic(topic(10, 2, 10, 6), t)).toBe('topic_drop');
  });

  it('calls a topic the brand barely appears in uncovered', () => {
    expect(c.classifyTopic(topic(10, 1, 10, 1), t)).toBe('topic_uncovered');
  });

  it('calls partial coverage a gap', () => {
    expect(c.classifyTopic(topic(10, 4, 10, 4), t)).toBe('topic_gap');
  });

  it('says nothing about a well-covered, steady topic', () => {
    expect(c.classifyTopic(topic(10, 8, 10, 8), t)).toBeNull();
  });

  it('says nothing about a topic too small to judge', () => {
    expect(c.classifyTopic(topic(t.topicMinPrompts - 1, 0, 3, 0), t)).toBeNull();
  });
});

describe('classifyRateFall', () => {
  const row = (prevMentions, curMentions) => ({
    prev_answers: 100,
    prev_mentions: prevMentions,
    cur_answers: 100,
    cur_mentions: curMentions,
  });
  const kinds = { slip: 'platform_slipping', drop: 'platform_drop' };

  it('grades a small fall as slipping and a large one as a drop', () => {
    expect(c.classifyRateFall(row(40, 34), t, kinds)).toBe('platform_slipping');
    expect(c.classifyRateFall(row(40, 20), t, kinds)).toBe('platform_drop');
  });

  it('ignores a platform that was never worth anything', () => {
    expect(c.classifyRateFall(row(2, 0), t, kinds)).toBeNull();
  });
});

describe('classifyCompetitor', () => {
  it('names a competitor mentioned a multiple of the brand', () => {
    expect(c.classifyCompetitor({ cur_mentions: 60, prev_mentions: 55 }, 20, t)).toEqual([
      'competitor_leads',
    ]);
  });

  it('names one growing fast, separately', () => {
    expect(c.classifyCompetitor({ cur_mentions: 30, prev_mentions: 10 }, 40, t)).toEqual([
      'competitor_momentum',
    ]);
  });

  it('can be both', () => {
    expect(c.classifyCompetitor({ cur_mentions: 90, prev_mentions: 30 }, 20, t)).toEqual([
      'competitor_leads',
      'competitor_momentum',
    ]);
  });
});

describe('classifySource', () => {
  const source = (over = {}) => ({
    domain: 'example.com',
    owned: false,
    results: 50,
    prompts: 5,
    with_brand: 0,
    competitor_only: 0,
    ...over,
  });

  it('never calls the brand’s own domain a third party', () => {
    expect(c.classifySource(source({ owned: true }), t)).toBeNull();
  });

  it('sorts sources by who wins them', () => {
    expect(c.classifySource(source({ competitor_only: 40 }), t)).toBe('competitor_winning_source');
    expect(c.classifySource(source({ competitor_only: 5 }), t)).toBe('competitor_cited_source');
    expect(c.classifySource(source(), t)).toBe('third_party_presence_gap');
    expect(c.classifySource(source({ with_brand: 5 }), t)).toBe('authority_citation_gap');
    expect(c.classifySource(source({ with_brand: 30 }), t)).toBe('third_party_citation_gap');
  });

  it('ignores a source too rarely cited to matter', () => {
    expect(c.classifySource(source({ results: t.sourceMinResults - 1 }), t)).toBeNull();
  });
});

describe('classifyGscQuery', () => {
  const q = (over = {}) => ({
    query: 'x',
    cur_impressions: 1000,
    cur_clicks: 50,
    prev_clicks: 50,
    cur_position: 5,
    ...over,
  });
  const absent = prompt();
  const visible = prompt({ cur_mention_days: 3, prev_mention_days: 3 });

  it('needs a tracked prompt to be about', () => {
    expect(c.classifyGscQuery(q(), null, t)).toEqual([]);
  });

  it('splits AI-invisible demand by where the brand ranks in Google', () => {
    expect(c.classifyGscQuery(q({ cur_position: 2 }), absent, t)).toContain(
      'search_ai_misalignment',
    );
    expect(c.classifyGscQuery(q({ cur_position: 8 }), absent, t)).toContain('gsc_demand_gap');
  });

  it('reports falling clicks first', () => {
    expect(c.classifyGscQuery(q({ cur_clicks: 10, prev_clicks: 50 }), visible, t)).toContain(
      'gsc_decline',
    );
  });

  it('reports a click-through rate far below its position', () => {
    expect(c.classifyGscQuery(q({ cur_clicks: 1, cur_position: 1 }), visible, t)).toContain(
      'gsc_low_ctr',
    );
  });
});

describe('matchPrompt', () => {
  const prompts = new Map([
    ['a', c.tokens('best running shoes for flat feet')],
    ['b', c.tokens('how to clean leather boots')],
  ]);

  it('maps a query to the prompt that shares most of its words', () => {
    expect(c.matchPrompt(c.tokens('running shoes flat feet'), prompts, t)?.id).toBe('a');
  });

  it('maps nothing when too little is shared', () => {
    expect(c.matchPrompt(c.tokens('pizza delivery'), prompts, t)).toBeNull();
  });
});

describe('classifyTrafficPage', () => {
  const site = { keyRate: 0.02, engagedRate: 0.6 };

  it('calls a page losing some AI sessions slipping', () => {
    expect(
      c.classifyTrafficPage({ prev_sessions: 100, cur_sessions: 85, source: 'snippet' }, site, t),
    ).toEqual(['ai_traffic_slipping']);
  });

  it('only judges conversion where analytics measured it', () => {
    const page = { prev_sessions: 50, cur_sessions: 50, cur_key_events: 5, cur_engaged: 40 };
    expect(c.classifyTrafficPage({ ...page, source: 'snippet' }, site, t)).toEqual([]);
    expect(c.classifyTrafficPage({ ...page, source: 'analytics' }, site, t)).toContain(
      'ai_landing_page_winner',
    );
  });
});

describe('fallingPages', () => {
  it('lists the pages AI visits fell on, biggest fall first, matching paths without case (AT-013)', () => {
    expect(
      c.fallingPages(
        [
          { page: '/menu', visits: 30 },
          { page: '/Gifts', visits: 12 },
          { page: '/about', visits: 8 },
        ],
        [
          { page: '/menu', visits: 12 },
          { page: '/gifts', visits: 12 },
          { page: '/blog', visits: 4 },
        ],
      ),
    ).toEqual([
      { page: '/menu', before: 30, now: 12 },
      { page: '/about', before: 8, now: 0 },
    ]);
    expect(c.fallingPages(undefined, undefined)).toEqual([]);
  });
});

describe('the library’s signal kinds', () => {
  /**
   * `signals.category` has a check constraint. A kind outside it fails the
   * insert, and one failed insert throws the brand's whole nightly pass —
   * the shape of #829 and #834.
   */
  it('only use categories the database accepts', () => {
    for (const [kind, meta] of Object.entries(LIBRARY_KINDS)) {
      expect({ kind, ok: SIGNAL_CATEGORIES.includes(meta.category) }).toEqual({ kind, ok: true });
    }
  });

  it('map every audit check they read to a kind they declare', () => {
    for (const kind of Object.values(c.AUDIT_SIGNAL_KINDS))
      expect(LIBRARY_KINDS[kind]).toBeDefined();
  });
});
