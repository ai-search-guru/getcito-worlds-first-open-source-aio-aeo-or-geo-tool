import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { ProofSpot } from '@/lib/content/pageRead';

/**
 * Visual proof spots in the draft's left margin (Quality spec §4b, CE-049):
 * where one specific image the business can take itself would prove a
 * passage, with "For: “{passage}”" and Add image. A decoration, never the
 * page's, so no save, export, Copy, Copy HTML or CMS push has it. Wide
 * (the page's scroll area 1120 px and up), a card beside the paragraph;
 * narrower, a small marker in its padding that opens the same dialog.
 */

export interface ProofSpotsMeta {
  /** The page read's spots, in its order. */
  spots: readonly ProofSpot[];
  /** "Visual proof". */
  title: string;
  /** "Add image". */
  add: string;
  /** "For: “{passage}”". */
  forPassage: (passage: string) => string;
  /** "Add image for “{passage}”": the button's and the marker's name. */
  addFor: (passage: string) => string;
  /** "Visual proof: {image}": the marker's tooltip. */
  marker: (image: string) => string;
  /** Opens the image dialog for a spot. */
  onAdd: (spot: ProofSpot) => void;
}

interface SpotsState {
  meta: ProofSpotsMeta | null;
  decorations: DecorationSet;
}

export const proofSpotsKey = new PluginKey<SpotsState>('proofSpots');

import { openSpotPlaces, type PlacedSpot } from '@/lib/content/docText';

export { openSpotPlaces, type PlacedSpot };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

const CAMERA =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>';

/** The card (wide) and the marker (narrow), absolutely beside the paragraph. */
function spotView(spot: ProofSpot, meta: ProofSpotsMeta): HTMLElement {
  // Not the paragraph's words: a group of its own, in the page's plain type
  // (a quote's italics aren't the card's).
  const box = el('span', 'not-prose font-normal not-italic');
  box.contentEditable = 'false';
  box.dataset.proofSpot = '';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', meta.title);
  const add = (e: Event) => {
    e.preventDefault();
    meta.onAdd(spot);
  };

  const card = el(
    'span',
    'absolute right-full mr-5 hidden w-[200px] flex-col gap-1 rounded-lg border border-dashed border-sky-300 bg-sky-50/60 p-2.5 text-left leading-snug select-none @min-[1120px]:flex dark:border-sky-800 dark:bg-sky-950/30',
  );
  card.append(
    el(
      'span',
      'text-[10.5px] font-semibold tracking-wide text-sky-700 uppercase dark:text-sky-300',
      meta.title,
    ),
    el('span', 'line-clamp-4 text-[12.5px] text-foreground', spot.image),
    el(
      'span',
      'line-clamp-2 text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]',
      meta.forPassage(spot.passage),
    ),
  );
  const button = el(
    'button',
    'mt-1 self-start rounded-md border bg-background px-2 py-0.5 text-[12px] font-medium text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
    meta.add,
  );
  button.type = 'button';
  button.setAttribute('aria-label', meta.addFor(spot.passage));
  button.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('click', add);
  card.append(button);

  const marker = el(
    'button',
    'absolute right-full mt-1 mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-sky-400 bg-background text-sky-700 hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none @min-[1120px]:hidden dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/40',
  );
  marker.type = 'button';
  marker.innerHTML = CAMERA;
  marker.title = meta.marker(spot.image);
  marker.setAttribute('aria-label', meta.addFor(spot.passage));
  marker.addEventListener('mousedown', (e) => e.preventDefault());
  marker.addEventListener('click', add);

  box.append(card, marker);
  return box;
}

function place(doc: PmNode, meta: ProofSpotsMeta | null): DecorationSet {
  if (!meta?.spots.length) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    openSpotPlaces(doc, meta.spots).map(({ spot, at }) =>
      Decoration.widget(at, () => spotView(spot, meta), {
        // All the card shows and acts on: a change draws it again.
        key: `proof-spot:${spot.passage}:${spot.block}:${spot.image}:${spot.alt}:${meta.title}`,
        side: -1,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    ),
  );
}

export const ProofSpotsExtension = Extension.create({
  name: 'proofSpots',

  addProseMirrorPlugins() {
    return [
      new Plugin<SpotsState>({
        key: proofSpotsKey,
        state: {
          init: () => ({ meta: null, decorations: DecorationSet.empty }),
          // Placed again when the spots change or the page does (a spot
          // filled or written over goes), not on a cursor move.
          apply: (tr, prev) => {
            const next = tr.getMeta(proofSpotsKey) as ProofSpotsMeta | null | undefined;
            const meta = next === undefined ? prev.meta : next;
            if (next === undefined && !tr.docChanged) return prev;
            return { meta, decorations: place(tr.doc, meta) };
          },
        },
        props: {
          decorations: (state) => proofSpotsKey.getState(state)?.decorations ?? null,
        },
      }),
    ];
  },
});
