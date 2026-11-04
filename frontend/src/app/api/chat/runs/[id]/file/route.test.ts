// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * Save to Files and Download on an answer (CHAT-06 items 32–37): a
 * read-only workspace can't file (402), a full one files nothing new (409),
 * a filed answer answers its file; a download names its file and is never
 * kept; an answer the person can't open is 404.
 */

const ACTOR = { userId: 'user-1', email: null, organizationId: 'org-1' };
const RUN = '44444444-4444-4444-8444-444444444444';

const state = vi.hoisted(() => ({ refused: false }));
vi.mock('@/lib/subscriptionGuard', () => ({
  failedCallResponse: () => NextResponse.json({ error: 'Failed' }, { status: 500 }),
  writeRefusal: async () =>
    state.refused
      ? NextResponse.json({ ok: false, code: 'subscription_inactive' }, { status: 402 })
      : null,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/chat/runApi', async (original) => ({
  ...(await original<typeof import('@/lib/chat/runApi')>()),
  chatActor: async () => ACTOR,
}));
const files = vi.hoisted(() => ({
  saveRunAnswer: vi.fn(),
  readRunAnswer: vi.fn(),
  readRunFile: vi.fn(),
  answerToDraft: vi.fn(),
}));
vi.mock('@/lib/chat/fileStore', () => files);
const exporter = vi.hoisted(() => ({ exportAnswer: vi.fn() }));
vi.mock('@/lib/chat/exportFile', () => exporter);
const fileExport = vi.hoisted(() => ({ exportChatFile: vi.fn() }));
vi.mock('@/lib/chat/fileExport', () => fileExport);

const fileRoute = await import('./route');
const exportRoute = await import('../export/route');
const deliverableRoute = await import('../files/[n]/route');
const draftRoute = await import('../content-draft/route');
const chatExportRoute = await import('../../../conversations/[id]/export/route');

const params = (id = RUN) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.refused = false;
  files.saveRunAnswer.mockReset();
  files.readRunAnswer.mockReset();
  files.readRunFile.mockReset();
  files.answerToDraft.mockReset();
  fileExport.exportChatFile.mockReset();
  exporter.exportAnswer.mockReset();
});

describe('POST /api/chat/runs/{id}/file', () => {
  it('files the answer, and answers a filed one with its file', async () => {
    files.saveRunAnswer.mockResolvedValueOnce({
      ok: true,
      already: false,
      file: { id: 'f1', title: 'Why?' },
    });
    const res = await fileRoute.POST(new Request('http://x'), params());
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, file: { id: 'f1' } });
    expect(files.saveRunAnswer).toHaveBeenCalledWith(ACTOR, RUN);

    files.saveRunAnswer.mockResolvedValueOnce({
      ok: true,
      already: true,
      file: { id: 'f1', title: 'Why?' },
    });
    expect((await fileRoute.POST(new Request('http://x'), params())).status).toBe(200);
  });

  it('refuses a read-only workspace, a full one, and an answer it can’t open', async () => {
    state.refused = true;
    expect((await fileRoute.POST(new Request('http://x'), params())).status).toBe(402);
    expect(files.saveRunAnswer).not.toHaveBeenCalled();
    state.refused = false;

    files.saveRunAnswer.mockResolvedValueOnce({ ok: false, failure: 'storage_full' });
    const full = await fileRoute.POST(new Request('http://x'), params());
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ code: 'storage_full' });

    files.saveRunAnswer.mockResolvedValueOnce({ ok: false, failure: 'not_found' });
    expect((await fileRoute.POST(new Request('http://x'), params())).status).toBe(404);
    expect((await fileRoute.POST(new Request('http://x'), params('nope'))).status).toBe(404);
  });
});

