import { describe, expect, it } from 'vitest';
import { pageChangedSince } from './_PageRewrite';

/** Rewrite the page to these rules: whether the page still reads as the agent read it. */
describe('pageChangedSince', () => {
  it('reads the editor’s HTML and stored HTML alike, line breaks and lists included', () => {
    const editor =
      '<h2>Pricing</h2><p>Plans start at $49.</p><ul><li><p>A</p></li><li><p>B</p></li></ul>';
    const stored =
      '<h2>Pricing</h2>\n<p>Plans start at $49.</p>\n<ul>\n<li>A</li>\n<li>B</li>\n</ul>';
    expect(pageChangedSince(editor, stored)).toBe(false);
    // Structured data isn't the page's words.
    expect(
      pageChangedSince(editor, `${stored}<script type="application/ld+json">{"a":1}</script>`),
    ).toBe(false);
  });

  it('says a page with other words changed', () => {
    expect(pageChangedSince('<p>Plans start at $49.</p>', '<p>Plans start at $59.</p>')).toBe(true);
    expect(pageChangedSince('<p>AB</p>', '<p>A</p><p>B</p>')).toBe(true);
  });
});
