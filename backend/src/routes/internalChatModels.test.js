import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * The model menu for the web (W4-01): only with the internal secret, the
 * query checked before anything is read, no dollars in the answer.
 */

const chatModelMenu = vi.fn();
vi.mock('../lib/modelMenu.js', () => ({ chatModelMenu: (...args) => chatModelMenu(...args) }));

const { default: router } = await import('./internalChatModels.js');

let server;
let baseUrl;

beforeEach(async () => {
  vi.stubEnv('CRON_SECRET', 'shh');
  chatModelMenu.mockReset().mockReturnValue({
    auto: { id: 'auto', multiplier: '1x', tone: 'normal' },
    models: [],
    selected: null,
    results: [],
    catalogCount: 0,
    updatedAt: null,
  });
  const app = express();
  app.use('/api/internal/chat/models', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/internal/chat/models`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const get = (query = '', secret = 'shh') =>
  fetch(`${baseUrl}${query}`, { headers: { Authorization: `Bearer ${secret}` } });

describe('GET /api/internal/chat/models', () => {
  it('answers only the web, with its secret', async () => {
    expect((await get('', 'nope')).status).toBe(401);
    expect((await fetch(baseUrl)).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await get('', '')).status).toBe(401);
    expect(chatModelMenu).not.toHaveBeenCalled();
  });

  it('passes the offered ids, the selected model and the search', async () => {
    const res = await get(
      '?ids=anthropic/claude-haiku-5.5,anthropic/claude-sonnet-5.5&selected=anthropic/claude-opus-5.5&q=%20son%20',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, auto: { multiplier: '1x' } });
    expect(chatModelMenu).toHaveBeenCalledWith({
      ids: ['anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-5.5'],
      selected: 'anthropic/claude-opus-5.5',
      q: 'son',
    });
    await get('?selected=auto');
    expect(chatModelMenu).toHaveBeenLastCalledWith({ ids: [], selected: 'auto', q: undefined });
  });

  it('refuses a query it doesn’t know, an id that isn’t one, or too many ids', async () => {
    expect((await get('?ids=claude')).status).toBe(400);
    expect((await get('?selected=../../etc')).status).toBe(400);
    expect((await get('?debug=1')).status).toBe(400);
    const many = Array.from({ length: 21 }, (_, i) => `acme/m-${i}`).join(',');
    expect((await get(`?ids=${many}`)).status).toBe(400);
    expect(chatModelMenu).not.toHaveBeenCalled();
  });
});
