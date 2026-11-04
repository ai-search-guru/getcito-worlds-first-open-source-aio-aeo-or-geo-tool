// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';
import {
  AUTHORS,
  DRAFT_ID,
  DRAFT_ROW,
  EXPECTED_HTML,
  JSON_LD_PARSED,
} from './__fixtures__/packageDraft';
import { htmlBlockElement } from '@/lib/content/htmlAllowlist';

/**
 * get_content_draft_package (B5) on the server, where there is no browser
 * window: the editor's helpers read the page with jsdom's, and the page is
 * the one the editor's Send to CMS makes (contentPackage.editor.test.ts).
 */

let draft: Record<string, unknown> | null;
const draftFilters: [string, unknown][] = [];
// A database without 00448: a read of schema_left_out fails as Postgres says.
let before00448 = false;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => {
      let columns = '';
      const chain = {
        select: (read: string) => ((columns = read), chain),
        eq: (column: string, value: unknown) => (draftFilters.push([column, value]), chain),
        maybeSingle: async () =>
          before00448 && columns.includes('schema_left_out')
            ? {
                data: null,
                error: {
                  code: '42703',
                  message: 'column content_drafts.schema_left_out does not exist',
                },
              }
            : { data: draft, error: null },
      };
      return chain;
    },
  },
}));
const readContentAuthors = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/authorsRead', () => ({ readContentAuthors }));

const { getContentDraftPackageFor } = await import('./contentPackage');
const { createMcpServer } = await import('./server');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

beforeEach(() => {
  draft = { ...DRAFT_ROW };
  draftFilters.length = 0;
  before00448 = false;
  readContentAuthors.mockReset().mockResolvedValue(AUTHORS);
  // The authors, and so the byline, are read once Quality is live.
  vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '1');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getContentDraftPackageFor', () => {
  it('gives the page the editor’s Send to CMS makes, read with jsdom on the server', async () => {
    expect(typeof window).toBe('undefined');
    const result = await getContentDraftPackageFor(auth, DRAFT_ID);
    expect(result).toEqual({
      draft_id: DRAFT_ID,
      title: 'Cold brew at home: a slow, smooth coffee',
      slug: 'cold-brew-at-home',
      meta_title: 'Cold brew at home: a slow, smooth coffee',
      meta_description: 'Cold brew is coffee steeped in cold water for twelve to eighteen hours.',
      html: EXPECTED_HTML,
      json_ld: [JSON_LD_PARSED],
      author: 'Ada Lovelace',
      reviewer: null,
      featured_image: { src: 'https://acme.example/cold-brew.jpg', alt: 'A jar of cold brew' },
      source_url: null,
    });
    expect(draftFilters).toContainEqual(['brands.organization_id', 'org-1']);
    expect(readContentAuthors).toHaveBeenCalledWith(expect.anything(), 'org-1', expect.anything());
  });

  it('adds an article its Article schema with the author, unless left out (00448)', async () => {
    draft = { ...DRAFT_ROW, body_html: '<h1>Cold brew</h1><p>Steep it slowly.</p>' };
    delete draft.schema_left_out;
    // The web ahead of its migration: read without the column, as not left out.
    before00448 = true;
    const result = await getContentDraftPackageFor(auth, DRAFT_ID);
    expect('json_ld' in result && result.json_ld).toEqual([
      expect.objectContaining({
        '@type': 'Article',
        author: expect.objectContaining({ '@type': 'Person', name: 'Ada Lovelace' }),
      }),
    ]);

    before00448 = false;
    draft = { ...draft, schema_left_out: true };
    const leftOut = await getContentDraftPackageFor(auth, DRAFT_ID);
    expect('json_ld' in leftOut && leftOut.json_ld).toEqual([]);
  });

  it('cleans what a CMS mustn’t run, as the editor does', async () => {
    draft = {
      ...DRAFT_ROW,
      body_html:
        '<h1>Cold brew</h1><p onclick="steal()">Steep it slowly.<script>steal()</script></p>',
    };
    const result = await getContentDraftPackageFor(auth, DRAFT_ID);
    expect('html' in result && result.html).not.toMatch(/onclick|steal/);
  });

  it('passes an HTML block as written, as Copy HTML and Send to CMS do', async () => {
    // A block's code is the user's own: a CMS gets it as it is, script and all.
    const code =
      '<script src="https://widgets.example/w.js"></script><iframe src="https://video.example/embed/1"></iframe><a href="javascript:openChat()">Chat</a>';
    draft = {
      ...DRAFT_ROW,
      body_html: `<h1>Cold brew</h1><p onclick="steal()">Steep it slowly.</p>${htmlBlockElement(code)}`,
    };
    const result = await getContentDraftPackageFor(auth, DRAFT_ID);
    const html = 'html' in result ? result.html : '';
    expect(html).toContain(code);
    // The page's own content is still cleaned.
    expect(html).not.toMatch(/onclick|steal/);
  });

  it('says why a page can’t go yet', async () => {
    draft = {
      ...DRAFT_ROW,
      body_html: '<h1>Cold brew</h1><p>It steeps for [number] hours.</p>',
    };
    expect(await getContentDraftPackageFor(auth, DRAFT_ID)).toMatchObject({
      error: 'not_ready',
      problem: 'placeholders',
    });
  });

  it('finds no draft of another organization, nor an archived one', async () => {
    draft = null;
    expect(await getContentDraftPackageFor(auth, DRAFT_ID)).toMatchObject({ error: 'not_found' });
    draft = { ...DRAFT_ROW, archived_at: '2026-10-20T10:00:00Z' };
    expect(await getContentDraftPackageFor(auth, DRAFT_ID)).toMatchObject({ error: 'not_found' });
    expect(
      await getContentDraftPackageFor({ ...auth, organizationId: null }, DRAFT_ID),
    ).toMatchObject({ error: 'not_found' });
  });
});

