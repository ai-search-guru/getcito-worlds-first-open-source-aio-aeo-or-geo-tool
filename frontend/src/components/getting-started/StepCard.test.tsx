import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GettingStartedStep } from '@/lib/getting-started/steps';
import type { FirstRun } from '@/hooks/useFirstRun';

/**
 * A Getting started step's card (AC-ALT2 §6): why, how (a video's place and
 * the steps), done when, and a button that opens the page in a new tab. An
 * optional step can be skipped after a last-chance question.
 */

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const { skipGettingStartedStep, toast, asked } = vi.hoisted(() => ({
  skipGettingStartedStep: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  // Every message key the card asked for.
  asked: new Set<string>(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () =>
    Object.assign(
      (key: string) => {
        asked.add(key);
        return key;
      },
      { raw: (key: string) => [`${key} 1`, `${key} 2`] },
    ),
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/actions/gettingStarted', () => ({ skipGettingStartedStep }));

const { GettingStartedStepCard } = await import('./StepCard');
const { UpgradeDialogContext } = await import('@/components/context/upgradeGate');

const step = (over: Partial<GettingStartedStep> = {}): GettingStartedStep => ({
  key: 'mentions',
  stage: 'explore',
  href: '/dashboard/mentions',
  state: 'new',
  progress: null,
  updatedAt: null,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onChanged = vi.fn();
const onReady = vi.fn();
const openUpgrade = vi.fn();

async function render(
  s: GettingStartedStep,
  {
    canManage = true,
    isLocked = false,
    firstRun = null,
  }: { canManage?: boolean; isLocked?: boolean; firstRun?: FirstRun | null } = {},
) {
  await act(async () =>
    root.render(
      <UpgradeDialogContext.Provider
        value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
      >
        <GettingStartedStepCard
          brandId="b1"
          step={s}
          members={[]}
          canManage={canManage}
          onClose={onClose}
          onChanged={onChanged}
          onReady={onReady}
          firstRun={firstRun}
        />
      </UpgradeDialogContext.Provider>,
    ),
  );
}

const text = () => document.body.textContent ?? '';
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label));

beforeEach(() => {
  asked.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  for (const fn of [onClose, onChanged, onReady, skipGettingStartedStep, toast.success]) {
    fn.mockReset();
  }
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('GettingStartedStepCard', () => {
  it('says why and how, without a video place yet, and when it counts as done', async () => {
    await render(step({ key: 'competitors', progress: { value: 2, target: 3 } }));
    expect(text()).toContain('steps.competitors.title');
    expect(text()).toContain('steps.competitors.why 1');
    expect(text()).toContain('steps.competitors.how 2');
    expect(text()).not.toContain('panel.videosSoon');
    expect(text()).toContain('panel.doneWhen · 2/3');
  });

  it("opens the step's page in a new tab and says to finish there", async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await render(step());
    await act(async () => button('steps.mentions.open')!.click());
    expect(open).toHaveBeenCalledWith('/dashboard/mentions', '_blank', 'noopener');
    expect(text()).toContain('panel.inNewTab');
    open.mockRestore();
  });

  it('has no button for a step that is done, or still waiting for its data', async () => {
    await render(step({ state: 'done' }));
    expect(text()).toContain('panel.doneAuto');
    expect(button('steps.mentions.open')).toBeUndefined();

    await render(step({ state: 'waiting' }));
    expect(text()).toContain('opensWhenReady');
    expect(button('steps.mentions.open')).toBeUndefined();
  });

  it('says how far the first run is for a step it brings the data for, in place of its page', async () => {
    const firstRun: FirstRun = {
      brandId: 'b1',
      queued: false,
      progress: { current: 18, total: 40 },
      left: { minutes: 6 },
    };
    await render(step({ state: 'waiting' }), { firstRun });
    expect(text()).toContain('arriving count · minutesLeft.');
    expect(text()).toContain('fillsIn');
    expect(text()).not.toContain('opensWhenReady');

    // An early answer opened the step: its page would still be nearly empty.
    await render(step({ state: 'new' }), { firstRun });
    expect(text()).toContain('fillsIn');
    expect(button('steps.mentions.open')).toBeUndefined();

    // Done, or a step that needs none of its data: as usual.
    await render(step({ state: 'done' }), { firstRun });
    expect(text()).toContain('panel.doneAuto');
    await render(step({ key: 'competitors', stage: 'setup' }), { firstRun });
    expect(text()).not.toContain('fillsIn');
    expect(button('steps.competitors.open')).toBeDefined();
  });

  it('skips an optional step only after the last-chance question', async () => {
    skipGettingStartedStep.mockResolvedValue(undefined);
    await render(step({ key: 'gsc', stage: 'setup', optional: true }));
    expect(text()).toContain('panel.optionalRecommended');

    await act(async () => button('panel.skip')!.click());
    expect(skipGettingStartedStep).not.toHaveBeenCalled();
    expect(text()).toContain('skipDialog.lessAccurate');

    await act(async () => button('skipDialog.skip')!.click());
    expect(skipGettingStartedStep).toHaveBeenCalledWith('b1', 'gsc');
    expect(toast.success).toHaveBeenCalledWith('skipDialog.skipped');
    expect(onChanged).toHaveBeenCalled();
  });

  it('skips nothing on a read-only workspace: Skip opens the upgrade dialog, not the question', async () => {
    openUpgrade.mockReset();
    await render(step({ key: 'gsc', stage: 'setup', optional: true }), { isLocked: true });
    await act(async () => button('panel.skip')!.click());
    // next-intl is mocked: the label is its key.
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('skipSteps');
    expect(text()).not.toContain('skipDialog.lessAccurate');
    expect(skipGettingStartedStep).not.toHaveBeenCalled();
  });

  it('offers no Skip on a required step or one already skipped', async () => {
    await render(step());
    expect(button('panel.skip')).toBeUndefined();
    await render(step({ key: 'ga', stage: 'setup', optional: true, state: 'skipped' }));
    expect(button('panel.skip')).toBeUndefined();
    expect(text()).toContain('panel.skippedNote');
  });

  it('leads on to the actions from the last step', async () => {
    await render(step({ key: 'ready', stage: 'ready', state: 'done' }));
    await act(async () => button('steps.ready.open')!.click());
    expect(onReady).toHaveBeenCalled();
  });

  it('asks for a name only on the steps that have one (the optional ones)', async () => {
    await render(step());
    expect(asked.has('steps.mentions.name')).toBe(false);
    await render(step({ key: 'gsc', stage: 'setup', optional: true }));
    expect(asked.has('steps.gsc.name')).toBe(true);
  });

  // gkhngyk on #1234/#1236: only admins and managers skip a step.
  it('offers no Skip to someone who can’t set the steps up', async () => {
    await render(step({ key: 'gsc', stage: 'setup', optional: true }), { canManage: false });
    expect(button('panel.skip')).toBeUndefined();
    expect(button('steps.gsc.open')).toBeDefined();
  });

  it('leaves Escape to a dialog open over the page', async () => {
    await render(step());
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).not.toHaveBeenCalled();
    dialog.remove();
  });

  it('closes on Escape', async () => {
    await render(step());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
