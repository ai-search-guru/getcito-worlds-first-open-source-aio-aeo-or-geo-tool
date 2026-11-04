import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { AuthorsRead } from '@/lib/content/authors';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * Settings › Authors (CE-037): the workspace's real authors; whoever added
 * one, the author themself or an admin edits it; admins and managers pick
 * each brand's default, or the "{Brand} Team" byline.
 */

const actions = vi.hoisted(() => ({
  getContentAuthors: vi.fn(),
  saveContentAuthor: vi.fn(),
  deleteContentAuthor: vi.fn(),
  setDefaultAuthor: vi.fn(),
  setBrandByline: vi.fn(),
}));
vi.mock('@/lib/actions/contentAuthors', () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { AuthorsSection } = await import('./AuthorsSection');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ACME = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function workspace(role: string): AuthorsRead {
  return {
    authors: [
      {
        id: ADA,
        name: 'Ada Lovelace',
        title: 'Head of Content',
        bio: null,
        photoUrl: null,
        sameAs: ['https://www.linkedin.com/in/ada'],
        userId: ME,
        createdBy: OTHER,
        defaultFor: [ACME],
        pages: 3,
      },
      {
        id: BOB,
        name: 'Bob Stone',
        title: null,
        bio: null,
        photoUrl: null,
        sameAs: [],
        userId: OTHER,
        createdBy: OTHER,
        defaultFor: [],
        pages: 0,
      },
      {
        id: CAL,
        name: 'Cal Freelance',
        title: null,
        bio: null,
        photoUrl: null,
        sameAs: [],
        userId: null,
        createdBy: ME,
        defaultFor: [],
        pages: 0,
      },
    ],
    brands: [{ id: ACME, name: 'Acme' }],
    me: { id: ME, role },
  };
}

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  for (const fn of [...Object.values(actions), toast.success, toast.error]) fn.mockReset();
  actions.getContentAuthors.mockResolvedValue(workspace('analyst'));
  actions.saveContentAuthor.mockResolvedValue({ id: BOB });
  actions.deleteContentAuthor.mockResolvedValue(undefined);
  actions.setDefaultAuthor.mockResolvedValue(undefined);
  actions.setBrandByline.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function render(isLocked = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <AuthorsSection />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const buttons = (name: string) =>
  [...document.body.querySelectorAll('button')].filter((b) => b.textContent === name);
const row = (name: string) =>
  [...container.querySelectorAll('li')].find((li) => li.textContent?.includes(name))!;
const trigger = () => container.querySelector<HTMLElement>(`[aria-labelledby="default-${ACME}"]`)!;
const byline = () =>
  [...container.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((c) =>
    c.closest('label')?.textContent?.includes('Add byline to content'),
  )!;
const isMe = () =>
  [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((c) =>
    c.closest('label')?.textContent?.includes('This author is me'),
  )!;

async function click(el: Element | undefined) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(input) as object;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('AuthorsSection', () => {
  it('lists the authors with their profiles and brand defaults, and the real-people note', async () => {
    await render();
    expect(container.textContent).toContain(
      "Real people only. Content Agent can't add, edit or invent authors.",
    );
    expect(row('Ada Lovelace').textContent).toContain('(you)');
    expect(row('Ada Lovelace').textContent).toContain(
      '1 profile link · 3 pages · Default for Acme',
    );
    expect(row('Bob Stone').textContent).toContain('No profile links · no pages yet');
    expect(trigger().querySelector('[data-slot="select-value"]')!.textContent).toBe('Ada Lovelace');
    expect(actions.getContentAuthors).toHaveBeenCalledWith({ pages: true });
  });

  it('lets a member edit the author they are and the ones they added, not the defaults', async () => {
    await render();
    expect(row('Ada Lovelace').querySelectorAll('button')).toHaveLength(2);
    expect(row('Cal Freelance').querySelectorAll('button')).toHaveLength(2);
    expect(row('Bob Stone').querySelectorAll('button')).toHaveLength(0);
    expect(trigger().hasAttribute('data-disabled')).toBe(true);
    expect(container.textContent).toContain('Admins and managers set the defaults.');
  });

  it("lets a manager pick a brand's default author, or its team byline", async () => {
    actions.getContentAuthors.mockResolvedValue(workspace('manager'));
    await render();
    expect(trigger().hasAttribute('data-disabled')).toBe(false);

    await click(trigger());
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((o) => o.textContent)).toEqual([
      'Acme Team',
      'Ada Lovelace',
      'Bob Stone',
      'Cal Freelance',
    ]);
    // Base UI picks the highlighted option: the pointer moves onto it first.
    const team = options.find((o) => o.textContent === 'Acme Team')!;
    await act(async () => {
      team.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await click(team);
    expect(actions.setDefaultAuthor).toHaveBeenCalledWith(ACME, null);
  });

  it("lets a manager add the byline to a brand's content, off by default (CE-057)", async () => {
    await render();
    expect(byline().getAttribute('aria-checked')).toBe('false');
    expect(byline().hasAttribute('data-disabled')).toBe(true);
    expect(container.textContent).toContain('only for a CMS with no author field');

    actions.getContentAuthors.mockResolvedValue(workspace('manager'));
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    await click(byline());
    expect(actions.setBrandByline).toHaveBeenCalledWith(ACME, true);
    expect(actions.getContentAuthors).toHaveBeenCalledTimes(3);

    expect(byline().getAttribute('aria-describedby')).toBe(`default-${ACME}`);

    // Held while it saves; switched off, it sends false.
    actions.getContentAuthors.mockResolvedValue({
      ...workspace('manager'),
      brands: [{ id: ACME, name: 'Acme', bylineInContent: true }],
    });
    let saved: () => void = () => {};
    actions.setBrandByline.mockReturnValue(new Promise<void>((resolve) => (saved = resolve)));
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(byline().getAttribute('aria-checked')).toBe('true');
    await click(byline());
    expect(actions.setBrandByline).toHaveBeenLastCalledWith(ACME, false);
    expect(byline().getAttribute('aria-checked')).toBe('false');
    expect(byline().hasAttribute('data-disabled')).toBe(true);
    await act(async () => saved());

    actions.setBrandByline.mockRejectedValue(new Error('forbidden'));
    await click(byline());
    expect(toast.error).toHaveBeenCalledWith("Couldn't change Add byline to content.");
  });

  it('adds an author, one profile link per line, and holds a link that is not https', async () => {
    actions.getContentAuthors.mockResolvedValue({
      ...workspace('analyst'),
      authors: workspace('analyst').authors.filter((a) => a.id !== ADA),
    });
    await render();
    await click(buttons('Add author')[0]);
    const name = document.querySelector<HTMLInputElement>('#author-name')!;
    const links = document.querySelector<HTMLTextAreaElement>('#author-links')!;
    const save = () => buttons('Save author')[0];

    expect(save().disabled).toBe(true);
    await act(async () => type(name, 'Grace Hopper'));
    await act(async () => type(links, 'https://github.com/grace\nhttp://example.com'));
    expect(save().disabled).toBe(true);
    expect(links.getAttribute('aria-invalid')).toBe('true');
    expect(document.body.textContent).toContain(
      "http://example.com isn't an https link of up to 300 characters.",
    );

    await act(async () => type(links, 'https://github.com/grace\n\n https://x.com/grace '));
    expect(save().disabled).toBe(false);
    await click(isMe());
    await click(save());
    expect(actions.saveContentAuthor).toHaveBeenCalledWith({
      name: 'Grace Hopper',
      title: '',
      bio: '',
      photoUrl: '',
      sameAs: ['https://github.com/grace', 'https://x.com/grace'],
      isMe: true,
    });
    expect(actions.getContentAuthors).toHaveBeenCalledTimes(2);
  });

  it("can't make the member a second author", async () => {
    await render();
    await click(buttons('Add author')[0]);
    expect(isMe().hasAttribute('data-disabled')).toBe(true);
    expect(document.body.textContent).toContain("You're another author already.");
  });

  it('says so when the server finds the member is another author already', async () => {
    actions.saveContentAuthor.mockResolvedValue({ error: 'already_author' });
    await render();
    await click(row('Cal Freelance').querySelector('button')!);
    await click(buttons('Save author')[0]);
    expect(toast.error).toHaveBeenCalledWith(
      'You\'re another author already. Untick "This author is me" or edit your own author.',
    );
    expect(actions.getContentAuthors).toHaveBeenCalledTimes(1);
  });

  it('edits an author with its id, and keeps it as the member', async () => {
    await render();
    await click(row('Ada Lovelace').querySelector('button')!);
    expect(document.querySelector<HTMLInputElement>('#author-name')!.value).toBe('Ada Lovelace');
    await click(buttons('Save author')[0]);
    expect(actions.saveContentAuthor).toHaveBeenCalledWith(
      expect.objectContaining({ id: ADA, name: 'Ada Lovelace', isMe: true }),
    );
  });

  it("lets an admin edit a colleague's author without taking it over", async () => {
    actions.getContentAuthors.mockResolvedValue(workspace('admin'));
    await render();
    await click(row('Bob Stone').querySelector('button')!);
    expect(isMe().hasAttribute('data-disabled')).toBe(true);
    expect(document.body.textContent).toContain('Another member is this author.');
    await click(buttons('Save author')[0]);
    expect(actions.saveContentAuthor).toHaveBeenCalledWith(
      expect.objectContaining({ id: BOB, isMe: false }),
    );
  });

  it('says so when a save fails', async () => {
    actions.saveContentAuthor.mockRejectedValue(new Error('forbidden'));
    await render();
    await click(row('Cal Freelance').querySelector('button')!);
    await click(buttons('Save author')[0]);
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the author.");
  });

  it('asks before removing an author', async () => {
    await render();
    await click(row('Cal Freelance').querySelectorAll('button')[1]);
    expect(document.body.textContent).toContain('Remove Cal Freelance?');
    expect(document.body.textContent).toContain(
      "They leave the authors list and any brand's default. No page in the Library is by them.",
    );
    expect(actions.deleteContentAuthor).not.toHaveBeenCalled();

    await click(buttons('Remove').find((b) => !container.contains(b)));
    expect(actions.deleteContentAuthor).toHaveBeenCalledWith(CAL);
  });

  it("says the author's pages go back to the team byline", async () => {
    await render();
    await click(row('Ada Lovelace').querySelectorAll('button')[1]);
    expect(document.body.textContent).toContain('Remove Ada Lovelace?');
    expect(document.body.textContent).toContain(
      "Their 3 pages go back to your brand's team byline.",
    );
  });

  it('on a read-only workspace, adds, edits, removes and sets nothing', async () => {
    actions.getContentAuthors.mockResolvedValue(workspace('manager'));
    openUpgrade.mockClear();
    await render(true);
    await click(buttons('Add author')[0]);
    expect(openUpgrade).toHaveBeenLastCalledWith('Adding authors needs a plan');
    await click(row('Cal Freelance').querySelectorAll('button')[0]);
    expect(openUpgrade).toHaveBeenLastCalledWith('Editing authors needs a plan');
    await click(row('Cal Freelance').querySelectorAll('button')[1]);
    expect(openUpgrade).toHaveBeenLastCalledWith('Removing authors needs a plan');
    await click(byline());
    expect(openUpgrade).toHaveBeenLastCalledWith('Changing the byline setting needs a plan');
    expect(openUpgrade).toHaveBeenCalledTimes(4);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(actions.setBrandByline).not.toHaveBeenCalled();
    expect(actions.deleteContentAuthor).not.toHaveBeenCalled();
  });

  it("says so when the authors can't be read", async () => {
    actions.getContentAuthors.mockResolvedValue(null);
    await render();
    expect(container.textContent).toContain("Couldn't load the authors.");
  });
});
