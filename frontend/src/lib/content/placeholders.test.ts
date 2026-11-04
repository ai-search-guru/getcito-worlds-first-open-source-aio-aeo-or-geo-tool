import { describe, expect, it } from 'vitest';
import { pagePlaceholders } from './placeholders';

/** Placeholders in a page (Quality spec §4, CE-044): counted for the person to fill. */

describe('pagePlaceholders', () => {
  it('counts each placeholder once, in the lines the editor keeps text in', () => {
    expect(
      pagePlaceholders(
        '<h1>Pour-over</h1>' +
          '<h2>What [name of a real person] uses</h2>' +
          '<p>Use [figure, source] g of coffee and [figure, source] of water.</p>' +
          '<ul><li><p>Ask [name of a real person]</p><ul><li><p>Then [time]</p></li></ul></li></ul>' +
          '<ul><li><blockquote><p>[quote from a real person, with its source]</p></blockquote></li></ul>' +
          '<table><tbody><tr><td><ul><li><p>[price]</p></li></ul></td></tr></tbody></table>',
      ),
    ).toEqual({ count: 7 });
  });

  it('reads none in footnotes, checkboxes, [sic], Markdown links or a page without them', () => {
    expect(
      pagePlaceholders(
        '<p>See note [1] and [2].</p><p>[x] Done, [ ] to do.</p>' +
          '<p>He wrote "teh" [sic].</p><p>Read [the docs](https://acme.com/docs).</p>',
      ),
    ).toEqual({ count: 0 });
    expect(pagePlaceholders('')).toEqual({ count: 0 });
  });

  it("reads a heading's brackets only in the agent's own forms", () => {
    expect(
      pagePlaceholders(
        '<h1>Best CRM tools [2026 Update]</h1><h2>How to brew [Step-by-Step Guide]</h2>' +
          '<h3>The checklist [PDF]</h3><h3>Brew [figure, source, 2025] grams</h3><p>[PDF]</p>',
      ),
    ).toEqual({ count: 2 });
  });
  it('reads a list item written without a paragraph by its own words, once', () => {
    expect(
      pagePlaceholders(
        '<ul><li>Churn fell [figure, source].<ul><li>Then [year].</li></ul></li><li><p>[price]</p></li></ul>',
      ).count,
    ).toBe(3);
  });
});
