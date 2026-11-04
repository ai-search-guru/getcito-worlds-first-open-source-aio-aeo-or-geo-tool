import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from './originCheck.js';

const allowed = ['https://app.example.com', 'https://admin.example.com'];

describe('isAllowedOrigin', () => {
  it('allows a header whose host is in the allow-list', () => {
    expect(isAllowedOrigin('https://app.example.com', allowed)).toBe(true);
    expect(isAllowedOrigin('https://admin.example.com', allowed)).toBe(true);
  });

  it('allows a full Referer URL with a path and query', () => {
    expect(isAllowedOrigin('https://app.example.com/prompts?tab=1#top', allowed)).toBe(true);
  });

  it('compares hostnames only, ignoring scheme, port and case', () => {
    expect(isAllowedOrigin('http://APP.example.com:8443/x', allowed)).toBe(true);
  });

  it('rejects a different host', () => {
    expect(isAllowedOrigin('https://evil.example.net', allowed)).toBe(false);
  });

  it('rejects a host that only contains an allowed host', () => {
    expect(isAllowedOrigin('https://app.example.com.evil.net', allowed)).toBe(false);
    expect(isAllowedOrigin('https://notapp.example.com', allowed)).toBe(false);
  });

  it('rejects a malformed header instead of throwing', () => {
    expect(isAllowedOrigin('foo', allowed)).toBe(false);
    expect(isAllowedOrigin('not a url', allowed)).toBe(false);
    expect(isAllowedOrigin('//app.example.com', allowed)).toBe(false);
    expect(isAllowedOrigin('http://', allowed)).toBe(false);
  });

  it('rejects a missing or empty header', () => {
    expect(isAllowedOrigin(undefined, allowed)).toBe(false);
    expect(isAllowedOrigin(null, allowed)).toBe(false);
    expect(isAllowedOrigin('', allowed)).toBe(false);
  });

  it('skips a malformed allow-list entry and still matches the valid ones', () => {
    const mixed = ['app.example.com', 'https://admin.example.com'];
    expect(isAllowedOrigin('https://admin.example.com', mixed)).toBe(true);
    expect(isAllowedOrigin('https://evil.example.net', mixed)).toBe(false);
  });

  it('skips a malformed allow-list entry listed after the valid one', () => {
    const mixed = ['https://app.example.com', 'not a url'];
    expect(isAllowedOrigin('https://app.example.com', mixed)).toBe(true);
  });

  it('rejects everything when every allow-list entry is malformed', () => {
    expect(isAllowedOrigin('https://app.example.com', ['app.example.com', 'foo'])).toBe(false);
  });

  it('rejects everything when the allow-list is empty', () => {
    expect(isAllowedOrigin('https://app.example.com', [])).toBe(false);
  });

  it('does not let a scheme-less entry match a header that has no host', () => {
    // `new URL('localhost:3000')` parses (scheme "localhost:") with an empty hostname,
    // and so does `new URL('foo:bar')`. Neither side may match on that empty hostname.
    expect(isAllowedOrigin('foo:bar', ['localhost:3000'])).toBe(false);
    expect(isAllowedOrigin('javascript:alert(1)', ['localhost:3000'])).toBe(false);
    expect(isAllowedOrigin('foo:bar', ['https://app.example.com'])).toBe(false);
  });

  it('still matches a valid entry that sits next to a scheme-less one', () => {
    expect(
      isAllowedOrigin('http://localhost:3000/', ['localhost:3000', 'http://localhost:3000']),
    ).toBe(true);
  });
});
