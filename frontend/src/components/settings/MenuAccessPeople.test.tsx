import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { MenuAccessSettings, MenuMember } from '@/lib/actions/menuAccess';

/**
 * Settings › Menu access › Who can change menus and People: an admin lets a
 * manager change menus; each non-admin's exception to their role's menu is
 * saved as a box changes, and put back when the save fails.
 */

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const actions = vi.hoisted(() => ({ setMemberMenu: vi.fn(), setMenuManager: vi.fn() }));
vi.mock('@/lib/actions/menuAccess', () => actions);

const { MenuManagersCard, MenuPeopleCard, memberMenuWith } = await import('./MenuAccessPeople');
const { ChatAgenticProvider } = await import('@/components/context/ChatAgenticProvider');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const member = (over: Partial<MenuMember>): MenuMember => ({
  userId: 'u',
  email: 'u@acme.example',
  fullName: null,
  avatarUrl: null,
  role: 'analyst',
  workAreas: [],
  shown: [],
  hidden: [],
  canManageMenus: false,
  isCurrentUser: false,
  ...over,
});

let settings: MenuAccessSettings;
const onFailed = vi.fn();
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  actions.setMemberMenu.mockResolvedValue(undefined);
  actions.setMenuManager.mockResolvedValue(undefined);
  settings = {
    roles: { manager: ['content', 'audit'], analyst: ['content'], agency_partner: [] },
    viewerIsAdmin: true,
    members: [
      member({ userId: 'admin', role: 'admin', fullName: 'Alex Morgan' }),
      member({
        userId: 'deniz',
        role: 'manager',
        fullName: 'Deniz Kaya',
        workAreas: ['brand'],
        canManageMenus: true,
      }),
      member({ userId: 'ece', role: 'manager', fullName: 'Ece Yılmaz', shown: ['audit'] }),
      member({ userId: 'mert', role: 'analyst', fullName: 'Mert Aydın' }),
    ],
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/**
 * The cards over settings that change as they save, as the section holds
 * them; a failed save reads them again (here: as they started).
 */
function Cards() {
  const [current, setCurrent] = useState(settings);
  const onChange = (update: (s: MenuAccessSettings) => MenuAccessSettings) => setCurrent(update);
  const reload = () => {
    onFailed();
    setCurrent(settings);
  };
  return (
    <>
      <MenuManagersCard settings={current} onChange={onChange} onFailed={reload} />
      <MenuPeopleCard settings={current} onChange={onChange} onFailed={reload} />
    </>
  );
}

async function render(chatOn = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChatAgenticProvider enabled={chatOn}>
          <Cards />
        </ChatAgenticProvider>
      </NextIntlClientProvider>,
    );
  });
}

