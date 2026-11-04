import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { PromptLocationCell } from '@/lib/promptLocationMatrix';
import type { Prompt } from '@/types';
import type { FirstRun } from '@/hooks/useFirstRun';

const getPromptLocationMatrix = vi.hoisted(() => vi.fn());
const getLocationQuota = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/prompt', () => ({ getPromptLocationMatrix, getLocationQuota }));
const getTrackingCountries = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/trackingCountries', () => ({ getTrackingCountries }));
// The brand's first run: null unless a test says it goes on.
const firstRun = vi.hoisted(() => ({ run: null as FirstRun | null }));
vi.mock('@/hooks/useFirstRun', () => ({ useFirstRun: () => firstRun.run }));

const { clearTrackingCountries } = await import('@/lib/useTrackingCountries');
const { LocationMatrix, LocationPending, clearLocationMatrixCache, loadLocationMatrix } =
  await import('./_LocationMatrix');

/** Tracked Prompts' Locations view (PROMPT-015b). */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = '11111111-1111-1111-1111-111111111111';
let container: HTMLDivElement;
let root: Root;

const prompt = (
  id: string,
  text: string,
  regions: string[],
  category = 'Coffee',
  over: Partial<Prompt> = {},
): Prompt =>
  ({
    id,
    text,
    regions,
    category,
    isActive: true,
    platforms: ['chatgpt-web'],
    models: [],
    ...over,
  }) as unknown as Prompt;
const cell = (score: number, position: number | null = 3.2): PromptLocationCell => ({
  score,
  mentions: Math.round(score / 2),
  citations: 2,
  position,
  runs: 6,
});

const rows = [
  prompt('p1', 'best specialty coffee subscription', ['US', 'TR']),
  prompt('p2', 'same day coffee delivery near me', ['US']),
];
const onOpenCell = vi.fn();
const onTrack = vi.fn();
const onStopTracking = vi.fn();

async function render(canTrack = true) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <LocationMatrix
          brandId={BRAND}
          rows={rows}
          pageRows={rows}
          window={{ from: '2026-10-21T00:00:00Z' }}
          onOpenCell={onOpenCell}
          onTrack={canTrack ? onTrack : undefined}
          onStopTracking={canTrack ? onStopTracking : undefined}
        />
      </NextIntlClientProvider>,
    );
  });
  return container.textContent ?? '';
}

/** Each row's cells as they show: without the text only screen readers get. */
const bodyRows = () =>
  [...container.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => {
      const shown = td.cloneNode(true) as HTMLElement;
      shown.querySelectorAll('.sr-only').forEach((el) => el.remove());
      return shown.textContent;
    }),
  );

