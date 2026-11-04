import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftSourcesData } from './sources';
import { NO_DRAFT_RULES, activeRules, ruleSet, type ActiveRule } from './rules';

/**
 * What Start's Agent gives the Content Agent (CE-015): the sources kept, the
 * rules in effect (the workspace's My rules included, feed rules left out),
 * the person's own rules, and on an existing page the passages AI quotes.
 */

const getDraftSources = vi.fn();
const getMyRuleSets = vi.fn();
const getCitedPassages = vi.fn();
vi.mock('@/lib/actions/contentDrafts', () => ({
  getDraftSources: (...args: unknown[]) => getDraftSources(...args),
  getMyRuleSets: (...args: unknown[]) => getMyRuleSets(...args),
  getCitedPassages: (...args: unknown[]) => getCitedPassages(...args),
}));

const { agentWriteRequest, rulesForAgent, rulesForBrief } = await import('./agentWrite');
const { fanoutsToUse } = await import('./rules');

const data: DraftSourcesData = {
  prompts: [
    { id: 'p1', text: 'Best grinder?', inDraft: true, citesPage: false, answers: 4, mentioned: 1 },
  ],
  fanouts: [{ query: 'burr grinder under 200', platforms: ['copilot-web'], searched: 3 }],
  citedPages: [],
  gscQueries: [],
  brandDomains: ['acme.example'],
  competitorDomains: [],
};
const describe_ = (rule: ActiveRule) => ({ name: `name:${rule.key}`, detail: rule.current });
const draft = (over = {}) => ({
  id: 'd1',
  brandId: 'b1',
  title: 'Burr grinders',
  pageType: 'product_page',
  method: 'create' as const,
  sourceUrl: null,
  bodyHtml: '<h1>Burr grinders</h1>',
  rules: NO_DRAFT_RULES,
  ...over,
});

beforeEach(() => {
  getDraftSources.mockReset().mockResolvedValue({ data, choices: [] });
  getMyRuleSets.mockReset().mockResolvedValue({});
  getCitedPassages.mockReset().mockResolvedValue([]);
});

describe('agentWriteRequest', () => {
  it('sends the sources kept and the type’s rules, with the workspace’s My rules', async () => {
    getMyRuleSets.mockResolvedValue({
      product_page: {
        overrides: { faq: { on: false }, length: { value: '2000' } },
        textRules: [
          { id: 't1', text: 'Say “we” for the brand', on: true },
          { id: 't2', text: 'Old rule', on: false },
        ],
      },
    });
    const request = await agentWriteRequest(draft(), describe_);

    expect(request.sources).toMatchObject({
      promptIds: ['p1'],
      fanouts: [{ query: 'burr grinder under 200', platforms: ['copilot-web'] }],
      headings: [],
      length: 2000,
    });
    const keys = request.rules.map((rule) => rule.key);
    expect(keys).not.toContain('faq');
    expect(keys).not.toContain('feedMatch');
    // Heading levels are the editor's: one H1 isn't the agent's to keep.
    expect(keys).not.toContain('oneH1');
    expect(keys).toContain('aiTraces');
    expect(request.rules.find((rule) => rule.key === 'length')).toEqual({
      key: 'length',
      name: 'name:length',
      detail: '2000',
    });
    expect(request.textRules).toEqual(['Say “we” for the brand']);
    // A new page has nothing AI quotes yet.
    expect(getCitedPassages).not.toHaveBeenCalled();
    expect(request.locked).toEqual([]);
  });

  it('gives the fan-out rules the fan-outs the page doesn’t use yet', async () => {
    const seen: Record<string, string | null> = {};
    const request = await agentWriteRequest(
      draft({ bodyHtml: '<h1>Burr grinders</h1><h2>Hand grinders</h2>' }),
      (rule, status) => {
        seen[rule.key] = status ? fanoutsToUse(status) : null;
        return { name: rule.key, detail: '' };
      },
    );
    expect(request.rules.map((rule) => rule.key)).toContain('fanoutH2');
    // A page the agent writes anew uses none of them yet: named, in their words.
    expect(seen.fanoutH2).toBe('"burr grinder under 200"');
    expect(seen.fanoutFaq).toBe('"burr grinder under 200"');
    // Only the fan-out rules carry a status.
    expect(seen.length).toBeNull();
  });

  it('names only what an existing page doesn’t use yet', async () => {
    const seen: Record<string, string | null> = {};
    await agentWriteRequest(
      draft({
        method: 'optimize',
        sourceUrl: 'https://acme.example/grinders',
        bodyHtml: '<h1>Burr grinders</h1><h2>The best burr grinder under 200</h2>',
      }),
      (rule, status) => {
        seen[rule.key] = status ? fanoutsToUse(status) : null;
        return { name: rule.key, detail: '' };
      },
    );
    expect(seen.fanoutH2).toBeNull();
  });

  it('locks what AI quotes on an existing page, and takes the editor’s rules as given', async () => {
    getCitedPassages.mockResolvedValue([{ key: 'burrs grind evenly', platforms: [] }]);
    const rules = activeRules(ruleSet('product_page'), NO_DRAFT_RULES).filter((rule) =>
      ['summary', 'feedMatch'].includes(rule.key),
    );
    const request = await agentWriteRequest(
      draft({
        method: 'optimize',
        sourceUrl: 'https://acme.example/grinders',
        bodyHtml: '<h1>Grinders</h1><p>Burrs grind evenly.</p><ul><li><p>Steel</p></li></ul>',
      }),
      describe_,
      { rules, textRules: ['Short sentences'] },
    );

    expect(getCitedPassages).toHaveBeenCalledWith('d1', [
      'Grinders',
      'Burrs grind evenly.',
      'Steel',
    ]);
    expect(request.locked).toEqual(['burrs grind evenly']);
    expect(getMyRuleSets).not.toHaveBeenCalled();
    expect(request.rules.map((rule) => rule.key)).toEqual(['summary']);
    expect(request.textRules).toEqual(['Short sentences']);
  });

  it('still sends the rules when the sources can’t be read', async () => {
    getDraftSources.mockResolvedValue(null);
    const request = await agentWriteRequest(draft({ pageType: null }), describe_);
    expect(request.sources).toEqual({
      promptIds: [],
      fanouts: [],
      pages: [],
      queries: [],
      headings: [],
      length: expect.any(Number),
    });
    expect(request.rules.length).toBeGreaterThan(0);
  });
});

