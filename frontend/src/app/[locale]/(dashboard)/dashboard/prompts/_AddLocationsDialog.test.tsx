import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { Prompt } from '@/types';

const actions = vi.hoisted(() => ({
  getLocationQuota: vi.fn(),
  bulkUpdatePromptLocations: vi.fn(),
}));
vi.mock('@/lib/actions/prompt', () => actions);
// The engines' countries (PROMPT-015e): none read, so the picker's own list.
vi.mock('@/lib/actions/trackingCountries', () => ({ getTrackingCountries: async () => [] }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AddLocationsDialog } = await import('./_AddLocationsDialog');
type AddLocationsPreset = import('./_AddLocationsDialog').AddLocationsPreset;

/** Track in more locations (PROMPT-015c). */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = '11111111-1111-1111-1111-111111111111';
let container: HTMLDivElement;
let root: Root;
const onDone = vi.fn();

const prompt = (id: string, regions: string[], category = 'Delivery'): Prompt =>
  ({ id, text: `prompt ${id}`, regions, category, isActive: true }) as unknown as Prompt;
const prompts = [prompt('p1', ['US']), prompt('p2', ['US']), prompt('p3', ['US'], 'Buying')];

async function render(
  preset: AddLocationsPreset | null,
  shown: Prompt[] = prompts,
  selectedIds: ReadonlySet<string> = new Set(),
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AddLocationsDialog
          open
          onOpenChange={() => {}}
          brandId={BRAND}
          prompts={shown}
          selectedIds={selectedIds}
          preset={preset}
          onDone={onDone}
        />
      </NextIntlClientProvider>,
    );
  });
  return document.body.textContent ?? '';
}

const submit = () =>
  [...document.body.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith('Track in'),
  ) as HTMLButtonElement;