beforeEach(() => {
  clearLocationMatrixCache();
  clearTrackingCountries();
  getLocationQuota.mockReset().mockResolvedValue({
    maxPrompts: 200,
    used: 152,
    planId: 'growth',
    planName: 'Growth',
  });
  getTrackingCountries.mockReset().mockResolvedValue([]);
  getPromptLocationMatrix.mockReset().mockResolvedValue({
    p1: { US: cell(62), TR: cell(35, null) },
    p2: { US: cell(20, 6.4) },
  });
  onOpenCell.mockReset();
  onTrack.mockReset();
  onStopTracking.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('LocationMatrix', () => {
  it('reads each tracked location, the most tracked first, and shows each prompt there', async () => {
    const text = await render();
    expect(getPromptLocationMatrix).toHaveBeenCalledWith(BRAND, {
      from: '2026-10-21T00:00:00Z',
      to: undefined,
      regions: ['US', 'TR'],
    });
    expect(text).toContain('United States');
    expect(text).toContain('Türkiye');
    expect(bodyRows()).toEqual([
      ['All prompts · average', '—', '41', '35', '—'],
      ['best specialty coffee subscription', 'Coffee', '62', '35', '27'],
      ['same day coffee delivery near me', 'Coffee', '20', '+ Track', '—'],
    ]);
    expect(text).toContain('Weakest location');
    expect(text).toContain('Biggest gap between locations');
  });

  it('marks a city column with the engines that answer from it (PROMPT-015d)', async () => {
    rows[0] = prompt('p1', 'best specialty coffee subscription', ['US', 'TR', 'TR~ISTANBUL']);
    getPromptLocationMatrix.mockResolvedValue({
      p1: { US: cell(62), TR: cell(35), 'TR~ISTANBUL': cell(41) },
    });
    const text = await render();
    expect(text).toContain('İstanbul');
    expect(text).toContain('City');
    expect(text).toContain('AI Mode · AIO · APIs');
    rows[0] = prompt('p1', 'best specialty coffee subscription', ['US', 'TR']);
  });

  it('switches the metric, and reads a prompt never named there as such', async () => {
    await render();
    const position = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Position',
    )!;
    await act(async () => position.click());
    expect(position.getAttribute('aria-pressed')).toBe('true');
    expect(bodyRows()[1]).toEqual([
      'best specialty coffee subscription',
      'Coffee',
      '#3.2',
      'Not named',
      '—',
    ]);
  });

  it("opens a cell's positions for its location, and tracks a prompt where it isn't", async () => {
    await render();
    (
      container.querySelector(
        'button[aria-label="best specialty coffee subscription in Türkiye: open its positions"]',
      ) as HTMLButtonElement
    ).click();
    expect(onOpenCell).toHaveBeenCalledWith('p1', 'TR');
    (
      container.querySelector(
        'button[aria-label="Track “same day coffee delivery near me” in Türkiye"]',
      ) as HTMLButtonElement
    ).click();
    expect(onTrack).toHaveBeenCalledWith(rows[1], 'TR');
  });

  it('stops a location for the prompts shown from its column, and for one prompt from its cell', async () => {
    await render();
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for Türkiye"]',
    )!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.click();
    });
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((i) => i.textContent)).toEqual(['Stop tracking in Türkiye']);
    await act(async () => items[0].click());
    expect(onStopTracking).toHaveBeenCalledWith(null, 'TR');

    // Each tracked cell has its own, the counterpart of + Track, and it opens
    // no Positions panel: the cell's own button is beside it, not under it.
    const stop = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Stop tracking “best specialty coffee subscription” in United States"]',
    )!;
    expect(stop.title).toBe('Stop tracking here');
    // Clickable only while it shows: a touch screen, with no hover, can't hit it unseen.
    expect(stop.className).toContain('pointer-events-none');
    expect(stop.className).toContain('group-hover/cell:pointer-events-auto');
    expect(stop.className).toContain('focus-visible:pointer-events-auto');
    await act(async () => stop.click());
    expect(onStopTracking).toHaveBeenLastCalledWith(rows[0], 'US');
    expect(onOpenCell).not.toHaveBeenCalled();
    // An untracked cell has none, and neither has a prompt's last location.
    expect(
      container.querySelector(
        'button[aria-label="Stop tracking “same day coffee delivery near me” in Türkiye"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        'button[aria-label="Stop tracking “same day coffee delivery near me” in United States"]',
      ),
    ).toBeNull();
    expect(container.querySelectorAll('button[aria-label^="Stop tracking “"]')).toHaveLength(2);
  });

  it("offers no + Track to a member who can't edit, and says when nothing is tracked in a location", async () => {
    await render(false);
    expect(container.textContent).not.toContain('+ Track');
    expect(container.querySelector('button[aria-label^="Stop tracking"]')).toBeNull();
    expect(container.querySelector('button[aria-label^="Actions for"]')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <LocationMatrix
            brandId={BRAND}
            rows={[prompt('p3', 'untargeted', [])]}
            pageRows={[prompt('p3', 'untargeted', [])]}
            window={{ from: '2026-10-21T00:00:00Z' }}
            onOpenCell={onOpenCell}
          />
        </NextIntlClientProvider>,
      );
    });
    expect(container.textContent).toContain("Your prompts aren't tracked in a location yet.");
  });
});

