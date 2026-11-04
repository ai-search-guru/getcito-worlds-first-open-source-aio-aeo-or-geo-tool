// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';

/**
 * The brands a chat touched (BRAND-ACCESS §10, 00436): a call's brand, or
 * every brand the person can access for a read that lists them (the whole
 * workspace for All brands), noted before the call runs; a new chat starts
 * from its own brand. A database before 00436 notes nothing, quietly.
 */

const fake = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => fake.db.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => fake.db.rpc(name, args),
  },
}));

const { createFakeSupabase } = await import('@/lib/chat/testing/fakeSupabase');
const { noteTouchedBrands, referenceTouches, startTouchedBrands, touchedByCall } =
  await import('./touchedBrands');

const CHAT = 'chat-1';
const BRAND = '11111111-1111-4111-8111-111111111111';
const SHARED = '22222222-2222-4222-8222-222222222222';

/**
 * The two functions as 00436 writes them, on the fake's chat rows: a start
 * only while the set isn't kept yet and nothing is in the chat; a note adds
 * to a kept set, and the whole workspace makes it not known.
 */
function seed(db: FakeSupabase) {
  db.tables.chat_conversations = [{ id: CHAT, brand_id: BRAND, touched_brand_ids: null }];
  db.tables.chat_messages = [];
  db.rpcs.chat_start_touched_brands = ({ p_conversation_id }) => {
    const chat = db.tables.chat_conversations.find((c) => c.id === p_conversation_id);
    const empty = !db.tables.chat_messages.some((m) => m.conversation_id === p_conversation_id);
    if (chat && chat.touched_brand_ids === null && empty) {
      chat.touched_brand_ids = chat.brand_id ? [chat.brand_id] : [];
    }
  };
  db.rpcs.chat_note_touched_brands = ({ p_conversation_id, p_brand_ids, p_whole_workspace }) => {
    const chat = db.tables.chat_conversations.find((c) => c.id === p_conversation_id);
    if (!chat || chat.touched_brand_ids === null) return;
    chat.touched_brand_ids = p_whole_workspace
      ? null
      : [
          ...new Set([...(chat.touched_brand_ids as string[]), ...(p_brand_ids as string[])]),
        ].sort();
  };
}

const touched = () => fake.db.tables.chat_conversations[0].touched_brand_ids;

beforeEach(() => {
  fake.db = createFakeSupabase();
  seed(fake.db);
});
afterEach(() => vi.restoreAllMocks());

describe('touchedByCall', () => {
  it("is the call's brand, else nothing for a read about no brand", () => {
    expect(touchedByCall({}, BRAND, 'all')).toEqual([BRAND]);
    expect(touchedByCall({ namesBrands: true }, BRAND, [SHARED])).toEqual([BRAND]);
    expect(touchedByCall({}, null, 'all')).toEqual([]);
  });

  it('is every brand the person can access for a read that lists them: all of them, the workspace', () => {
    expect(touchedByCall({ namesBrands: true }, null, 'all')).toBe('workspace');
    expect(touchedByCall({ namesBrands: true }, null, [BRAND, SHARED])).toEqual([BRAND, SHARED]);
    expect(touchedByCall({ namesBrands: true }, null, null)).toEqual([]);
  });
});

