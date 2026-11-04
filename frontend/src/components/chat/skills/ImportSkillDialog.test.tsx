import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';

/**
 * Importing a skill (W3-09): an upload goes as multipart `file`, a GitHub
 * link as JSON `{ url }`; a file over 5 MB is refused before it goes; the
 * API's refusal stays in the dialog in its words; an import says whether
 * the Admins were asked to review it.
 */

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ImportSkillDialog } = await import('./ImportSkillDialog');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
let answer: Response;
const fetchMock = vi.fn(async () => answer.clone());
const onImported = vi.fn();
const onClose = vi.fn();

async function render(mode: 'upload' | 'github') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ImportSkillDialog mode={mode} onClose={onClose} onImported={onImported} />
      </NextIntlClientProvider>,
    );
  });
}
const dialog = () => document.querySelector<HTMLElement>('[data-slot="import-skill"]')!;
const el = <T extends HTMLElement>(action: string) =>
  dialog().querySelector<T>(`[data-action="${action}"]`)!;
async function submit() {
  await act(async () => el('skills.importSubmit').click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function pick(file: File) {
  const input = el<HTMLInputElement>('skills.importFile');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
async function type(value: string) {
  const input = el<HTMLInputElement>('skills.importUrl');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  answer = Response.json({
    ok: true,
    skill: { id: 's1', name: 'copy-editing', requested: false },
  });
  fetchMock.mockClear();
  for (const fn of [toast.success, onImported, onClose]) fn.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('ImportSkillDialog', () => {
  it('uploads the file picked as multipart, and opens the skill’s review', async () => {
    await render('upload');
    expect(el<HTMLButtonElement>('skills.importSubmit').disabled).toBe(true);
    const name = () => dialog().querySelector('[data-slot="import-file-name"]')!.textContent;
    expect(name()).toBe('No file chosen');
    const file = new File(['---\nname: copy-editing\n---\n# Copy editing'], 'SKILL.md', {
      type: 'text/markdown',
    });
    await pick(file);
    expect(name()).toBe('SKILL.md');
    await submit();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/chat/skills/import');
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('file')).toBe(file);
    expect(toast.success).toHaveBeenCalledWith('Imported. Review it before anyone can use it.');
    expect(onImported).toHaveBeenCalledWith({ id: 's1', name: 'copy-editing', requested: false });
  });

  it('refuses a file over 5 MB before it goes', async () => {
    await render('upload');
    await pick(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'skill.zip'));
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe('This file is over 5 MB.');
  });

  it('imports a GitHub link as JSON, and says when the Admins were asked to review it', async () => {
    answer = Response.json({
      ok: true,
      skill: { id: 's2', name: 'launch-post', requested: true },
    });
    await render('github');
    await type(' https://github.com/acme/skills/tree/main/launch-post ');
    await submit();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      url: 'https://github.com/acme/skills/tree/main/launch-post',
    });
    expect(toast.success).toHaveBeenCalledWith('Imported. Your Admins were asked to review it.');
  });

  it('keeps the API’s refusal in the dialog, in its words', async () => {
    answer = Response.json(
      { ok: false, code: 'license', error: 'This skill has no license we accept.' },
      { status: 400 },
    );
    await render('github');
    await type('https://github.com/acme/skills');
    await submit();
    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      'This skill has no license we accept.',
    );
    expect(onImported).not.toHaveBeenCalled();
  });
});