describe('a location with no answers yet', () => {
  async function renderRows(
    list: Prompt[],
    window: { from: string; to?: string } = { from: '2026-10-21T00:00:00Z' },
  ) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <LocationMatrix
            brandId={BRAND}
            rows={list}
            pageRows={list}
            window={window}
            onOpenCell={onOpenCell}
            onTrack={onTrack}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  it('says the next daily run asks it, within 24 hours', async () => {
    getPromptLocationMatrix.mockResolvedValue({ p1: { US: cell(62) } });
    await renderRows([prompt('p1', 'best specialty coffee subscription', ['US', 'TR'])]);
    expect(bodyRows()[1]).toEqual([
      'best specialty coffee subscription',
      'Coffee',
      // Locations sort by name: Türkiye (TR) before the US.
      'Within 24h',
      '62',
      '—',
    ]);
    // The reason reaches the keyboard and screen readers, not only the mouse.
    const pending = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Within 24h',
    )!;
    expect(document.getElementById(pending.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Tracked in Türkiye from the next daily run: its first results come within 24 hours.',
    );
  });

  it('waits only for a new prompt; an older one answered nowhere just had no run: a dash', async () => {
    getPromptLocationMatrix.mockResolvedValue({});
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await renderRows([
      prompt('p1', 'older prompt', ['US', 'TR'], 'Coffee', { createdAt: '2026-09-01T00:00:00Z' }),
      prompt('p2', 'new prompt', ['US', 'TR'], 'Coffee', { createdAt: hourAgo }),
    ]);
    const rows = bodyRows();
    expect(rows[1].slice(2)).toEqual(['—', '—', '—']);
    expect(container.querySelector('span[title="No answers here in this period"]')).not.toBeNull();
    expect(rows[2].slice(2)).toEqual(['Within 24h', 'Within 24h', '—']);
  });

  it('shows a plain dash for a custom range that ended before today', async () => {
    getPromptLocationMatrix.mockResolvedValue({ p1: { US: cell(62) } });
    await renderRows([prompt('p1', 'best specialty coffee subscription', ['US', 'TR'])], {
      from: '2026-09-01T00:00:00Z',
      to: '2026-09-07T23:59:59Z',
    });
    expect(bodyRows()[1][2]).toBe('—');
    expect(container.querySelector('span[title="No answers here in this period"]')).not.toBeNull();
  });

  it('says when the prompt is paused, or none of its engines answers from there (PROMPT-015e)', async () => {
    getTrackingCountries.mockResolvedValue([
      { code: 'US', models: ['chatgpt', 'copilot'] },
      { code: 'KE', models: ['chatgpt'] },
    ]);
    getPromptLocationMatrix.mockResolvedValue({ p1: { US: cell(62) }, p2: { US: cell(40) } });
    await renderRows([
      prompt('p1', 'paused prompt', ['US', 'KE'], 'Coffee', { isActive: false }),
      prompt('p2', 'copilot only', ['US', 'KE'], 'Coffee', { platforms: ['copilot-web'] }),
    ]);
    const rows = bodyRows();
    // KE comes before US.
    expect(rows[1][2]).toBe('Paused');
    expect(rows[2][2]).toBe('No engine here');
    const noEngine = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'No engine here',
    )!;
    expect(document.getElementById(noEngine.getAttribute('aria-describedby')!)?.textContent).toBe(
      "None of this prompt's engines answers from Kenya, so nothing is asked there. Add an engine that does, or remove the location.",
    );
  });

  it("waits for Google's engines in a US state: they ask from the state now", async () => {
    getTrackingCountries.mockResolvedValue([{ code: 'US', models: ['aimode', 'aioverview'] }]);
    getPromptLocationMatrix.mockResolvedValue({ p1: { US: cell(62) } });
    await renderRows([
      prompt('p1', 'google only', ['US', 'US-CA'], 'Coffee', { platforms: ['google-aio'] }),
    ]);
    // US, then US-CA: answers elsewhere in the window, so the state's come with the next run.
    expect(bodyRows()[1].slice(2, 4)).toEqual(['62', 'Within 24h']);
  });

  it('shows Limit reached instead of + Track once the plan’s locations are used up', async () => {
    getLocationQuota.mockResolvedValue({
      maxPrompts: 200,
      used: 200,
      planId: 'growth',
      planName: 'Growth',
    });
    await render();
    expect(container.textContent).not.toContain('+ Track');
    const limit = container.querySelector(
      'button[aria-label="Limit reached: “same day coffee delivery near me” in Türkiye. Your plan\'s prompt locations are used up (200 of 200); open to see how to track here."]',
    ) as HTMLButtonElement;
    expect(limit.textContent).toBe('Limit reached');
    expect(limit.title).toBe(
      "Your plan's prompt locations are used up (200 of 200). Open to see how to track here.",
    );
    limit.click();
    expect(onTrack).toHaveBeenCalledWith(rows[1], 'TR');
  });
});

