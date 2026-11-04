import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HeaderTip } from './_HeaderTip';

/**
 * The header's icon buttons show their label on hover and keyboard focus,
 * close it with Escape, and give the hint to screen readers as the button's
 * description (Next step spec §3b).
 */

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

async function render(narrowOnly = false) {
  await act(async () => {
    root.render(
      <HeaderTip label="Copy HTML" hint="Copy the page as HTML" narrowOnly={narrowOnly}>
        <button type="button" aria-label="Copy HTML" />
      </HeaderTip>,
    );
  });
}
const tip = () => document.querySelector('[data-slot="tooltip-content"]');
const wait = () => act(async () => new Promise((resolve) => setTimeout(resolve, 400)));

describe('HeaderTip', () => {
  it('gives the hint to screen readers as the button’s description', async () => {
    await render();
    const button = container.querySelector('button')!;
    const hint = document.getElementById(button.getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toBe('Copy the page as HTML');
    expect(hint.hidden).toBe(true);
  });

  it('shows the label and hint on hover, and closes with Escape', async () => {
    await render();
    const trigger = container.querySelector('span')!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      trigger.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await wait();
    expect(tip()!.textContent).toBe('Copy HTMLCopy the page as HTML');
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await wait();
    expect(tip()).toBeNull();
  });

  it('shows on keyboard focus', async () => {
    await render();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      container.querySelector('button')!.focus();
    });
    await wait();
    expect(tip()!.textContent).toBe('Copy HTMLCopy the page as HTML');
  });

  it('shows only narrower than 1024px for a button that shows its label where there is room', async () => {
    await render(true);
    const trigger = container.querySelector('span')!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      trigger.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await wait();
    expect(tip()!.className).toContain('lg:hidden');
  });
});
