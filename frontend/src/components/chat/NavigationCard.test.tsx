import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/** The navigation card (CHAT-19 §2). */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { NavigationCard } = await import('./NavigationCard');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {node}
      </NextIntlClientProvider>,
    );
  });
}

describe('NavigationCard', () => {
  it('names the page and its filters, says the router used no AI, and goes there', async () => {
    await render(
      <NavigationCard
        title="Tracked Prompts"
        section="Prompts"
        href="/dashboard/prompts/tracked?range=7d"
        filters={[{ key: 'range', value: '7d' }]}
        ruleRouted
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Prompts › Tracked Prompts');
    expect(text).toContain('Last 7 days');
    expect(text).toContain('Filters set for you. This chat stays open in the side panel.');
    expect(text).toContain('Navigation only · no AI usage');
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/prompts/tracked?range=7d',
    );
    expect(container.querySelector('a')?.textContent).toBe('Go to page');
  });

  it('names a platform as people know it, and says nothing of filters when there are none', async () => {
    await render(
      <NavigationCard
        title="Citations"
        section={null}
        href="/dashboard/citations?platform=perplexity-web"
        filters={[{ key: 'platform', value: 'perplexity-web' }]}
        ruleRouted={false}
      />,
    );
    expect(container.textContent).toContain('Perplexity');
    // The model routed it: AI was used.
    expect(container.textContent).not.toContain('no AI usage');
    await render(
      <NavigationCard
        title="Competitors"
        section={null}
        href="/dashboard/competitors"
        filters={[]}
        ruleRouted
      />,
    );
    expect(container.textContent).toContain('This chat stays open in the side panel.');
    expect(container.textContent).not.toContain('Filters set');
  });
});
