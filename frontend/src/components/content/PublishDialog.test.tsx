import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const publishPage = vi.hoisted(() => vi.fn());
const readPublishAddress = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/publishClient', () => ({ publishPage, readPublishAddress }));
// Published as before the publish route, on an API without it.
const setContentDraftStatus = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/contentDrafts', () => ({ setContentDraftStatus }));

const { PublishDialog } = await import('./PublishDialog');

/** Mark published (CE-013): the address the page is live at, where tracking starts. */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onPublished = vi.fn();

async function render(published = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <PublishDialog
          draftId="d1"
          published={published}
          onClose={onClose}
          onPublished={onPublished}
        />
      </NextIntlClientProvider>,
    );
  });
}
const dialog = () => document.querySelector('[role="dialog"]')!;
const input = () => dialog().querySelector<HTMLInputElement>('#publish-url')!;
const save = () =>
  [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === 'Mark published',
  )!;
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  onClose.mockReset();
  onPublished.mockReset();
  toast.success.mockReset();
  toast.warning.mockReset();
  setContentDraftStatus.mockReset().mockResolvedValue(undefined);
  readPublishAddress.mockReset().mockResolvedValue('https://acme.example/blog/cold-brew');
  publishPage.mockReset().mockResolvedValue({
    ok: true,
    publishedUrl: 'https://acme.example/blog/cold-brew',
    publishedAt: '2026-10-25T10:00:00Z',
    onBrandDomain: true,
    taskCompleted: true,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('PublishDialog', () => {
  it('starts from where the page is live, and marks it published there', async () => {
    await render();
    expect(readPublishAddress).toHaveBeenCalledWith('d1');
    expect(input().value).toBe('https://acme.example/blog/cold-brew');
    await type('  https://acme.example/blog/cold-brew-at-home ');
    await act(async () => save().click());
    expect(publishPage).toHaveBeenCalledWith('d1', 'https://acme.example/blog/cold-brew-at-home');
    expect(toast.success).toHaveBeenCalledWith(
      'Published. The Live page tab measures it from now on.',
    );
    expect(onPublished).toHaveBeenCalledWith('https://acme.example/blog/cold-brew');
    expect(onClose).toHaveBeenCalled();
  });

  it('says an address off the brand’s domains won’t show numbers', async () => {
    publishPage.mockResolvedValue({
      ok: true,
      publishedUrl: 'https://medium.com/@acme/x',
      publishedAt: '2026-10-25T10:00:00Z',
      onBrandDomain: false,
      taskCompleted: false,
    });
    await render();
    await act(async () => save().click());
    expect(toast.warning).toHaveBeenCalledWith(
      "Published. The address isn't on the brand's domains, so its numbers won't show.",
    );
  });

  it('asks for a full address, and stays open, when it isn’t one', async () => {
    publishPage.mockResolvedValue({ ok: false, code: 'invalid_url' });
    await render();
    await type('acme.example/x');
    await act(async () => save().click());
    expect(dialog().querySelector('#publish-url-hint')!.textContent).toBe(
      "Give the page's full address, starting with https:// or http://.",
    );
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(onClose).not.toHaveBeenCalled();
    await type('');
    expect(save().disabled).toBe(true);
  });

  it('marks the page published without its address on an API without the route, and says so', async () => {
    publishPage.mockResolvedValue({ ok: false, code: 'no_route' });
    await render();
    await act(async () => save().click());
    expect(setContentDraftStatus).toHaveBeenCalledWith('d1', 'published');
    expect(toast.warning).toHaveBeenCalledWith(
      "Published. The address couldn't be saved yet, so the Live page tab can't measure it.",
    );
    expect(onPublished).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalled();
  });

  it('can’t change a published page’s address on an API without the route, nor fall back', async () => {
    publishPage.mockResolvedValue({ ok: false, code: 'no_route' });
    await render(true);
    await act(async () => save().click());
    expect(setContentDraftStatus).not.toHaveBeenCalled();
    expect(dialog().querySelector('#publish-url-hint')!.textContent).toBe(
      "Couldn't mark the page published. Try again.",
    );
    expect(onClose).not.toHaveBeenCalled();

    // A page gone is the route's own answer.
    publishPage.mockResolvedValue({ ok: false, code: 'not_found' });
    await act(async () => save().click());
    expect(dialog().querySelector('#publish-url-hint')!.textContent).toBe(
      "This page isn't in the Library anymore.",
    );
  });

  it('waits for the starting address, and starts empty without one', async () => {
    readPublishAddress.mockReturnValue(new Promise(() => {}));
    await render();
    expect(input().disabled).toBe(true);
    act(() => root.unmount());
    root = createRoot(container);
    readPublishAddress.mockResolvedValue('');
    await render();
    expect(input().value).toBe('');
    expect(save().disabled).toBe(true);
  });
});
