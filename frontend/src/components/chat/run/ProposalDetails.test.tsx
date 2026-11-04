import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../../messages/en.json';
import { ProposalDetails } from './ProposalDetails';

/** What Send to Action Center freezes, on its card (CHAT-09 items 18, 18b). */

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

const LONG = `Plan | Price per bag | Ships in | Free shipping from. ${'Every plan ships fresh. '.repeat(10)}`;

describe('ProposalDetails', () => {
  it('shows each task with its new text shortened, the goal and what it is sent with', () => {
    act(() =>
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <ProposalDetails
            confirm={{
              n: 1,
              action: 'Send findings to Action Center',
              target: '“Win back /pricing” · Recover · 1 task',
              digest: 'd'.repeat(32),
              canDontAskAgain: false,
              why: 'Lost 6 citations.',
              goal: 'Get /pricing cited again',
              items: [
                {
                  title: 'Add a price table to /pricing',
                  detail: 'On-page · /pricing · Done when: It is live',
                  body: LONG,
                },
              ],
              targets: [
                { kind: 'pages', values: ['/pricing'] },
                { kind: 'platforms', values: ['Google AI Overviews'] },
              ],
            }}
          />
        </NextIntlClientProvider>,
      ),
    );
    const text = () => container.textContent ?? '';
    expect(text()).toContain('Add a price table to /pricing');
    expect(text()).toContain('On-page · /pricing · Done when: It is live');
    expect(text()).toContain('GoalGet /pricing cited again');
    expect(text()).toContain('Pages/pricing');
    expect(text()).toContain('PlatformsGoogle AI Overviews');
    expect(text()).not.toContain(LONG);
    const showAll = container.querySelector<HTMLButtonElement>('[data-action="approval.showAll"]')!;
    expect(showAll.textContent).toBe('Show all');
    act(() => showAll.click());
    expect(text()).toContain(LONG.trim());
    expect(showAll.textContent).toBe('Show less');
    expect(showAll.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows nothing for a card without them', () => {
    act(() =>
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <ProposalDetails
            confirm={{ n: 1, action: 'x', target: 'y', digest: 'd', canDontAskAgain: false }}
          />
        </NextIntlClientProvider>,
      ),
    );
    expect(container.querySelector('[data-slot="proposal-details"]')).toBeNull();
  });
});
