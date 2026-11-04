import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let session: { access_token: string } | null;
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
}));

const { estimateDocument, readAuditEstimate } = await import('./auditEstimate');

const fetchMock = vi.fn();
beforeEach(() => {
  session = { access_token: 'tok' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
const ESTIMATE = {
  score: 62,
  categories: { structure: 78, content: 55, authority: 40, trust: 72, eeat: 48 },
  checks: { page: 18, site: 13, ai: 0 },
};

describe('estimateDocument', () => {
  it('puts the page in a document whose head says its title, description and author', () => {
    const doc = estimateDocument({
      title: 'Cold brew at home',
      html: '<h1>Cold brew at home</h1><p>Steep it cold.</p>',
      metaDescription: 'Steep it cold.',
      author: 'Acme Coffee Team',
    });
    expect(doc).toContain('<title>Cold brew at home</title>');
    expect(doc).toContain('<meta name="description" content="Steep it cold.">');
    expect(doc).toContain('<meta name="author" content="Acme Coffee Team">');
    expect(doc).toContain('<body>\n<h1>Cold brew at home</h1><p>Steep it cold.</p>\n</body>');
  });
});

describe('readAuditEstimate', () => {
  it('reads the estimate for the draft, with the page and nothing else for free', async () => {
    answer(200, ESTIMATE);
    expect(await readAuditEstimate('d1', 'b1', '<html></html>')).toEqual({ estimate: ESTIMATE });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/content-drafts\/d1\/audit-estimate$/);
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ brandId: 'b1', html: '<html></html>' });
  });

  it('asks for the AI checks, and sends their verdicts back after', async () => {
    const verdicts = [{ key: 'direct-answer', status: 'pass' as const, score: 1 }];
    answer(200, { ...ESTIMATE, verdicts });
    expect(await readAuditEstimate('d1', 'b1', 'x', { ai: true })).toEqual({
      estimate: ESTIMATE,
      verdicts,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ ai: true });
    answer(200, ESTIMATE);
    await readAuditEstimate('d1', 'b1', 'x', { verdicts });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      brandId: 'b1',
      html: 'x',
      verdicts,
    });
  });

  it('says why it couldn’t, never throwing', async () => {
    answer(429, { code: 'ai_budget' });
    expect(await readAuditEstimate('d1', 'b1', 'x', { ai: true })).toEqual({ error: 'ai_budget' });
    answer(402, { code: 'no_subscription' });
    expect(await readAuditEstimate('d1', 'b1', 'x', { ai: true })).toEqual({
      error: 'no_subscription',
    });
    answer(502, { code: 'something' });
    expect(await readAuditEstimate('d1', 'b1', 'x')).toEqual({ error: 'failed' });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await readAuditEstimate('d1', 'b1', 'x')).toEqual({ error: 'failed' });
    session = null;
    expect(await readAuditEstimate('d1', 'b1', 'x')).toEqual({ error: 'failed' });
  });
});