describe('rulesForAgent', () => {
  it('gives the rules in effect as the agent reads them: on, the agent’s, a fan-out rule with its fan-outs', () => {
    const rules = activeRules(ruleSet('product_page'), NO_DRAFT_RULES);
    const summary = rules.find((rule) => rule.key === 'summary')!;
    const feed = rules.find((rule) => rule.key === 'feedMatch')!;
    const off = { ...rules.find((rule) => rule.key === 'faq')!, on: false };
    const fanout = rules.find((rule) => rule.key === 'fanoutH2')!;
    const status = { state: 'bad', code: 'missing', fanouts: ['espresso under 500'] } as never;
    const seen: unknown[] = [];
    const read = rulesForAgent(
      [
        { rule: summary, status: { state: 'ok' } as never },
        { rule: feed },
        { rule: off },
        { rule: fanout, status },
      ],
      (rule, given) => {
        seen.push([rule.key, given]);
        return { name: `name:${rule.key}`, detail: rule.current };
      },
    );
    expect(read.map((rule) => rule.key)).toEqual(['summary', 'fanoutH2']);
    // Only a fan-out rule is described with its status (the fan-outs it still needs).
    expect(seen).toEqual([
      ['summary', undefined],
      ['fanoutH2', status],
    ]);
  });
});

describe('rulesForBrief', () => {
  it('leaves out the Keywords rule while it holds the brief’s own keywords, not one the person set', () => {
    const describe = (rule: ActiveRule) => ({ name: rule.key, detail: rule.current });
    const fromBrief = activeRules(ruleSet('guide', { keywords: ['old', 'words'] }), NO_DRAFT_RULES);
    expect(
      rulesForBrief(
        fromBrief.map((rule) => ({ rule })),
        describe,
      ).map((r) => r.key),
    ).not.toContain('keywords');
    const set = activeRules(ruleSet('guide', { keywords: ['old', 'words'] }), {
      overrides: { keywords: { value: 'espresso, grinder' } },
    });
    expect(
      rulesForBrief(
        set.map((rule) => ({ rule })),
        describe,
      ).find((r) => r.key === 'keywords'),
    ).toEqual({ key: 'keywords', name: 'keywords', detail: 'espresso, grinder' });
  });
});