describe('the get_content_draft_package tool', () => {
  it('lists as a read-only tool and answers a page that can’t go yet as the REST route does', async () => {
    const server = createMcpServer(auth);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
      JSON.parse((result.content as { text: string }[])[0].text);

    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'get_content_draft_package');
    expect(tool).toMatchObject({
      title: 'Draft as a CMS-ready page',
      annotations: { readOnlyHint: true, openWorldHint: false },
    });
    // It says HTML blocks come as written, so a client expects their code.
    expect(tool?.description).toContain('HTML blocks are passed as written');
    expect(tool?.description).not.toMatch(/cleaned/);

    const ready = await client.callTool({
      name: 'get_content_draft_package',
      arguments: { draft_id: DRAFT_ID },
    });
    expect(ready.isError).toBeFalsy();
    expect(text(ready)).toMatchObject({ draft_id: DRAFT_ID, html: EXPECTED_HTML });

    draft = { ...DRAFT_ROW, body_html: '<h1>Cold brew</h1><p>It steeps for [number] hours.</p>' };
    const notReady = await client.callTool({
      name: 'get_content_draft_package',
      arguments: { draft_id: DRAFT_ID },
    });
    expect(notReady.isError).toBe(true);
    expect(text(notReady)).toEqual({
      error: expect.stringContaining('[placeholders]'),
      code: 'not_ready',
      problem: 'placeholders',
    });
  });
});

describe('jsdom’s window', () => {
  afterEach(() => {
    vi.doUnmock('jsdom');
    vi.resetModules();
  });

  it('is made again on the next call when the first try fails', async () => {
    vi.resetModules();
    const made = vi.fn();
    vi.doMock('jsdom', async () => {
      const real = await vi.importActual<typeof import('jsdom')>('jsdom');
      return {
        JSDOM: class extends real.JSDOM {
          constructor(html?: string) {
            made();
            if (made.mock.calls.length === 1) throw new Error('jsdom failed to load');
            super(html);
          }
        },
      };
    });
    const { getContentDraftPackageFor: fresh } = await import('./contentPackage');
    await expect(fresh(auth, DRAFT_ID)).rejects.toThrow('jsdom failed to load');
    expect(await fresh(auth, DRAFT_ID)).toMatchObject({ draft_id: DRAFT_ID, html: EXPECTED_HTML });
    expect(made).toHaveBeenCalledTimes(2);
  });
});
