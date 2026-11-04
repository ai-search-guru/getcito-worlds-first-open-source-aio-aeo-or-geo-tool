import { describe, expect, it } from 'vitest';
import { fileStamp } from './stamp';

/** A file's time line (CHAT-06 items 38–42), from the stored times, in their time zone. */

const t = (key: 'generatedTip' | 'dataAsOfTip', { full }: { full: string }) =>
  key === 'generatedTip' ? `Generated ${full}` : `Data as of ${full}`;

describe('fileStamp', () => {
  it('words when it was made, with the GMT offset, in the time zone it was shown in', () => {
    expect(fileStamp(t, '2026-10-26T06:14:00.000Z', null, 'Europe/Istanbul')).toBe(
      'Generated Oct 26, 2026 · 09:14 GMT+3',
    );
  });

  it('adds the newest data it read', () => {
    expect(
      fileStamp(t, '2026-10-26T06:14:00.000Z', '2026-10-26T03:00:00.000Z', 'Europe/Istanbul'),
    ).toBe('Generated Oct 26, 2026 · 09:14 GMT+3 · Data as of Oct 26, 2026 · 06:00 GMT+3');
  });
});