describe('GET /api/chat/runs/{id}/export', () => {
  const read = { answer: { markdown: 'Hi' } };

  it('downloads the format, named, never kept', async () => {
    files.readRunAnswer.mockResolvedValue(read);
    exporter.exportAnswer.mockResolvedValue({
      fileName: 'why-2026-10-30.md',
      contentType: 'text/markdown; charset=utf-8',
      body: new TextEncoder().encode('# Why'),
    });
    const res = await exportRoute.GET(
      new Request('https://app.example/api/chat/runs/x/export?format=md'),
      params(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="why-2026-10-30.md"');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.text()).toBe('# Why');
    expect(files.readRunAnswer).toHaveBeenCalledWith(ACTOR, RUN, 'https://app.example');
  });

  it('refuses an unknown format, an answer it can’t open, and a format not offered', async () => {
    const get = (format: string) =>
      exportRoute.GET(new Request(`https://app.example/x?format=${format}`), params());
    expect((await get('exe')).status).toBe(400);
    files.readRunAnswer.mockResolvedValueOnce(null);
    expect((await get('pdf')).status).toBe(404);
    files.readRunAnswer.mockResolvedValueOnce(read);
    exporter.exportAnswer.mockResolvedValueOnce(null);
    expect((await get('csv')).status).toBe(404);
  });

  it('gives a PDF time to render: an answer or a chat may run to many pages', () => {
    // A 1,000-row table takes about 14 s to lay out, and a chat holds many answers.
    expect(exportRoute.maxDuration).toBe(300);
    expect(chatExportRoute.maxDuration).toBe(300);
  });
});

describe('GET /api/chat/runs/{id}/files/{n}', () => {
  const get = (n: string, format: string) =>
    deliverableRoute.GET(new Request(`https://app.example/x?format=${format}`), {
      params: Promise.resolve({ id: RUN, n }),
    });

  it('downloads the run’s n-th deliverable in a format it offers', async () => {
    files.readRunFile.mockResolvedValue({ title: 'Pricing FAQ' });
    fileExport.exportChatFile.mockResolvedValue({
      fileName: 'pricing-faq-2026-10-30.html',
      contentType: 'text/html; charset=utf-8',
      body: new TextEncoder().encode('<h1>Pricing FAQ</h1>'),
    });
    const res = await get('1', 'html');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="pricing-faq-2026-10-30.html"',
    );
    expect(files.readRunFile).toHaveBeenCalledWith(ACTOR, RUN, 1, 'https://app.example');
  });

  it('refuses a bad place or format, and a file it can’t open', async () => {
    expect((await get('0', 'md')).status).toBe(404);
    expect((await get('x', 'md')).status).toBe(404);
    expect((await get('1', 'exe')).status).toBe(400);
    files.readRunFile.mockResolvedValueOnce(null);
    expect((await get('1', 'md')).status).toBe(404);
  });
});

describe('POST /api/chat/runs/{id}/content-draft', () => {
  const post = (body: unknown = {}) =>
    draftRoute.POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify(body) }),
      params(),
    );

  it('makes the answer a draft and says where to open it', async () => {
    files.answerToDraft.mockResolvedValueOnce({ draftId: 'd1' });
    const res = await post({ brandId: '22222222-2222-4222-8222-222222222222' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, href: '/dashboard/content/editor/d1' });
    expect(files.answerToDraft).toHaveBeenCalledWith(
      ACTOR,
      RUN,
      '22222222-2222-4222-8222-222222222222',
    );
  });

  it('takes the demo brand’s id, made by hand and not an RFC 4122 one', async () => {
    files.answerToDraft.mockResolvedValueOnce({ draftId: 'd1' });
    expect((await post({ brandId: '22222222-2222-2222-2222-222222222222' })).status).toBe(201);
  });

  it('refuses a read-only workspace, a missing brand and an answer it can’t open', async () => {
    state.refused = true;
    expect((await post()).status).toBe(402);
    state.refused = false;
    files.answerToDraft.mockResolvedValueOnce({ failure: 'no_brand' });
    const noBrand = await post();
    expect(noBrand.status).toBe(400);
    expect(await noBrand.json()).toMatchObject({ code: 'no_brand' });
    files.answerToDraft.mockResolvedValueOnce({ failure: 'not_found' });
    expect((await post()).status).toBe(404);
    expect((await post({ brandId: 'nope' })).status).toBe(400);
  });
});
