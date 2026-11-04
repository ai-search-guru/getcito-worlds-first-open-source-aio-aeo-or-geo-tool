import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { eeat, trust, trustBlocks, type LinkCheck } from '@/lib/content/qualityChecks';
import type { ContentAuthor } from '@/lib/content/authors';
import { proofsOnPage } from '@/lib/content/pageRead';
import { qualityTodos } from '@/lib/content/qualityTodos';
import type { Readability } from '@/lib/content/readability';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string } & Record<string, unknown>) => (
    <a href={href} {...props} />
  ),
}));

const { QualityTab, proofSentences, qualitySuggestions } = await import('./_QualityTab');
type QualityRead = import('./_QualityTab').QualityRead;
type HandOff = import('./_QualityTab').HandOff;

/**
 * Instructions › Quality (Quality spec §3, CE-039): the scores, their label,
 * the person's to-dos (CE-040) and what would raise them.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const result: Readability = {
  score: 71,
  words: 420,
  checks: [
    { id: 'avgSentence', points: 20, max: 25, value: 22.4, count: 0 },
    { id: 'longSentences', points: 6, max: 15, value: 41, count: 3, at: 'A very long sentence.' },
    {
      id: 'readingLevel',
      points: 10,
      max: 20,
      value: 77,
      count: 1,
      formula: 'flesch',
      target: 50,
      band: { min: 50, max: 70 },
    },
    { id: 'answerFirst', points: 15, max: 15, value: 30, count: 0, at: null },
    { id: 'shortParagraphs', points: 10, max: 10, value: 6, count: 0, at: null },
    { id: 'headingSpacing', points: 10, max: 10, value: 3, count: 0, at: null },
    { id: 'passiveJargon', points: 5, max: 5, value: 0, count: 0, at: null },
  ],
};

const ada: ContentAuthor = {
  id: 'a1',
  name: 'Ada Lovelace',
  title: null,
  bio: 'Writes about forecasting.',
  photoUrl: null,
  sameAs: ['https://www.linkedin.com/in/ada'],
  userId: null,
  createdBy: null,
  defaultFor: [],
  pages: null,
};

/** The page's quality with this author (or the team byline) and Readability. */
function read(
  readability: Readability | null,
  author: ContentAuthor | null = ada,
  hasAuthors = true,
  canEdit = true,
): QualityRead {
  const score = eeat({ author });
  return {
    readability,
    eeat: score,
    trust: null,
    author,
    canEdit,
    hasAuthors,
    brandName: 'Acme',
    team: 'Acme Team',
    siteTrust: null,
    todos: qualityTodos({ eeat: score, author, hasAuthors, canEdit }),
  };
}

let container: HTMLDivElement;
let root: Root;
const onShow = vi.fn();
const onPickAuthor = vi.fn();
const onShowPlaceholder = vi.fn();
const onAddInput = vi.fn();
const onKeep = vi.fn();
const onAddSource = vi.fn();
const onConfirmImages = vi.fn();
const onAddImage = vi.fn();
const onPickReviewer = vi.fn();
const onChangeType = vi.fn();
const onConfirmAuthor = vi.fn();
const onConfirmIntro = vi.fn();

