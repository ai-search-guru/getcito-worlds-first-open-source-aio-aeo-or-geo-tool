import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { scoreAudit } from './scorer.js';
import { classifyLinks, jsonLd, countPhrases } from './signals/helpers.js';
import { jsonLdPresence, h1Quality } from './signals/structure.js';
import { https, metaDescription } from './signals/trust.js';
import { length, readability } from './signals/content.js';
import { readingBlocks, readingLevel } from './signals/readability.js';
import { withRetry } from '../retry.js';

/** Build a minimal audit context from an HTML string (no network). */
function ctxFromHtml(html, extra = {}) {
  const text = cheerio.load(html)('body').text().replace(/\s+/g, ' ').trim();
  return {
    url: 'https://example.com/page',
    origin: 'https://example.com',
    protocol: 'https',
    statusCode: 200,
    html,
    htmlBytes: Buffer.byteLength(html, 'utf8'),
    $: cheerio.load(html),
    text,
    wordCount: text ? text.split(/\s+/).length : 0,
    robotsTxt: null,
    llmsTxt: null,
    now: Date.UTC(2026, 0, 1),
    ...extra,
  };
}

describe('scoreAudit', () => {
  it('averages within a category and normalizes the total over evaluated categories', () => {
    const results = [
      { key: 'json-ld-presence', status: 'pass', score: 1 }, // structure
      { key: 'h1-quality', status: 'fail', score: 0 }, // structure
      { key: 'https', status: 'pass', score: 1 }, // trust
    ];
    const { totalScore, categoryScores } = scoreAudit(results);

    expect(categoryScores.structure.score).toBeCloseTo(0.5, 5);
    expect(categoryScores.structure.evaluated).toBe(2);
    expect(categoryScores.structure.total).toBe(13);
    expect(categoryScores.trust.score).toBe(1);
    // (0.25*0.5 + 0.10*1) / (0.25 + 0.10) = 0.643
    expect(totalScore).toBeCloseTo(0.6428, 3);
  });

  it('excludes na signals and reports null for categories with no evaluated signals', () => {
    const results = [
      { key: 'https', status: 'pass', score: 1 },
      { key: 'json-ld-presence', status: 'na', score: null },
    ];
    const { categoryScores } = scoreAudit(results);
    expect(categoryScores.structure.score).toBeNull();
    expect(categoryScores.structure.evaluated).toBe(0);
    expect(categoryScores.trust.score).toBe(1);
  });
});

// Shared with frontend/src/lib/content/readability.test.ts: Flesch 82 in both.
const FIXTURE = `<h1>How to brew pour-over coffee at home</h1>
<p>Pour-over coffee is simple to make, and it tastes clean and bright. You need a dripper, a paper filter, a kettle and fresh beans. Most people wanted a cup that tasted like the café, so we created this guide.</p>
<h2>What you need</h2>
<ul>
<li>A dripper, e.g. a ceramic cone or a flat-bottom brewer.</li>
<li>Twenty grams of medium-fine coffee for one large mug.</li>
<li>Water just off the boil, around ninety-four degrees.</li>
</ul>
<h2>Step by step</h2>
<p>Rinse the filter with hot water first. This removes the papery taste and warms the dripper. Then add the coffee and shake it level.</p>
<p>Start with a short pour, just enough to wet the grounds. Wait thirty seconds while the coffee blooms. Fresh coffee releases gas, and the bloom lets it escape before the main pour.</p>
<p>Pour slowly in small circles, keeping the water level steady. The whole brew should take about three minutes. If it runs faster, grind finer; if it stalls, grind coarser.</p>
<blockquote><p>"Taste is the only rule that matters," says our head roaster. "Adjust one thing at a time."</p></blockquote>
<h2>Common mistakes</h2>
<p>Many beginners pour too fast, which makes a weak and sour cup. Others use water that is far too hot, which makes the coffee bitter. A beautiful, quiet morning ritual needs a little patience. Measure your coffee, watch the clock and keep notes on each cup.</p>`;

const frame = (main, links = 3) =>
  `<!doctype html><html><body><nav><ul>${'<li><a href="/x">Menu link</a></li>'.repeat(links)}</ul></nav><main><article>${main}</article></main><footer><ul>${'<li><a href="/y">Footer link</a></li>'.repeat(links)}</ul></footer></body></html>`;

/** The fixture's reading level, as the editor reads it: its formula and score, then its parts. */
const FIXTURE_READ = {
  language: 'en',
  formula: 'flesch',
  readingScore: 82,
  wordsPerSentence: 10.2,
  syllablesPerWord: 1.4,
  lettersPerWord: 4.4,
  wordsPerParagraph: 34,
  mobileLinesPerParagraph: 5,
};