describe('a prompt with no answers yet, in the Table view', () => {
  async function renderPending(
    p: Prompt,
    region?: string,
    window: { to?: string } = {},
    awaiting = true,
  ): Promise<{ shown: string; tip: string | null }> {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <LocationPending prompt={p} region={region} window={window} awaiting={awaiting} />
        </NextIntlClientProvider>,
      );
    });
    const label = container.querySelector('button');
    const described = label?.getAttribute('aria-describedby');
    const shown = container.cloneNode(true) as HTMLElement;
    shown.querySelectorAll('.sr-only').forEach((el) => el.remove());
    return {
      shown: shown.textContent ?? '',
      tip: described ? (document.getElementById(described)?.textContent ?? null) : null,
    };
  }

  it('says its first results come with the next daily run, for the keyboard and screen readers too', async () => {
    const { shown, tip } = await renderPending(prompt('p1', 'new prompt', ['US']));
    expect(shown).toBe('Within 24h');
    expect(tip).toBe("This prompt's first results come with the next daily run, within 24 hours.");
  });

  it("says it's arriving while the brand's first run asks it, and Within 24h again after", async () => {
    firstRun.run = { brandId: 'b1', queued: false, progress: null, left: null };
    try {
      const during = await renderPending(prompt('p1', 'new prompt', ['US']), 'US');
      expect(during.shown).toBe('Arriving now');
      expect(during.tip).toBe(
        'Your first tracking is asking this now. Its results come in as it goes, and all of them when it finishes.',
      );
      // Paused stays paused.
      const paused = await renderPending(
        prompt('p1', 'paused prompt', ['US'], 'Coffee', { isActive: false }),
      );
      expect(paused.shown).toBe('Paused');
    } finally {
      firstRun.run = null;
    }
    expect((await renderPending(prompt('p1', 'new prompt', ['US']))).shown).toBe('Within 24h');
  });

  it('says when the prompt is paused', async () => {
    const { shown, tip } = await renderPending(
      prompt('p1', 'paused prompt', ['US'], 'Coffee', { isActive: false }),
    );
    expect(shown).toBe('Paused');
    expect(tip).toBe("This prompt is paused, so it isn't asked anywhere until you resume it.");
  });

  it("shows the plain dash for an older prompt with no answers in the range: it isn't waiting", async () => {
    const { shown, tip } = await renderPending(
      prompt('p1', 'older prompt', ['US']),
      undefined,
      {},
      false,
    );
    expect(shown).toBe('—');
    expect(tip).toBeNull();
    // With a location picked, the dash says there were no answers there.
    await renderPending(prompt('p1', 'older prompt', ['US']), 'US', {}, false);
    expect(container.querySelector('span[title="No answers here in this period"]')).not.toBeNull();
  });

  it('says Paused, or No engine here, whatever its age', async () => {
    // Copilot answers from Türkiye, not Kenya.
    getTrackingCountries.mockResolvedValue([
      { code: 'TR', models: ['chatgpt', 'copilot'] },
      { code: 'KE', models: ['chatgpt'] },
    ]);
    const paused = prompt('p1', 'paused prompt', ['US'], 'Coffee', { isActive: false });
    expect((await renderPending(paused, undefined, {}, false)).shown).toBe('Paused');
    const copilot = prompt('p2', 'copilot only', ['KE'], 'Coffee', { platforms: ['copilot-web'] });
    expect((await renderPending(copilot, 'KE', {}, false)).shown).toBe('No engine here');
  });

  it('shows the plain dash for a custom range that ended before today', async () => {
    const { shown, tip } = await renderPending(prompt('p1', 'new prompt', ['US']), undefined, {
      to: '2026-09-07T23:59:59Z',
    });
    expect(shown).toBe('—');
    expect(tip).toBeNull();
    expect(container.querySelector('span[title]')).toBeNull();
  });

  it('with a location picked, says it for that location', async () => {
    getTrackingCountries.mockResolvedValue([
      { code: 'TR', models: ['chatgpt', 'copilot'] },
      { code: 'KE', models: ['chatgpt'] },
    ]);
    expect(await renderPending(prompt('p1', 'new prompt', ['US', 'TR']), 'TR')).toEqual({
      shown: 'Within 24h',
      tip: 'Tracked in Türkiye from the next daily run: its first results come within 24 hours.',
    });
    // None of its engines answers from there: no answers will come.
    const copilot = prompt('p2', 'copilot only', ['KE'], 'Coffee', { platforms: ['copilot-web'] });
    expect((await renderPending(copilot, 'KE')).shown).toBe('No engine here');
  });
});

