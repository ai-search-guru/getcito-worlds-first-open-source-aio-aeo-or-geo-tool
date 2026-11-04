// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

/** Leaving Chat Home (CHAT-22 §1): kept on the person's own row, answered as a value. */

const prefs = vi.hoisted(() => ({ saveHomeSeen: vi.fn() }));
vi.mock('@/lib/actions/chatPrefs', () => prefs);

const { POST } = await import('./route');

describe('POST /api/chat/home-seen', () => {
  it('keeps the leave, and answers whether it was kept', async () => {
    prefs.saveHomeSeen.mockResolvedValueOnce({ ok: true });
    expect(await (await POST()).json()).toEqual({ ok: true });
    prefs.saveHomeSeen.mockResolvedValueOnce({ ok: false });
    expect(await (await POST()).json()).toEqual({ ok: false });
    expect(prefs.saveHomeSeen).toHaveBeenCalledTimes(2);
  });
});
