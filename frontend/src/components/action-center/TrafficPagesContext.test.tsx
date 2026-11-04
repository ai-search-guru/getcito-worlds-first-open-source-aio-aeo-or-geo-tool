import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * The drawer's Overview for pages sent from AI Traffic (AT-006): the list and
 * range they were sent from, and each page's figures when sent.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));

const { TrafficPagesContext } = await import('./TrafficPagesContext');

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

function render(payload: Record<string, unknown>) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <TrafficPagesContext payload={payload} />
      </NextIntlClientProvider>,
    ),
  );
  return container.textContent ?? '';
}

describe('TrafficPagesContext', () => {
  it('names the list, the range and each page as sent', () => {
    const text = render({
      reason: 'cited_not_clicked',
      window: { from: '2026-09-18T12:00:00.000Z', to: '2026-10-18T12:00:00.000Z' },
      evidence: [
        { page: '/guides/espresso', citations: 80, sessions: 0, aiVisits: 0 },
        { page: '/shop/beans', citations: 1, sessions: 240, aiVisits: 0 },
      ],
    });
    expect(text).toContain('AI Traffic Analytics › Pages · Cited, not clicked');
    expect(text).toContain('Sep 18, 2026 – Oct 18, 2026');
    expect(text).toContain('/guides/espresso80 citations · 0 sessions · 0 AI visits');
    expect(text).toContain('/shop/beans1 citation · 240 sessions · 0 AI visits');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/dashboard/traffic');
  });

  it('reads a 24-hour range in hours, and all time as such', () => {
    expect(
      render({
        reason: 'no_ai_traffic',
        window: { from: '2026-10-17T12:00:00.000Z', to: '2026-10-18T12:00:00.000Z' },
        evidence: [],
      }),
    ).toContain('No AI traffic');
    expect(container.textContent).toMatch(/Oct 17, 2026, \d+:\d{2} [AP]M – Oct 18, 2026/);
    expect(render({ reason: 'no_ai_traffic', window: { from: null, to: null } })).toContain(
      'All time',
    );
  });
});
