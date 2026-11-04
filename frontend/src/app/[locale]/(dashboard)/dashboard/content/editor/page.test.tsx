import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';

const getContentDraft = vi.fn();
vi.mock('@/lib/actions/contentDrafts', () => ({
  getContentDraft: (...args: unknown[]) => getContentDraft(...args),
}));
const replace = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ replace }) }));
const brandState = vi.hoisted(() => ({ activeBrandId: 'b1' as string | null }));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (selector: (state: typeof brandState) => unknown) => selector(brandState),
}));

const { default: ContentEditorStartPage } = await import('./page');
const { readLastDraft, writeLastDraft } = await import('@/lib/content/lastDraft');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Content › Editor: the draft last opened here, else a new page's start. */

// An in-memory localStorage: the test environment has none.
const store = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
};
Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage });

let container: HTMLDivElement;
let root: Root;

async function renderPage() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ContentEditorStartPage />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  brandState.activeBrandId = 'b1';
  getContentDraft.mockReset();
  replace.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  localStorage.clear();
});

describe('Content › Editor', () => {
  it('goes back to the brand’s draft last opened', async () => {
    writeLastDraft('b1', 'd1');
    getContentDraft.mockResolvedValue({ id: 'd1', brandId: 'b1', archivedAt: null });
    await renderPage();
    expect(getContentDraft).toHaveBeenCalledWith('d1');
    expect(replace).toHaveBeenCalledWith('/dashboard/content/editor/d1');
  });

  it('starts a new page when none was opened here', async () => {
    await renderPage();
    expect(getContentDraft).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/dashboard/content/library?new=1');
  });

  it('starts a new page, and forgets it, when the draft is gone', async () => {
    writeLastDraft('b1', 'd1');
    getContentDraft.mockResolvedValue(null);
    await renderPage();
    expect(replace).toHaveBeenCalledWith('/dashboard/content/library?new=1');
    expect(readLastDraft('b1')).toBeNull();
  });

  it('starts a new page for a draft archived since, or another brand’s', async () => {
    writeLastDraft('b1', 'd1');
    getContentDraft.mockResolvedValue({
      id: 'd1',
      brandId: 'b1',
      archivedAt: '2026-10-24T10:00:00Z',
    });
    await renderPage();
    expect(replace).toHaveBeenLastCalledWith('/dashboard/content/library?new=1');
    expect(readLastDraft('b1')).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    writeLastDraft('b1', 'd2');
    getContentDraft.mockResolvedValue({ id: 'd2', brandId: 'b2', archivedAt: null });
    await renderPage();
    expect(replace).toHaveBeenLastCalledWith('/dashboard/content/library?new=1');
    expect(readLastDraft('b1')).toBeNull();
  });

  it('opens the draft anyway when it can’t be read now (the editor tries again)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeLastDraft('b1', 'd1');
    getContentDraft.mockRejectedValue(new Error('offline'));
    await renderPage();
    expect(replace).toHaveBeenCalledWith('/dashboard/content/editor/d1');
    expect(readLastDraft('b1')).toBe('d1');
    error.mockRestore();
  });

  it('asks for a brand when none is selected', async () => {
    brandState.activeBrandId = null;
    await renderPage();
    expect(replace).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Select a brand to see its content.');
  });
});
