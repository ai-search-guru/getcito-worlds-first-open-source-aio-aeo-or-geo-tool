import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { BulkActionBar } from './_BulkActionBar';

/** The prompts table's bulk action bar: its Locations menu (PROMPT-015). */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const onAddLocations = vi.fn();
const onRemoveLocations = vi.fn();

async function render(busy = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <BulkActionBar
          count={2}
          activeCount={2}
          busy={busy}
          suggesting={false}
          suggestBlockedReason={null}
          deleting={null}
          onPause={() => {}}
          onResume={() => {}}
          onSuggestContent={() => {}}
          onAddLocations={onAddLocations}
          onRemoveLocations={onRemoveLocations}
          onDelete={() => {}}
          onClear={() => {}}
        />
      </NextIntlClientProvider>,
    );
  });
}

const trigger = () =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Locations',
  ) as HTMLButtonElement;

async function openMenu() {
  await act(async () => {
    trigger().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger().click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

beforeEach(() => {
  onAddLocations.mockReset();
  onRemoveLocations.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('BulkActionBar', () => {
  it('adds locations to the selection or stops some', async () => {
    await render();
    let items = await openMenu();
    expect(items.map((i) => i.textContent)).toEqual(['Add locations', 'Remove locations']);
    await act(async () => items[1].click());
    expect(onRemoveLocations).toHaveBeenCalledTimes(1);
    expect(onAddLocations).not.toHaveBeenCalled();
    items = await openMenu();
    await act(async () => items[0].click());
    expect(onAddLocations).toHaveBeenCalledTimes(1);
  });

  it('waits while another bulk action runs', async () => {
    await render(true);
    expect(trigger().disabled).toBe(true);
  });
});
