import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { FEATURE_CHECKS, bodyText, featureGaps, pageFeatures } from './pageFeatures.js';
import { signalRegistry } from '../audit/signals/index.js';

/**
 * What Site Audit's checks find on a page read, and what competitor pages
 * have that the brand's doesn't (learning C1). No supabase mock on purpose:
 * this module has to load without the SUPABASE_* env, as in CI, for the
 * brief and Improve that read it.
 */

/** Enough words that what was read is a page, not a wall. */
const PROSE = `<p>${'A kettle boils water quickly and safely for tea. '.repeat(14)}</p>`;
const FAQ_PAGE = `<html><head><script type="application/ld+json">${JSON.stringify({
  '@type': 'FAQPage',
  mainEntity: [{ '@type': 'Question' }, { '@type': 'Question' }],
})}</script></head><body><h1>Best kettles</h1><h2>Which kettle?</h2>${PROSE}
<table><thead><tr><th>Kettle</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table></body></html>`;
const WALL_PAGE = '<html><body><p>We use cookies. Accept to continue.</p></body></html>';

describe('FEATURE_CHECKS', () => {
  it("are Site Audit checks, none of them reading the site's robots.txt or llms.txt", () => {
    const keys = new Set(signalRegistry.map((signal) => signal.key));
    expect(FEATURE_CHECKS.filter((key) => !keys.has(key))).toEqual([]);
    expect(FEATURE_CHECKS).not.toContain('ai-bot-access');
    expect(FEATURE_CHECKS).not.toContain('llms-txt-presence');
  });
});

describe('pageFeatures', () => {
  it("runs Site Audit's checks over a page read here", async () => {
    const { words, checks } = await pageFeatures('https://rival.com/kettles', FAQ_PAGE);
    expect(words).toBeGreaterThan(0);
    expect(checks['faq-schema']).toBe('pass');
    expect(checks.tables).toBe('pass');
    expect(Object.keys(checks).sort()).toEqual([...FEATURE_CHECKS].sort());
  });

  it('reads a consent wall or an empty page as no page at all', async () => {
    expect(await pageFeatures('https://rival.com/kettles', WALL_PAGE)).toBeNull();
    expect(
      await pageFeatures('https://rival.com/kettles', '<html><body></body></html>'),
    ).toBeNull();
  });
});

describe('featureGaps', () => {
  const page = (passing) => ({
    checks: Object.fromEntries(
      FEATURE_CHECKS.map((key) => [key, passing.includes(key) ? 'pass' : 'fail']),
    ),
  });

  it("names the checks at least half the competitor pages pass that the brand's page doesn't", () => {
    const gaps = featureGaps(
      [page(['faq-schema', 'tables']), page(['faq-schema']), page(['lists'])],
      page(['tables']),
    );
    expect(gaps.map((gap) => [gap.key, gap.competitors, gap.of])).toEqual([['faq-schema', 2, 3]]);
    expect(gaps[0].label).toEqual(expect.any(String));
  });

  it('names every such check when no page of the brand was read', () => {
    expect(
      featureGaps([page(['tables']), page(['tables', 'lists'])], null).map((gap) => gap.key),
    ).toEqual(['tables', 'lists']);
  });

  it('compares nothing from fewer than two competitor pages', () => {
    expect(featureGaps([page(['tables'])], null)).toEqual([]);
    expect(featureGaps([page(['tables'])], page([]))).toEqual([]);
    expect(featureGaps([], null)).toEqual([]);
  });
});

describe('reading a page AI cites, whatever it holds', () => {
  it("reads the body's words as Site Audit does, its scripts, styles and drawings left out", () => {
    const html =
      '<html><head><title>T</title><style>a{}</style></head><body><h1>Hi</h1><script>x=1</script>' +
      '<p>a <b>b</b> c</p><svg><text>no</text></svg><noscript>ns</noscript>' +
      '<template><p>tp</p></template>tail</body></html>';
    const removed = cheerio.load(html);
    removed('script, style, noscript, template, svg').remove();
    expect(bodyText(cheerio.load(html))).toBe(removed('body').text());
    expect(bodyText(cheerio.load(html))).toBe('Hia b ctail');
  });

  it('reads a page of tens of thousands of empty styles in a second, not a minute', async () => {
    const html = `<html><body>${PROSE}${'<style></style>'.repeat(100_000)}</body></html>`;
    const started = Date.now();
    expect(await pageFeatures('https://example.com/a', html)).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('reads a page of tens of thousands of empty list items in seconds, not a minute', async () => {
    const html = `<html><body>${PROSE}${'<li></li>'.repeat(40_000)}</body></html>`;
    const started = Date.now();
    expect(await pageFeatures('https://example.com/a', html)).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
