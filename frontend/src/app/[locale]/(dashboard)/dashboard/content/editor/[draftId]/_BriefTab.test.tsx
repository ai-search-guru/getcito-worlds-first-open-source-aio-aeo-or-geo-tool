import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { DraftBrief } from '@/lib/content/brief';
import type { DraftMethod } from '@/lib/content/drafts';
import type { InputsGiven } from '@/lib/content/draftInputs';
import { BriefTab, type AgentRewrite, type BriefState } from './_BriefTab';

const saveDraftBrief = vi.fn();
vi.mock('@/lib/actions/contentDrafts', () => ({
  saveDraftBrief: (...args: unknown[]) => saveDraftBrief(...args),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const brief: DraftBrief = {
  goal: 'Help home baristas pick a machine',
  audience: 'First-time espresso buyers',
  outline: [
    {
      heading: 'The best espresso machines under $500',
      keyPoints: ['Price bands', 'What to skip'],
      fanout: 'best espresso machine under 500',
      platform: 'perplexity-web',
    },
    { heading: 'Care and cleaning', keyPoints: [], fanout: null, platform: null },
  ],
  keywords: ['espresso machine', 'grinder'],
  origin: 'rebuild',
  builtAt: '2026-10-21T10:00:00Z',
  builtFrom: { prompts: 2, fanouts: 3, pages: 1, queries: 1 },
};

const onRebuild = vi.fn();
const onRetry = vi.fn();
const onSaved = vi.fn();

let container: HTMLDivElement;
let root: Root;

async function render(
  state: BriefState,
  extra: {
    pageType?: string | null;
    sourceUrl?: string | null;
    length?: number;
    method?: DraftMethod;
    rewrite?: AgentRewrite;
    given?: InputsGiven | null;
    onAddInput?: () => void;
  } = {},
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BriefTab
          draftId="d1"
          state={state}
          pageType={extra.pageType === undefined ? 'buying_guide' : extra.pageType}
          length={extra.length ?? 3000}
          sourceUrl={
            extra.sourceUrl === undefined ? 'https://acme.example/guides/espresso' : extra.sourceUrl
          }
          method={extra.method ?? 'optimize'}
          rebuilding={false}
          onRebuild={onRebuild}
          onRetry={onRetry}
          onSaved={onSaved}
          rewrite={extra.rewrite}
          given={extra.given}
          onAddInput={extra.onAddInput}
        />
      </NextIntlClientProvider>,
    );
  });
}

const button = (name: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === name || b.getAttribute('aria-label') === name,
  )!;
