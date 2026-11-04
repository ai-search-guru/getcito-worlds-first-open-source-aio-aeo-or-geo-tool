// @vitest-environment node
import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/chat/models (W4-01): the person's workspace, its own key's provider, the chat's model. */

const ORG = '11111111-1111-4111-8111-111111111111';
const actor = vi.hoisted(() => ({ value: null as unknown }));
const readModelMenu = vi.hoisted(() => vi.fn());
const ownChatKeyProvider = vi.hoisted(() => vi.fn());

vi.mock('@/lib/chat/runApi', () => ({
  chatActor: async () => actor.value,
  runFailure: (status: number, failure: string, code: string, error: string) =>
    NextResponse.json({ ok: false, failure, code, error }, { status }),
}));
vi.mock('@/lib/chat/modelMenu', () => ({ readModelMenu }));
vi.mock('@/lib/chat/key', () => ({ ownChatKeyProvider }));

const { GET } = await import('./route');

const get = (query = '') => GET(new Request(`http://localhost/api/chat/models${query}`));

beforeEach(() => {
  actor.value = { userId: 'user-1', email: null, organizationId: ORG };
  readModelMenu.mockReset().mockResolvedValue({ models: [] });
  ownChatKeyProvider.mockReset().mockResolvedValue(null);
});

describe('GET /api/chat/models', () => {
  it('isn’t there while Chat is off for the workspace', async () => {
    actor.value = NextResponse.json({ ok: false }, { status: 404 });
    expect((await get()).status).toBe(404);
    expect(readModelMenu).not.toHaveBeenCalled();
  });

  it('reads the menu with the own key’s provider and the chat’s model', async () => {
    ownChatKeyProvider.mockResolvedValue('anthropic');
    const res = await get('?selected=anthropic/claude-opus-5.5');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, menu: { models: [] } });
    expect(ownChatKeyProvider).toHaveBeenCalledWith(ORG);
    expect(readModelMenu).toHaveBeenCalledWith({
      selected: 'anthropic/claude-opus-5.5',
      ownKeyProvider: 'anthropic',
    });
  });

  it('takes no selection that isn’t a model id, and Auto as is', async () => {
    await get('?selected=../../x');
    expect(readModelMenu).toHaveBeenLastCalledWith({ selected: null, ownKeyProvider: null });
    await get('?selected=auto');
    expect(readModelMenu).toHaveBeenLastCalledWith({ selected: 'auto', ownKeyProvider: null });
  });

  it('answers a failure as a value', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    readModelMenu.mockRejectedValue(new Error('boom'));
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, failure: 'failed' });
  });
});
