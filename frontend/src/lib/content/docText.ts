import { getSchema } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { DOMParser as PmDOMParser, type Node as PmNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { EDITOR_STARTER_KIT } from './editor';
import { contentDom } from './dom';
import { HtmlBlockNode } from './htmlBlockNode';
import { JsonLd } from './jsonLdNode';
import type { ProofSpot } from './pageRead';

/**
 * Places in the editor's document (ProseMirror), for the editor and the
 * server's go-live gate alike, so both count the same.
 */

const squeeze = (text: string) => text.replace(/\s+/g, '');

/**
 * Where a text is in the page, as document positions: each place it is in
 * a paragraph that holds it whole and, with `block`, is part of that Trust
 * block (its text, as trustBlocks reads it). Headings and code aren't
 * Trust's. Spaces don't count: Trust's text has one at each tag's edge
 * ("( report)", "40 %") and at a line break, where the page may have none.
 * Its words may run across marks (a bold word, a link), not across blocks.
 */
export function textRanges(
  doc: PmNode,
  text: string,
  block?: string,
): { from: number; to: number }[] {
  const needle = squeeze(text);
  if (!needle) return [];
  const within = block === undefined ? null : squeeze(block);
  const ranges: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === 'heading' || node.type.spec.code) return false;
    // The paragraph's words without their spaces, each at its position.
    let words = '';
    const at: number[] = [];
    node.forEach((child, offset) => {
      const own = child.isText ? (child.text ?? '') : '';
      for (let i = 0; i < own.length; i++) {
        if (/\s/.test(own[i])) continue;
        words += own[i];
        at.push(pos + 1 + offset + i);
      }
    });
    if (!words || (within !== null && !within.includes(words))) return false;
    for (let i = words.indexOf(needle); i !== -1; i = words.indexOf(needle, i + 1)) {
      ranges.push({ from: at[i], to: at[i + needle.length - 1] + 1 });
    }
    return false;
  });
  return ranges;
}

/** A spot on the page: where its passage's paragraph starts. */
export interface PlacedSpot {
  spot: ProofSpot;
  /** The start of its passage's paragraph's text. */
  at: number;
}

/**
 * The spots still open on the page, each where its passage's paragraph
 * starts: one whose passage is gone, or whose paragraph's top-level block
 * an image already follows (its spot was filled), isn't.
 */
export function openSpotPlaces(doc: PmNode, spots: readonly ProofSpot[]): PlacedSpot[] {
  return spots.flatMap((spot) => {
    const [range] = textRanges(doc, spot.passage, spot.block);
    if (!range) return [];
    const $from = doc.resolve(range.from);
    if (doc.maybeChild($from.index(0) + 1)?.type.name === 'image') return [];
    return [{ spot, at: $from.start() }];
  });
}

/**
 * A page's HTML as the editor's document, with the nodes that shape it (its
 * marks and decorations aside), for the server's go-live gate. Needs a DOM:
 * withContentDom's on the server.
 */
export function pageDoc(html: string): PmNode {
  const schema = getSchema([
    StarterKit.configure(EDITOR_STARTER_KIT),
    TableKit.configure({ table: { resizable: false } }),
    Image,
    JsonLd,
    HtmlBlockNode,
  ]);
  const holder = contentDom().document.createElement('div');
  holder.innerHTML = html;
  return PmDOMParser.fromSchema(schema).parse(holder);
}
