import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const uploadContentImage = vi.fn();
vi.mock('@/lib/content/imageUpload', async (importOriginal) => ({
  ...(await importOriginal()),
  uploadContentImage: (...args: unknown[]) => uploadContentImage(...args),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ImageUploadButton } = await import('./ImageUploadButton');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Upload from your computer (00272): the image's address back for the field beside it. */

let container: HTMLDivElement;
let root: Root;
const onUploaded = vi.fn();

beforeEach(() => {
  uploadContentImage.mockReset();
  toast.error.mockReset();
  onUploaded.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = () =>
  act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ImageUploadButton onUploaded={onUploaded} />
      </NextIntlClientProvider>,
    ),
  );
const pick = (file: File) =>
  act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

describe('ImageUploadButton', () => {
  it('uploads the picked image and hands back its address', async () => {
    let done!: (value: unknown) => void;
    uploadContentImage.mockReturnValue(new Promise((resolve) => (done = resolve)));
    await render();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toBe('image/jpeg,image/png,image/webp,image/gif');
    expect(container.querySelector('button')!.textContent).toBe('Upload from your computer');
    const shot = new File(['x'], 'shot.png', { type: 'image/png' });
    await pick(shot);
    expect(uploadContentImage).toHaveBeenCalledWith(shot);
    // While it goes up: said, and not pressed again.
    expect(container.querySelector('button')!.textContent).toBe('Uploading…');
    expect(container.querySelector('button')!.disabled).toBe(true);
    await act(async () => done({ url: 'https://store.example/a.png' }));
    expect(onUploaded).toHaveBeenCalledWith('https://store.example/a.png');
    expect(container.querySelector('button')!.disabled).toBe(false);
  });

  it('says why an image didn’t go up', async () => {
    uploadContentImage.mockResolvedValue({ error: 'size' });
    await render();
    await pick(new File(['x'], 'big.png', { type: 'image/png' }));
    expect(toast.error).toHaveBeenCalledWith('That image is over 5 MB. Use a smaller one.');
    expect(onUploaded).not.toHaveBeenCalled();
  });
});
