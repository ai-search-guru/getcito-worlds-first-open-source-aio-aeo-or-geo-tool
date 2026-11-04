import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/competitors/suggest: the brand's competitors from a web search
 * of its site and market, and whether the brand itself sells products
 * online, which setup uses to turn on Shopping mode.
 */

const generateObject = vi.fn();
const webResearch = vi.fn();
vi.mock('ai', () => ({ generateObject }));
vi.mock('../lib/aiProvider.js', () => ({ resolveModel: vi.fn(() => 'model') }));
vi.mock('../lib/webResearch.js', () => ({ webResearch }));
vi.mock('../lib/retry.js', () => ({ withRetry: (fn) => fn() }));

const { default: router } = await import('./competitors.js');

const competitors = [
  { name: 'Blue Bottle', domain: 'bluebottlecoffee.com' },
  { name: 'Trade', domain: 'drinktrade.com' },
  { name: 'Atlas Coffee Club', domain: 'atlascoffeeclub.com' },
];

let server;
let baseUrl;

beforeEach(async () => {
  vi.clearAllMocks();
  webResearch.mockResolvedValue({ text: 'research', searched: true, sources: 3 });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/competitors', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const suggest = (body) =>
  fetch(`${baseUrl}/api/competitors/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/competitors/suggest', () => {
  it('returns the competitors and whether the brand sells online', async () => {
    generateObject.mockResolvedValue({ object: { competitors, isEcommerce: true } });
    const res = await suggest({
      brandName: 'Acme Coffee',
      website: 'acmecoffee.com',
      region: 'US',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ competitors, isEcommerce: true });

    // The research asks it, and the structuring step reads it from there.
    const [, researchPrompt] = webResearch.mock.calls[0];
    expect(researchPrompt).toContain(
      '"Acme Coffee" itself sells products that shoppers buy online',
    );
    // Optional, so an answer without it still structures the competitors.
    const { schema } = generateObject.mock.calls[0][0];
    expect(schema.safeParse({ competitors }).success).toBe(true);
    expect(schema.shape.isEcommerce.safeParse(true).success).toBe(true);
  });

  it('says no when the answer has no verdict', async () => {
    generateObject.mockResolvedValue({ object: { competitors } });
    const res = await suggest({ brandName: 'Acme Analytics' });
    expect(await res.json()).toEqual({ competitors, isEcommerce: false });
  });

  it('needs a brand name', async () => {
    expect((await suggest({})).status).toBe(400);
    expect(webResearch).not.toHaveBeenCalled();
  });

  it('refuses a body past the setup limits before asking any model (#1611)', async () => {
    const res = await suggest({ brandName: 'Acme Coffee', description: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(webResearch).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();
  });
});
