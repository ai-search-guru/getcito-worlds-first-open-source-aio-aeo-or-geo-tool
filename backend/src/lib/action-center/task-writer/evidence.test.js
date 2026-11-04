import { describe, expect, it } from 'vitest';
import { buildEvidence, evidenceForPrompt, hasTargets } from './evidence.js';

const lost = (over = {}) => ({
  id: 's1',
  kind: 'lost_citations',
  payload: {
    promptId: 'p1',
    promptText: 'Which coffee subscriptions ship internationally?',
    platforms: ['chatgpt-web', 'gemini-web'],
    lostUrls: [{ url: 'https://acme.example/blog/shipping', position: 2 }],
    citedNow: [{ url: 'https://www.seriouseats.com/best', domain: 'seriouseats.com', answers: 4 }],
    ...over,
  },
});

describe('buildEvidence', () => {
  it("links a lost citation's prompt, the page it lost and who is cited instead", () => {
    const evidence = buildEvidence([lost()]);
    const [page] = evidence.pages;
    const [prompt] = evidence.prompts;
    const [domain] = evidence.domains;

    expect(page).toMatchObject({ ref: 'page:1', lostPosition: 2 });
    expect(page.labels).toEqual(['acme.example/blog/shipping', '/blog/shipping']);
    expect([...page.platforms]).toEqual(['chatgpt-web', 'gemini-web']);
    expect([...page.citedInstead]).toEqual([domain]);
    expect([...prompt.lostPages]).toEqual([page]);
    expect(domain).toMatchObject({ ref: 'domain:1', domain: 'seriouseats.com', answers: 4 });
    expect(evidence.byRef.get('prompt:1')).toBe(prompt);
  });

  it('names a competitor ahead, prompt by prompt, and the sources it wins with', () => {
    const evidence = buildEvidence([
      {
        id: 's2',
        kind: 'competitor_leads',
        payload: {
          competitorName: 'Trade Coffee',
          positions: [
            {
              promptId: 'p4',
              promptText: 'Best espresso machines under $500?',
              platform: 'chatgpt-web',
              competitor: { now: 1 },
              you: { now: 4 },
            },
          ],
          winningSources: [{ domain: 'g2.com', answers: 3 }],
        },
      },
    ]);
    expect(evidence.competitors[0]).toMatchObject({ ref: 'competitor:1', name: 'Trade Coffee' });
    expect(evidence.prompts[0].leaders).toEqual([
      { competitor: 'Trade Coffee', platform: 'chatgpt-web', them: 1, you: 4 },
    ]);
    expect(evidence.domains[0].domain).toBe('g2.com');
  });

  it("gives a competitor's page events once each, newest first, with the checks' names", () => {
    const changed = {
      kind: 'changed',
      at: '2026-10-12T03:00:00Z',
      url: 'https://www.trade.example/pricing',
      domain: 'trade.example',
      detail: {
        gained: [{ key: 'faq', label: 'FAQ section' }],
        lost: [{ key: 'dated', label: '' }],
      },
    };
    const firstCited = {
      kind: 'first_cited',
      at: '2026-10-03T00:00:00Z',
      url: 'https://trade.example/guide',
      domain: 'trade.example',
      detail: { answers: 2 },
    };
    const signal = (id, kind, pageEvents) => ({
      id,
      kind,
      payload: { competitorName: 'Trade Coffee', pageEvents },
    });
    const shown = evidenceForPrompt(
      buildEvidence([
        signal('s1', 'competitor_momentum', [changed, firstCited]),
        signal('s2', 'competitor_leads', [changed, { kind: 'renamed', at: 'x', url: 'y' }]),
      ]),
    );
    expect(shown.competitors).toEqual([
      {
        ref: 'competitor:1',
        name: 'Trade Coffee',
        pageEvents: [
          {
            date: '2026-10-12',
            page: 'trade.example/pricing',
            event: 'page changed',
            nowHas: ['FAQ section'],
            noLongerHas: ['dated'],
          },
          {
            date: '2026-10-03',
            page: 'trade.example/guide',
            event: 'first cited in your tracked answers',
          },
        ],
      },
    ]);
  });

  it("reads AI-traffic pages and an audit finding's checks", () => {
    const evidence = buildEvidence([
      {
        id: 's3',
        kind: 'ai_traffic_drop',
        payload: {
          referrals: [
            {
              page: '/subscriptions',
              sessions: 32,
              before: 40,
              platforms: [{ platform: 'chatgpt.com' }],
            },
          ],
        },
      },
      {
        id: 's4',
        kind: 'crawler_blocked',
        payload: {
          entity: 'pages',
          targets: [
            {
              id: 'https://acme.example/pricing',
              label: 'https://acme.example/pricing',
              issues: [{ check: 'robots_ai_bots', label: 'robots.txt blocks AI bots' }],
            },
            { id: 'site', label: 'Whole site' },
          ],
        },
      },
    ]);
    expect(evidence.pages.map((p) => [p.url, p.sessions, p.before, [...p.issues]])).toEqual([
      ['/subscriptions', 32, 40, []],
      ['https://acme.example/pricing', null, null, ['robots.txt blocks AI bots']],
    ]);
  });

  it('merges what several signals say about one page and ranks by evidence', () => {
    const evidence = buildEvidence([
      lost(),
      lost({ promptId: 'p2', promptText: 'Second prompt' }),
      lost({
        promptId: 'p3',
        promptText: 'Third',
        lostUrls: [{ url: 'https://acme.example/other' }],
      }),
    ]);
    expect(evidence.pages.map((p) => p.url)).toEqual([
      'https://acme.example/blog/shipping',
      'https://acme.example/other',
    ]);
    expect(evidence.pages[0].prompts.size).toBe(2);
  });

  it("reads a path and the brand's URL for it as one page", () => {
    const evidence = buildEvidence(
      [
        lost({ lostUrls: [{ url: 'https://www.acme.example/subscriptions', position: 1 }] }),
        {
          id: 's5',
          kind: 'ai_traffic_drop',
          payload: { referrals: [{ page: '/subscriptions', sessions: 3, before: 9 }] },
        },
      ],
      { domains: ['acme.example'] },
    );
    expect(evidence.pages).toHaveLength(1);
    expect(evidence.pages[0]).toMatchObject({
      url: 'https://www.acme.example/subscriptions',
      sessions: 3,
      lostPosition: 1,
    });
  });

  it('has nothing to write about without targets', () => {
    expect(hasTargets(buildEvidence([{ id: 's', kind: 'sharp_drop', payload: {} }]))).toBe(false);
  });
});

describe('evidenceForPrompt', () => {
  it('gives the model refs and names, not links and slugs', () => {
    const shown = evidenceForPrompt(buildEvidence([lost()]));
    expect(shown.pages[0]).toEqual({
      ref: 'page:1',
      url: 'acme.example/blog/shipping',
      lostOnPrompts: ['prompt:1'],
      platforms: ['ChatGPT', 'Gemini'],
      citedAtBefore: 2,
      citedInstead: ['domain:1'],
    });
    expect(shown.prompts[0]).toMatchObject({
      ref: 'prompt:1',
      lostPages: ['page:1'],
      citedInstead: ['domain:1'],
    });
  });
});
