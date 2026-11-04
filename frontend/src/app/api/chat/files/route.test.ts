// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Files page's calls (CHAT-06 items 16–19, 26–29): the list with its
 * storage, a file in a format it offers (its main one by default), and
 * Download selected as one .zip: 1 to 50 files, never past 100 MB.
 */

const ACTOR = { userId: 'user-1', email: null, organizationId: 'org-1' };
const FILE = '44444444-4444-4444-8444-444444444444';

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/chat/runApi', async (original) => ({
  ...(await original<typeof import('@/lib/chat/runApi')>()),
  chatActor: async () => ACTOR,
}));
const lister = vi.hoisted(() => ({ listChatFiles: vi.fn() }));
vi.mock('@/lib/chat/fileList', async (original) => ({
  ...(await original<typeof import('@/lib/chat/fileList')>()),
  listChatFiles: lister.listChatFiles,
}));
const files = vi.hoisted(() => ({ readChatFile: vi.fn(), zipChatFiles: vi.fn() }));
vi.mock('@/lib/chat/fileStore', () => files);
const fileExport = vi.hoisted(() => ({ exportChatFile: vi.fn() }));
vi.mock('@/lib/chat/fileExport', () => fileExport);

const listRoute = await import('./route');
const fileRoute = await import('./[id]/route');
const zipRoute = await import('./zip/route');

beforeEach(() => {
  lister.listChatFiles.mockReset();
  files.readChatFile.mockReset();
  files.zipChatFiles.mockReset();
  fileExport.exportChatFile.mockReset();
});

describe('GET /api/chat/files', () => {
  it('lists a page under the chip and the words, and reads a bad query as all files', async () => {
    lister.listChatFiles.mockResolvedValue({ files: [], hasMore: false, storage: {} });
    const res = await listRoute.GET(new Request('http://x/api/chat/files?filter=me&q=faq'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, files: [], hasMore: false, storage: {} });
    expect(lister.listChatFiles.mock.calls[0][2]).toEqual({ filter: 'me', q: 'faq', offset: 0 });
    await listRoute.GET(new Request('http://x/api/chat/files?filter=nope&offset=-3'));
    expect(lister.listChatFiles.mock.calls[1][2]).toEqual({ filter: 'all', q: '', offset: 0 });
  });
});

describe('GET /api/chat/files/{id}', () => {
  const get = (query = '', id = FILE) =>
    fileRoute.GET(new Request(`http://x/api/chat/files/${id}${query}`), {
      params: Promise.resolve({ id }),
    });

  it('downloads the file in its main format, or the one asked for, named by the server', async () => {
    files.readChatFile.mockResolvedValue({ formats: ['html', 'md'] });
    fileExport.exportChatFile.mockResolvedValue({
      fileName: 'pricing-faq-2026-10-30.html',
      contentType: 'text/html; charset=utf-8',
      body: new TextEncoder().encode('<h1>FAQ</h1>'),
    });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="pricing-faq-2026-10-30.html"',
    );
    expect(fileExport.exportChatFile.mock.calls[0][1]).toBe('html');
    await get('?format=md');
    expect(fileExport.exportChatFile.mock.calls[1][1]).toBe('md');
  });

  it('refuses a format it doesn’t know, and a file that isn’t the workspace’s', async () => {
    expect((await get('?format=exe')).status).toBe(400);
    files.readChatFile.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect((await get('', 'nope')).status).toBe(404);
  });
});

describe('POST /api/chat/files/zip', () => {
  const post = (body: unknown) =>
    zipRoute.POST(
      new Request('http://x/api/chat/files/zip', { method: 'POST', body: JSON.stringify(body) }),
    );

  it('answers one .zip and how many files went in', async () => {
    files.zipChatFiles.mockResolvedValue({
      ok: true,
      fileName: 'files-2026-10-30.zip',
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([80, 75]));
          controller.enqueue(new Uint8Array([3, 4]));
          controller.close();
        },
      }),
      count: 2,
    });
    const res = await post({ ids: [FILE, '22222222-2222-2222-2222-222222222222'] });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    expect(res.headers.get('X-File-Count')).toBe('2');
    // The stream goes out as it comes.
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([80, 75, 3, 4]);
  });

  it('refuses none, more than 50, past 100 MB, and none of the workspace’s', async () => {
    expect((await post({ ids: [] })).status).toBe(400);
    expect((await post({ ids: Array.from({ length: 51 }, () => FILE) })).status).toBe(400);
    files.zipChatFiles.mockResolvedValueOnce({ ok: false, failure: 'too_big' });
    expect((await post({ ids: [FILE] })).status).toBe(413);
    files.zipChatFiles.mockResolvedValueOnce({ ok: false, failure: 'not_found' });
    expect((await post({ ids: [FILE] })).status).toBe(404);
  });
});