describe('startTouchedBrands and noteTouchedBrands', () => {
  it("keep a new chat's brands from its own, adding each call's", async () => {
    await startTouchedBrands(CHAT);
    expect(touched()).toEqual([BRAND]);
    expect(await noteTouchedBrands(CHAT, [SHARED])).toBe(true);
    expect(await noteTouchedBrands(CHAT, [BRAND])).toBe(true);
    expect(touched()).toEqual([BRAND, SHARED]);
  });

  it('never start a chat that already holds something, which stays not known', async () => {
    fake.db.tables.chat_messages.push({ conversation_id: CHAT });
    await startTouchedBrands(CHAT);
    expect(await noteTouchedBrands(CHAT, [SHARED])).toBe(true);
    expect(touched()).toBeNull();
  });

  it('make the set not known for good once a call listed the whole workspace', async () => {
    await startTouchedBrands(CHAT);
    expect(await noteTouchedBrands(CHAT, 'workspace')).toBe(true);
    expect(touched()).toBeNull();
    await noteTouchedBrands(CHAT, [SHARED]);
    expect(touched()).toBeNull();
  });

  it('ask nothing of the database for a call that touches no brand', async () => {
    expect(await noteTouchedBrands(CHAT, [])).toBe(true);
    expect(fake.db.log).toEqual([]);
  });

  it('note nothing, quietly, on a database before 00436, with no column to keep', async () => {
    delete fake.db.rpcs.chat_start_touched_brands;
    delete fake.db.rpcs.chat_note_touched_brands;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startTouchedBrands(CHAT);
    fake.db.failures.chat_conversations = { code: '42703', message: 'no touched_brand_ids' };
    expect(await noteTouchedBrands(CHAT, [SHARED])).toBe(true);
    fake.db.failures.chat_conversations = { code: 'PGRST204', message: 'no touched_brand_ids' };
    expect(await noteTouchedBrands(CHAT, [SHARED])).toBe(true);
    expect(error).not.toHaveBeenCalled();
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('make a kept set not known when the note function is missing: the closed side', async () => {
    await startTouchedBrands(CHAT);
    expect(touched()).toEqual([BRAND]);
    delete fake.db.rpcs.chat_note_touched_brands;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await noteTouchedBrands(CHAT, [SHARED])).toBe(true);
    expect(touched()).toBeNull();
    // A write that fails otherwise refuses the call.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.db.failures.chat_conversations = { code: '57014', message: 'timeout' };
    expect(await noteTouchedBrands(CHAT, [SHARED])).toBe(false);
    expect(error).toHaveBeenCalled();
  });

  it('refuse the call when its note fails, and log a start that fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = { code: '57014', message: 'timeout' };
    vi.spyOn(fake.db, 'rpc').mockResolvedValue({ data: null, error: failing });
    expect(await noteTouchedBrands(CHAT, [SHARED])).toBe(false);
    await startTouchedBrands(CHAT);
    expect(error).toHaveBeenCalledTimes(2);
  });
});

describe('referenceTouches', () => {
  const PROMPT = '33333333-3333-4333-8333-333333333333';
  const TASK = '44444444-4444-4444-8444-444444444444';
  const prompt = { type: 'prompt', id: PROMPT };
  const task = { type: 'task', id: TASK };
  const chart = { type: 'chart', id: 'visibility-trend' };
  const brandChip = (value?: string) => ({ chips: [{ key: 'brand', value }] });

  beforeEach(() => {
    fake.db.tables.prompts = [{ id: PROMPT, prompt_sets: { brand_id: BRAND } }];
    fake.db.tables.action_tasks = [{ id: TASK, actions: { brand_id: SHARED } }];
  });

  it('touches nothing without references', async () => {
    expect(await referenceTouches({})).toEqual([]);
    expect(await referenceTouches({ context: brandChip(BRAND) })).toEqual([]);
    expect(fake.db.log).toEqual([]);
  });

  it("is a prompt's and a task's own brand, and the page's brand for what is on the page", async () => {
    expect(await referenceTouches({ references: [prompt, task] })).toEqual([BRAND, SHARED]);
    expect(await referenceTouches({ references: [chart], context: brandChip(SHARED) })).toEqual([
      SHARED,
    ]);
  });

  it("is the whole workspace for what it can't tell", async () => {
    // A page's chart with no brand chip, an id that isn't one, an object that isn't there.
    expect(await referenceTouches({ references: [chart] })).toBe('workspace');
    expect(await referenceTouches({ references: [chart], context: brandChip('x') })).toBe(
      'workspace',
    );
    expect(await referenceTouches({ references: [{ type: 'prompt', id: 'p-1' }] })).toBe(
      'workspace',
    );
    fake.db.tables.prompts = [];
    expect(await referenceTouches({ references: [prompt] })).toBe('workspace');
  });

  it('throws when it can’t read them', async () => {
    fake.db.failures.prompts = { message: 'timeout' };
    await expect(referenceTouches({ references: [prompt] })).rejects.toThrow(/timeout/);
  });
});
