import { describe, expect, it } from 'vitest';
import { auditContextOf } from './context.js';
import { runSignals } from './engine.js';

/** A page already read, made the context every signal reads (auditContextOf). */
describe('auditContextOf', () => {
  const html = `<!doctype html><html><head><title>Fresh beans</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Fresh beans"}</script>
<style>body { color: red }</style></head>
<body><h1>Fresh beans</h1><p>Coffee tastes best   soon after roasting.</p><script>track()</script></body></html>`;
  const ctx = auditContextOf({
    url: 'https://shop.example/blog/fresh',
    statusCode: 200,
    html,
    robotsTxt: null,
    llmsTxt: null,
    now: 1_700_000_000_000,
  });

  it('reads the address, the text without scripts or styles, and its words', () => {
    expect(ctx).toMatchObject({
      url: 'https://shop.example/blog/fresh',
      origin: 'https://shop.example',
      protocol: 'https',
      statusCode: 200,
      query: null,
      now: 1_700_000_000_000,
    });
    expect(ctx.text).toContain('Coffee tastes best soon after roasting.');
    expect(ctx.text).not.toMatch(/track\(|color/);
    expect(ctx.wordCount).toBe(ctx.text.split(/\s+/).length);
    expect(ctx.htmlBytes).toBe(Buffer.byteLength(html, 'utf8'));
  });

  it('keeps the JSON-LD in the parsed page for the structural signals', async () => {
    expect(ctx.$('script[type="application/ld+json"]')).toHaveLength(1);
    const results = await runSignals(ctx);
    expect(results.find((r) => r.key === 'json-ld-presence').status).toBe('pass');
  });
});
