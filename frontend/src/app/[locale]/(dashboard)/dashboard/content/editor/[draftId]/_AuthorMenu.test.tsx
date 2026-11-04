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

const { AuthorMenu, MANAGE_AUTHORS_PATH } = await import('./_AuthorMenu');

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

async function render(authorId: string | null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AuthorMenu
          brandId="b1"
          brandName="Acme"
          authors={AUTHORS}
          authorId={authorId}
          onPick={onPick}
        />
      </NextIntlClientProvider>,
    );
  });
}

const trigger = () => container.querySelector<HTMLElement>('button')!;
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];

async function click(el: Element | undefined) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

/** Who the page is by (CE-038), in the editor's header. */
describe('AuthorMenu', () => {
  it("names the page's author, or the brand's team", async () => {
    await render('a1');
    expect(trigger().textContent).toBe('By Ada Lovelace');
    await render(null);
    expect(trigger().textContent).toBe('By Acme Team');
  });

  it('offers the workspace authors, the default marked, then the team byline', async () => {
    await render('a2');
    await click(trigger());
    expect(items().map((i) => i.textContent)).toEqual([
      'Ada LovelaceHead of Content · Default for this brand',
      'Bob Stone',
      'Acme TeamOrganization byline',
    ]);
    expect(items()[1].getAttribute('aria-checked')).toBe('true');
    expect(document.body.textContent).toContain(
      "Real people only. Content Agent can't add, edit or invent authors.",
    );
    const manage = [...document.querySelectorAll('a')].find(
      (a) => a.textContent === 'Manage authors',
    );
    expect(manage?.getAttribute('href')).toBe(MANAGE_AUTHORS_PATH);
  });

  it('picks an author, or the team byline as none', async () => {
    await render('a2');
    await click(trigger());
    await click(items()[0]);
    expect(onPick).toHaveBeenLastCalledWith('a1');

    await click(trigger());
    await click(items()[2]);
    expect(onPick).toHaveBeenLastCalledWith(null);
  });
});
