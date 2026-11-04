import { beforeEach, describe, expect, it } from 'vitest';
import { readUrlChoice, readUrlParam, writeUrlParams } from './urlState';

beforeEach(() => {
  window.history.replaceState({ router: 'state' }, '', '/dashboard/list');
});

describe('readUrlChoice', () => {
  it('returns an allowed value from the query string', () => {
    window.history.replaceState(null, '', '/dashboard/list?status=open');
    expect(readUrlChoice('status', ['all', 'open', 'done'] as const, 'all')).toBe('open');
  });

  it('falls back on a missing or unknown value', () => {
    expect(readUrlChoice('status', ['all', 'open'] as const, 'all')).toBe('all');
    window.history.replaceState(null, '', '/dashboard/list?status=bogus');
    expect(readUrlChoice('status', ['all', 'open'] as const, 'all')).toBe('all');
  });
});

describe('readUrlParam', () => {
  it('returns the value or an empty string', () => {
    window.history.replaceState(null, '', '/dashboard/list?q=shoes');
    expect(readUrlParam('q')).toBe('shoes');
    expect(readUrlParam('missing')).toBe('');
  });
});

describe('writeUrlParams', () => {
  it('writes non-default values and keeps unrelated params', () => {
    window.history.replaceState(null, '', '/dashboard/list?opportunity=abc');
    writeUrlParams({ status: 'open', impact: 'all' }, { status: 'all', impact: 'all' });
    expect(window.location.search).toBe('?opportunity=abc&status=open');
  });

  it('removes defaults, empty strings and nulls', () => {
    window.history.replaceState(null, '', '/dashboard/list?status=open&q=x&prompt=p1');
    writeUrlParams({ status: 'all', q: '', prompt: null }, { status: 'all' });
    expect(window.location.search).toBe('');
  });

  it("keeps the router's history state", () => {
    writeUrlParams({ status: 'open' });
    expect(window.history.state).toEqual({ router: 'state' });
  });
});
