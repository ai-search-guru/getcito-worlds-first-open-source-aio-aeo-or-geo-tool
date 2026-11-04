import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { OpenAiIndexCard } from './openai_index_card';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/** #1281: ChatGPT in the US, OpenAI's product index and the verified seller flag. */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  openUpgrade.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactNode, isLocked = false) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          {node}
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  return container.textContent ?? '';
}

const noop = async () => {};
const box = () => container.querySelector('button[role="checkbox"]') as HTMLButtonElement;

describe('OpenAiIndexCard', () => {
  it('reads found, source unknown, with the cards and the advice', () => {
    const text = render(
      <OpenAiIndexCard
        read={{ directFeed: false, ownCards: 3 }}
        loading={false}
        canManage
        onDirectFeedChange={noop}
      />,
    );
    expect(text).toContain("Catalog in OpenAI's product index");
    expect(text).toContain('Found, source unknown');
    expect(text).toContain('(3 cards)');
    expect(text).toContain('Send OpenAI a direct product feed, or connect a Shopify store');
    expect(box().getAttribute('aria-checked')).toBe('false');
    expect(box().disabled).toBe(false);
  });

  it("reads not found with no cards, and a direct feed on the brand's word with no advice", () => {
    expect(
      render(
        <OpenAiIndexCard
          read={{ directFeed: false, ownCards: 0 }}
          loading={false}
          canManage
          onDirectFeedChange={noop}
        />,
      ),
    ).toContain('Not found in tracked answers');
    const text = render(
      <OpenAiIndexCard
        read={{ directFeed: true, ownCards: 0 }}
        loading={false}
        canManage
        onDirectFeedChange={noop}
      />,
    );
    expect(text).toContain('Direct feed');
    expect(text).not.toContain('or connect a Shopify store');
    expect(box().getAttribute('aria-checked')).toBe('true');
  });

  it('always reads the verified seller flag as unknown', () => {
    const text = render(
      <OpenAiIndexCard
        read={{ directFeed: true, ownCards: 9 }}
        loading={false}
        canManage
        onDirectFeedChange={noop}
      />,
    );
    expect(text).toContain('Verified seller in ChatGPT');
    expect(text).toContain('Unknown');
  });

  it('lets only admins and managers change the direct-feed word', () => {
    const text = render(
      <OpenAiIndexCard
        read={{ directFeed: false, ownCards: 0 }}
        loading={false}
        canManage={false}
        onDirectFeedChange={noop}
      />,
    );
    expect(box().disabled).toBe(true);
    expect(text).toContain('Admins and managers can change this.');
  });

  it('saves the word, and says so when the save fails', async () => {
    const change = vi.fn().mockRejectedValue(new Error('forbidden'));
    render(
      <OpenAiIndexCard
        read={{ directFeed: false, ownCards: 0 }}
        loading={false}
        canManage
        onDirectFeedChange={change}
      />,
    );
    await act(async () => {
      box().click();
    });
    expect(change).toHaveBeenCalledWith(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't save. Try again.",
    );
  });

  it('saves nothing on a read-only workspace: the box opens the upgrade dialog', async () => {
    const change = vi.fn();
    render(
      <OpenAiIndexCard
        read={{ directFeed: false, ownCards: 0 }}
        loading={false}
        canManage
        onDirectFeedChange={change}
      />,
      true,
    );
    await act(async () => {
      box().click();
    });
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith(
      'Changing the product feed setting needs a plan',
    );
    expect(change).not.toHaveBeenCalled();
    expect(box().getAttribute('aria-checked')).toBe('false');
  });

  it('says so when the read failed', () => {
    expect(
      render(<OpenAiIndexCard read={null} loading={false} canManage onDirectFeedChange={noop} />),
    ).toContain("Couldn't read this right now.");
  });
});
