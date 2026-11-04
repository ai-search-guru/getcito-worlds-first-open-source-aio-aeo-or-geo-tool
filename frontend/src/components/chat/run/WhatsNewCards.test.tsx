import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';

/**
 * What's new's cards under an answer (W4-21, CHAT-11 item 10): the
 * feature, the team's lines, Try it to its page (marking it read), and for
 * an entry the plan doesn't include "On {plans}." with See plans.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { WhatsNewCards } = await import('./WhatsNewCards');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let host: HTMLDivElement;
const posts: { url: string; body: unknown }[] = [];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  posts.length = 0;
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    posts.push({ url: String(url), body: JSON.parse(String(init?.body ?? 'null')) });
    return new Response('{"ok":true}');
  }) as typeof fetch;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(node: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {node}
      </NextIntlClientProvider>,
    );
  });
}

describe('WhatsNewCards', () => {
  it('shows each update’s feature, lines and Try it, and marks it read when opened', async () => {
    await render(
      <WhatsNewCards
        entries={[
          {
            slug: 'agent-center',
            feature: 'Agent Center',
            lines: ['One.', 'Two.', 'Three.'],
            href: '/dashboard/agents',
          },
          {
            slug: 'full-auto',
            feature: 'Full auto',
            lines: ['A.', 'B.', 'C.'],
            href: '/dashboard/chat',
            onPlans: 'Growth and Enterprise',
          },
        ]}
      />,
    );
    const cards = [...host.querySelectorAll('article')];
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
      'Agent Center',
      'Full auto',
    ]);
    expect([...cards[0].querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'One.',
      'Two.',
      'Three.',
    ]);
    const tryIt = cards[0].querySelector<HTMLAnchorElement>('[data-action="whatsNew.tryIt"]')!;
    expect(tryIt.getAttribute('href')).toBe('/dashboard/agents');
    expect(tryIt.textContent).toBe('Try it');
    expect(cards[0].textContent).not.toContain('On ');
    expect(cards[1].textContent).toContain('On Growth and Enterprise.');
    expect(cards[1].querySelector('[data-action="plans.compare"]')?.getAttribute('href')).toBe(
      '/dashboard/settings/billing',
    );
    await act(async () => {
      tryIt.addEventListener('click', (e) => e.preventDefault());
      tryIt.click();
    });
    expect(posts).toEqual([{ url: '/api/chat/whats-new/read', body: { slugs: ['agent-center'] } }]);
  });

  it('shows nothing without updates', async () => {
    await render(<WhatsNewCards entries={[]} />);
    expect(host.innerHTML).toBe('');
  });
});
