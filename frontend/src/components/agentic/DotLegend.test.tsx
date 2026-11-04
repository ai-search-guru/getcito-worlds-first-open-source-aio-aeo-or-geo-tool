import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { DotLegend } from './DotLegend';

/**
 * "?" beside Agents at work (CHAT-23 `chatMenu.dotLegend`): opens "What the
 * dots mean" and closes with Esc, focus back on the button.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DotLegend />
      </NextIntlClientProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const trigger = () => container.querySelector<HTMLButtonElement>('button')!;
const popup = () => document.querySelector<HTMLElement>('[data-slot="popover-content"]');

describe('DotLegend', () => {
  it('is a labelled button with its CHAT-23 id', () => {
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(trigger().dataset.action).toBe('chatMenu.dotLegend');
    // The button says what it opens, in the popover's own words.
    expect(trigger().getAttribute('aria-label')).toBe('What the dots mean');
    expect(trigger().title).toBe('What the dots mean');
    expect(popup()).toBeNull();
  });

  it('explains every dot, in the mockup order, and closes with Esc', async () => {
    trigger().focus();
    await act(async () => trigger().click());
    await act(async () => {});
    expect(popup()!.textContent).toContain('What the dots mean');
    const rows = [...popup()!.querySelectorAll('li')].map(
      (li) => li.querySelector('b')!.textContent,
    );
    expect(rows).toEqual(['Running', 'Needs you', 'Done', 'Stopped or failed', 'Idle']);
    // The words say the state: the dots beside them are not read twice.
    for (const dot of popup()!.querySelectorAll('[data-slot="list-dot"]')) {
      expect(dot.getAttribute('aria-hidden')).toBe('true');
    }
    // The open popover stops reduced-motion users' zoom too.
    expect(popup()!.className).toContain('motion-reduce:animate-none!');

    await act(async () =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    await act(async () => {});
    expect(popup()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});
