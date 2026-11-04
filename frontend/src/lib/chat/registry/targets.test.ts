// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { pageChanges } from './targets';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

/** update_draft's card summary (W2-07): what a change does to a page, in short. */
describe('pageChanges', () => {
  it('counts words and names the headings added and removed', () => {
    expect(
      pageChanges(
        '<h1>FAQ</h1><p>Old text here.</p><h2>Old FAQ</h2><script>var a = 1;</script>',
        '<h1>FAQ</h1><p>New text, a little longer.</p><H2 class="x">Plans for teams</H2><style>p{}</style>',
      ),
    ).toBe('Page changes: 6 → 9 words · headings: +“Plans for teams”, −“Old FAQ”');
    expect(pageChanges('<h1>A</h1>', '<h1>A</h1><p>b</p>')).toBe(
      'Page changes: 1 → 2 words · headings unchanged',
    );
  });

  it('stays fast on a page of unclosed tags (the model writes the page it sends)', () => {
    // 200k characters, under the input's 500k cap. A lazy match up to a close that
    // never comes made this take tens of seconds, on the card's way to the person.
    for (const unit of ['<h1 ', '<h2>', '<script ', '<style>', '<']) {
      const page = unit.repeat(Math.floor(200_000 / unit.length));
      const started = performance.now();
      pageChanges('<p>Before</p>', page);
      pageChanges(page, '<p>After</p>');
      expect(performance.now() - started, unit).toBeLessThan(1000);
    }
  });
});
