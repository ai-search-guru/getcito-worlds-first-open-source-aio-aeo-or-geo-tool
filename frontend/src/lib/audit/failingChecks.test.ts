import { describe, expect, it } from 'vitest';
import { failingChecks } from './failingChecks';

/** What a Site Audit report sends to the Action Center (learning D2). */
describe('failingChecks', () => {
  it('counts the fails, and a warning only for JSON-LD validity', () => {
    expect(
      failingChecks([
        { key: 'faq-schema', status: 'fail' },
        { key: 'tables', status: 'warn' },
        { key: 'json-ld-validity', status: 'warn' },
        { key: 'h1-quality', status: 'pass' },
        { key: 'llms-txt-presence', status: 'na' },
      ]),
    ).toBe(2);
    expect(failingChecks([])).toBe(0);
  });
});
