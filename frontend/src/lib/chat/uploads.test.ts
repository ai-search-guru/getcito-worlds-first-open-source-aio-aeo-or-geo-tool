import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, contentMatchesType, uploadProblem, uploadTypeOf } from './uploads';

/** What a message may carry (CHAT-02 items 19–21, 00409). */

describe('uploadTypeOf', () => {
  it('takes a listed type, or the extension when the browser gives none', () => {
    expect(uploadTypeOf({ name: 'brief.pdf', type: 'application/pdf' })).toBe('application/pdf');
    expect(uploadTypeOf({ name: 'notes.md', type: '' })).toBe('text/markdown');
    expect(uploadTypeOf({ name: 'Report.XLSX', type: 'application/octet-stream' })).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(uploadTypeOf({ name: 'setup.exe', type: 'application/x-msdownload' })).toBeNull();
    expect(uploadTypeOf({ name: 'setup.exe', type: '' })).toBeNull();
  });
});

describe('uploadProblem', () => {
  const file = (name: string, type: string, size: number) => ({ name, type, size });
  it('refuses an unlisted type, over 10 MB, and a sixth file', () => {
    expect(uploadProblem(file('a.pdf', 'application/pdf', 1000), 0)).toBeNull();
    expect(uploadProblem(file('a.exe', '', 1000), 0)).toBe('type');
    expect(uploadProblem(file('a.pdf', 'application/pdf', 12 * 1024 * 1024), 0)).toBe('size');
    expect(uploadProblem(file('a.pdf', 'application/pdf', MAX_UPLOAD_BYTES), 0)).toBeNull();
    expect(uploadProblem(file('a.pdf', 'application/pdf', 1000), 5)).toBe('count');
  });
});

describe('contentMatchesType', () => {
  const text = (s: string) => new TextEncoder().encode(s);
  const bytes = (...b: number[]) => new Uint8Array(b);
  it('takes a file whose first bytes are its type’s', () => {
    expect(contentMatchesType('application/pdf', text('%PDF-1.7\n'))).toBe(true);
    expect(contentMatchesType('application/pdf', text('\r\n%PDF-1.4'))).toBe(true);
    expect(
      contentMatchesType('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)),
    ).toBe(true);
    expect(contentMatchesType('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(contentMatchesType('image/webp', text('RIFF\u0001\u0002\u0003\u0004WEBPVP8 '))).toBe(
      true,
    );
    expect(
      contentMatchesType(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00),
      ),
    ).toBe(true);
    expect(contentMatchesType('text/csv', text('a,b\n1,2\n'))).toBe(true);
    expect(contentMatchesType('text/plain', bytes(0xff, 0xfe, 0x68, 0x00))).toBe(true);
  });

  it('refuses one whose bytes are another kind of file', () => {
    const exe = bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00);
    expect(contentMatchesType('application/pdf', exe)).toBe(false);
    expect(contentMatchesType('image/png', text('<html>'))).toBe(false);
    expect(contentMatchesType('image/jpeg', text('%PDF-1.7'))).toBe(false);
    expect(
      contentMatchesType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', exe),
    ).toBe(false);
    expect(contentMatchesType('text/plain', exe)).toBe(false);
    expect(contentMatchesType('text/markdown', new Uint8Array())).toBe(false);
  });
});