describe('loadLocationMatrix', () => {
  it('reads a location once a minute, and again after the cache is cleared', async () => {
    const window = { from: '2026-10-21T00:00:00Z' };
    await loadLocationMatrix(BRAND, window, ['US', 'TR']);
    expect(await loadLocationMatrix(BRAND, window, ['US'])).toEqual({
      p1: { US: cell(62) },
      p2: { US: cell(20, 6.4) },
    });
    expect(getPromptLocationMatrix).toHaveBeenCalledTimes(1);
    clearLocationMatrixCache();
    await loadLocationMatrix(BRAND, window, ['US', 'TR']);
    expect(getPromptLocationMatrix).toHaveBeenCalledTimes(2);
  });

  it('reads only a location not read yet, as a new location column needs', async () => {
    const window = { from: '2026-10-21T00:00:00Z' };
    await loadLocationMatrix(BRAND, window, ['US']);
    getPromptLocationMatrix.mockResolvedValueOnce({ p1: { DE: cell(50) } });
    expect(await loadLocationMatrix(BRAND, window, ['US', 'DE'])).toEqual({
      p1: { US: cell(62), DE: cell(50) },
      p2: { US: cell(20, 6.4) },
    });
    expect(getPromptLocationMatrix).toHaveBeenLastCalledWith(BRAND, {
      from: '2026-10-21T00:00:00Z',
      to: undefined,
      regions: ['DE'],
    });
    expect(getPromptLocationMatrix).toHaveBeenCalledTimes(2);
  });

  it('runs one read at a time, so a read-ahead never adds to one running', async () => {
    const window = { from: '2026-10-21T00:00:00Z' };
    let finish = () => {};
    getPromptLocationMatrix.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve({ p1: { US: cell(62) } }))),
    );
    const first = loadLocationMatrix(BRAND, window, ['US']);
    const second = loadLocationMatrix(BRAND, window, ['US', 'TR']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getPromptLocationMatrix).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
    expect(getPromptLocationMatrix).toHaveBeenCalledTimes(2);
    expect(getPromptLocationMatrix.mock.calls[1][1].regions).toEqual(['TR']);
  });

  it('reads again after a failed read', async () => {
    getPromptLocationMatrix.mockRejectedValueOnce(new Error('down'));
    const window = { from: '2026-10-21T00:00:00Z' };
    await expect(loadLocationMatrix(BRAND, window, ['US'])).rejects.toThrow('down');
    await loadLocationMatrix(BRAND, window, ['US']);
    expect(getPromptLocationMatrix).toHaveBeenCalledTimes(2);
  });
});
