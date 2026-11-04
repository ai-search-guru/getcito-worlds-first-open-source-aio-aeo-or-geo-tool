import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CharacterCount } from '@tiptap/extensions';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

vi.mock('@/lib/actions/shoppingPath', () => ({
  searchProductsForBlock: vi.fn(),
  getProductsForBlock: vi.fn(),
}));

const { EditorToolbar, onEmptyLine } = await import('./_toolbar');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** An editor on the page, with the cursor at `pos`. */
function at(content: string, pos: number) {
  editor = new Editor({ extensions: [StarterKit], content });
  editor.commands.setTextSelection(pos);
  return onEmptyLine(editor, editor.state);
}

describe('onEmptyLine', () => {
  // "<h1>Title</h1>" takes positions 0–7: the empty paragraph after it opens at 7.
  it('offers the insert menu on an empty line between blocks', () => {
    expect(at('<h1>Title</h1><p></p><p>Text</p>', 8)).toBe(true);
  });

  it('not on a line with text, a heading or a list item', () => {
    expect(at('<h1>Title</h1><p></p><p>Text</p>', 11)).toBe(false);
    expect(at('<h1>Title</h1><p></p>', 3)).toBe(false);
    expect(at('<h1>Title</h1><ul><li><p></p></li></ul>', 10)).toBe(false);
  });

  it('not on an empty page, where the placeholder shows', () => {
    expect(at('<p></p>', 1)).toBe(false);
  });
});

describe('EditorToolbar', () => {
  let container: HTMLElement;
  let root: Root;
  const openUpgrade = vi.fn();
  afterEach(() => {
    openUpgrade.mockReset();
    act(() => root.unmount());
    container.remove();
    document.body.replaceChildren();
  });

  /** `isLocked`: a read-only workspace (plan not active). */
  async function render(productsBrandId: string | null, isLocked = false) {
    editor = new Editor({
      extensions: [StarterKit, CharacterCount],
      content: '<h1>Title</h1><p>Text</p>',
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <UpgradeDialogContext.Provider
            value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
          >
            <EditorToolbar
              editor={editor!}
              target={3000}
              lengthWarning={false}
              htmlView={false}
              onToggleHtml={() => {}}
              onAttach={() => {}}
              productsBrandId={productsBrandId}
            />
          </UpgradeDialogContext.Provider>
        </NextIntlClientProvider>,
      );
    });
  }
  const products = () =>
    document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Insert products from your catalog"]',
    );

  it("leaves + Insert › Products out of a draft that isn't an online shop's", async () => {
    await render(null);
    expect(products()).toBeNull();
    // The other tools are there.
    expect(document.body.querySelector('button[aria-label="Add an HTML block"]')).not.toBeNull();
  });

  it("offers it on an online shop's draft, from its brand's catalog", async () => {
    await render('b1');
    await act(async () => products()!.click());
    expect(document.body.textContent).toContain('Add products');
  });

  it('opens the upgrade dialog from it on a read-only workspace, and adds nothing', async () => {
    await render('b1', true);
    await act(async () => products()!.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Editing the page needs a plan');
    expect(document.body.textContent).not.toContain('Add products');
  });
});
