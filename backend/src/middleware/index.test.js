import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn() },
}));

const { default: Middleware } = await import('./index.js');
const { default: logger } = await import('../lib/logger.js');

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function reqWith(headers) {
  return { headers };
}

function socketWith(headers) {
  return { handshake: { headers } };
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('ALLOWED_ORIGINS', 'https://app.example.com,https://admin.example.com');
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Middleware.checkRequestIsComingFromDomain', () => {
  async function run(headers) {
    const res = makeRes();
    const next = vi.fn();
    await Middleware.checkRequestIsComingFromDomain(reqWith(headers), res, next);
    return { res, next };
  }

  it('lets a request from an allowed Referer through', async () => {
    const { res, next } = await run({ referer: 'https://app.example.com/dashboard?tab=1' });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('falls back to the Origin header when there is no Referer', async () => {
    const { res, next } = await run({ origin: 'https://admin.example.com' });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers 403 for a host that is not allowed', async () => {
    const { res, next } = await run({ referer: 'https://evil.example.net/' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Forbidden' });
  });

  it('answers 403 when neither Referer nor Origin is sent', async () => {
    const { res, next } = await run({});
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('answers 403, not 500, for a malformed Referer', async () => {
    const { res, next } = await run({ referer: 'foo' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Forbidden' });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('answers 403, not 500, for a malformed Origin', async () => {
    const { res, next } = await run({ origin: 'not a url' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Forbidden' });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('still allows a valid origin when ALLOWED_ORIGINS has a malformed entry', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', 'app.example.com,https://app.example.com');
    const { res, next } = await run({ referer: 'https://app.example.com/' });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers 403, not 500, for a disallowed host when ALLOWED_ORIGINS has a malformed entry', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', 'app.example.com,https://app.example.com');
    const { res, next } = await run({ referer: 'https://evil.example.net/' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('Middleware.checkRequestIsComingFromDomainForSocket', () => {
  async function run(headers) {
    const next = vi.fn();
    await Middleware.checkRequestIsComingFromDomainForSocket(socketWith(headers), next);
    return next;
  }

  it('lets a handshake from an allowed Referer through', async () => {
    const next = await run({ referer: 'https://app.example.com/dashboard' });
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('falls back to the Origin header when there is no Referer', async () => {
    const next = await run({ origin: 'https://admin.example.com' });
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a host that is not allowed with Forbidden Socket', async () => {
    const next = await run({ origin: 'https://evil.example.net' });
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0][0].message).toBe('Forbidden Socket');
  });

  it('rejects a handshake with neither Referer nor Origin', async () => {
    const next = await run({});
    expect(next.mock.calls[0][0].message).toBe('Forbidden Socket');
  });

  it('rejects a malformed Referer with Forbidden Socket, not Internal Error Socket', async () => {
    const next = await run({ referer: 'foo' });
    expect(next.mock.calls[0][0].message).toBe('Forbidden Socket');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('rejects a malformed Origin with Forbidden Socket, not Internal Error Socket', async () => {
    const next = await run({ origin: 'not a url' });
    expect(next.mock.calls[0][0].message).toBe('Forbidden Socket');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('still allows a valid origin when ALLOWED_ORIGINS has a malformed entry', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', 'app.example.com,https://app.example.com');
    const next = await run({ origin: 'https://app.example.com' });
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a disallowed host with Forbidden Socket when ALLOWED_ORIGINS has a malformed entry', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', 'app.example.com,https://app.example.com');
    const next = await run({ origin: 'https://evil.example.net' });
    expect(next.mock.calls[0][0].message).toBe('Forbidden Socket');
    expect(logger.error).not.toHaveBeenCalled();
  });
});
