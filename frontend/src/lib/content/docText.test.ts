import { describe, expect, it } from 'vitest';
import { openSpotPlaces, pageDoc, textRanges } from './docText';
import { encodeHtmlBlock } from './htmlAllowlist';

/**
 * A page read into the editor's document on the server (the go-live gate):
 * the same nodes the editor parses, so the visual proof spots still open and
 * a text's places count the same as in the editor.
 */

const RAIN = {
  passage: 'keeps your gear dry in any weather',
  block: 'The Ridge 28 keeps your gear dry in any weather.',
  image: 'On a wet hike',
  alt: 'Wet hike',
};
const SEAMS = {
  passage: 'welded seams',
  block: 'Every seam is welded seams-first and taped.',
  image: 'The seams',
  alt: 'Seams',
};

describe('pageDoc', () => {
  it('reads the page into the editor’s nodes: headings, tables, images, JSON-LD and HTML blocks', () => {
    const doc = pageDoc(
      `<h2>Specs</h2><table><tbody><tr><td>Weight</td></tr></tbody></table><img src="https://acme.com/a.jpg" alt="A"><script type="application/ld+json">{"@type":"Product"}</script><div data-html-block="${encodeHtmlBlock('<b>hi</b>')}"></div><hr><pre><code>x</code></pre>`,
    );
    const types: string[] = [];
    doc.forEach((node) => types.push(node.type.name));
    expect(types.slice(0, 5)).toEqual(['heading', 'table', 'image', 'jsonLd', 'htmlBlock']);
    // No rule or code block in the editor's pages.
    expect(types).not.toContain('horizontalRule');
    expect(types).not.toContain('codeBlock');
  });

  it('counts the spots still open as the editor does: a spot whose paragraph an image follows is filled', () => {
    const doc = pageDoc(
      `<p>${RAIN.block}</p><p>${SEAMS.block}</p><img src="https://acme.com/seams.jpg" alt="Seams">`,
    );
    expect(openSpotPlaces(doc, [RAIN, SEAMS]).map((place) => place.spot.passage)).toEqual([
      RAIN.passage,
    ]);
    expect(textRanges(doc, 'welded seams')).toHaveLength(1);
  });
});
