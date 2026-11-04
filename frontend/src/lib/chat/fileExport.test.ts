import { describe, expect, it } from 'vitest';
import { exportChatFile, type StoredChatFile } from './fileExport';

/** A file in Files, downloaded in a format it offers (CHAT-06 items 2, 35). */

const page: StoredChatFile = {
  title: 'Pricing FAQ',
  mimeType: 'text/html',
  formats: ['html', 'md', 'docx', 'pdf'],
  generatedAt: '2026-10-30T09:14:00.000Z',
  timezone: 'UTC',
  stamp: 'Generated Oct 30, 2026 · 09:14 GMT+0',
  content: '<h1>Pricing FAQ</h1><p>What does it cost? <strong>$49</strong>.</p>',
};
const answer: StoredChatFile = {
  ...page,
  title: 'Why did citations drop?',
  mimeType: 'text/markdown',
  formats: ['md', 'docx', 'pdf'],
  content: 'Two pages lost most of it.',
};
const text = (body: Uint8Array) => new TextDecoder().decode(body);

describe('exportChatFile', () => {
  it('writes a page Chat saved as HTML and Markdown, with its time line, named after it', async () => {
    const html = await exportChatFile(page, 'html');
    expect(html?.fileName).toBe('pricing-faq-2026-10-30.html');
    expect(text(html!.body)).toContain('<title>Pricing FAQ</title>');
    expect(text(html!.body)).toContain('<strong>$49</strong>');

    const md = await exportChatFile(page, 'md');
    expect(md?.contentType).toBe('text/markdown; charset=utf-8');
    expect(text(md!.body)).toBe(
      'Generated Oct 30, 2026 · 09:14 GMT+0\n\n# Pricing FAQ\n\nWhat does it cost? **$49**.\n',
    );
  });

  it('cleans a page on the way out: no script, no handler (CHAT-06)', async () => {
    const html = await exportChatFile(
      {
        ...page,
        content:
          '<h1>Pricing FAQ</h1><script>alert(1)</script><p onclick="alert(2)">Hi</p><img src="https://getcito.com/a.png" onerror="alert(3)">',
      },
      'html',
    );
    const body = text(html!.body);
    expect(body).not.toMatch(/<script/i);
    expect(body).not.toMatch(/onerror|onclick/i);
    expect(body).toContain('<p>Hi</p>');
  });

  it('writes a page as Word', async () => {
    const docx = await exportChatFile(page, 'docx');
    expect(docx?.fileName).toBe('pricing-faq-2026-10-30.docx');
    expect(docx!.body.byteLength).toBeGreaterThan(1000);
  });

  it('writes an answer through the answer’s writers', async () => {
    const md = await exportChatFile(answer, 'md');
    expect(md?.fileName).toBe('why-did-citations-drop-2026-10-30.md');
    expect(text(md!.body)).toContain('# Why did citations drop?');
  });

  it('gives no format the file doesn’t offer', async () => {
    expect(await exportChatFile(answer, 'html')).toBeNull();
    expect(await exportChatFile(page, 'csv')).toBeNull();
  });
});
