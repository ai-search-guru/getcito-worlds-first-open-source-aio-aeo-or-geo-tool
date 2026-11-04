import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProofSpot } from '@/lib/content/pageRead';
import { ProofSpotsExtension, openSpotPlaces, proofSpotsKey } from './_proofSpots';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const open = (content: string) => {
  editor = new Editor({ extensions: [StarterKit, Image, ProofSpotsExtension], content });
  return editor;
};

const RAIN: ProofSpot = {
  passage: 'keeps your gear dry in any weather',
  block: 'The Ridge 28 keeps your gear dry in any weather.',
  image: 'A photo of the Ridge 28 on a real hike in the rain',
  alt: 'A hiker with the Ridge 28 on a wet trail',
};
const SEAMS: ProofSpot = {
  passage: 'welded seams',
  block: 'Every seam is welded seams-first and taped.',
  image: 'A close-up of the welded seams',
  alt: 'Close-up of the seams',
};

const show = (e: Editor, spots: ProofSpot[], onAdd = vi.fn()) => {
  e.view.dispatch(
    e.state.tr.setMeta(proofSpotsKey, {
      spots,
      title: 'Visual proof',
      add: 'Add image',
      forPassage: (passage: string) => `For: “${passage}”`,
      addFor: (passage: string) => `Add image for “${passage}”`,
      marker: (image: string) => `Visual proof: ${image}`,
      onAdd,
    }),
  );
  return onAdd;
};
const spots = (e: Editor) => [...e.view.dom.querySelectorAll<HTMLElement>('[data-proof-spot]')];

/** Visual proof spots (Quality CE-049): editor-only, beside their passages. */
describe('ProofSpotsExtension', () => {
  it('shows a spot at the start of its passage’s paragraph, outside the page', () => {
    const e = open(`<h1>Ridge 28</h1><p>${RAIN.block}</p><p>More words.</p>`);
    const onAdd = show(e, [RAIN]);
    const [spot] = spots(e);
    expect(spot.parentElement?.tagName).toBe('P');
    expect(spot.parentElement?.textContent).toContain(RAIN.block);
    expect(spot.contentEditable).toBe('false');
    expect(spot.textContent).toContain('Visual proof');
    expect(spot.textContent).toContain(RAIN.image);
    expect(spot.textContent).toContain(`For: “${RAIN.passage}”`);
    // The card's button and the narrow width's marker both add an image.
    const buttons = spot.querySelectorAll('button');
    expect([...buttons].map((b) => b.getAttribute('aria-label'))).toEqual([
      `Add image for “${RAIN.passage}”`,
      `Add image for “${RAIN.passage}”`,
    ]);
    expect(buttons[1].title).toBe(`Visual proof: ${RAIN.image}`);
    // Its own group, not the paragraph's words.
    expect(spot.getAttribute('role')).toBe('group');
    expect(spot.getAttribute('aria-label')).toBe('Visual proof');
    buttons[1].click();
    expect(onAdd).toHaveBeenCalledWith(RAIN);
    // No save, export, Copy HTML or HTML view has it.
    expect(e.getHTML()).toBe(`<h1>Ridge 28</h1><p>${RAIN.block}</p><p>More words.</p>`);
    expect(e.getText()).not.toContain('Visual proof');
  });

  it('leaves a spot out once an image follows its block, or its passage is gone', () => {
    const e = open(
      `<p>${RAIN.block}</p><img src="https://cdn.example/rain.jpg" alt="Rain"><ul><li><p>${SEAMS.block}</p></li></ul>`,
    );
    show(e, [RAIN, SEAMS]);
    expect(spots(e)).toHaveLength(1);
    expect(spots(e)[0].closest('li')).not.toBeNull();
    expect(openSpotPlaces(e.state.doc, [RAIN, SEAMS]).map((p) => p.spot)).toEqual([SEAMS]);

    // Written over: no spot.
    e.commands.setContent(`<p>The Ridge 28 is light.</p><ul><li><p>${SEAMS.block}</p></li></ul>`);
    expect(openSpotPlaces(e.state.doc, [RAIN])).toEqual([]);
  });

  it('follows the read, and leaves with none to show', () => {
    const e = open(`<p>${RAIN.block}</p>`);
    show(e, [RAIN]);
    // Placed once: a cursor move doesn't place them again.
    const placed = proofSpotsKey.getState(e.state)!.decorations;
    e.commands.setTextSelection(3);
    expect(proofSpotsKey.getState(e.state)!.decorations).toBe(placed);
    // A new read of the same spot with other alt text: its Add image has the new one.
    const onAdd = show(e, [{ ...RAIN, alt: 'The Ridge 28 dry inside after rain' }]);
    spots(e)[0].querySelector('button')!.click();
    expect(onAdd).toHaveBeenCalledWith({ ...RAIN, alt: 'The Ridge 28 dry inside after rain' });
    e.commands.insertContentAt(e.state.doc.content.size, '<p>Typing on.</p>');
    expect(spots(e)).toHaveLength(1);
    e.view.dispatch(e.state.tr.setMeta(proofSpotsKey, null));
    expect(spots(e)).toHaveLength(0);
  });
});
