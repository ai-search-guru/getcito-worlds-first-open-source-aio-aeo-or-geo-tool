import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Uploading a logo: checked first, then the server's one-time address, then the file itself. */

const uploadToSignedUrl = vi.fn();
const bucket = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    storage: {
      from: (name: string) => {
        bucket(name);
        return { uploadToSignedUrl };
      },
    },
  }),
}));

const { uploadLogo } = await import('./logoUpload');

const png = new File(['x'], 'logo.png', { type: 'image/png' });
const prepare = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  prepare.mockResolvedValue({ ok: true, path: 'org/kit/id.png', token: 'tok' });
  uploadToSignedUrl.mockResolvedValue({ error: null });
});

describe('uploadLogo', () => {
  it('sends the file to the one-time address and gives back its path', async () => {
    expect(await uploadLogo(png, prepare)).toEqual({ ok: true, path: 'org/kit/id.png' });
    expect(prepare).toHaveBeenCalledWith('image/png', 1);
    expect(bucket).toHaveBeenCalledWith('white-label-logos');
    expect(uploadToSignedUrl).toHaveBeenCalledWith('org/kit/id.png', 'tok', png, {
      contentType: 'image/png',
    });
  });

  it('asks for no address for a type or size the bucket doesn’t take', async () => {
    const gif = new File(['x'], 'logo.gif', { type: 'image/gif' });
    expect(await uploadLogo(gif, prepare)).toEqual({ ok: false, error: 'type' });
    const big = new File([new Uint8Array(1024 * 1024 + 1)], 'logo.png', { type: 'image/png' });
    expect(await uploadLogo(big, prepare)).toEqual({ ok: false, error: 'size' });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('passes on the server’s refusal, and a failed upload', async () => {
    prepare.mockResolvedValueOnce({ ok: false, failure: 'locked' });
    expect(await uploadLogo(png, prepare)).toEqual({ ok: false, error: 'locked' });
    uploadToSignedUrl.mockResolvedValueOnce({ error: { message: 'down' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await uploadLogo(png, prepare)).toEqual({ ok: false, error: 'failed' });
  });
});
