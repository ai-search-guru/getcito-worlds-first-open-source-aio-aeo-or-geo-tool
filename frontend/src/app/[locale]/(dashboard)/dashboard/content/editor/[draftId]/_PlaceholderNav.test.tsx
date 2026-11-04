import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { PlaceholderMarks } from './_placeholderMarks';
import { PlaceholderNav } from './_PlaceholderNav';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let editor: Editor;

async function render(content: string, hidden = 0, onShowHidden = vi.fn()) {
  editor = new Editor({ extensions: [StarterKit, PlaceholderMarks], content });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PlaceholderNav editor={editor} hidden={hidden} onShowHidden={onShowHidden} />
      </NextIntlClientProvider>,
    );
  });
  return onShowHidden;
}

const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === label || b.textContent === label,
  )!;
const status = () => container.querySelector('[role="status"]')!.textContent;
const selected = () => {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to);
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  editor.destroy();
  container.remove();
});

/** The toolbar's placeholders (CE-044): how many are left, and the way through them. */
describe('PlaceholderNav', () => {
  it('counts the placeholders left and steps through them, round from the last', async () => {
    await render(
      '<p>Rivals like [competitor] lead.</p><h2>FAQ</h2><p>See [notes] and [notes].</p>',
    );
    expect(container.textContent).toContain('Your input needed: 3');

    await act(async () => button('Next input needed').click());
    expect(selected()).toBe('[competitor]');
    expect(container.textContent).toContain('Your input 1 of 3');

    await act(async () => button('Next input needed').click());
    await act(async () => button('Next input needed').click());
    expect(container.textContent).toContain('Your input 3 of 3');
    await act(async () => button('Next input needed').click());
    expect(container.textContent).toContain('Your input 1 of 3');

    await act(async () => button('Previous input needed').click());
    expect(container.textContent).toContain('Your input 3 of 3');
  });

  it('goes on to the next one once one is filled, and leaves once none is left', async () => {
    await render('<p>Rivals like [competitor] and [partner] lead.</p>');
    await act(async () => button('Next input needed').click());
    await act(async () => {
      editor.commands.insertContent('Acme');
    });
    expect(container.textContent).toContain('Your input needed: 1');
    await act(async () => button('Your input needed: 1').click());
    expect(selected()).toBe('[partner]');
    await act(async () => {
      editor.commands.insertContent('Beta');
    });
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
    // A screen reader hears that the last one is filled.
    expect(status()).toBe('No input needed');
  });

  it('steps past two that touch, on to the second and then the next', async () => {
    await render('<p>Call [ab][cd] or [ef].</p>');
    await act(async () => button('Next input needed').click());
    expect(selected()).toBe('[ab]');
    await act(async () => button('Next input needed').click());
    expect(selected()).toBe('[cd]');
    expect(container.textContent).toContain('Your input 2 of 3');
    await act(async () => button('Next input needed').click());
    expect(selected()).toBe('[ef]');
    expect(container.textContent).toContain('Your input 3 of 3');
  });

  it('says the count as it changes, in a polite status', async () => {
    await render('<p>Rivals like [competitor] and [partner] lead.</p>');
    expect(container.querySelector('[role="status"]')!.getAttribute('aria-live')).toBe('polite');
    expect(status()).toBe('Your input needed: 2');
    await act(async () => button('Next input needed').click());
    // Stepping doesn't change it: only a fill does.
    expect(status()).toBe('Your input needed: 2');
    await act(async () => {
      editor.commands.insertContent('Acme');
    });
    expect(status()).toBe('Your input needed: 1');
  });

  it('counts the ones the page doesn’t show, and offers Show in HTML for them all along', async () => {
    const onShowHidden = await render('<p>Rivals like [competitor] lead.</p>', 1);
    expect(container.textContent).toContain('Your input needed: 2');
    // The arrows step through the page's only: Show in HTML is there for the hidden one.
    expect(button('Show in HTML')).toBeTruthy();
    await act(async () => button('Next input needed').click());
    expect(container.textContent).toContain('Your input 1 of 2');
    expect(button('Show in HTML')).toBeTruthy();
    await act(async () => {
      editor.commands.insertContent('Acme');
    });
    expect(container.textContent).toContain('Your input needed: 1');
    await act(async () => button('Show in HTML').click());
    expect(onShowHidden).toHaveBeenCalledOnce();
  });

  it('says where the hidden ones are to a screen reader, not only in a tooltip', async () => {
    await render('<p>Nothing to fill.</p>', 2);
    const show = button('Show in HTML');
    const hint = document.getElementById(show.getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toBe(
      "In an image's alt text, the JSON-LD or an HTML block: the page doesn't show them.",
    );
  });

  it('shows nothing for a page without one', async () => {
    await render('<p>Nothing to fill.</p>');
    expect(container.textContent).toBe('');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
