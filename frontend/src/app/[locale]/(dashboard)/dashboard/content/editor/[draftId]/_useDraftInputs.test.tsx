import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { NO_INPUTS, type DraftInputs } from '@/lib/content/draftInputs';

const getDraftInputs = vi.hoisted(() => vi.fn());
const saveDraftInputs = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/contentDraftInputs', () => ({ getDraftInputs, saveDraftInputs }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { useDraftInputs } = await import('./_useDraftInputs');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Brief › Your input as the editor holds it (CE-048): read once, each change kept. */

const DRAFT = '2f1d1c52-0f7a-4c1e-9b8a-5d6e7f8a9b0c';
const KEPT: DraftInputs = { ...NO_INPUTS, experience: 'We tested it.' };
/** Each change adds a mark to the experience as it is when the change lands. */
const MARK = (current: DraftInputs) => ({ ...current, experience: `${current.experience}+` });

let container: HTMLDivElement;
let root: Root;

/** Shows what the hook holds; its button makes a change, or reads again after a failed read. */
function Probe({ on }: { on: boolean }) {
  const read = useDraftInputs(DRAFT, on);
  return (
    <button
      type="button"
      data-read={JSON.stringify(read.status === 'ready' ? read.inputs : read.status)}
      onClick={() => {
        if (read.status === 'ready') read.change(MARK);
        if (read.status === 'failed') read.retry();
      }}
    />
  );
}

async function render(on: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Probe on={on} />
      </NextIntlClientProvider>,
    );
  });
}
const held = () => JSON.parse(container.querySelector('button')!.getAttribute('data-read')!);
const click = () => act(async () => container.querySelector('button')!.click());

beforeEach(() => {
  getDraftInputs.mockReset().mockResolvedValue(KEPT);
  saveDraftInputs.mockReset().mockImplementation(async (_id, inputs) => inputs);
  toast.error.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.mocked(console.error).mockRestore();
});

describe('useDraftInputs', () => {
  it("isn't read before Quality's second phase", async () => {
    await render(false);
    expect(getDraftInputs).not.toHaveBeenCalled();
    expect(held()).toBe('off');
  });

  it('reads the input once, and makes each change to it as it is then', async () => {
    await render(true);
    expect(getDraftInputs).toHaveBeenCalledWith(DRAFT);
    expect(held()).toEqual(KEPT);

    await click();
    await click();
    expect(held()).toEqual({ ...KEPT, experience: 'We tested it.++' });
    expect(saveDraftInputs).toHaveBeenLastCalledWith(DRAFT, {
      ...KEPT,
      experience: 'We tested it.++',
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says when a change can't be kept, and reads the input as kept again", async () => {
    await render(true);
    saveDraftInputs.mockRejectedValueOnce(new Error('denied'));
    await click();
    expect(toast.error).toHaveBeenCalledWith("Couldn't save your input. Try again.");
    expect(getDraftInputs).toHaveBeenCalledTimes(2);
    expect(held()).toEqual(KEPT);
  });

  it('keeps a change made since over that read', async () => {
    await render(true);
    let answer: (read: DraftInputs) => void = () => {};
    getDraftInputs.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    saveDraftInputs.mockRejectedValueOnce(new Error('denied'));
    await click();
    await click();
    await act(async () => answer(KEPT));
    expect(held()).toEqual({ ...KEPT, experience: 'We tested it.++' });
  });

  it("says when it can't be read, and reads it again on Try again", async () => {
    getDraftInputs.mockRejectedValueOnce(new Error('offline'));
    await render(true);
    expect(held()).toBe('failed');
    await click();
    expect(getDraftInputs).toHaveBeenCalledTimes(2);
    expect(held()).toEqual(KEPT);
  });
});