describe('readability (as the editor reads it)', () => {
  it('scores the page the editor’s test reads, as the editor does', () => {
    expect(Math.round(readingLevel(readingBlocks(FIXTURE), 'en').score)).toBe(82);
    // Over 70 reads simpler than most readers want: a warning, never a fail.
    expect(readability.evaluate(ctxFromHtml(frame(FIXTURE)))).toEqual({
      status: 'warn',
      score: 0.5,
      evidence: FIXTURE_READ,
    });
  });

  it('reads no menus or footer: a page with little text of its own has no score', () => {
    const page = frame('<h1>Blue mug</h1><p>A blue mug for coffee, tea and cocoa.</p>', 40);
    expect(readability.evaluate(ctxFromHtml(page))).toEqual({
      status: 'na',
      score: null,
      evidence: { reason: 'not enough text' },
    });
  });

  it('reads a page builder’s div text as the editor’s import does', () => {
    const divs = FIXTURE.replace(/<(\/?)p>/g, '<$1div>');
    expect(readability.evaluate(ctxFromHtml(frame(divs))).evidence).toMatchObject({
      readingScore: 82,
    });
  });

  it('reads no page past 2 MB once its scripts and styles are gone', () => {
    const big = frame(`${FIXTURE}<script>${'x'.repeat(3_000_000)}</script>`);
    expect(readability.evaluate(ctxFromHtml(big)).evidence).toEqual(FIXTURE_READ);
    const huge = frame(`${FIXTURE}<div>${'word '.repeat(450_000)}</div>`);
    expect(readability.evaluate(ctxFromHtml(huge))).toEqual({
      status: 'na',
      score: null,
      evidence: { reason: 'page too large to read' },
    });
  });

  it('reads a page in its language: Ateşman for Turkish', () => {
    const tr =
      '<html lang="tr"><body><main><article><h1>Kapadokya gezimiz</h1>' +
      "<p>Geçen bahar Kapadokya'yı üç günde gezdik. Yolculuğu iki ay önceden planladık. Uçak biletlerini erken aldık ve küçük bir taş otelde kaldık. İlk sabah erkenden kalktık. Balonları izlemek için tepeye çıktık. Gökyüzü yüzlerce renkli balonla doldu. O an çok mutlu olduk.</p>" +
      '</article></main></body></html>';
    expect(readability.evaluate(ctxFromHtml(tr))).toMatchObject({
      status: 'pass',
      evidence: { language: 'tr', formula: 'atesman' },
    });
  });

  it('gives no score in a language written without spaces between words', () => {
    const ja = `<html lang="ja"><body><main><article><p>${'小さなチームは、今月、成約できる商談を見て、売上を予測します。'.repeat(10)}</p></article></main></body></html>`;
    expect(readability.evaluate(ctxFromHtml(ja))).toMatchObject({
      status: 'na',
      evidence: { language: 'ja' },
    });
  });
});

describe('helpers', () => {
  it('classifyLinks splits internal vs external', () => {
    const ctx = ctxFromHtml(
      `<a href="/about">a</a><a href="https://example.com/x">b</a>
       <a href="https://other.com/y">c</a><a href="#frag">d</a><a href="mailto:x@y.com">e</a>`,
    );
    const { internal, external } = classifyLinks(ctx);
    expect(internal.length).toBe(2); // /about + example.com/x
    expect(external.length).toBe(1); // other.com
  });

  it('jsonLd parses blocks and counts valid ones', () => {
    const ctx = ctxFromHtml(
      `<script type="application/ld+json">{"@type":"Article"}</script>
       <script type="application/ld+json">not json</script>`,
    );
    const { total, valid, nodes } = jsonLd(ctx);
    expect(total).toBe(2);
    expect(valid).toBe(1);
    expect(nodes).toHaveLength(1);
  });

  it('countPhrases counts case-insensitive occurrences', () => {
    expect(countPhrases('We tested it. Then WE TESTED again.', ['we tested'])).toBe(2);
  });

  it('countPhrases matches phrases regardless of phrase casing', () => {
    expect(countPhrases('We tested it.', ['We Tested'])).toBe(1);
  });

  it('countPhrases skips empty phrases', () => {
    expect(countPhrases('anything', [''])).toBe(0);
  });
});

describe('withRetry', () => {
  it('returns the value on first success without retrying', async () => {
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls += 1;
        return 'ok';
      },
      { attempts: 3, baseDelayMs: 0 },
    );
    expect(out).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries transient failures then succeeds', async () => {
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('transient');
        return 'recovered';
      },
      { attempts: 3, baseDelayMs: 0 },
    );
    expect(out).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('throws the last error after exhausting attempts', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('always');
        },
        { attempts: 2, baseDelayMs: 0 },
      ),
    ).rejects.toThrow('always');
    expect(calls).toBe(2);
  });
});

describe('deterministic signals', () => {
  it('h1-quality: pass for one well-sized H1, fail for none', () => {
    const good = h1Quality.evaluate(ctxFromHtml('<h1>The Best Running Shoes for Marathons</h1>'));
    expect(good.status).toBe('pass');
    expect(good.score).toBe(1);
    expect(h1Quality.evaluate(ctxFromHtml('<p>no heading</p>')).status).toBe('fail');
  });

  it('json-ld-presence: pass when a block exists', () => {
    const r = jsonLdPresence.evaluate(
      ctxFromHtml('<script type="application/ld+json">{"@type":"Article"}</script>'),
    );
    expect(r.status).toBe('pass');
  });

  it('https: pass over TLS without mixed content, warn with an http asset', () => {
    expect(https.evaluate(ctxFromHtml('<img src="https://x/i.png">')).status).toBe('pass');
    const mixed = https.evaluate(ctxFromHtml('<img src="http://x/i.png">'));
    expect(mixed.status).toBe('warn');
    expect(https.evaluate(ctxFromHtml('<p>x</p>', { protocol: 'http' })).status).toBe('fail');
  });

  it('meta-description: pass for 80–160 chars, fail when absent', () => {
    const desc = 'x'.repeat(120);
    expect(
      metaDescription.evaluate(ctxFromHtml(`<meta name="description" content="${desc}">`)).status,
    ).toBe('pass');
    expect(metaDescription.evaluate(ctxFromHtml('<p>x</p>')).status).toBe('fail');
  });

  it('length: pass for 800–3000 words', () => {
    expect(length.evaluate(ctxFromHtml('<p>x</p>', { wordCount: 1200 })).status).toBe('pass');
    expect(length.evaluate(ctxFromHtml('<p>x</p>', { wordCount: 100 })).status).toBe('fail');
  });
});
