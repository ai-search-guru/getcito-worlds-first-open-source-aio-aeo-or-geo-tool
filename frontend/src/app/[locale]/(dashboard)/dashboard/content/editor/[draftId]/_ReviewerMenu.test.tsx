import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ContentAuthor } from '@/lib/content/authors';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string } & Record<string, unknown>) => (
    <a href={href} {...props} />
  ),
}));

const { ReviewerMenu } = await import('./_ReviewerMenu');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const author = (over: Partial<ContentAuthor>): ContentAuthor => ({
  id: 'a1',
  name: 'Ada Lovelace',
  title: 'Head of Content',
  bio: null,
  photoUrl: null,
  sameAs: [],
  userId: null,
  createdBy: null,
  defaultFor: [],
  pages: 0,
  ...over,
});
const AUTHORS = [
  author({ defaultFor: ['b1'] }),
  author({ id: 'a2', name: 'Bob Stone', title: null }),
];

let container: HTMLDivElement;
let root: Root;
const onPick = vi.fn();

beforeEach(() => {
  onPick.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function render(reviewerId: string | null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ReviewerMenu authors={AUTHORS} reviewerId={reviewerId} onPick={onPick} />
      </NextIntlClientProvider>,
    );
  });
}

const trigger = () => container.querySelector<HTMLElement>('button')!;
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
const click = (el: Element | undefined) => act(async () => void (el as HTMLElement).click());

/** Who reviewed a page that advises on health, money or the law (CE-049). */
describe('ReviewerMenu', () => {
  it('asks for a reviewer, then names them; their title is the credential', async () => {
    await render(null);
    expect(trigger().textContent).toBe('Add reviewer');
    await click(trigger());
    expect(items().map((i) => i.textContent)).toEqual([
      'Ada LovelaceHead of Content',
      'Bob Stone',
      'No reviewer',
    ]);
    expect(document.body.textContent).toContain(
      'Qualified people only, from your authors: their title is the credential.',
    );
    await click(items()[0]);
    expect(onPick).toHaveBeenLastCalledWith('a1');

    await render('a1');
    expect(trigger().textContent).toBe('Reviewed by Ada Lovelace');
    await click(trigger());
    await click(items()[2]);
    expect(onPick).toHaveBeenLastCalledWith(null);
  });
});
