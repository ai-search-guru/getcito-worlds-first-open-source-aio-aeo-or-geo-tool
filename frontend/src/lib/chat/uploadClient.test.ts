// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** One attachment from the browser (W1-13): the file goes up with the type the app named. */

const sent = vi.hoisted(() => ({ bodies: [] as Blob[] }));

vi.mock('@/lib/actions/chatUploads', () => ({
  prepareChatUpload: async () => ({
    ok: true,
    ticket: { id: 'up-1', path: 'org-1/up-1', token: 'tok' },
  }),
  finishChatUpload: async () => ({ ok: true }),
  removeChatUpload: async () => ({ ok: true }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        uploadToSignedUrl: async (_path: string, _token: string, body: Blob) => {
          sent.bodies.push(body);
          return { data: { path: 'org-1/up-1' }, error: null };
        },
      }),
    },
  }),
}));

const { uploadChatFile } = await import('./uploadClient');

beforeEach(() => {
  sent.bodies = [];
});

describe('uploadChatFile', () => {
  it('sends a file the browser gave no type with the type from its extension', async () => {
    const md = new File(['# Notes'], 'notes.md', { type: '' });
    expect(await uploadChatFile(md, null)).toEqual({ ok: true, id: 'up-1' });
    expect(sent.bodies).toHaveLength(1);
    // The bucket reads the form part's type, which is the Blob's, not contentType.
    expect(sent.bodies[0].type).toBe('text/markdown');
    expect(await sent.bodies[0].text()).toBe('# Notes');
  });
});
