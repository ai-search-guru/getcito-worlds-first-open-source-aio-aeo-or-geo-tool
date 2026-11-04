import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { ConfirmImagesDialog } from './_ConfirmImagesDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Quality's Confirm (CE-049): the page's images, each the person's own or not. */

let container: HTMLDivElement;
let root: Root;
const onConfirm = vi.fn();

beforeEach(() => {
  onConfirm.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('ConfirmImagesDialog', () => {
  it('lists the images, the confirmed ones ticked for good, and confirms one on its box', async () => {
    await act(async () =>
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <ConfirmImagesDialog
            images={[
              { src: 'https://cdn.example/run.png', alt: 'A forecast run' },
              { src: 'https://cdn.example/team.jpg', alt: '' },
            ]}
            own={new Set(['https://cdn.example/team.jpg'])}
            onConfirm={onConfirm}
            onClose={() => {}}
          />
        </NextIntlClientProvider>,
      ),
    );
    const rows = [...document.querySelectorAll('[role="dialog"] li')];
    expect(rows.map((row) => row.textContent)).toEqual([
      'A forecast runOur own image, not stock',
      'No alt textConfirmed: our own image',
    ]);
    expect(rows[0].querySelector('img')!.getAttribute('referrerpolicy')).toBe('no-referrer');
    const boxes = [...document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')];
    // Confirmed for good: nothing to untick, focus kept on it.
    expect(boxes[1].getAttribute('aria-disabled')).toBe('true');
    await act(async () => boxes[1].click());
    expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => boxes[0].click());
    expect(onConfirm).toHaveBeenCalledWith('https://cdn.example/run.png');
  });
});