const button = (text: string) =>
  [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement;
const stopSubmit = () =>
  [...document.body.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith('Stop tracking in'),
  ) as HTMLButtonElement;
const scope = (label: string) =>
  [...document.body.querySelectorAll('label')]
    .find((l) => l.textContent?.includes(label))!
    .querySelector('input') as HTMLInputElement;

beforeEach(() => {
  actions.getLocationQuota.mockReset().mockResolvedValue({
    maxPrompts: 200,
    used: 152,
    planId: 'growth',
    planName: 'Growth',
  });
  actions.bulkUpdatePromptLocations
    .mockReset()
    .mockResolvedValue({ updated: 1, unchanged: 0, blocked: 0, delta: 1 });
  toast.success.mockReset();
  onDone.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AddLocationsDialog', () => {
  it("opens on a cell's prompt and location, prices it, and tracks it there", async () => {
    const text = await render({ promptId: 'p2', locations: ['TR'] });
    expect(text).toContain('Track in more locations');
    expect(text).toContain('Türkiye');
    expect(text).toContain('152 → 153 of 200 tracked locations');
    expect(scope('prompt p2').checked).toBe(true);
    await act(async () => submit().click());
    expect(actions.bulkUpdatePromptLocations).toHaveBeenCalledWith(['p2'], 'add', ['TR']);
    expect(toast.success).toHaveBeenCalledWith(
      '1 prompt is now tracked in the new locations. The first results come with the next daily run, within 24 hours.',
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("adds to no prompt when the cell's prompt is no longer shown, rather than to all", async () => {
    const text = await render({ promptId: 'gone', locations: ['TR'] });
    expect(scope('All 3 prompts shown').checked).toBe(false);
    expect(text).toContain('152 → 152 of 200 tracked locations');
    expect(text).toContain('Choose the prompts to add these locations to.');
    expect(submit().disabled).toBe(true);
    await act(async () => scope('All 3 prompts shown').click());
    expect(document.body.textContent).toContain('152 → 155 of 200 tracked locations');
    expect(submit().disabled).toBe(false);
  });

  it('prices a topic and every prompt shown', async () => {
    await render({ locations: ['TR', 'DE'] });
    expect(scope('All 3 prompts shown').checked).toBe(true);
    expect(document.body.textContent).toContain('152 → 158 of 200 tracked locations');
    // The first topic, Buying, has one prompt; Delivery has two.
    await act(async () => scope('Topic').click());
    expect(document.body.textContent).toContain('152 → 154 of 200 tracked locations');
    const topic = document.body.querySelector('select[aria-label="Topic"]') as HTMLSelectElement;
    await act(async () => {
      topic.value = 'Delivery';
      topic.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.body.textContent).toContain('152 → 156 of 200 tracked locations');
  });

  it('stops a choice past the limit in place, with the numbers and the plan’s way out', async () => {
    actions.getLocationQuota.mockResolvedValue({
      maxPrompts: 200,
      used: 199,
      planId: 'growth',
      planName: 'Growth',
    });
    const text = await render({ locations: ['TR'] });
    expect(text).toContain('199 → 202 of 200 tracked locations');
    expect(text).toContain('This needs 3 more tracked locations; 1 is left on your Growth plan.');
    expect(text).toContain('Or contact us for a custom plan.');
    expect(submit().disabled).toBe(true);
    expect(document.body.querySelector('a[href*="billing"]')).toBeNull();
  });

  it('offers Starter an upgrade', async () => {
    actions.getLocationQuota.mockResolvedValue({
      maxPrompts: 50,
      used: 50,
      planId: 'starter',
      planName: 'Starter',
    });
    const text = await render({ locations: ['TR'] });
    expect(text).toContain('none are left on your Starter plan');
    expect(text).toContain('Or upgrade your plan, or contact us for a custom plan.');
    expect(document.body.querySelector('a[href="/dashboard/settings?tab=billing"]')).not.toBeNull();
  });

  it('turns a city off for prompts no engine of which answers from one (PROMPT-015d)', async () => {
    let text = await render({ locations: ['TR~ISTANBUL'] });
    expect(text).toContain('İstanbul');
    expect(text).toContain('None of these prompts runs an engine that answers from a city');
    expect(submit().disabled).toBe(true);
    // One prompt asks Google AI Mode: the city can be added, with a note for the rest.
    prompts[0] = { ...prompts[0], platforms: ['google-aimode'] } as Prompt;
    act(() => root.unmount());
    root = createRoot(container);
    text = await render({ locations: ['TR~ISTANBUL'] });
    expect(text).toContain("2 of these prompts don't run an engine that answers from a city");
    expect(submit().disabled).toBe(false);
    prompts[0] = prompt('p1', ['US']);
  });

  it("says what the server refused, and changes nothing it didn't save", async () => {
    actions.bulkUpdatePromptLocations.mockResolvedValue({
      error: 'Your Growth plan allows up to 200 active prompt locations',
      code: 'plan_limit',
    });
    await render({ promptId: 'p1', locations: ['TR'] });
    await act(async () => submit().click());
    expect(document.body.textContent).toContain('Your Growth plan allows up to 200');
    expect(onDone).not.toHaveBeenCalled();
  });

  describe('stopping locations', () => {
    // p1 only in the US; p2 in the US and Germany; p3 in Germany and Türkiye, paused.
    const tracked = [
      prompt('p1', ['US']),
      prompt('p2', ['US', 'DE']),
      { ...prompt('p3', ['DE', 'TR'], 'Buying'), isActive: false } as Prompt,
    ];

    const chips = () =>
      [...document.body.querySelectorAll('fieldset button')].map((b) =>
        b.textContent?.replace(/\s+/g, ' ').trim(),
      );

    it('offers the locations the prompts track, with how many track each', async () => {
      const text = await render({ mode: 'remove' }, tracked);
      expect(text).toContain('Stop tracking in locations');
      expect(button('Remove').getAttribute('aria-pressed')).toBe('true');
      expect(chips()).toEqual(['🇩🇪 Germany2', '🇺🇸 United States2', '🇹🇷 Türkiye1']);
      // A screen reader hears what the number counts.
      expect(
        [...document.body.querySelectorAll('fieldset button')].map((b) =>
          b.getAttribute('aria-label'),
        ),
      ).toEqual([
        'Germany, tracked by 2 prompts',
        'United States, tracked by 2 prompts',
        'Türkiye, tracked by 1 prompt',
      ]);
      expect(stopSubmit().disabled).toBe(true);
    });

    it('counts the prompts chosen, not every prompt shown, and keeps a pick', async () => {
      await render({ mode: 'remove', locations: ['US'] }, tracked);
      expect(chips()).toEqual(['🇩🇪 Germany2', '🇺🇸 United States2', '🇹🇷 Türkiye1']);
      // The Buying topic is p3 alone: Germany and Türkiye once each, and the
      // US, picked already, stays to be unpicked, tracked by none of them.
      await act(async () => scope('Topic').click());
      expect(chips()).toEqual(['🇩🇪 Germany1', '🇹🇷 Türkiye1', '🇺🇸 United States0']);
      expect(
        document.body
          .querySelector('fieldset button[aria-pressed="true"]')
          ?.getAttribute('aria-label'),
      ).toBe('United States, tracked by none of these prompts');
      expect(document.body.textContent).toContain(
        'None of these prompts is tracked in these locations.',
      );
    });

    it('prices a column stop: what goes, what the plan gets back, and who keeps it', async () => {
      const text = await render({ mode: 'remove', locations: ['US'] }, tracked);
      // p2 loses the US; p1 has no other location, so it keeps it.
      expect(text).toContain('Removes 1 tracked location from 1 prompt · frees 1 plan location');
      expect(text).toContain('152 → 151 of 200 tracked locations');
      expect(text).toContain(
        '1 prompt is tracked only in these locations, so it keeps them: a prompt needs at least one location.',
      );
      expect(text).toContain('Past results stay; tracking stops from the next run.');
      expect(stopSubmit().textContent).toBe('Stop tracking in 1 location');
      await act(async () => stopSubmit().click());
      expect(actions.bulkUpdatePromptLocations).toHaveBeenCalledWith(['p1', 'p2', 'p3'], 'remove', [
        'US',
      ]);
      expect(toast.success).toHaveBeenCalledWith(
        '1 prompt is no longer tracked there. Past results stay.',
      );
      expect(onDone).toHaveBeenCalled();
    });

    it("counts a paused prompt's locations as removed but frees none on the plan", async () => {
      const text = await render({ mode: 'remove', locations: ['DE'] }, tracked);
      expect(text).toContain('Removes 2 tracked locations from 2 prompts · frees 1 plan location');
    });

    it("won't take a prompt's last location", async () => {
      const text = await render({ mode: 'remove', promptId: 'p1', locations: ['US'] }, tracked);
      expect(scope('prompt p1').checked).toBe(true);
      expect(text).toContain('1 prompt is tracked only in these locations');
      expect(text).not.toContain('None of these prompts is tracked');
      expect(text).not.toContain('Past results stay');
      expect(stopSubmit().disabled).toBe(true);
    });

    it('stops it for one prompt from its cell', async () => {
      await render({ mode: 'remove', promptId: 'p2', locations: ['DE'] }, tracked);
      expect(document.body.textContent).toContain(
        'Removes 1 tracked location from 1 prompt · frees 1 plan location',
      );
      await act(async () => stopSubmit().click());
      expect(actions.bulkUpdatePromptLocations).toHaveBeenCalledWith(['p2'], 'remove', ['DE']);
    });

    it('starts on the selection, and says when it has none of the locations', async () => {
      const text = await render({ mode: 'remove', locations: ['TR'] }, tracked, new Set(['p1']));
      expect(scope('The 1 prompt selected').checked).toBe(true);
      expect(chips()).toEqual(['🇺🇸 United States1', '🇹🇷 Türkiye0']);
      expect(text).toContain('None of these prompts is tracked in these locations.');
      expect(stopSubmit().disabled).toBe(true);
    });

    it('says what the server refused, keeps the dialog, and lets it be tried again', async () => {
      actions.bulkUpdatePromptLocations.mockResolvedValue({
        error: 'None of the selected prompts are available.',
      });
      await render({ mode: 'remove', promptId: 'p2', locations: ['DE'] }, tracked);
      await act(async () => stopSubmit().click());
      expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
        'None of the selected prompts are available.',
      );
      expect(toast.success).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
      expect(stopSubmit().disabled).toBe(false);
      expect(stopSubmit().querySelector('.animate-spin')).toBeNull();
    });

    it('never runs the add checks: no limit stop, no city note', async () => {
      actions.getLocationQuota.mockResolvedValue({
        maxPrompts: 50,
        used: 60,
        planId: 'starter',
        planName: 'Starter',
      });
      const text = await render({ mode: 'remove', locations: ['DE'] }, tracked);
      expect(text).not.toContain('left on your Starter plan');
      expect(stopSubmit().disabled).toBe(false);
    });

    it('switches between adding and stopping, starting each from no location', async () => {
      await render({ locations: ['TR'] }, tracked);
      expect(document.body.textContent).toContain('Track in more locations');
      await act(async () => button('Remove').click());
      expect(document.body.textContent).toContain('Stop tracking in locations');
      expect(stopSubmit().textContent).toBe('Stop tracking in these locations');
      const germany = [...document.body.querySelectorAll('fieldset button')].find((b) =>
        b.textContent?.includes('Germany'),
      ) as HTMLButtonElement;
      await act(async () => germany.click());
      expect(germany.getAttribute('aria-pressed')).toBe('true');
      expect(stopSubmit().textContent).toBe('Stop tracking in 1 location');
      await act(async () => button('Add').click());
      expect(submit().textContent).toBe('Track in these locations');
    });
  });
});