const fields = () =>
  Object.fromEntries(
    [...container.querySelectorAll('dt')].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ]),
  );

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  saveDraftBrief.mockReset();
  onRebuild.mockReset();
  onRetry.mockReset();
  onSaved.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Brief tab', () => {
  it('shows the page, the brief and each H2 with the fan-out it answers', async () => {
    await render({ status: 'ready', brief });
    // The card first: the brief is there, so Rebuild brief, the secondary button.
    expect(container.textContent).toContain('Brief ready · 2 H2s');
    expect(button('Rebuild brief').className).not.toContain('bg-primary');
    expect(button('What it does')).toBeDefined();
    expect(fields()).toEqual({
      'Page type': 'Buying guide',
      'Target URL': '/guides/espresso',
      Goal: 'Help home baristas pick a machine',
      Audience: 'First-time espresso buyers',
      // Characters first, as rules count; about as many words next to them.
      Length: '3,000 characters · ~500 wordsFrom the rules',
    });
    const sections = [...container.querySelectorAll('ol > li')].map((li) => li.textContent);
    expect(sections).toEqual([
      'H2The best espresso machines under $500Price bandsWhat to skipAnswers “best espresso machine under 500”· Perplexity',
      'H2Care and cleaning',
    ]);
    expect(container.textContent).toContain('espresso machinegrinder');
    expect(container.textContent).toContain('Built from 7 sources');

    await act(async () => button('Rebuild brief').click());
    expect(onRebuild).toHaveBeenCalled();
  });

  it('asks before rebuilding a brief the person edited', async () => {
    await render({ status: 'ready', brief: { ...brief, origin: 'edit' } });
    await act(async () => button('Rebuild brief').click());
    expect(onRebuild).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      'Rebuild brief writes a new brief over the one you edited.',
    );
    await act(async () => button('Keep my brief').click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(onRebuild).not.toHaveBeenCalled();

    await act(async () => button('Rebuild brief').click());
    await act(async () => button('Rebuild anyway').click());
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });

  it('says next to Length how long the cited pages are, once read (CE-030)', async () => {
    await render({
      status: 'ready',
      brief: { ...brief, citedLength: { characters: 4300, pages: 3 } },
    });
    expect(fields().Length).toBe(
      '3,000 characters · ~500 wordsFrom the rules · a typical cited page has 4,300 characters (median of 3)',
    );
  });

  it('says what the cited pages have, from the same read (learning C2)', async () => {
    await render({
      status: 'ready',
      brief: {
        ...brief,
        citedLength: { characters: 4300, pages: 3 },
        citedFeatures: {
          pages: 3,
          checks: [
            { key: 'faq-schema', label: 'FAQ schema', pages: 3 },
            { key: 'tables', label: 'Tables', pages: 2 },
          ],
        },
      },
    });
    expect(fields()['Cited pages have']).toBe(
      "FAQ schema (3 of 3) · Tables (2 of 3)Site Audit's checks on the same cited pages",
    );
  });

  it('offers Run Agent for a new page without a brief, or H2s added by hand', async () => {
    await render(
      { status: 'ready', brief: null },
      { pageType: 'product_page', sourceUrl: null, length: 1200 },
    );
    expect(container.textContent).toContain('No brief yetGoal, audience and outline are empty.');
    expect(fields()).toMatchObject({
      'Page type': 'Product page',
      'Target URL': 'A new page',
      Goal: 'Not set yet',
      Audience: 'Not set yet',
      Length: '1,200 characters · ~200 wordsFrom the rules',
    });
    expect(container.textContent).toContain(
      'Empty. Build brief to draft one, or add H2s yourself.',
    );
    // Run Agent is the black primary while there's nothing to rebuild.
    expect(button('Build brief').className).toContain('bg-primary');
    await act(async () => button('Build brief').click());
    expect(onRebuild).toHaveBeenCalled();

    // Or the person writes the H2s.
    await act(async () => button('Edit brief').click());
    expect(container.querySelectorAll('input[aria-label$="heading"]')).toHaveLength(0);
    expect(button('Add section')).toBeDefined();
  });

  it('asks right under the card, before rebuilding an edited brief', async () => {
    await render({ status: 'ready', brief: { ...brief, origin: 'edit' } });
    await act(async () => button('Rebuild brief').click());
    // The question sits with the button that asked, before the page type and outline.
    const alert = container.querySelector('[role="alert"]')!;
    expect(
      alert.compareDocumentPosition(container.querySelector('dl')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('says a brief with a goal but no H2s yet can be rebuilt', async () => {
    await render({ status: 'ready', brief: { ...brief, outline: [] } });
    expect(container.textContent).toContain('Brief ready · no H2s yet');
    expect(container.textContent).toContain(
      'No H2s yet. Rebuild brief to draft them, or add H2s yourself.',
    );
  });

  it('saves H2s added by hand on a draft without a brief', async () => {
    saveDraftBrief.mockImplementation(async (_id, next: DraftBrief) => ({ ...next }));
    await render({ status: 'ready', brief: null });
    await act(async () => button('Edit brief').click());
    await act(async () => button('Add section').click());
    const heading = container.querySelector<HTMLInputElement>('input[aria-label$="heading"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        heading,
        'What pipeline forecasting is',
      );
      heading.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Save brief').click());
    expect(saveDraftBrief).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({
        goal: '',
        audience: '',
        outline: [expect.objectContaining({ heading: 'What pipeline forecasting is' })],
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it('runs the agent without asking over an edited brief that is still empty', async () => {
    await render({
      status: 'ready',
      brief: { ...brief, goal: '', audience: '', outline: [], origin: 'edit' },
    });
    await act(async () => button('Build brief').click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });

  it('says where an opportunity’s brief comes from', async () => {
    await render({
      status: 'ready',
      brief: { ...brief, origin: 'opportunity', builtAt: null, builtFrom: null },
    });
    expect(container.textContent).toContain("From the opportunity's brief.");
  });

  it('edits the brief by hand', async () => {
    saveDraftBrief.mockImplementation(async (_id, next: DraftBrief) => ({
      ...next,
      origin: 'edit',
    }));
    await render({ status: 'ready', brief });
    await act(async () => button('Edit brief').click());

    const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const heading = container.querySelector<HTMLInputElement>(
      'input[aria-label="Section 1 heading"]',
    )!;
    const points = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Section 1 key points"]',
    )!;
    await act(async () => {
      setValue(heading, 'Espresso machines under $500');
      setValue(points, 'Price bands\n\n Warranty ');
    });
    await act(async () => button('Remove section 2').click());
    await act(async () => button('Save brief').click());

    expect(saveDraftBrief).toHaveBeenCalledWith('d1', {
      ...brief,
      outline: [
        {
          heading: 'Espresso machines under $500',
          keyPoints: ['Price bands', 'Warranty'],
          fanout: 'best espresso machine under 500',
          platform: 'perplexity-web',
        },
      ],
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ origin: 'edit' }));
    expect(toast.success).toHaveBeenCalledWith('Brief saved');
  });

  it('keeps what Edit brief doesn’t show: version 2’s answer, format, facts and page plan', async () => {
    saveDraftBrief.mockImplementation(async (_id, next: DraftBrief) => ({ ...next }));
    const planned: DraftBrief = {
      ...brief,
      version: 2,
      tldr: 'The page’s essentials.',
      proof: [{ kind: 'data', what: 'Our own shot times' }],
      outline: brief.outline.map((section, i) =>
        i === 0
          ? {
              ...section,
              answer: 'Under $500, a single boiler with a PID.',
              format: 'table' as const,
              facts: [{ claim: 'Average price', sourceType: 'statistic' as const, source: null }],
            }
          : section,
      ),
    };
    await render({ status: 'ready', brief: planned });
    await act(async () => button('Edit brief').click());
    await act(async () => button('Save brief').click());
    const saved = saveDraftBrief.mock.calls[0][1] as DraftBrief;
    expect(saved).toMatchObject({
      version: 2,
      tldr: 'The page’s essentials.',
      proof: planned.proof,
    });
    expect(saved.outline[0]).toMatchObject({
      answer: 'Under $500, a single boiler with a PID.',
      format: 'table',
      facts: [{ claim: 'Average price', sourceType: 'statistic', source: null }],
    });
    // The editor's own field stays its own.
    expect(saved.outline[0]).not.toHaveProperty('points');
  });

  it('says a brief too long to save is too long', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    saveDraftBrief.mockRejectedValue(new Error('too_long'));
    await render({ status: 'ready', brief });
    await act(async () => button('Edit brief').click());
    await act(async () => button('Save brief').click());
    expect(toast.error).toHaveBeenCalledWith(
      'The brief is too long to save. Shorten its sections or key points.',
    );
  });

  it('keeps the edit open when saving fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    saveDraftBrief.mockRejectedValue(new Error('boom'));
    await render({ status: 'ready', brief });
    await act(async () => button('Edit brief').click());
    await act(async () => button('Save brief').click());
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the brief. Try again.");
    expect(button('Save brief')).toBeDefined();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('rewrites a new page from the brief, once the person says so', async () => {
    const run = vi.fn();
    await render(
      { status: 'ready', brief },
      { method: 'create', sourceUrl: null, rewrite: { run, running: false, blocked: null } },
    );
    await act(async () => button('Rewrite from brief').click());
    expect(run).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      'The page you have now stays in History.',
    );
    await act(async () => button('Start the agent').click());
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('suggests changes to a live page from the brief, and waits for open suggestions', async () => {
    const run = vi.fn();
    await render(
      { status: 'ready', brief },
      { rewrite: { run, running: false, blocked: 'Accept or reject the open suggestions first.' } },
    );
    const suggest = button('Suggest changes from brief');
    expect(suggest.disabled).toBe(true);
    // Why, written under the button: not only on hover (v1.1 CE-031).
    expect(suggest.parentElement!.textContent).toContain(
      'Accept or reject the open suggestions first.',
    );

    await render({ status: 'ready', brief }, { rewrite: { run, running: false, blocked: null } });
    await act(async () => button('Suggest changes from brief').click());
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      'Passages AI answers quote stay as they are.',
    );
    await act(async () => button('Cancel').click());
    expect(run).not.toHaveBeenCalled();
  });

  it('offers no rewrite without an outline, or once the page is ready', async () => {
    const run = vi.fn();
    await render(
      { status: 'ready', brief: { ...brief, outline: [] } },
      { rewrite: { run, running: false, blocked: null } },
    );
    expect(button('Suggest changes from brief')).toBeUndefined();
    await render({ status: 'ready', brief });
    expect(button('Suggest changes from brief')).toBeUndefined();
  });

  it('offers to retry when the brief can’t be read', async () => {
    await render({ status: 'failed' });
    await act(async () => button('Retry').click());
    expect(onRetry).toHaveBeenCalled();
  });
});

/** A brief of version 2 (the brief rules, 2026), as the server writes it. */
const planned: DraftBrief = {
  ...brief,
  version: 2,
  tldr: 'Under $500, a single boiler with a PID wins.',
  angle: 'Our own shot-time tests on each machine.',
  proof: [
    { kind: 'test', what: 'Shot times on each machine' },
    { kind: 'data', what: 'Returns by model' },
  ],
  leftOut: ['home espresso grinder'],
  freshness: { datedPoint: 'Each price, with its month', updatedLine: true, yearInTitle: true },
  entities: { brand: 'Acme Coffee', products: ['Barista Pro'], competitors: ['Acme Rival'] },
  links: {
    internal: [
      {
        url: 'https://acme.example/guides/grinders',
        anchor: 'our grinder guide',
        section: 'Care and cleaning',
      },
    ],
    outbound: [{ url: 'https://sca.example/brew', anchor: 'brewing standards', section: null }],
  },
  outline: brief.outline.map((section, i) =>
    i === 0
      ? {
          ...section,
          answer: 'Name the best pick under $500 and why.',
          format: 'table' as const,
          facts: [
            {
              claim: 'Average price of a machine',
              sourceType: 'statistic' as const,
              source: {
                kind: 'cited_page' as const,
                ref: 'https://sca.example/brew',
                label: 'https://sca.example/brew',
              },
            },
            {
              claim: 'Share of buyers who pick a single boiler',
              sourceType: 'study' as const,
              source: null,
            },
          ],
        }
      : section,
  ),
};

const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('a brief of version 2 (the brief rules, 2026)', () => {
  it('shows the TL;DR, the angle and each section’s answer, format and facts', async () => {
    await render({ status: 'ready', brief: planned });
    expect(fields()).toMatchObject({
      'TL;DR': 'Under $500, a single boiler with a PID wins.',
      Angle: 'Our own shot-time tests on each machine.',
    });
    const first = container.querySelectorAll('ol > li')[0]!.textContent;
    expect(first).toContain('Table');
    expect(first).toContain('Answer first: Name the best pick under $500 and why.');
    expect(first).toContain('Statistic: Average price of a machine');
    expect(first).toContain('From https://sca.example/brew');
    expect(first).toContain('Study: Share of buyers who pick a single boiler');
    expect(first).toContain('Source to find');
  });

  it('lists the proof to gather: marked when Your input has it, else Add input opens it', async () => {
    const onAddInput = vi.fn();
    await render(
      { status: 'ready', brief: planned },
      { given: { experience: false, data: true, quote: false }, onAddInput },
    );
    const rows = [...container.querySelectorAll('section li')].filter((li) =>
      /Shot times|Returns by model/.test(li.textContent ?? ''),
    );
    // A test is the person's experience: not in Your input yet.
    expect(rows[0]!.textContent).toContain('Test');
    expect(rows[0]!.textContent).toContain('Add input');
    expect(rows[1]!.textContent).toContain('In Your input');
    // Each named by its proof, for a screen reader; the visible words in the name.
    await act(async () => button('Add input: Shot times on each machine').click());
    expect(onAddInput).toHaveBeenCalledTimes(1);
  });

  it('offers no Add input until Your input is read', async () => {
    await render({ status: 'ready', brief: planned }, { given: null, onAddInput: vi.fn() });
    expect(container.textContent).toContain('Proof to gather');
    expect(container.textContent).not.toContain('Add input');
  });

  it('folds the writing notes until opened: names, links, freshness, fan-outs left out', async () => {
    await render({ status: 'ready', brief: planned });
    const notes = button('Writing notes');
    const region = document.getElementById(notes.getAttribute('aria-controls')!)!;
    expect(notes.getAttribute('aria-expanded')).toBe('false');
    // In the page, hidden while folded, so aria-controls names it.
    expect(region.hidden).toBe(true);
    await act(async () => notes.click());
    expect(notes.getAttribute('aria-expanded')).toBe('true');
    expect(region.hidden).toBe(false);
    const text = region.textContent ?? '';
    expect(text).toContain('Brand: Acme Coffee');
    expect(text).toContain('Products: Barista Pro');
    expect(text).toContain('Competitors: Acme Rival');
    expect(text).toContain('our grinder guide');
    expect(text).toContain('in “Care and cleaning”');
    expect(text).toContain('Internal · our grinder guide → /guides/grinders');
    // An outbound link names its site.
    expect(text).toContain('Outbound · brewing standards → sca.example/brew · anywhere');
    expect(text).toContain('Date: Each price, with its month');
    expect(text).toContain('Show an “Updated” date');
    expect(text).toContain('Put the year in the title');
    expect(text).toContain('home espresso grinder');
  });

  it('shows none of it for a brief before version 2', async () => {
    await render({ status: 'ready', brief });
    expect(container.textContent).not.toContain('Proof to gather');
    expect(container.textContent).not.toContain('Writing notes');
    expect(fields()).not.toHaveProperty('TL;DR');
  });

  it('edits the TL;DR, the angle, each section’s answer and the proof to gather', async () => {
    saveDraftBrief.mockImplementation(async (_id, next: DraftBrief) => ({ ...next }));
    await render({ status: 'ready', brief: planned });
    await act(async () => button('Edit brief').click());
    const area = (label: string) =>
      container.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!;
    const labelled = (text: string) =>
      [...container.querySelectorAll('label')]
        .find((l) => l.textContent?.startsWith(text))!
        .querySelector('textarea')!;
    await act(async () => {
      setValue(labelled('TL;DR'), ' A PID machine wins under $500. ');
      setValue(labelled('Angle'), '');
      setValue(area('Section 1 answer first'), ' Name the pick. ');
      setValue(
        container.querySelector<HTMLInputElement>('input[aria-label="Proof 2"]')!,
        ' Returns by model, 2026 ',
      );
    });
    await act(async () => button('Remove proof 1').click());
    await act(async () => button('Add proof').click());
    await act(async () => button('Save brief').click());
    const saved = saveDraftBrief.mock.calls[0][1] as DraftBrief;
    expect(saved).toMatchObject({
      tldr: 'A PID machine wins under $500.',
      angle: null,
      // An empty proof added goes.
      proof: [{ kind: 'data', what: 'Returns by model, 2026' }],
      // The notes it doesn't edit stay.
      entities: planned.entities,
      links: planned.links,
      freshness: planned.freshness,
      leftOut: planned.leftOut,
    });
    expect(saved.outline[0]).toMatchObject({
      answer: 'Name the pick.',
      format: 'table',
      facts: planned.outline[0].facts,
    });
    expect(saved.outline[1].answer).toBeNull();
  });

  it('adds no version 2 fields to an older brief it edits', async () => {
    saveDraftBrief.mockImplementation(async (_id, next: DraftBrief) => ({ ...next }));
    await render({ status: 'ready', brief });
    await act(async () => button('Edit brief').click());
    expect(container.textContent).not.toContain('TL;DR');
    await act(async () => button('Save brief').click());
    const saved = saveDraftBrief.mock.calls[0][1] as DraftBrief;
    expect(saved).not.toHaveProperty('tldr');
    expect(saved.outline[0]).not.toHaveProperty('answer');
  });

  it('changes a proof’s kind, and offers no more than six', async () => {
    saveDraftBrief.mockImplementation(async (_id, next: DraftBrief) => ({ ...next }));
    await render({ status: 'ready', brief: planned });
    await act(async () => button('Edit brief').click());
    const click = async (el: Element | undefined) => {
      await act(async () => {
        el!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        (el as HTMLElement).click();
      });
    };
    await click(container.querySelector('[aria-label="Proof 2 kind"]')!);
    const quote = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === 'Quote',
    )!;
    // Base UI picks the highlighted option: the pointer moves onto it first.
    await act(async () => {
      quote.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await click(quote);
    for (let i = 0; i < 4; i++) await act(async () => button('Add proof').click());
    // Six: no more to add.
    expect(container.querySelectorAll('input[aria-label^="Proof "]')).toHaveLength(6);
    expect(
      [...container.querySelectorAll('button')].some((b) => b.textContent === 'Add proof'),
    ).toBe(false);
    await act(async () => button('Save brief').click());
    const saved = saveDraftBrief.mock.calls[0][1] as DraftBrief;
    expect(saved.proof).toEqual([
      { kind: 'test', what: 'Shot times on each machine' },
      { kind: 'quote', what: 'Returns by model' },
    ]);
  });
});
