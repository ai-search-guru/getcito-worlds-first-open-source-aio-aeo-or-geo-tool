import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { ContentDraftContext } from './ContentDraftContext';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(payload: Record<string, unknown>) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ContentDraftContext payload={payload} />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ContentDraftContext', () => {
  it('opens the draft, and names its page type, page and prompts (CE-015)', async () => {
    await render({
      draftId: 'd9',
      pageType: 'pricing',
      pages: ['https://northwind.example/pricing/'],
      targetCount: 4,
    });
    expect(container.querySelector('a')!.getAttribute('href')).toBe('/dashboard/content/editor/d9');
    expect(container.textContent).toContain('Content Editor');
    expect(container.textContent).toContain('Pricing');
    expect(container.textContent).toContain('/pricing');
    expect(container.textContent).toContain('4 prompts');
  });

  it('says a draft for a new page is one', async () => {
    await render({ draftId: 'd9', pages: [], targetCount: 0 });
    expect(container.textContent).toContain('A new page');
    expect(container.textContent).not.toContain('Prompts it should answer');
  });
});