const el = (selector: string) => container.querySelector(selector) as HTMLElement;
const row = (id: string) => el(`[data-member="${id}"]`);
const buttonIn = (scope: HTMLElement, text: string) =>
  [...scope.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;

describe('memberMenuWith', () => {
  it('shows a section the role hides, and hides one it shows', () => {
    expect(memberMenuWith({ shown: [], hidden: [] }, ['content'], 'content', true)).toEqual({
      shown: ['content'],
      hidden: [],
    });
    expect(memberMenuWith({ shown: [], hidden: [] }, ['content'], 'reports', false)).toEqual({
      shown: [],
      hidden: ['reports'],
    });
  });

  it('drops the exception when the box goes back to the role’s', () => {
    expect(
      memberMenuWith({ shown: ['content'], hidden: [] }, ['content'], 'content', false),
    ).toEqual({ shown: [], hidden: [] });
    expect(memberMenuWith({ shown: [], hidden: ['reports'] }, [], 'reports', true)).toEqual({
      shown: [],
      hidden: [],
    });
  });
});

describe('MenuManagersCard', () => {
  it('lists managers only, and lets an admin switch one', async () => {
    await render();
    const deniz = el('[aria-label="Deniz Kaya can change menus"]');
    expect(deniz.getAttribute('aria-checked')).toBe('true');
    expect(el('[aria-label="Ece Yılmaz can change menus"]').getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(el('[aria-label="Mert Aydın can change menus"]')).toBeNull();

    await act(async () => deniz.click());
    expect(actions.setMenuManager).toHaveBeenCalledWith('deniz', false);
    expect(deniz.getAttribute('aria-checked')).toBe('false');
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('reads the settings again when the save fails', async () => {
    actions.setMenuManager.mockRejectedValueOnce(new Error('nope'));
    await render();
    const ece = el('[aria-label="Ece Yılmaz can change menus"]');
    await act(async () => ece.click());
    expect(onFailed).toHaveBeenCalled();
    expect(ece.getAttribute('aria-checked')).toBe('false');
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the menu. Try again.");
  });

  it('is read-only for a manager who changes menus', async () => {
    settings.viewerIsAdmin = false;
    await render();
    expect((el('[aria-label="Deniz Kaya can change menus"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(container.textContent).toContain('Only admins choose who can change menus.');
  });
});

describe('MenuPeopleCard', () => {
  it('lists non-admins with their work areas and menu', async () => {
    await render();
    expect(row('admin')).toBeNull();
    expect(row('deniz').textContent).toContain('Brand & PR');
    expect(row('deniz').textContent).toContain("Manager's menu");
    // Manager's 10 sections narrowed to Brand & PR's: Action Center, Chat,
    // Brand Visibility, Competitors, Mentions, Citations, Reports.
    expect(row('deniz').textContent).toContain('7 of 12 sections');
    expect(row('ece').textContent).toContain('Custom: +Audit');
    expect(row('ece').textContent).toContain('11 of 12 sections');
    expect(row('mert').textContent).toContain('All sections');
  });

  // Agent Center, only with the new Chat on: in the count and the boxes then.
  it('counts and lists Agent Center only with the new Chat on', async () => {
    await render(true);
    // Brand & PR's sections now hold Agent Center too.
    expect(row('deniz').textContent).toContain('8 of 13 sections');
    await act(async () => buttonIn(row('mert'), 'Customize').click());
    expect(el('[aria-label="Mert Aydın sees Agent Center"]').getAttribute('aria-checked')).toBe(
      'true',
    );

    act(() => root.unmount());
    root = createRoot(container);
    await render(false);
    await act(async () => buttonIn(row('mert'), 'Customize').click());
    expect(container.querySelector('[aria-label="Mert Aydın sees Agent Center"]')).toBeNull();
    expect(el('[aria-label="Mert Aydın sees Chat"]')).not.toBeNull();
  });

  it('saves a person’s exception as a box changes', async () => {
    await render();
    await act(async () => buttonIn(row('mert'), 'Customize').click());
    expect(row('mert').textContent).toContain("Mert Aydın's sections");
    expect((el('[aria-label="Mert Aydın sees Action Center"]') as HTMLButtonElement).disabled).toBe(
      true,
    );

    await act(async () => el('[aria-label="Mert Aydın sees Content"]').click());
    expect(actions.setMemberMenu).toHaveBeenCalledWith('mert', { shown: ['content'], hidden: [] });
    expect(row('mert').textContent).toContain('shown for them');
    expect(row('mert').textContent).toContain('Custom: +Content');

    await act(async () => el('[aria-label="Mert Aydın sees Reports"]').click());
    expect(actions.setMemberMenu).toHaveBeenLastCalledWith('mert', {
      shown: ['content'],
      hidden: ['reports'],
    });
  });

  it('goes back to the role’s menu', async () => {
    await render();
    await act(async () => buttonIn(row('ece'), 'Customize').click());
    await act(async () => buttonIn(row('ece'), "Use Manager's menu").click());
    expect(actions.setMemberMenu).toHaveBeenCalledWith('ece', { shown: [], hidden: [] });
    expect(row('ece').textContent).toContain("Manager's menu");
  });

  it('reads the settings again when the save fails', async () => {
    actions.setMemberMenu.mockRejectedValueOnce(new Error('nope'));
    await render();
    await act(async () => buttonIn(row('mert'), 'Customize').click());
    await act(async () => el('[aria-label="Mert Aydın sees Content"]').click());
    expect(onFailed).toHaveBeenCalled();
    expect(el('[aria-label="Mert Aydın sees Content"]').getAttribute('aria-checked')).toBe('false');
    expect(toast.error).toHaveBeenCalled();
  });
});
