import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * The web tells the server the workspace's own key fails, server to server
 * with CRON_SECRET; the body is checked before anything is sent.
 */

const ORG = '22222222-2222-2222-2222-222222222222';
const SINCE = '2026-11-01T09:00:00.000Z';

const notifyOwnKeyFailure = vi.fn();
vi.mock('../lib/chat-notices/ownKey.js', () => ({
  notifyOwnKeyFailure: (...args) => notifyOwnKeyFailure(...args),
}));
const tellGoLiveOff = vi.fn();
vi.mock('../lib/chat-notices/goLive.js', () => ({
  tellGoLiveOff: (...args) => tellGoLiveOff(...args),
}));
vi.mock('../lib/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { default: router } = await import('./internalChatNotices.js');

let server;
let baseUrl;

beforeEach(async () => {
  vi.stubEnv('CRON_SECRET', 'shh');
  notifyOwnKeyFailure.mockReset().mockResolvedValue({ notices: 2, emails: 1 });
  const app = express();
  app.use(express.json());
  app.use('/api/internal/chat/notices', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/internal/chat/notices`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const post = (body, secret = 'shh') =>
  fetch(`${baseUrl}/own-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });

describe('POST /api/internal/chat/notices/own-key', () => {
  it('answers only the web, with its secret', async () => {
    expect((await post({ orgId: ORG, provider: 'openai', since: SINCE }, 'nope')).status).toBe(401);
    expect(notifyOwnKeyFailure).not.toHaveBeenCalled();
  });

  it('tells the Admins of the episode, and says how many it told', async () => {
    const res = await post({ orgId: ORG, provider: 'openai', since: SINCE, reminder: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, notices: 2, emails: 1 });
    expect(notifyOwnKeyFailure).toHaveBeenCalledWith({
      orgId: ORG,
      provider: 'openai',
      since: SINCE,
      reminder: true,
    });
  });

  it('refuses a body it can’t read, and says so when telling fails', async () => {
    for (const body of [
      { orgId: 'org', provider: 'openai', since: SINCE },
      { orgId: ORG, provider: 'copilot', since: SINCE },
      { orgId: ORG, provider: 'openai', since: 'yesterday' },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(notifyOwnKeyFailure).not.toHaveBeenCalled();
    notifyOwnKeyFailure.mockRejectedValueOnce(new Error('down'));
    expect((await post({ orgId: ORG, provider: 'openai', since: SINCE })).status).toBe(500);
  });
});

describe('POST /api/internal/chat/notices/go-live-off', () => {
  const AGENT = '33333333-3333-4333-8333-333333333333';
  const EDITOR = '44444444-4444-4444-8444-444444444444';
  const post = (body, auth = 'Bearer shh') =>
    fetch(`${baseUrl}/go-live-off`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(body),
    });

  it('tells who allowed an agent an edit stopped, for the version allowed, but not the editor', async () => {
    tellGoLiveOff.mockReset().mockResolvedValue({ notices: 1, emails: 1 });
    const res = await post({ orgId: ORG, agentId: AGENT, version: 3, editor: EDITOR });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, notices: 1, emails: 1 });
    expect(tellGoLiveOff).toHaveBeenCalledWith({
      orgId: ORG,
      agentId: AGENT,
      version: 3,
      editor: EDITOR,
    });
  });

  it('answers only the web, refuses a body it can’t read, and says when it failed', async () => {
    tellGoLiveOff.mockReset().mockResolvedValue({ notices: 0, emails: 0 });
    expect((await post({ orgId: ORG, agentId: AGENT, version: 3 }, 'Bearer no')).status).toBe(401);
    for (const body of [
      { orgId: ORG, agentId: AGENT },
      { orgId: ORG, agentId: 'x', version: 1 },
      { orgId: ORG, agentId: AGENT, version: 0 },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(tellGoLiveOff).not.toHaveBeenCalled();
    tellGoLiveOff.mockRejectedValueOnce(new Error('db down'));
    expect((await post({ orgId: ORG, agentId: AGENT, version: 3 })).status).toBe(500);
  });
});
