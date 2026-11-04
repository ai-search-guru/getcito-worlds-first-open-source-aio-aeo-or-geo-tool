import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { jsonLdRelevance, jsonLdValidity } from './structure.js';

/** Structured data as the audit reads it: a @graph's nodes in its wrapper's context. */

const page = (json) => ({
  $: cheerio.load(
    `<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head><body></body></html>`,
  ),
});

/** One @graph, the context on the wrapper alone, as WordPress's SEO plugins write it. */
const GRAPH = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebPage', '@id': 'https://acme.example/#webpage', name: 'Pricing' },
    { '@type': 'Organization', '@id': 'https://acme.example/#org', name: 'Acme' },
  ],
};

describe('json-ld-validity', () => {
  it('passes one @graph whose context is on the wrapper alone', () => {
    expect(jsonLdValidity.evaluate(page(GRAPH))).toMatchObject({
      status: 'pass',
      evidence: { wellFormedNodes: 2 },
    });
  });

  it('keeps a node’s own context, and fails a @graph with none anywhere', () => {
    const own = {
      '@context': 'https://example.org/vocab',
      '@graph': [{ '@context': 'https://schema.org', '@type': 'Product', name: 'Boot' }],
    };
    expect(jsonLdValidity.evaluate(page(own)).status).toBe('pass');
    const none = { '@graph': GRAPH['@graph'] };
    expect(jsonLdValidity.evaluate(page(none)).status).toBe('fail');
  });

  it('reads a large shared context once, not once per node', () => {
    // About 500 KB: a wrapper context of ~250 KB and thousands of tiny nodes.
    const vocab = {};
    for (let i = 0; i < 7_300; i++) vocab[`t${i}`] = `https://schema.org/T${i}`;
    const nodes = [];
    for (let i = 0; i < 9_500; i++) nodes.push({ '@type': 'Thing', n: i });
    const big = { '@context': ['https://schema.org', vocab], '@graph': nodes };
    const started = Date.now();
    expect(jsonLdValidity.evaluate(page(big)).status).toBe('pass');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('json-ld-relevance', () => {
  it('reads the types inside a @graph', () => {
    expect(jsonLdRelevance.evaluate(page(GRAPH)).status).not.toBe('fail');
  });
});
