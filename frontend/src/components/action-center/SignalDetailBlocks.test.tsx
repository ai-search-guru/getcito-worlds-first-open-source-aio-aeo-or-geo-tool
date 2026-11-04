import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { Signal } from '@/lib/signals/map';
import { NO_WHERE } from '@/lib/signals/where';

const getSignalActions = vi.fn();
vi.mock('@/lib/actions/signals', () => ({
  getSignalActions: (...args: unknown[]) => getSignalActions(...args),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { SignalChangeBlock, SignalEvidenceBlock, SignalWhereBlock } =
  await import('./SignalDetailBlocks');

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getSignalActions.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

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
  previousValue: 34,
  currentValue: 18,
  changeValue: -16,
  payload: {
    entity: 'platforms',
    platform: 'gemini-web',
    targets: [{ id: 'gemini-web', label: 'gemini-web' }],
  },
  kpiKeys: [],
  actionId: null,
  where: { platforms: ['gemini-web'], regions: [], topics: [] },
  ...over,
});

describe('SignalChangeBlock', () => {
  it('labels every figure with its metric, window and unit', () => {
    render(<SignalChangeBlock signal={signal({})} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Last 7 days against the 7 days before');
    expect(text).toContain('Mention rate · previous 7 days34%');
    expect(text).toContain('Mention rate · last 7 days18%');
    expect(text).toContain('−16 pts');
    // A fall in the brand's own rate is bad news.
    const delta = [...container.querySelectorAll('span')].find((s) => s.textContent === '−16 pts');
    expect(delta?.className).toContain('text-red-600');
  });

  it("colours a competitor's rise as bad news", () => {
    render(
      <SignalChangeBlock
        signal={signal({
          category: 'competitor',
          kind: 'competitor_momentum',
          payload: { entity: 'competitors', competitorName: 'Profound' },
          previousValue: 12,
          currentValue: 31,
          changeValue: 19,
        })}
      />,
    );
    const delta = [...container.querySelectorAll('span')].find((s) => s.textContent === '+19');
    expect(delta?.className).toContain('text-red-600');
    expect(container.textContent).toContain('Mentions · Profound · last 7 days31');
  });

  it('names the window of each figure a cross-channel finding mixes', () => {
    render(
      <SignalChangeBlock
        signal={signal({
          category: 'traffic',
          kind: 'cross_channel_risk',
          payload: {
            entity: 'pages',
            targets: [{ id: 'site' }],
            clicksBefore: 900,
            clicksNow: 600,
          },
          previousValue: 120,
          currentValue: 80,
          changeValue: -40,
        })}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Last 14 days against the 14 days before');
    expect(text).toContain('AI referral sessions · previous 14 days120');
    expect(text).toContain('AI referral sessions · last 14 days80');
    expect(text).toContain('Last 28 days against the 28 days before');
    expect(text).toContain('Search clicks · previous 28 days900');
    expect(text).toContain('Search clicks · last 28 days600');
    expect(text).not.toContain('7 days');
  });

  it("names a source's counts rather than showing 0 → 251 +167", () => {
    render(
      <SignalChangeBlock
        signal={signal({
          category: 'competitor',
          kind: 'competitor_winning_source',
          payload: { entity: 'sources', domain: 'yotpo.com', prompts: 6 },
          previousValue: 0,
          currentValue: 251,
          changeValue: 167,
        })}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Answers citing it · all251');
    expect(text).toContain('Answers citing it · naming you0');
    expect(text).toContain('Answers citing it · naming only competitors167');
  });

  it('says so when a signal records no figures', () => {
    render(
      <SignalChangeBlock
        signal={signal({
          category: 'citation',
          kind: 'lost_citations',
          payload: { promptId: 'p1', promptText: 'Best coffee subscription?' },
          previousValue: null,
          currentValue: null,
          changeValue: null,
        })}
      />,
    );
    expect(container.textContent).toBe('What changedNot available');
  });
});

describe('SignalWhereBlock', () => {
  it('shows each field, with "Not available" where no detector records it', () => {
    render(
      <SignalWhereBlock
        signal={signal({
          category: 'citation',
          kind: 'lost_citations',
          payload: { promptId: 'p1', promptText: 'Best coffee subscription?' },
          where: { platforms: ['chatgpt-web'], regions: ['US'], topics: ['Coffee'] },
        })}
      />,
    );
    const rows = [...container.querySelectorAll('dt')].map(
      (dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`,
    );
    expect(rows).toEqual([
      'Prompt: Best coffee subscription?View prompt',
      'Topic: Coffee',
      'Tracked on: ChatGPT',
      'Tracked in: United States',
      'Your page cited before: Not available',
      'Cited now: Not available',
    ]);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/dashboard/prompts/p1');
  });
});

describe('a lost citation with its evidence', () => {
  const recorded = signal({
    category: 'citation',
    kind: 'lost_citations',
    previousValue: null,
    currentValue: null,
    changeValue: null,
    payload: {
      promptId: 'p1',
      promptText: 'Best coffee subscription?',
      platforms: ['chatgpt-web'],
      citedDays: 9,
      days: 11,
      quietDays: 3,
      lostUrls: [
        { url: 'https://coffee.example/guide', position: 2, lastCitedAt: '2026-10-08T05:00:00Z' },
      ],
      citedNow: [{ url: 'https://rival.example/best', answers: 3, answersRead: 4, position: 1 }],
    },
    where: { platforms: ['chatgpt-web'], regions: [], topics: [] },
  });

  it('shows the page lost, the pages cited now, and the cited days', () => {
    render(<SignalWhereBlock signal={recorded} />);
    const rows = [...container.querySelectorAll('dt')].map(
      (dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`,
    );
    expect(rows).toContain('Your page cited before: coffee.example/guide#2 · last cited Oct 8');
    expect(rows).toContain('Cited now: rival.example/best#1 · in 3 of 4 latest answers');
    expect(rows).toContain('Platforms: ChatGPT');

    render(<SignalChangeBlock signal={recorded} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Days with answers in the last 14 days');
    expect(text).toContain('Cited days · earlier days9 / 11');
    expect(text).toContain('Cited days · latest days0 / 3');
  });
});

describe('a competitor signal with its evidence', () => {
  it('shows positions by prompt and the sources behind its wins', () => {
    render(
      <SignalWhereBlock
        signal={signal({
          category: 'competitor',
          kind: 'competitor_momentum',
          payload: {
            entity: 'competitors',
            competitorName: 'Profound',
            positions: [
              {
                promptId: 'p1',
                promptText: 'Best AI rank tracker?',
                platform: 'chatgpt-web',
                competitor: { now: 1, before: 3 },
                you: { now: 3, before: 2 },
              },
              {
                promptId: 'p2',
                promptText: 'AI rank tracker comparison',
                platform: 'perplexity-web',
                competitor: { now: 2, before: null },
                you: { now: null, before: 4 },
              },
            ],
            winningSources: [{ domain: 'g2.example', answers: 2, answersRead: 3 }],
            competitorId: 'c1',
            pageEventDays: 28,
            pageEvents: [
              {
                kind: 'changed',
                at: '2026-10-12T03:00:00Z',
                url: 'https://www.profound.example/pricing/',
                domain: 'profound.example',
                detail: {
                  gained: [{ key: 'faq', label: 'FAQ section' }],
                  lost: [{ key: 'dated', label: 'Visible date' }],
                },
              },
              {
                kind: 'first_cited',
                at: '2026-10-03T00:00:00Z',
                url: 'https://profound.example/guide',
                domain: 'profound.example',
                detail: { answers: 2 },
              },
            ],
          },
          where: NO_WHERE,
        })}
      />,
    );
    const rows = [...container.querySelectorAll('dt')].map(
      (dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`,
    );
    expect(rows).toContain(
      'What happened to their pages: profound.example/pricing' +
        'Oct 12 · Changed · now has FAQ section · no longer has Visible date' +
        'profound.example/guideOct 3 · First cited in your tracked answers' +
        'See their pages over time',
    );
    expect(container.querySelector('a[href*="competitors?competitor=c1"]')?.textContent).toBe(
      'See their pages over time',
    );
    expect(rows).toContain(
      'Positions by prompt: Best AI rank tracker?ChatGPT · Profound #1 ↑2 · You #3 ↓1' +
        'AI rank tracker comparisonPerplexity · Profound #2 new · You — lost',
    );
    expect(rows).toContain(
      'Sources behind their wins: g2.examplecited in 2 of the 3 latest answers they win',
    );
    expect(rows).toContain('Platforms: ChatGPTPerplexity');
    // A competitor's climb and the brand's fall are both bad news.
    const tone = (text: string) =>
      [...container.querySelectorAll('span')].find((s) => s.textContent === text)?.className;
    expect(tone(' ↑2')).toContain('text-red-600');
    expect(tone(' ↓1')).toContain('text-red-600');
  });
});

describe('an uncited-mentions signal with its evidence', () => {
  it('lists each prompt with its platforms, position, sentiment and a quote', () => {
    render(
      <SignalWhereBlock
        signal={signal({
          category: 'mention',
          kind: 'uncited_mentions',
          currentValue: 4,
          payload: {
            promptIds: ['p1'],
            mentions: [
              {
                promptId: 'p1',
                promptText: 'Best coffee subscription?',
                platforms: ['gemini-web', 'chatgpt-web'],
                answers: 3,
                position: 2,
                sentiment: 'positive',
                excerpt: '…Acme Coffee ships beans weekly.',
                excerptPlatform: 'gemini-web',
                excerptAt: '2026-10-14T05:00:00Z',
              },
            ],
          },
          where: NO_WHERE,
        })}
      />,
    );
    const rows = [...container.querySelectorAll('dt')].map(
      (dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`,
    );
    expect(rows).toContain(
      'Mentions by prompt: Best coffee subscription?Gemini, ChatGPT · #2 · Positive · in 3 answers' +
        '“…Acme Coffee ships beans weekly.”Gemini, Oct 14',
    );
    expect(rows.some((r) => r.startsWith('Sentiment'))).toBe(false);
  });
});

describe("a technical finding with its checks' evidence", () => {
  it('shows the crawlers it blocks and what each check found, page by page', () => {
    render(
      <SignalWhereBlock
        signal={signal({
          category: 'technical',
          kind: 'crawler_blocked',
          currentValue: 1,
          payload: {
            entity: 'pages',
            targets: [
              {
                id: '/pricing',
                label: '/pricing',
                issues: [
                  {
                    check: 'ai-bot-access',
                    label: 'AI bot access (robots.txt)',
                    evidence: {
                      aiBotsMentioned: ['gptbot', 'claudebot'],
                      blocked: true,
                      blockedBots: ['gptbot'],
                    },
                  },
                ],
              },
            ],
          },
          where: NO_WHERE,
        })}
      />,
    );
    const rows = [...container.querySelectorAll('dt')].map(
      (dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`,
    );
    expect(rows).toContain('Affected crawlers: GPTBot (OpenAI)');
    expect(rows).toContain(
      'Failed checks: /pricingAI bot access (robots.txt) · In robots.txt: GPTBot (OpenAI), ClaudeBot (Anthropic)',
    );
  });

  it('names what a check found, and leaves out the model that judged it', () => {
    render(
      <SignalWhereBlock
        signal={signal({
          category: 'technical',
          kind: 'content_gap',
          currentValue: 1,
          payload: {
            entity: 'pages',
            targets: [
              {
                id: '/guide',
                label: '/guide',
                issues: [
                  {
                    check: 'query-coverage',
                    label: 'Query coverage',
                    evidence: { reason: 'No pricing answers.', model: 'openai/gpt-4.1-mini' },
                  },
                  {
                    check: 'freshness',
                    label: 'Freshness',
                    evidence: { ageDays: 412, newest: '2025-08-30', pages: [{ url: '/a' }] },
                  },
                ],
              },
            ],
          },
          where: NO_WHERE,
        })}
      />,
    );
    const lines = [...container.querySelectorAll('dd li span.block')].map((el) => el.textContent);
    expect(lines).toEqual([
      'Query coverage · No pricing answers.',
      'Freshness · Age in days: 412 · Newest date: 2025-08-30',
    ]);
  });

  it('names the language and the reading formula a page was read with', () => {
    render(
      <SignalWhereBlock
        signal={signal({
          category: 'technical',
          kind: 'content_gap',
          currentValue: 1,
          payload: {
            entity: 'pages',
            targets: [
              {
                id: '/kapadokya',
                label: '/kapadokya',
                issues: [
                  {
                    check: 'readability',
                    label: 'Readability',
                    evidence: {
                      language: 'tr',
                      formula: 'atesman',
                      readingScore: 18,
                      wordsPerSentence: 31.5,
                    },
                  },
                  {
                    check: 'first-person',
                    label: 'First-person evidence',
                    evidence: { language: 'en', firstPersonSentences: 0, sentences: 40 },
                  },
                ],
              },
            ],
          },
          where: NO_WHERE,
        })}
      />,
    );
    const lines = [...container.querySelectorAll('dd li span.block')].map((el) => el.textContent);
    expect(lines).toEqual([
      'Readability · Language: Turkish · Formula: Ateşman · Reading score: 18 · Words a sentence: 31.5',
      'First-person evidence · Language: English · First-person sentences: 0 · Sentences: 40',
    ]);
  });
});

describe('a traffic signal with its referrals and prompts', () => {
  it('lists the referrals by platform, page by page, and the prompts', () => {
    render(
      <SignalWhereBlock
        signal={signal({
          category: 'traffic',
          kind: 'ai_traffic_slipping',
          currentValue: 2,
          payload: {
            entity: 'pages',
            targets: [
              { id: '/pricing', label: '/pricing' },
              { id: '/guide', label: '/guide' },
            ],
            referrals: [
              {
                page: '/pricing',
                source: 'analytics',
                sessions: 6,
                before: 11,
                platforms: [
                  { platform: 'chatgpt.com', sessions: 4, before: 9 },
                  { platform: 'perplexity.ai', sessions: 2, before: 2 },
                ],
              },
              { page: '/guide', source: null, sessions: 0, before: 0, platforms: [] },
            ],
            referralDays: 14,
            citablePrompts: [],
            citablePromptsTotal: 0,
          },
          where: NO_WHERE,
        })}
      />,
    );
    const rows = [...container.querySelectorAll('dt')].map(
      (dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`,
    );
    expect(rows).toContain(
      'AI referrals by platform: /pricingChatGPT 9 → 4 · Perplexity 2 → 2/guideNo AI referrals' +
        'Visits in the last 14 days, against the 14 before',
    );
    expect(rows).toContain('Prompts it could be cited on: None');
  });

  it("doesn't name the page again when the signal is about one", () => {
    render(
      <SignalWhereBlock
        signal={signal({
          category: 'traffic',
          kind: 'page_opportunity',
          currentValue: 120,
          payload: {
            landingPage: '/pricing',
            referrals: [
              {
                page: '/pricing',
                source: 'analytics',
                sessions: 1,
                before: 0,
                platforms: [{ platform: 'grok.com', sessions: 1, before: 0 }],
              },
            ],
            referralDays: 14,
          },
          where: NO_WHERE,
        })}
      />,
    );
    const rows = [...container.querySelectorAll('dt')].map(
      (dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`,
    );
    expect(rows).toContain('URL: /pricing');
    expect(rows).toContain(
      'AI referrals by platform: Grok 0 → 1Visits in the last 14 days, against the 14 before',
    );
  });
});

describe("an AI-traffic finding's pages", () => {
  const rowsOf = () =>
    [...container.querySelectorAll('dt')].map(
      (dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`,
    );
  const page = {
    id: '/guide',
    label: '/guide',
    before: 52,
    now: 50,
    engagedRate: 0.2,
    keyEvents: 1,
    keyEventsBefore: 3,
    keyRate: 0.02,
  };

  it('says how engaged its AI visitors were against the site', () => {
    render(
      <SignalWhereBlock
        signal={signal({
          category: 'traffic',
          kind: 'ai_landing_underperforming',
          currentValue: 1,
          payload: { entity: 'pages', targets: [page], siteEngagedRate: 0.444, siteKeyRate: 0.089 },
          where: NO_WHERE,
        })}
      />,
    );
    expect(rowsOf()).toContain('Pages: /guideSessions 52 → 50 · Engagement rate 20% (site 44%)');
  });

  it("counts a winning page's key events per session, which can pass one", () => {
    render(
      <SignalWhereBlock
        signal={signal({
          category: 'traffic',
          kind: 'ai_landing_page_winner',
          currentValue: 1,
          payload: {
            entity: 'pages',
            targets: [{ ...page, keyEvents: 75, keyEventsBefore: 40, keyRate: 1.5 }],
            siteKeyRate: 0.089,
          },
          where: NO_WHERE,
        })}
      />,
    );
    expect(rowsOf()).toContain(
      'Pages: /guideSessions 52 → 50 · Key events 40 → 75 · 1.5 key events per session (site 0.09)',
    );
  });

  it('gives the key events a converting page lost, and only sessions without Analytics', () => {
    render(
      <SignalWhereBlock
        signal={signal({
          category: 'traffic',
          kind: 'converting_page_slipping',
          currentValue: 2,
          payload: {
            entity: 'pages',
            targets: [page, { id: '/blog', label: '/blog', before: 20, now: 16 }],
          },
          where: NO_WHERE,
        })}
      />,
    );
    expect(rowsOf()).toContain(
      'Pages: /guideSessions 52 → 50 · Key events 3 → 1/blogSessions 20 → 16',
    );
  });
});

describe('SignalEvidenceBlock', () => {
  it('links the answers and every action the signal is used by, with its status', async () => {
    // The latest link first: the current action, then the closed one before it.
    getSignalActions.mockResolvedValue([
      { id: 'a2', actionNo: 61, kind: 'unknown_kind_for_test', status: 'new', payload: {} },
      { id: 'a1', actionNo: 52, kind: 'unknown_kind_for_test', status: 'completed', payload: {} },
    ]);
    await act(async () => {
      render(
        <SignalEvidenceBlock
          brandId="b1"
          signal={signal({ payload: { promptId: 'p1', promptText: 'x' }, actionId: 'a2' })}
        />,
      );
    });
    // By the signal, so its earlier actions come too, not by its action_id.
    expect(getSignalActions).toHaveBeenCalledWith('b1', 's1');
    const links = [...container.querySelectorAll('a')].map(
      (a) => `${a.textContent} → ${a.getAttribute('href')}`,
    );
    expect(links).toEqual([
      'View AI answers → /dashboard/prompts/p1',
      'AC-61 · Unknown kind for testNew → /dashboard/action-center/actions?action=a2',
      'AC-52 · Unknown kind for testCompleted → /dashboard/action-center/actions?action=a1',
    ]);
  });

  it("puts the signal's current action first when its link is older", async () => {
    getSignalActions.mockResolvedValue([
      { id: 'a2', actionNo: 61, kind: 'unknown_kind_for_test', status: 'completed', payload: {} },
      { id: 'a1', actionNo: 52, kind: 'unknown_kind_for_test', status: 'in_progress', payload: {} },
    ]);
    await act(async () => {
      render(<SignalEvidenceBlock brandId="b1" signal={signal({ actionId: 'a1' })} />);
    });
    const labels = [...container.querySelectorAll('li a')].map((a) => a.textContent);
    expect(labels).toEqual([
      'AC-52 · Unknown kind for testIn Progress',
      'AC-61 · Unknown kind for testCompleted',
    ]);
  });

  it('loads again when the signal moves to another action, without the old list', async () => {
    getSignalActions.mockResolvedValueOnce([
      { id: 'a1', actionNo: 52, kind: 'unknown_kind_for_test', status: 'new', payload: {} },
    ]);
    await act(async () => {
      render(<SignalEvidenceBlock brandId="b1" signal={signal({ actionId: 'a1' })} />);
    });
    expect(container.textContent).toContain('AC-52');

    let resolve: (rows: unknown[]) => void = () => {};
    getSignalActions.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    render(<SignalEvidenceBlock brandId="b1" signal={signal({ actionId: 'a2' })} />);
    expect(getSignalActions).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Loading…');
    expect(container.textContent).not.toContain('AC-52');

    await act(async () => {
      resolve([
        { id: 'a2', actionNo: 61, kind: 'unknown_kind_for_test', status: 'new', payload: {} },
        { id: 'a1', actionNo: 52, kind: 'unknown_kind_for_test', status: 'completed', payload: {} },
      ]);
    });
    expect(container.textContent).toContain('AC-61');
    expect(container.textContent).toContain('AC-52');
  });

  it('says when the actions could not be loaded', async () => {
    getSignalActions.mockRejectedValue(new Error('timeout'));
    await act(async () => {
      render(<SignalEvidenceBlock brandId="b1" signal={signal({ actionId: 'a1' })} />);
    });
    expect(container.textContent).toContain('Couldn’t load the actions.');
  });

  it('says when no action uses the signal, without asking', () => {
    render(<SignalEvidenceBlock brandId="b1" signal={signal({ where: NO_WHERE })} />);
    expect(getSignalActions).not.toHaveBeenCalled();
    expect(container.textContent).toContain('No action uses this signal yet.');
  });
});
