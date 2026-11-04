import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { SkillUpdate as Update } from '@/lib/chat/skills/updates';

/**
 * An imported skill's update (W4-31): what changed, field by field and
 * line by line; the new version's scan, what was removed and its source
 * from the commit in use to the new one; an Admin approves it, its creator
 * waits, a blocked one keeps the version in use.
 */

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: nav.push }),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { SkillUpdate } = await import('./SkillUpdate');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const KEPT = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const update = (over: Partial<Update> = {}): Update => ({
  id: ID,
  name: 'copy-editing',
  current: {
    title: 'Copy editing',
    description: 'Tightens copy.',
    body: 'Read the page.\nTighten it.',
    license: 'MIT',
  },
  next: {
    title: 'Copy editing',
    description: 'Tightens copy, keeps your voice.',
    body: 'Read the page.\nTighten it by a third.',
    license: 'MIT',
  },
  commitSha: KEPT,
  updateSha: NEW,
  sourceUrl: `https://github.com/acme/skills/tree/${NEW}/copy-editing`,
  scan: { blocks: [], warns: ['Links to an outside site'] },
  removed: ['scripts/ (1 file)'],
  can: { approve: true },
  ...over,
});

let container: HTMLDivElement;
let root: Root;
let current: Update;
let status = 200;
let answer: Response;
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
  init?.method === 'POST'
    ? answer.clone()
    : Response.json(status === 200 ? { ok: true, update: current } : { ok: false }, { status }),
);

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SkillUpdate id={ID} />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
const page = () => container.querySelector<HTMLElement>('[data-slot="skill-update"]')!;
const action = (name: string) => container.querySelector<HTMLElement>(`[data-action="${name}"]`);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  current = update();
  status = 200;
  answer = Response.json({ ok: true, skill: { id: ID, commitSha: NEW } });
  fetchMock.mockClear();
  nav.push.mockReset();
  for (const fn of [toast.error, toast.success]) fn.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('SkillUpdate', () => {
  it('shows what changed, the steps line by line, the scan, what was removed and the commits', async () => {
    await render();
    expect(fetchMock).toHaveBeenCalledWith(`/api/chat/skills/${ID}/update`, expect.anything());
    expect(page().querySelector('h1')!.textContent).toBe('Update for /copy-editing');
    // Only the fields that changed.
    const fields = page().querySelector('[data-slot="update-fields"]')!;
    expect(fields.textContent).toContain('What it does');
    expect(fields.textContent).not.toContain('License');
    const lines = [
      ...page().querySelectorAll<HTMLElement>('[data-slot="update-diff"] [data-kind]'),
    ];
    expect(lines.map((line) => line.dataset.kind)).toEqual(['same', 'removed', 'added']);
    expect(lines[2].textContent).toContain('Tighten it by a third.');
    expect(page().querySelector('[data-slot="scan-warns"]')!.textContent).toContain(
      'Links to an outside site',
    );
    expect(page().textContent).toContain('scripts/ (1 file)');
    expect(page().querySelector('[data-slot="update-commits"]')!.textContent).toBe(
      'aaaaaaa → bbbbbbb',
    );
  });

  it('an Admin approves the commit they read, then goes back to Skills', async () => {
    await render();
    await act(async () => action('skillUpdate.approve')!.click());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toBe(`/api/chat/skills/${ID}/update`);
    expect(JSON.parse(post[1]!.body as string)).toEqual({ updateSha: NEW });
    expect(toast.success).toHaveBeenCalledWith('Updated. /copy-editing now uses the new version.');
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/skills');
  });

  it('says why when the approval fails, and stays', async () => {
    answer = Response.json({ ok: false, error: 'There’s no update to approve.' }, { status: 409 });
    await render();
    await act(async () => action('skillUpdate.approve')!.click());
    expect(toast.error).toHaveBeenCalledWith('There’s no update to approve.');
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('shows its creator the update waiting on an Admin, and a blocked one kept out', async () => {
    current = update({ can: { approve: false } });
    await render();
    expect(action('skillUpdate.approve')).toBeNull();
    expect(page().querySelector('[data-slot="update-note"]')!.textContent).toBe(
      'An Admin approves updates before anyone uses them.',
    );
    act(() => root.unmount());
    root = createRoot(container);
    current = update({ can: { approve: false }, scan: { blocks: ['a secret'], warns: [] } });
    await render();
    expect(page().querySelector('[data-slot="update-note"]')!.textContent).toBe(
      'The scan blocks the new version, so /copy-editing keeps the one in use.',
    );
  });

  it('says there is none, or that it couldn’t load', async () => {
    status = 409;
    await render();
    expect(container.textContent).toContain("There's no update for this skill.");
    act(() => root.unmount());
    root = createRoot(container);
    status = 500;
    await render();
    expect(container.textContent).toContain("This update couldn't be loaded.");
  });
});
