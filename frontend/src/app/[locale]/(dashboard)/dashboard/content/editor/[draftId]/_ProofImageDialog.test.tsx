import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import StarterKit from '@tiptap/starter-kit';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ProofSpot } from '@/lib/content/pageRead';
import { ProofImageDialog, insertProofImage } from './_ProofImageDialog';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * A visual proof spot's Add image (Quality CE-049): the image goes in right
 * after its passage's block, with its alt text and an optional caption.
 */

const SPOT: ProofSpot = {
  passage: 'keeps your gear dry in any weather',
  block: 'The Ridge 28 keeps your gear dry in any weather.',
  image: 'A photo of the Ridge 28 on a real hike in the rain',
  alt: 'A hiker with the Ridge 28 on a wet trail',
};
const SRC = 'https://cdn.trailmade.example/ridge-rain.jpg';

let editor: Editor;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  toast.error.mockReset();
  editor = new Editor({
    extensions: [StarterKit, Image],
    content: `<h1>Ridge 28</h1><p>${SPOT.block}</p><p>Next paragraph.</p>`,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
  editor.destroy();
});

const setValue = (el: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const input = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name)!;
const onClose = vi.fn();
const onOwn = vi.fn();
const render = () =>
  act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ProofImageDialog editor={editor} spot={SPOT} onClose={onClose} onOwn={onOwn} />
      </NextIntlClientProvider>,
    ),
  );

describe('insertProofImage', () => {
  it('puts the image right after the passage’s block, with a caption under it', () => {
    expect(
      insertProofImage(editor, SPOT, { src: SRC, alt: 'Rain test', caption: ' On the GR20. ' }),
    ).toBe(true);
    expect(editor.getHTML()).toBe(
      `<h1>Ridge 28</h1><p>${SPOT.block}</p><img src="${SRC}" alt="Rain test"><p><em>On the GR20.</em></p><p>Next paragraph.</p>`,
    );
  });

  it('puts it after a list whole, and says when the passage is gone', () => {
    editor.commands.setContent(
      `<ul><li><p>${SPOT.block}</p></li><li><p>Two.</p></li></ul><p>After.</p>`,
    );
    insertProofImage(editor, SPOT, { src: SRC, alt: 'Rain', caption: '' });
    expect(editor.getHTML()).toBe(
      `<ul><li><p>${SPOT.block}</p></li><li><p>Two.</p></li></ul><img src="${SRC}" alt="Rain"><p>After.</p>`,
    );
    editor.commands.setContent('<p>Written over.</p>');
    expect(insertProofImage(editor, SPOT, { src: SRC, alt: 'Rain', caption: '' })).toBe(false);
  });
});

describe('ProofImageDialog', () => {
  it('names the image to take, drafts its alt text, and adds it', async () => {
    onClose.mockReset();
    await render();
    expect(document.body.textContent).toContain(SPOT.image);
    expect(input('proof-image-alt').value).toBe(SPOT.alt);
    // Not an image address; then no alt text.
    await act(async () => setValue(input('proof-image-src'), 'javascript:alert(1)'));
    await act(async () => button('Add image').click());
    expect(document.body.textContent).toContain("Enter the image's web address");
    // http: an https page may not show it.
    await act(async () => setValue(input('proof-image-src'), 'http://cdn.example/rain.jpg'));
    await act(async () => button('Add image').click());
    expect(onClose).not.toHaveBeenCalled();
    expect(input('proof-image-src').maxLength).toBe(2048);
    await act(async () => setValue(input('proof-image-src'), SRC));
    await act(async () => setValue(input('proof-image-alt'), '  '));
    await act(async () => button('Add image').click());
    expect(document.body.textContent).toContain('Add alt text');
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => setValue(input('proof-image-alt'), 'The Ridge 28 after a rain test'));
    await act(async () => button('Add image').click());
    expect(onClose).toHaveBeenCalled();
    expect(editor.getHTML()).toContain(`<img src="${SRC}" alt="The Ridge 28 after a rain test">`);
  });

  it("says the image put in is the person's own when they tick it (CE-049, part d)", async () => {
    onOwn.mockReset();
    await render();
    await act(async () => setValue(input('proof-image-src'), SRC));
    await act(async () => document.querySelector<HTMLButtonElement>('#proof-image-own')!.click());
    await act(async () => button('Add image').click());
    expect(onOwn).toHaveBeenCalledWith(SRC);
  });

  it('says so when the passage left the page meanwhile', async () => {
    await render();
    editor.commands.setContent('<p>Written over.</p>');
    await act(async () => setValue(input('proof-image-src'), SRC));
    await act(async () => button('Add image').click());
    expect(toast.error).toHaveBeenCalledWith(
      "That passage isn't on the page any more, so the image wasn't added.",
    );
    expect(editor.getHTML()).toBe('<p>Written over.</p>');
  });
});
