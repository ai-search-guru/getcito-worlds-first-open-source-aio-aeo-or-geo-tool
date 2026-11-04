import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS } from './logger.js';

/** What the server's log never holds (#1263). */

function logged(object) {
  const lines = [];
  const log = pino({ redact: REDACT_PATHS }, { write: (line) => lines.push(line) });
  log.error(object, 'unhandled error');
  return lines.join('');
}

describe('the logger', () => {
  it("keeps a malformed request's body, which may hold a sign-in, out of the log", () => {
    const err = Object.assign(new SyntaxError('Unexpected end of JSON input'), {
      body: '{"input":{"apiKey":"sk_live_secret"',
      type: 'entity.parse.failed',
    });
    const line = logged({ err });
    expect(line).not.toContain('sk_live_secret');
    expect(line).toContain('Unexpected end of JSON input');
  });

  it("keeps a request's sign-in headers out of the log", () => {
    const line = logged({
      req: { headers: { authorization: 'Bearer tok_secret', cookie: 'c=1' } },
    });
    expect(line).not.toContain('tok_secret');
    expect(line).not.toContain('c=1');
  });
});
