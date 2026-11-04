import { describe, expect, it } from 'vitest';
import { bulkSendNotes } from './bulkSend';

/** Opportunities' notes after a bulk send to the workflow (#1590). */

describe('bulkSendNotes', () => {
  it('says how many were sent only when any were', () => {
    expect(bulkSendNotes({ sent: 3, failed: 0, redirected: 0 })).toEqual({
      sent: 3,
      failure: null,
    });
    expect(bulkSendNotes({ sent: 0, failed: 2, redirected: 0 }).sent).toBeNull();
  });

  it('says the address redirects when every failure was a redirect', () => {
    expect(bulkSendNotes({ sent: 0, failed: 3, redirected: 3 })).toEqual({
      sent: null,
      failure: 'redirect',
    });
  });

  it('counts the failures, not "Nothing was sent", when some were sent', () => {
    expect(bulkSendNotes({ sent: 1, failed: 1, redirected: 1 })).toEqual({
      sent: 1,
      failure: 'failed',
    });
  });

  it('counts the failures when some had another cause, or an older API says none', () => {
    expect(bulkSendNotes({ sent: 1, failed: 2, redirected: 1 }).failure).toBe('failed');
    expect(bulkSendNotes({ sent: 1, failed: 2 }).failure).toBe('failed');
  });
});
