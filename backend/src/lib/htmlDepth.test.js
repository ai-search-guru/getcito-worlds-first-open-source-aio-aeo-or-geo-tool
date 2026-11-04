import { describe, expect, it } from 'vitest';

import { MAX_HTML_DEPTH, nestsTooDeep } from './htmlDepth.js';

describe('nestsTooDeep', () => {
  it('passes a page as deep as a browser keeps, and stops one deeper', () => {
    expect(nestsTooDeep('<html><body><main><p>Text</p></main></body></html>')).toBe(false);
    expect(nestsTooDeep('<div>'.repeat(MAX_HTML_DEPTH))).toBe(false);
    expect(nestsTooDeep('<div>'.repeat(MAX_HTML_DEPTH + 1))).toBe(true);
    expect(nestsTooDeep('<div><span>'.repeat(10), 15)).toBe(true);
  });

  it('closes what a browser closes: an unclosed paragraph or item, and empty elements', () => {
    expect(nestsTooDeep('<p>one '.repeat(5_000))).toBe(false);
    expect(nestsTooDeep(`<ul>${'<li>item '.repeat(5_000)}</ul>`)).toBe(false);
    expect(nestsTooDeep('<br><img src="a.png">'.repeat(5_000))).toBe(false);
    expect(nestsTooDeep(`${'<div></div>'.repeat(5_000)}`)).toBe(false);
  });

  it('reads a long page in one pass, and stops a deep one at the limit', () => {
    nestsTooDeep('<p>warm</p>');
    const started = Date.now();
    expect(nestsTooDeep('<div>'.repeat(600_000))).toBe(true);
    expect(nestsTooDeep('<ul>'.repeat(600_000))).toBe(true);
    expect(
      nestsTooDeep(`<body>${'<p>Lorem ipsum, dolor sit amet.</p>'.repeat(50_000)}</body>`),
    ).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
