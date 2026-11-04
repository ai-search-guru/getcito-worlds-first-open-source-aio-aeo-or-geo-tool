// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Create schedule from its card (W3-02): a server action can be called with
 * anything, so the job is read again with the create_schedule tool's schema
 * before any check or write, and a bad one is refused as invalid.
 */

const BRAND = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';

const store = vi.hoisted(() => ({ createSchedule: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { organization_id: 'org-1' }, error: null }),
        }),
      }),
    }),
  },
}));
vi.mock('@/lib/subscriptionGuard', () => ({ assertWritable: vi.fn(async () => undefined) }));
vi.mock('@/lib/chat/flag', () => ({ chatAgenticEnabled: () => true }));
vi.mock('@/lib/chat/schedule/store', async (original) => ({
  ...(await original<typeof import('@/lib/chat/schedule/store')>()),
  createSchedule: store.createSchedule,
}));

const { createChatSchedule } = await import('./chatSchedules');
const { assertWritable } = await import('@/lib/subscriptionGuard');

const job = {
  title: '  Weekly visibility report ',
  when: 'every Monday at 9:00',
  prompt: 'Summarise last week',
  brandId: BRAND,
  deliver: 'chat' as const,
  changeOnly: false,
};
const place = { timezone: 'Europe/Istanbul', runId: RUN };

beforeEach(() => {
  store.createSchedule.mockReset();
  store.createSchedule.mockResolvedValue({ ok: true });
  vi.mocked(assertWritable).mockClear();
});

describe('createChatSchedule', () => {
  it('makes the job as the tool reads it: trimmed, for the signed-in person', async () => {
    expect(await createChatSchedule(job, place)).toEqual({ ok: true });
    expect(assertWritable).toHaveBeenCalledWith({ brandId: BRAND });
    expect(store.createSchedule).toHaveBeenCalledWith(
      { userId: 'user-1', organizationId: 'org-1', timezone: 'Europe/Istanbul', runId: RUN },
      {
        title: 'Weekly visibility report',
        when: 'every Monday at 9:00',
        prompt: 'Summarise last week',
        skill: undefined,
        brandId: BRAND,
        deliver: 'chat',
        changeOnly: false,
      },
    );
  });

  it.each([
    ['a title that is not text', { ...job, title: 42 }, place],
    ['a deliver choice there is none of', { ...job, deliver: 'fax' }, place],
    ['a brand that is not an id', { ...job, brandId: 'nike' }, place],
    ['nothing to ask', { ...job, prompt: undefined }, place],
    ['no job at all', null, place],
    ['a run that is not an id', job, { ...place, runId: 'run-1' }],
  ])('refuses %s as invalid, checking and writing nothing', async (_, input, where) => {
    expect(await createChatSchedule(input as never, where as never)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(assertWritable).not.toHaveBeenCalled();
    expect(store.createSchedule).not.toHaveBeenCalled();
  });
});
