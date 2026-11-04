import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Upload an image instead of pasting its address (00272). */

const prepareImageUpload = vi.fn();
vi.mock('@/lib/actions/contentImages', () => ({
  prepareImageUpload: (...args: unknown[]) => prepareImageUpload(...args),
}));
const uploadToSignedUrl = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    storage: {
      from: (bucket: string) => ({
        uploadToSignedUrl: (...args: unknown[]) => uploadToSignedUrl(bucket, ...args),
      }),
    },
  }),
}));

const { IMAGE_UPLOAD_MAX_BYTES, imageUploadProblem, uploadContentImage } =
  await import('./imageUpload');

const file = (type: string, size = 1000) => new File([new Uint8Array(size)], 'shot', { type });
const TICKET = {
  path: 'org-1/0b5c2a1e-8f3d-4c7a-9e21-5d6f7a8b9c0d.png',
  token: 'tok',
  url: 'https://store.example/public/content-images/org-1/0b5c2a1e-8f3d-4c7a-9e21-5d6f7a8b9c0d.png',
};

beforeEach(() => {
  prepareImageUpload.mockReset().mockResolvedValue(TICKET);
  uploadToSignedUrl.mockReset().mockResolvedValue({ data: {}, error: null });
});

describe('uploadContentImage', () => {
  it('sends the image to the one-time address the app gives, and gives its address', async () => {
    const shot = file('image/png');
    const result = await uploadContentImage(shot);
    expect(prepareImageUpload).toHaveBeenCalledWith('image/png');
    expect(uploadToSignedUrl).toHaveBeenCalledWith('content-images', TICKET.path, 'tok', shot, {
      contentType: 'image/png',
      cacheControl: '31536000',
    });
    expect(result).toEqual({ url: TICKET.url });
  });

  it('refuses a file of another type or over 5 MB before asking', async () => {
    expect(imageUploadProblem(file('image/svg+xml'))).toBe('type');
    expect(imageUploadProblem(file('constructor'))).toBe('type');
    expect(imageUploadProblem(file('image/jpeg', IMAGE_UPLOAD_MAX_BYTES + 1))).toBe('size');
    expect(await uploadContentImage(file('application/pdf'))).toEqual({ error: 'type' });
    expect(prepareImageUpload).not.toHaveBeenCalled();
  });

  it('says why the app gave no address: the plan, or the day’s uploads made', async () => {
    prepareImageUpload.mockResolvedValueOnce({ error: 'plan' });
    expect(await uploadContentImage(file('image/jpeg'))).toEqual({ error: 'plan' });
    prepareImageUpload.mockResolvedValueOnce({ error: 'limit' });
    expect(await uploadContentImage(file('image/jpeg'))).toEqual({ error: 'limit' });
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('says it failed when the upload or the ask does', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    uploadToSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'expired' } });
    expect(await uploadContentImage(file('image/jpeg'))).toEqual({ error: 'failed' });
    prepareImageUpload.mockRejectedValueOnce(new Error('offline'));
    expect(await uploadContentImage(file('image/jpeg'))).toEqual({ error: 'failed' });
    error.mockRestore();
  });
});
