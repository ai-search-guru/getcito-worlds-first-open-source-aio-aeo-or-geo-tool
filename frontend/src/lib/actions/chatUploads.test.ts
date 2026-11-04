// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Chat's attachments (W1-13): a one-time address after the app's checks, ready once there, or gone. */

const db = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  orgId: 'org-1',
  status: 'active',
  chat: { id: 'c1', user_id: 'u1' } as { id: string; user_id: string } | null,
  upload: null as Record<string, unknown> | null,
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  deletedRows: 0,
  removed: [] as string[],
  listed: ['up-1'] as string[],
  meta: { size: 2048, mimetype: 'application/pdf' } as Record<string, unknown>,
  bytes: new TextEncoder().encode('%PDF-1.7\n') as Uint8Array,
}));

function sessionQuery(table: string) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) q[m] = () => q;
  q.maybeSingle = async () => ({
    data:
      table === 'profiles'
        ? { organization_id: db.orgId }
        : table === 'organizations'
          ? { subscription_status: db.status }
          : table === 'chat_conversations'
            ? db.chat
            : null,
  });
  return q;
}

function adminQuery() {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is']) q[m] = () => q;
  q.insert = async (row: Record<string, unknown>) => (db.inserted.push(row), { error: null });
  q.update = (row: Record<string, unknown>) => (db.updated.push(row), q);
  q.delete = () => ((db.deletedRows += 1), q);
  q.maybeSingle = async () => ({ data: db.upload });
  q.then = (resolve: (v: unknown) => void) => resolve({ error: null });
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: sessionQuery,
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: adminQuery,
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => ({
          data: { path, token: 'tok' },
          error: null,
        }),
        list: async () => ({
          data: db.listed.map((name) => ({ name, metadata: db.meta })),
          error: null,
        }),
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.test/${path}` },
          error: null,
        }),
        remove: async (paths: string[]) => (db.removed.push(...paths), { error: null }),
      }),
    },
  },
}));

const { finishChatUpload, prepareChatUpload, removeChatUpload } = await import('./chatUploads');

const pdf = { name: 'brief.pdf', type: 'application/pdf', size: 2048 };

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  db.user = { id: 'u1' };
  db.status = 'active';
  db.chat = { id: 'c1', user_id: 'u1' };
  db.upload = null;
  db.inserted = [];
  db.updated = [];
  db.deletedRows = 0;
  db.removed = [];
  db.listed = ['up-1'];
  db.meta = { size: 2048, mimetype: 'application/pdf' };
  db.bytes = new TextEncoder().encode('%PDF-1.7\n');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(db.bytes as BodyInit, { status: 206 })),
  );
});

describe('prepareChatUpload', () => {
  it('keeps a pending row in the workspace’s folder and gives a one-time address', async () => {
    const result = await prepareChatUpload({ ...pdf, conversationId: 'c1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = db.inserted[0];
    expect(row).toMatchObject({
      organization_id: 'org-1',
      user_id: 'u1',
      conversation_id: 'c1',
      name: 'brief.pdf',
      mime_type: 'application/pdf',
      size_bytes: 2048,
    });
    expect(row.storage_path).toBe(`org-1/${result.ticket.id}`);
    expect(result.ticket).toMatchObject({ path: row.storage_path, token: 'tok' });
  });

  it('refuses an unlisted type, over 10 MB, Chat off, a read-only workspace and another’s chat', async () => {
    expect(await prepareChatUpload({ ...pdf, type: 'application/x-msdownload' })).toEqual({
      ok: false,
      failure: 'type',
    });
    expect(await prepareChatUpload({ ...pdf, size: 12 * 1024 * 1024 })).toEqual({
      ok: false,
      failure: 'size',
    });
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await prepareChatUpload(pdf)).toEqual({ ok: false, failure: 'chat_off' });
    vi.stubEnv('CHAT_AGENTIC', 'true');
    db.status = 'canceled';
    expect(await prepareChatUpload(pdf)).toEqual({ ok: false, failure: 'read_only' });
    db.status = 'active';
    db.chat = { id: 'c1', user_id: 'someone-else' };
    expect(await prepareChatUpload({ ...pdf, conversationId: 'c1' })).toEqual({
      ok: false,
      failure: 'not_found',
    });
    db.user = null;
    expect(await prepareChatUpload(pdf)).toEqual({ ok: false, failure: 'session' });
    expect(db.inserted).toHaveLength(0);
  });
});

describe('finishChatUpload and removeChatUpload', () => {
  beforeEach(() => {
    db.upload = {
      id: 'up-1',
      storage_path: 'org-1/up-1',
      status: 'pending',
      size_bytes: 2048,
      mime_type: 'application/pdf',
    };
  });

  it('marks the file ready once it is there, failed when it isn’t', async () => {
    expect(await finishChatUpload('up-1')).toEqual({ ok: true });
    expect(db.updated).toEqual([{ status: 'ready', size_bytes: 2048 }]);
    expect(db.removed).toEqual([]);
    db.listed = [];
    expect(await finishChatUpload('up-1')).toEqual({ ok: false, failure: 'failed' });
    expect(db.updated[1]).toEqual({ status: 'failed' });
  });

  it('keeps the size the bucket has, not the one the browser said', async () => {
    db.meta = { size: 9000, mimetype: 'application/pdf' };
    expect(await finishChatUpload('up-1')).toEqual({ ok: true });
    expect(db.updated).toEqual([{ status: 'ready', size_bytes: 9000 }]);
  });

  it('fails and deletes a file whose bytes or stored type aren’t the type it was prepared for', async () => {
    // An executable sent as a PDF: the bucket only checks the name of the type.
    db.bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    expect(await finishChatUpload('up-1')).toEqual({ ok: false, failure: 'failed' });
    expect(db.updated).toEqual([{ status: 'failed' }]);
    expect(db.removed).toEqual(['org-1/up-1']);
    // Prepared as a PDF, sent up as HTML.
    db.bytes = new TextEncoder().encode('%PDF-1.7\n');
    db.meta = { size: 2048, mimetype: 'text/html' };
    expect(await finishChatUpload('up-1')).toEqual({ ok: false, failure: 'failed' });
    expect(db.updated[1]).toEqual({ status: 'failed' });
    expect(db.removed).toEqual(['org-1/up-1', 'org-1/up-1']);
  });

  it('takes a draft’s file and row away, and nothing of another’s or a sent one', async () => {
    expect(await removeChatUpload('up-1')).toEqual({ ok: true });
    expect(db.removed).toEqual(['org-1/up-1']);
    db.upload = null;
    expect(await removeChatUpload('up-2')).toEqual({ ok: false, failure: 'not_found' });
  });
});