async function render(
  quality: QualityRead | Readability | null,
  handOff: HandOff | null = null,
  focusRequest: { to: 'todos' | 'trust'; n: number } | null = null,
) {
  const q = quality && 'eeat' in quality ? quality : read(quality as Readability | null);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <QualityTab
          quality={q}
          focusRequest={focusRequest}
          onShow={onShow}
          onShowPlaceholder={onShowPlaceholder}
          onPickAuthor={onPickAuthor}
          onAddInput={onAddInput}
          onKeep={onKeep}
          onAddSource={onAddSource}
          onConfirmImages={onConfirmImages}
          onAddImage={onAddImage}
          onPickReviewer={onPickReviewer}
          onChangeType={onChangeType}
          handOff={handOff}
          onConfirmAuthor={onConfirmAuthor}
          onConfirmIntro={onConfirmIntro}
        />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  onShow.mockReset();
  onPickAuthor.mockReset();
  onKeep.mockReset();
  onAddSource.mockReset();
  onConfirmAuthor.mockReset();
  onConfirmIntro.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe('QualityTab', () => {
  it('says which page type the checks and weights follow, and Change opens its menu (CE-052)', async () => {
    await render({
      ...read(result),
      weightsFor: { type: 'product_page', detected: true, profile: 'product' },
    });
    const line = [...container.querySelectorAll('p')].find((p) =>
      p.textContent?.startsWith('Checks and weights for'),
    )!;
    expect(line.textContent).toBe(
      "Checks and weights for Product page (detected): no author (your brand's), your own product photos, proof for claims, the price and stock your product feed has, shipping and returns, a specs table and short plain copy. Change",
    );
    await act(async () => line.querySelector('button')!.click());
    expect(onChangeType).toHaveBeenCalled();
    // No page type yet: an article's.
    await render({
      ...read(result),
      weightsFor: { type: null, detected: true, profile: 'article' },
    });
    expect(container.textContent).toContain(
      'Checks and weights for an article (no page type yet): an author with experience',
    );
    // Before Phase 3: no line.
    await render(read(result));
    expect(container.textContent).not.toContain('Checks and weights for');
  });

  it('names a price that differs from the product feed, and says when there is none to check (CE-053)', async () => {
    const trustRead = trust({
      blocks: trustBlocks('<p>The Ridge 28 costs $129.</p><p>In stock.</p>'),
      links: new Map(),
      brandDomains: [],
      feed: {
        compared: 2,
        mismatches: [
          { kind: 'price', page: '$129', feed: '$119', sentence: 'The Ridge 28 costs $129.' },
          { kind: 'stock', page: 'in', feed: 'out', sentence: 'In stock.' },
        ],
      },
      now: Date.parse('2026-10-25T12:00:00Z'),
    });
    await render({ ...read(result), trust: trustRead });
    expect(container.textContent).toContain(
      'Price differs from your product feed · Page $129 · Feed $119',
    );
    expect(container.textContent).toContain('2 differ: check which is right');
    // No feed, or no product in it with the page's URL or title: a line says so.
    await render({ ...read(result), feed: 'none' });
    expect(container.textContent).toContain(
      "Price and stock aren't checked: no product feed is connected",
    );
    expect(
      container.querySelector<HTMLAnchorElement>('a[href="/dashboard/settings/integrations"]')
        ?.textContent,
    ).toBe('Add a feed URL or a file');
    await render({ ...read(result), feed: 'notFound' });
    expect(container.textContent).toContain("no product in your feed has this page's URL or title");
    await render(read(result));
    expect(container.textContent).not.toContain("Price and stock aren't checked");
  });

  it('asks a category page to confirm its intro’s counts and prices, quoting them (CE-054)', async () => {
    await render({
      ...read(result),
      todos: [
        {
          id: 'introFacts',
          done: false,
          gain: 12,
          score: 'trust',
          action: 'confirmIntro',
          count: 2,
          facts: ['Choose from 120+ daypacks.', 'Prices run $49–$199.'],
        },
      ],
    });
    const row = [...container.querySelectorAll('[aria-label="Your to-dos"] li')].find((li) =>
      li.textContent?.startsWith("Confirm the intro's facts"),
    )!;
    expect(row.textContent).toContain('“Choose from 120+ daypacks.” “Prices run $49–$199.”');
    await act(async () =>
      [...row.querySelectorAll('button')].find((b) => b.textContent === 'Confirm')!.click(),
    );
    expect(onConfirmIntro).toHaveBeenCalled();
  });

  it('names the page type’s rules not met yet, and a product page’s shipping to-do (CE-052)', async () => {
    const typed: Readability = {
      ...result,
      checks: [
        ...result.checks,
        {
          id: 'typeRules',
          points: 0,
          max: 10,
          value: 1,
          count: 1,
          rules: [{ name: 'Specs table', detail: 'Now: missing' }],
        },
      ],
    };
    await render({
      ...read(typed),
      todos: [{ id: 'shippingReturns', done: false, gain: 4, score: 'trust', action: null }],
    });
    expect(container.textContent).toContain('1 page type rule not met: Specs table');
    // Each with how the page reads now: what Hand off sends the agent too.
    expect(container.textContent).toContain('Specs table (Now: missing). This page type');
    expect(container.textContent).toContain('Say how shipping and returns work');
  });

  it('keeps a customer case’s sentence the person’s, confirmed or not, out of the agent’s sources (CE-052)', () => {
    const sentence = 'Acme cut close time 40% with Ledgerly.';
    expect(proofSentences([], [sentence])).toEqual(new Set([sentence]));
    // An open proof to-do's sentence, as before.
    expect(
      proofSentences([
        {
          id: 'proof',
          done: false,
          gain: 3,
          score: 'trust',
          action: 'addProof',
          proof: {
            claim: 'ISO 27001',
            block: 'We are ISO 27001.',
            kind: 'certification',
            sentence: 'We are ISO 27001.',
          },
        },
      ]),
    ).toEqual(new Set(['We are ISO 27001.']));
  });

  it('shows the three scores with their bands, labelled an GetCito estimate', async () => {
    await render(result);
    const scores = container.querySelector('[aria-label="Quality scores"]')!;
    // Each name says in plain words what it scores (editor UX review 2026-11-03).
    expect(scores.textContent).toContain('E-E-A-TWho stands behind the page100Strong');
    // No Trust check is live for a page without agent claims: no fake points.
    expect(scores.textContent).toContain('TrustSources, links and dated factsNot scored yet');
    expect(scores.textContent).toContain('ReadabilityHow easily it reads71Can improve');
    expect(scores.textContent).toContain(
      '80 and up: Strong · 60 to 79: Can improve · under 60: Needs work',
    );
    expect(scores.textContent).toContain(
      "GetCito estimates based on Google's published quality signals. Not a Google score.",
    );
  });

  it('lists what would raise it, the biggest gain first, each with what to do', async () => {
    await render(result);
    const suggestions = container.querySelector('[aria-label="What would raise it"]')!;
    const rows = [...suggestions.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual([
      '+10 ReadabilityReading level 77 (Flesch Reading Ease)Aim for 50–70: the page reads simpler than most readers of it expect. Keep the detail they look for.',
      '+9 Readability3 sentences over 35 wordsSplit each into two. Show goes to the first.Show',
      '+5 ReadabilitySentences average 22.4 wordsAim for 15–20 words: shorter sentences read faster, and AI answers quote them whole.',
    ]);
    // A gain is an estimate, and says so: no exact promise.
    expect(suggestions.querySelector('li [title]')!.getAttribute('title')).toBe(
      'Could raise Readability by about 10 (an estimate)',
    );
    await act(async () => suggestions.querySelector<HTMLButtonElement>('li button')!.click());
    expect(onShow).toHaveBeenCalledWith('A very long sentence.');
  });

  it('shows the part the Next step names in the panel’s own scroll, marked, Quality open or not (editor test 2026-11-03)', async () => {
    vi.useFakeTimers();
    // The panel's own scroll: where a part shown scrolls to, not the page.
    const box = document.createElement('div');
    box.setAttribute('data-panel-scroll', '');
    box.appendChild(container);
    document.body.appendChild(box);
    const tops: number[] = [];
    box.scrollTo = ((options: ScrollToOptions) => {
      tops.push(options.top ?? -1);
    }) as typeof box.scrollTo;
    // jsdom has no layout: the panel at 100px, its to-dos at 180px, what raises it at 260px.
    const at: Record<string, number> = { 'Your to-dos': 180, 'What would raise it': 260 };
    const rect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const top = this === box ? 100 : (at[this.getAttribute('aria-label') ?? ''] ?? 140);
      return { top, left: 0, right: 0, bottom: top, width: 0, height: 0, x: 0, y: top } as DOMRect;
    };
    // The page itself never scrolls (editor UX review 2026-11-03: at 1024×768 Next and
    // Mark ready went out of sight).
    const had = HTMLElement.prototype.scrollIntoView;
    let pageScrolled = 0;
    HTMLElement.prototype.scrollIntoView = () => {
      pageScrolled += 1;
    };
    try {
      // To-dos open: Show to-dos brings them to the panel's top, less a little room.
      await render(read(result, null), null, { to: 'todos', n: 1 });
      const todos = container.querySelector<HTMLElement>('[aria-label="Your to-dos"]')!;
      expect(tops).toEqual([72]);
      expect(todos.tabIndex).toBe(-1);
      expect(todos.className).toContain('ring-2');
      // The same request again (a render) does nothing; a new one, with Quality open, does.
      await render(read(result, null), null, { to: 'todos', n: 1 });
      expect(tops).toHaveLength(1);
      await render(read(result, null), null, { to: 'trust', n: 2 });
      expect(tops).toEqual([72, 152]);
      // The mark goes after a moment.
      await act(async () => vi.advanceTimersByTime(2_000));
      expect(
        container.querySelector('[aria-label="What would raise it"]')!.className,
      ).not.toContain('ring-2');
      // No to-do left: Show to-dos goes to what raises the scores instead.
      await render(result, null, { to: 'todos', n: 3 });
      expect(tops.at(-1)).toBe(152);
      expect(pageScrolled).toBe(0);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = rect;
      HTMLElement.prototype.scrollIntoView = had;
      box.remove();
      vi.useRealTimers();
    }
  });

  it('asks for shorter words and sentences under English’s band', async () => {
    await render({
      ...result,
      checks: result.checks.map((c) =>
        c.id === 'readingLevel' ? { ...c, value: 42, count: -1 } : c,
      ),
    });
    const suggestions = container.querySelector('[aria-label="What would raise it"]')!;
    expect(suggestions.textContent).toContain(
      'Reading level 42 (Flesch Reading Ease)Aim for 50–70: shorter words and sentences.',
    );
  });

  it('asks to join short sentences when they run under the range', async () => {
    await render({
      ...result,
      checks: result.checks.map((c) =>
        c.id === 'avgSentence' ? { ...c, value: 8, count: -1 } : c,
      ),
    });
    expect(container.textContent).toContain('Sentences average 8 words');
    expect(container.textContent).toContain('join some short ones');
  });

  it('says when the page is too short to read, or reads well', async () => {
    await render({ score: null, unscored: 'tooShort', checks: [], words: 12 });
    expect(container.textContent).toContain('Write a few paragraphs');
    expect(container.querySelector('[aria-label="What would raise it"]')).toBeNull();
    await render({
      ...result,
      score: 100,
      checks: result.checks.map((c) => ({ ...c, points: c.max })),
    });
    expect(container.textContent).toContain('Nothing to raise here for now');
  });

  it('offers to confirm the author the site names, then their profile (00271)', async () => {
    const withConfirmed = (real: boolean, profile: boolean): QualityRead => {
      const score = eeat({ author: null, confirmed: { real, profile } });
      return {
        ...read(null, null),
        eeat: score,
        authorConfirmed: { real, profile },
        todos: qualityTodos({
          eeat: score,
          author: null,
          hasAuthors: true,
          confirmed: { real, profile },
        }),
      };
    };
    await render(withConfirmed(false, false));
    const box = () => container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
    expect(box()).toHaveLength(1);
    expect(box()[0].closest('li')!.textContent).toContain(
      'The author is a real person, named on your site',
    );
    await act(async () => box()[0].click());
    expect(onConfirmAuthor).toHaveBeenCalledWith('real', true);

    // Confirmed: the byline checked, the profile's own box offered.
    await render(withConfirmed(true, false));
    const [byline, profile] = [...container.querySelectorAll('[aria-label="Your to-dos"] li')];
    expect(byline.textContent).toContain(
      'You confirmed your site names a real person as the author',
    );
    expect(profile.textContent).toContain('Or, if your site shows their profile, confirm it');
    expect(box()).toHaveLength(2);
    await act(async () => box()[1].click());
    expect(onConfirmAuthor).toHaveBeenLastCalledWith('profile', true);
    expect(container.querySelector('[aria-label="Quality scores"]')!.textContent).toContain(
      'Who stands behind the page60',
    );
  });

  it("lists picking the page's author as a to-do, and opens the menu", async () => {
    await render(read(result, null));
    const scores = container.querySelector('[aria-label="Quality scores"]')!;
    expect(scores.textContent).toContain('Who stands behind the page0Needs work');
    const todos = container.querySelector('[aria-label="Your to-dos"]')!;
    expect(todos.querySelector('h4')!.textContent).toBe(
      'Your to-dos 2 left · only you can do these',
    );
    const [row, profile] = [...todos.querySelectorAll('li')];
    expect(row.textContent).toBe(
      "Pick the page's author · To doIt's by Acme Team now: a named person shows who stands behind the page. Or, if your site names the author, confirm it · +60 E-E-A-TPick author",
    );
    // The profile waits on the author: listed, with no button yet.
    expect(profile.textContent).toBe(
      "Complete the author's profile · To doOnce the page has an author: two sentences on what they know, and a profile link · +40 E-E-A-T",
    );
    expect(profile.querySelector('button, a')).toBeNull();
    await act(async () => row.querySelector('button')!.click());
    expect(onPickAuthor).toHaveBeenCalled();
    // Not a suggestion: the agent can't pick an author.
    expect(
      container.querySelector('[aria-label="What would raise it"]')!.textContent,
    ).not.toContain('author');
  });

  it('checks the author off, then asks to complete their profile in Settings › Authors', async () => {
    await render(read(result, { ...ada, bio: null, sameAs: [] }));
    const todos = container.querySelector('[aria-label="Your to-dos"]')!;
    expect(todos.querySelector('h4')!.textContent).toContain('1 left');
    const [byline, profile] = [...todos.querySelectorAll('li')];
    expect(byline.textContent).toBe("Pick the page's author · DoneBy Ada Lovelace");
    expect(byline.querySelector('.line-through')).not.toBeNull();
    expect(byline.querySelector('button, a')).toBeNull();
    expect(profile.textContent).toContain(
      "Complete Ada Lovelace's profile · To doAdd them in Settings › Authors: two sentences on what they know, and a LinkedIn or other profile link · +40 E-E-A-T",
    );
    expect(profile.querySelector('a')!.textContent).toBe('Edit author');
    expect(profile.querySelector('a')!.getAttribute('href')).toBe('/dashboard/settings/authors');
  });

  it('lists the placeholders to fill first, with Show (CE-044)', async () => {
    const author = ada;
    const score = eeat({ author });
    await render({
      ...read(result),
      todos: qualityTodos({
        eeat: score,
        author,
        hasAuthors: true,
        placeholders: { count: 1, had: true },
      }),
    });
    const todos = container.querySelector('[aria-label="Your to-dos"]')!;
    expect(todos.querySelector('h4')!.textContent).toBe(
      'Your to-dos 1 left · only you can do these',
    );
    const row = todos.querySelector('li')!;
    expect(row.textContent).toBe(
      'Fill 1 placeholder · To doWords in [brackets] stand where a real name, quote or number goes. Put in the real one, or take the sentence outShow',
    );
    await act(async () => row.querySelector('button')!.click());
    expect(onShowPlaceholder).toHaveBeenCalled();

    // Filled: checked, and it stays.
    await render({
      ...read(result),
      todos: qualityTodos({
        eeat: score,
        author,
        hasAuthors: true,
        placeholders: { count: 0, had: true },
      }),
    });
    const done = container.querySelector('[aria-label="Your to-dos"] li')!;
    expect(done.textContent).toBe('Fill the placeholders · DoneAll filled in');
    expect(done.querySelector('button')).toBeNull();
  });

  it('links the brand facts to approve to Brand settings, and names a price that differs (CE-047)', async () => {
    const author = ada;
    const score = eeat({ author });
    const blocks = trustBlocks(
      '<p>Pro costs $59 per month.</p><p>Up 40% (<a href="https://a.example">report</a>).</p>',
    );
    const trustRead = trust({
      blocks,
      links: new Map(),
      brandDomains: [],
      brandFacts: {
        compared: 1,
        mismatches: [
          {
            kind: 'price',
            page: '$59',
            fact: '$49',
            source: 'pricing',
            sentence: 'Pro costs $59 per month.',
          },
        ],
      },
      now: Date.parse('2026-10-24T12:00:00Z'),
    });
    await render({
      ...read(result),
      trust: trustRead,
      brandFactsPath: '/dashboard/brands/b1/settings?tab=facts',
      todos: qualityTodos({
        eeat: score,
        author,
        hasAuthors: true,
        brandFacts: { pending: 2, had: true },
      }),
    });
    // Last: the brand's, worth no points of the page's.
    const rows = [...container.querySelectorAll('[aria-label="Your to-dos"] li')];
    const row = rows.at(-1)!;
    expect(row.textContent).toContain('Approve 2 brand facts');
    expect(row.querySelector('a')!.getAttribute('href')).toBe(
      '/dashboard/brands/b1/settings?tab=facts',
    );
    const suggestion = [...container.querySelectorAll('li')].find((li) =>
      li.textContent?.includes('differs from brand facts'),
    )!;
    expect(suggestion.textContent).toContain(
      'Price differs from brand facts · Page $59 · pricing page $49',
    );
    await act(async () =>
      [...suggestion.querySelectorAll('button')].find((b) => b.textContent === 'Show')!.click(),
    );
    expect(onShow).toHaveBeenCalledWith('Pro costs $59 per month.');
  });

  it('asks for what only the person can give, each with Add, and its gain (CE-048)', async () => {
    const none = { experience: false, data: false, quote: false };
    const score = eeat({ author: ada, used: none });
    const trustScore = trust({
      blocks: trustBlocks('<p>Up 40% (<a href="https://src.example/">source</a>).</p>'),
      links: new Map(),
      brandDomains: [],
      quote: false,
      now: Date.parse('2026-10-24T12:00:00Z'),
    });
    await render({
      ...read(result),
      eeat: score,
      trust: trustScore,
      todos: qualityTodos({
        eeat: score,
        author: ada,
        hasAuthors: true,
        canEdit: true,
        used: none,
        given: { experience: true, data: false, quote: false },
        trust: trustScore,
      }),
    });
    const rows = [...container.querySelectorAll('[aria-label="Your to-dos"] li')].map(
      (li) => li.textContent,
    );
    expect(rows.slice(2)).toEqual([
      "Add your own experience · To doIt's in Your input, but the page doesn't use it yet: write it in, or let the agent write from it · +33 E-E-A-TAdd",
      "Add your own data · To doYour numbers, or GetCito data on this page's prompts: the page cites them as yours · +25 E-E-A-TAdd",
      "Add an expert's quote · To doA real person's words as said, with their name, title and where they said them · +21 TrustAdd",
    ]);
    const add = [...container.querySelectorAll('[aria-label="Your to-dos"] li')]
      .find((li) => li.textContent?.startsWith('Add your own data'))!
      .querySelector('button')!;
    await act(async () => add.click());
    expect(onAddInput).toHaveBeenCalled();
  });

  it("says who can complete the profile when the reader can't edit the author", async () => {
    await render(read(result, { ...ada, bio: null }, true, false));
    const row = [...container.querySelectorAll('li')].find((li) =>
      li.textContent?.includes("Complete Ada Lovelace's profile"),
    )!;
    expect(row.textContent).toContain(
      'Whoever added Ada Lovelace or an admin can add a short bio in Settings › Authors',
    );
    expect(row.querySelector('a')).toBeNull();
    expect(row.querySelector('button')).toBeNull();
  });

  it('names the author among who can when they are a member', async () => {
    await render(read(result, { ...ada, sameAs: [], userId: 'u2' }, true, false));
    const row = [...container.querySelectorAll('li')].find((li) =>
      li.textContent?.includes("Complete Ada Lovelace's profile"),
    )!;
    expect(row.textContent).toContain(
      'Ada Lovelace, whoever added them or an admin can add a profile link in Settings › Authors',
    );
    expect(row.querySelector('a')).toBeNull();
  });

  it('sends to Settings › Authors when the workspace has no author yet', async () => {
    await render(read(result, null, false));
    const row = container.querySelector('[aria-label="Your to-dos"] li')!;
    expect(row.textContent).toContain('Add an author for the page');
    expect(row.querySelector('a')!.textContent).toBe('Add author');
    expect(row.querySelector('a')!.getAttribute('href')).toBe('/dashboard/settings/authors');
  });

  it('says all done when every to-do is, and nothing is left to raise', async () => {
    await render({
      ...read(result),
      readability: {
        ...result,
        score: 100,
        checks: result.checks.map((c) => ({ ...c, points: c.max })),
      },
    });
    const todos = container.querySelector('[aria-label="Your to-dos"]')!;
    expect(todos.querySelector('h4')!.textContent).toBe('Your to-dos All done');
    expect(container.textContent).toContain('Nothing to raise here for now');
  });

  it('says nothing is left to raise only once the to-dos are done', async () => {
    await render({
      ...read(result, null),
      readability: {
        ...result,
        score: 100,
        checks: result.checks.map((c) => ({ ...c, points: c.max })),
      },
    });
    expect(container.textContent).not.toContain('Nothing to raise');
    expect(container.querySelector('[aria-label="What would raise it"]')).toBeNull();
  });

  it('says only that a short page is too short, with nothing else to raise', async () => {
    await render(read({ score: null, checks: [], words: 12 }));
    expect(container.textContent).toContain('Write a few paragraphs');
    expect(container.textContent).not.toContain('Nothing to raise');
  });

  it('asks to source figures, swap stale sources and fix links, each with Show', async () => {
    const html =
      '<p>Win rates rose 42% last year.</p>' +
      '<p>See <a href="https://old.example/">this study</a> and <a href="https://gone.example/">that one</a>.</p>';
    const links = new Map<string, LinkCheck>([
      [
        'https://old.example/',
        {
          href: 'https://old.example/',
          status: 'ok',
          httpStatus: 200,
          date: '2020-01-01T00:00:00.000Z',
        },
      ],
      [
        'https://gone.example/',
        { href: 'https://gone.example/', status: 'broken', httpStatus: 404, date: null },
      ],
    ]);
    const result = trust({
      blocks: trustBlocks(html),
      links,
      brandDomains: ['acme.com'],
      now: Date.parse('2026-10-23T12:00:00Z'),
    });
    await render({ ...read(null), trust: result });
    const scores = container.querySelector('[aria-label="Quality scores"]')!;
    // Figures 0 of 30, fresh 0 of 7, links 1.5 of 3: 4 of 100.
    expect(scores.textContent).toContain('Sources, links and dated facts4Needs work');
    const suggestions = container.querySelector('[aria-label="What would raise it"]')!;
    const rows = [...suggestions.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toContainEqual(expect.stringContaining('1 sentence with a figure has no source'));
    expect(rows).toContainEqual(
      expect.stringContaining('1 of 1 dated source is over 24 months old'),
    );
    expect(rows).toContainEqual(
      expect.stringContaining("1 link doesn't workFix or remove it: https://gone.example/Show"),
    );
    const figure = [...suggestions.querySelectorAll('li')].find((li) =>
      li.textContent?.includes('figure'),
    )!;
    await act(async () => figure.querySelector('button')!.click());
    expect(onShow).toHaveBeenCalledWith('Win rates rose 42% last year.');
  });

  it('asks to replace weak sources, with Show and Keep, and for a primary one (CE-046)', async () => {
    const html =
      '<p>People swear by it on <a href="https://www.reddit.com/r/coffee/1">a thread</a>.</p>' +
      '<p>Their tool too: <a href="https://rival.example/feature">rival</a>.</p>' +
      '<p>As <a href="https://www.reuters.com/x">Reuters</a> reported.</p>';
    const result = trust({
      blocks: trustBlocks(html),
      links: new Map(),
      brandDomains: ['acme.com'],
      sources: { competitorDomains: ['rival.example'], pageType: 'guide', kept: new Set() },
      now: Date.parse('2026-10-23T12:00:00Z'),
    });
    await render({ ...read(null), trust: result });
    const suggestions = container.querySelector('[aria-label="What would raise it"]')!;
    const rows = [...suggestions.querySelectorAll('li')];
    const weak = rows.find((li) => li.textContent?.includes('weak'))!;
    expect(weak.textContent).toContain(
      "2 sources are weak: a forum, a social post or a competitor's page",
    );
    expect(weak.textContent).toContain('reddit.com is a forum or a social post.');
    await act(async () => weak.querySelectorAll('button')[0].click());
    expect(onShow).toHaveBeenCalledWith('People swear by it on a thread.');
    await act(async () => weak.querySelectorAll('button')[1].click());
    expect(onKeep).toHaveBeenCalledWith('https://www.reddit.com/r/coffee/1');
    expect(rows.map((li) => li.textContent)).toContainEqual(
      expect.stringContaining('No primary source yet'),
    );
  });

  it('tags a source read by AI, and says when AI reads wait for the budget (CE-046)', async () => {
    const html =
      '<p>A blog says so on <a href="https://coffee-blog.example/best">a list</a>.</p>' +
      '<p>As <a href="https://www.reuters.com/x">Reuters</a> reported.</p>';
    const result = trust({
      blocks: trustBlocks(html),
      links: new Map(),
      brandDomains: ['acme.com'],
      sources: {
        competitorDomains: [],
        pageType: 'guide',
        kept: new Set(),
        ai: new Map([['coffee-blog.example', 'weak']]),
      },
      now: Date.parse('2026-10-23T12:00:00Z'),
    });
    await render({ ...read(null), trust: result, aiPaused: true });
    const weak = [...container.querySelectorAll('li')].find((li) =>
      li.textContent?.includes('weak:'),
    )!;
    expect(weak.textContent).toContain('AI check');
    expect(container.textContent).toContain(
      "Sources the rules can't place wait for an AI check: this month's AI usage is used up.",
    );
  });

  it('hands the suggestions off in one run, the to-dos staying the person’s (CE-051)', async () => {
    const run = vi.fn();
    const handOff = { run, running: false, blocked: null, count: 3, todos: 2 };
    await render(null, handOff);
    const card = container.querySelector('[aria-label="Hand it off to Content Agent"]')!;
    expect(card.textContent).toContain(
      'Fixes 3 suggestions in one run, for you to review · 2 to-dos stay yours',
    );
    const button = [...card.querySelectorAll('button')].find((b) => b.textContent === 'Hand off')!;
    await act(async () => button.click());
    expect(run).toHaveBeenCalled();

    // Blocked: it says why, on the button too; running: it says so; nothing to fix: it can't run.
    await render(null, { ...handOff, blocked: 'Decide the 2 open suggestions first.' });
    const held = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Hand off',
    )!;
    expect(held.disabled).toBe(true);
    const why = held.getAttribute('aria-describedby');
    expect([...container.querySelectorAll('p')].find((p) => p.id === why)?.textContent).toBe(
      'Decide the 2 open suggestions first.',
    );
    await render(null, { ...handOff, running: true });
    expect(container.textContent).toContain('Working…');
    await render(null, { ...handOff, count: 0, todos: 0 });
    expect(container.textContent).toContain('Nothing for the agent to fix · nothing left for you');
    // Below phase 2: no card.
    await render(null);
    expect(container.querySelector('[aria-label="Hand it off to Content Agent"]')).toBeNull();
  });

  it('leaves the person a suggestion that asks the other way to the hand-off’s checks (CE-051)', () => {
    const t = createTranslator({
      locale: 'en',
      messages,
      namespace: 'contentEditor.editor.quality',
    }) as unknown as Parameters<typeof qualitySuggestions>[0];
    const byKey = (readability: Readability) =>
      new Map(qualitySuggestions(t, read(readability)).map((s) => [s.key, s]));
    // Sentences too short, a page too simple (over the band): longer and harder are the person's.
    const simple = byKey({
      ...result,
      checks: result.checks.map((c) =>
        c.id === 'avgSentence' ? { ...c, points: 10, value: 9, count: -1 } : c,
      ),
    });
    expect(simple.get('readability:avgSentence')?.handOff).toBe(false);
    expect(simple.get('readability:readingLevel')?.handOff).toBe(false);
    expect(simple.get('readability:longSentences')?.handOff).toBeUndefined();
    // Too long, too hard: the agent's.
    const hard = byKey({
      ...result,
      checks: result.checks.map((c) =>
        c.id === 'avgSentence'
          ? { ...c, points: 10, value: 27, count: 1 }
          : c.id === 'readingLevel'
            ? { ...c, value: 40, count: -1 }
            : c,
      ),
    });
    expect(hard.get('readability:avgSentence')?.handOff).toBeUndefined();
    expect(hard.get('readability:readingLevel')?.handOff).toBeUndefined();
  });

  it('asks a page that puts the brand forward to disclose it and add an honest weakness, AI checks, Show on the pick (CE-050)', async () => {
    const PICK = 'Our top pick is the Acme Ridge 28.';
    const result = trust({
      blocks: trustBlocks(
        `<p>${PICK}</p><p>Pro saves 40% of the time (<a href="https://research.example/s">study</a>).</p>`,
      ),
      links: new Map(),
      brandDomains: ['acme.com'],
      page: { balanced: { found: false }, disclosure: { found: false } },
      now: Date.parse('2026-10-25T12:00:00Z'),
    });
    const pick = { found: false, show: 'Our top pick is the Acme Ridge 28' };
    await render({
      ...read(null),
      brandName: 'Acme',
      trust: result,
      aiChecks: { balanced: pick, disclosure: pick },
    });
    const rows = [...container.querySelectorAll('li')];
    const disclosure = rows.find((li) => li.textContent?.includes('Acme without a disclosure'))!;
    expect(disclosure.textContent).toContain('The page recommends Acme without a disclosure');
    expect(disclosure.textContent).toContain('AI check');
    await act(async () => disclosure.querySelector('button')!.click());
    expect(onShow).toHaveBeenCalledWith('Our top pick is the Acme Ridge 28');
    const balance = rows.find((li) => li.textContent?.includes('Add an honest weakness'))!;
    expect(balance.textContent).toContain('AI check');
    // Found: nothing to raise.
    await render({
      ...read(null),
      brandName: 'Acme',
      trust: result,
      aiChecks: { balanced: { found: true, show: null }, disclosure: { found: true, show: null } },
    });
    expect(container.textContent).not.toContain('Add an honest weakness');
    // The brand's name not read yet: "your brand".
    await render({
      ...read(null),
      brandName: '',
      trust: result,
      aiChecks: { balanced: null, disclosure: pick },
    });
    expect(container.textContent).toContain('The page recommends your brand without a disclosure');
  });

  it("asks for the proof of the page's own claims by kind and business, with Add proof link (CE-049)", async () => {
    const html =
      '<p>Ledgerly is 40% faster than spreadsheets.</p>' +
      '<p>Every plan is SOC 2 certified.</p>' +
      '<p>Teams forecast 3x more often.</p>';
    const blocks = trustBlocks(html);
    const proofs = proofsOnPage(blocks, [
      { claim: '40% faster', block: blocks[0].text, kind: 'test' },
      { claim: 'SOC 2 certified', block: blocks[1].text, kind: 'certification' },
      { claim: 'the best', block: 'a paragraph since rewritten', kind: 'ranking' },
    ]);
    const trustScore = trust({
      blocks,
      links: new Map(),
      brandDomains: ['acme.com'],
      proofs,
      now: Date.parse('2026-10-24T12:00:00Z'),
    });
    const quality = (siteType: QualityRead['siteType']): QualityRead => ({
      ...read(null),
      trust: trustScore,
      siteType,
      pageLimited: true,
      todos: qualityTodos({
        eeat: null,
        author: null,
        hasAuthors: true,
        trust: trustScore,
        proofs: { asks: proofs, had: new Set() },
      }),
    });
    await render(quality('b2b'));
    const todos = container.querySelector('[aria-label="Your to-dos"]')!;
    const rows = [...todos.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual([
      expect.stringMatching(
        /^Link your test result for “40% faster” · To doOnly you have this proof/,
      ),
      expect.stringMatching(/^Link the audit report or trust page for “SOC 2 certified”/),
    ]);
    // The page's other figure is still the agent's to source: one sentence, its share of the gain.
    const suggestions = container.querySelector('[aria-label="What would raise it"]')!;
    expect(suggestions.textContent).toContain('1 sentence with a figure has no source');
    expect(container.textContent).toContain(
      "Today's AI reads of this page are used up: the page's AI checks are left out of the scores.",
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Add a proof link to “40% faster”"]')!
        .click(),
    );
    expect(onAddSource).toHaveBeenCalledWith({
      text: '40% faster',
      sentence: 'Ledgerly is 40% faster than spreadsheets.',
      block: 'Ledgerly is 40% faster than spreadsheets.',
    });

    await render(quality('ecommerce'));
    expect(container.textContent).toContain(
      'Link the certificate or lab result for “SOC 2 certified”',
    );
    expect(container.textContent).toContain('Link the test report for “40% faster”');
  });

  it("asks to confirm the page's own images, or to add one at a spot (CE-049, part d)", async () => {
    const none = { experience: false, data: false, quote: false };
    const quality = (images: number, openSpots: number): QualityRead => {
      const score = eeat({ author: ada, used: none, visual: { images, own: 0, openSpots } });
      return {
        ...read(null),
        eeat: score,
        todos: qualityTodos({
          eeat: score,
          author: ada,
          hasAuthors: true,
          used: none,
          visual: { images, own: 0, openSpots },
        }),
      };
    };
    onConfirmImages.mockReset();
    onAddImage.mockReset();
    await render(quality(2, 0));
    const row = () =>
      [...container.querySelectorAll('[aria-label="Your to-dos"] li')].find((li) =>
        li.textContent?.startsWith('Show your own image'),
      )!;
    expect(row().textContent).toContain(
      "Are any of the page's 2 images your own (screenshots or photos you took), not stock? Confirm them",
    );
    await act(async () => row().querySelector('button')!.click());
    expect(onConfirmImages).toHaveBeenCalled();
    await render(quality(0, 1));
    expect(row().textContent).toContain(
      'A screenshot or photo you took, where the margin suggests one',
    );
    await act(async () => row().querySelector('button')!.click());
    expect(onAddImage).toHaveBeenCalled();
  });

  it('asks for a qualified reviewer, and opens their menu (CE-049, part e)', async () => {
    onPickReviewer.mockReset();
    const score = eeat({ author: ada });
    await render({
      ...read(null),
      eeat: score,
      todos: qualityTodos({
        eeat: score,
        author: ada,
        hasAuthors: true,
        reviewer: { topic: 'finance', picked: false },
      }),
    });
    const row = [...container.querySelectorAll('[aria-label="Your to-dos"] li')].find((li) =>
      li.textContent?.startsWith('Add a qualified reviewer'),
    )!;
    expect(row.textContent).toContain(
      'The page advises readers on their money: name the qualified person who reviewed it',
    );
    await act(async () => row.querySelector('button')!.click());
    expect(onPickReviewer).toHaveBeenCalled();
  });

  it("shows the site's trust, what is missing and the way to Site Audit", async () => {
    const siteTrust = {
      checks: {
        about: { ok: true, url: 'https://acme.com/about' },
        contact: { ok: true, url: 'https://acme.com/contact' },
        editorial: { ok: false, url: null },
        organizationSchema: { ok: true, url: 'https://acme.com/' },
        authorPages: { ok: false, authors: [{ name: 'Ada', url: null }] },
      },
      score: 3,
      checkedAt: '2026-10-23T12:00:00.000Z',
    };
    await render({ ...read(result), siteTrust });
    const site = container.querySelector('[aria-label="Site trust"]')!;
    expect(site.textContent).toBe(
      'Site trust 3/5· Missing: Editorial policy and Author pagesFix in Site Audit',
    );
    expect(site.querySelector('a')!.getAttribute('href')).toBe('/dashboard/audit#site-trust');

    const all = Object.fromEntries(
      Object.entries(siteTrust.checks).map(([k, v]) => [k, { ...v, ok: true }]),
    ) as typeof siteTrust.checks;
    await render({ ...read(result), siteTrust: { ...siteTrust, checks: all, score: 5 } });
    expect(container.querySelector('[aria-label="Site trust"]')!.textContent).toBe(
      'Site trust 5/5',
    );
  });

  it('lists a broken link before Trust is scored, its gain out of the Phase 1 points', async () => {
    const result = trust({
      blocks: trustBlocks('<p>See <a href="https://gone.example/">that one</a>.</p>'),
      links: new Map<string, LinkCheck>([
        [
          'https://gone.example/',
          { href: 'https://gone.example/', status: 'broken', httpStatus: 404, date: null },
        ],
      ]),
      brandDomains: ['acme.com'],
      now: Date.parse('2026-10-23T12:00:00Z'),
    });
    await render({ ...read(null), trust: result });
    const scores = container.querySelector('[aria-label="Quality scores"]')!;
    expect(scores.textContent).toContain('Sources, links and dated factsNot scored yet');
    const rows = [...container.querySelectorAll('li')].map((li) => li.textContent);
    // 3 of the 40 Phase 1 points.
    expect(rows).toContainEqual(expect.stringContaining("+8 Trust1 link doesn't work"));
  });

  it('counts the dated sources and the stale ones each in its own number', async () => {
    const dated = (date: string) => ({ status: 'ok' as const, httpStatus: 200, date });
    const result = trust({
      blocks: trustBlocks(
        '<p>See <a href="https://a.example/">a</a>, <a href="https://b.example/">b</a> and <a href="https://c.example/">c</a>.</p>',
      ),
      links: new Map<string, LinkCheck>([
        ['https://a.example/', { href: 'https://a.example/', ...dated('2020-01-01T00:00:00Z') }],
        ['https://b.example/', { href: 'https://b.example/', ...dated('2021-01-01T00:00:00Z') }],
        ['https://c.example/', { href: 'https://c.example/', ...dated('2026-01-01T00:00:00Z') }],
      ]),
      brandDomains: ['acme.com'],
      now: Date.parse('2026-10-23T12:00:00Z'),
    });
    await render({ ...read(null), trust: result });
    const rows = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toContainEqual(
      expect.stringContaining('2 of 3 dated sources are over 24 months old'),
    );
  });

  it('says when the page’s language isn’t read yet, not that it is too short', async () => {
    await render({ score: null, unscored: 'language', checks: [], words: 240 });
    expect(container.textContent).toContain("Readability isn't read for this language yet.");
    expect(container.textContent).not.toContain('Write a few paragraphs');
    expect(container.querySelector('[aria-label="What would raise it"]')).toBeNull();
  });
});
