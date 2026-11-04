import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { SkillReview as Review } from '@/lib/chat/skills/store';

/**
 * An imported skill's review (W3-09; mockup #s-skill-review): the cleaned
 * file with its hidden characters marked, the scan, what was removed and
 * the source; an Admin approves or rejects it, a blocked one only
 * rejected; its creator waits on an Admin.
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

const { SkillReview } = await import('./SkillReview');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const review = (over: Partial<Review> = {}): Review => ({
  id: ID,
  name: 'copy-editing',
  title: 'Copy editing',
  description: 'Tightens copy, removes filler and keeps your voice.',
  body: '# Copy editing\n\nTighten​ the copy.',
  compatibility: null,
  license: 'MIT',
  licenseText: 'MIT License\n\nCopyright (c) Acme',
  source: 'import',
  sourceUrl: 'https://github.com/acme/skills/tree/main/copy-editing',
  commitSha: 'c'.repeat(40),
  status: 'pending_review',
  scan: { blocks: [], warns: ['Links to an outside site: example.com'] },
  removed: ['scripts/ (3 files)', 'allowed-tools'],
  mine: false,
  createdAt: '2026-11-02T10:00:00.000Z',
  approvedAt: null,
  can: { approve: true, reject: true },
  ...over,
});

let container: HTMLDivElement;
let root: Root;
let current: Review;
let status = 200;
let decision: Response;
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
  init?.method === 'POST'
    ? decision.clone()
    : Response.json(status === 200 ? { ok: true, review: current } : { ok: false }, { status }),
);

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SkillReview id={ID} />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
const page = () => container.querySelector<HTMLElement>('[data-slot="skill-review"]')!;
const action = (name: string) => container.querySelector<HTMLElement>(`[data-action="${name}"]`);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  current = review();
  status = 200;
  decision = Response.json({ ok: true, skill: { id: ID, status: 'approved' } });
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

describe('SkillReview', () => {
  it('shows the cleaned file with its hidden characters marked, the scan, what was removed and the source', async () => {
    await render();
    expect(fetchMock).toHaveBeenCalledWith(`/api/chat/skills/${ID}/review`, expect.anything());
    expect(page().querySelector('[data-slot="review-status"]')!.textContent).toBe(
      'Waiting for review',
    );
    const mark = page().querySelector('[data-slot="hidden-char"]')!;
    expect(mark.textContent).toBe('U+200B');
    expect(page().textContent).toContain('1 hidden character is marked in the text.');
    expect(page().querySelector('[data-slot="scan-warns"]')!.textContent).toContain(
      'Links to an outside site: example.com',
    );
    expect(page().querySelector('[data-slot="scan-blocks"]')).toBeNull();
    expect(page().querySelector('[data-slot="review-removed"]')!.textContent).toContain(
      'scripts/ (3 files)',
    );
    expect(page().textContent).toContain('github.com/acme/skills/tree/main/copy-editing');
    expect(page().textContent).toContain('ccccccc');
    expect(page().textContent).toContain('MIT');
  });

  it('lets an Admin approve it, and goes back to Skills', async () => {
    await render();
    await act(async () => action('skillReview.approve')!.click());
    await settle();
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(url).toBe(`/api/chat/skills/${ID}/review`);
    expect(JSON.parse(String(init!.body))).toEqual({ decision: 'approve' });
    expect(toast.success).toHaveBeenCalledWith(
      "Approved. /copy-editing is on for you; share it from Skills when it's ready for everyone.",
    );
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/skills');
  });

  it('rejects, reads the review again, and says why a decision failed', async () => {
    decision = Response.json({ ok: true, skill: { id: ID, status: 'rejected' } });
    await render();
    current = review({ status: 'rejected', can: { approve: false, reject: false } });
    await act(async () => action('skillReview.reject')!.click());
    await settle();
    expect(page().dataset.status).toBe('rejected');
    expect(action('skillReview.reject')).toBeNull();
    current = review();
    decision = Response.json({ ok: false, error: 'This skill changed since.' }, { status: 409 });
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    await act(async () => action('skillReview.approve')!.click());
    await settle();
    expect(toast.error).toHaveBeenCalledWith('This skill changed since.');
  });

  it('offers only Reject on a blocked skill, and says why', async () => {
    current = review({
      status: 'blocked',
      scan: { blocks: ['hidden characters (zero-width, bidi or tag characters)'], warns: [] },
      can: { approve: false, reject: true },
    });
    await render();
    expect(action('skillReview.approve')).toBeNull();
    expect(action('skillReview.reject')).not.toBeNull();
    expect(page().querySelector('[data-slot="scan-blocks"]')!.textContent).toContain(
      'hidden characters',
    );
    expect(page().querySelector('[data-slot="review-note"]')!.textContent).toBe(
      'The scan blocked this skill, so it can’t be approved.'.replace('’', "'"),
    );
  });

  it('tells its creator an Admin reviews it, and says when it can’t be shown', async () => {
    current = review({ mine: true, can: { approve: false, reject: false } });
    await render();
    expect(page().querySelector('[data-slot="review-note"]')!.textContent).toBe(
      'An Admin reviews it before anyone can use it.',
    );
    expect(action('skillReview.approve')).toBeNull();
    status = 404;
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).toContain("This skill isn't available to review.");
  });
});
