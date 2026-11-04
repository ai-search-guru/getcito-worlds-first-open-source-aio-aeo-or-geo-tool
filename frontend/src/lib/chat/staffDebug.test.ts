// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatEvent } from './events';
import { createFakeSupabase, type FakeSupabase } from './testing/fakeSupabase';

/**
 * What the staff Debug view reads of an answer (CHAT-03 items 25–26;
 * W1-15): by the answer's message id or its run's id, each step's tool,
 * input, output (the first 20 KB) and measure, and the run's model calls
 * with tokens and cost; in the staff member's own workspace only. None of
 * it can go out as an event.
 */

const fake = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));
vi.mock('@/lib/supabase/admin', () => ({
  get supabaseAdmin() {
    return fake.db;
  },
}));

const { DEBUG_OUTPUT_BYTES, readChatMessageDebug, readChatStepOutput } =
  await import('./staffDebug');

const RUN = '44444444-4444-4444-8444-444444444444';
const CHAT = '33333333-3333-4333-8333-333333333333';
const ORG = '77777777-7777-4777-8777-777777777777';
const OTHER_ORG = '88888888-8888-4888-8888-888888888888';
const MESSAGE = '55555555-5555-4555-8555-555555555555';
const BRAND = '22222222-2222-4222-8222-222222222222';
const STAFF = '11111111-1111-4111-8111-111111111111';
const TEAMMATE = '99999999-9999-4999-8999-999999999999';
const ME = { userId: STAFF, organizationId: ORG };
const ELSEWHERE = { userId: STAFF, organizationId: OTHER_ORG };
const big = { rows: Array.from({ length: 2000 }, (_, i) => ({ url: `/page-${i}`, cited: i })) };

beforeEach(() => {
  fake.db = createFakeSupabase();
  fake.db.tables.chat_conversations = [
    { id: CHAT, organization_id: ORG, user_id: STAFF, shared_at: null, deleted_at: null },
  ];
  fake.db.tables.chat_runs = [
    {
      id: RUN,
      message_id: MESSAGE,
      conversation_id: CHAT,
      status: 'done',
      model: 'auto',
      effort: 'normal',
      error: null,
    },
  ];
  fake.db.tables.chat_run_steps = [
    {
      id: 's2',
      run_id: RUN,
      position: 2,
      kind: 'write',
      status: 'error',
      label: 'Saved draft in Content',
      tool: 'create_draft',
      debug_json: { input: { title: 'FAQ' }, error: 'storage_full' },
      latency_ms: null,
      cache_hit: false,
      truncated: false,
      result_tokens: null,
    },
    {
      id: 's1',
      run_id: RUN,
      position: 1,
      kind: 'read',
      status: 'done',
      label: 'Read Citations',
      tool: 'list_citations',
      debug_json: { input: { brand_id: BRAND, days: 30 }, output: big, latencyMs: 840 },
      latency_ms: null,
      cache_hit: true,
      truncated: true,
      result_tokens: 1200,
    },
  ];
  fake.db.tables.prompt_improve_usage = [
    {
      chat_run_id: RUN,
      chat_run_step_id: null,
      model: 'claude-haiku-4-5',
      input_tokens: 1800,
      output_tokens: 60,
      cache_read_tokens: 1500,
      cache_write_tokens: 0,
      cost_usd: 0.0012,
      latency_ms: 900,
      used_at: '2026-10-30T09:00:01.000Z',
    },
    {
      chat_run_id: RUN,
      chat_run_step_id: 's2',
      model: 'claude-sonnet-4-5',
      input_tokens: 4200,
      output_tokens: 700,
      cache_read_tokens: null,
      cache_write_tokens: null,
      cost_usd: '0.023100',
      latency_ms: 4100,
      used_at: '2026-10-30T09:00:05.000Z',
    },
    { chat_run_id: 'another', model: 'x', cost_usd: 9, used_at: '2026-10-30T09:00:00.000Z' },
  ];
});

describe('readChatMessageDebug', () => {
  it("shows each step's tool, input, output and measure, and the run's model calls with cost", async () => {
    const debug = (await readChatMessageDebug(MESSAGE, ME))!;
    expect(debug).toMatchObject({ status: 'done', model: 'auto', effort: 'normal', error: null });
    expect(debug.steps.map((s) => [s.n, s.tool])).toEqual([
      [1, 'list_citations'],
      [2, 'create_draft'],
    ]);
    expect(debug.steps[0]).toMatchObject({
      input: { brand_id: BRAND, days: 30 },
      latencyMs: 840,
      cacheHit: true,
      truncated: true,
      resultTokens: 1200,
      error: null,
    });
    expect(debug.steps[1]).toMatchObject({ output: null, error: 'storage_full' });
    expect(debug.modelCalls).toEqual([
      expect.objectContaining({ n: null, model: 'claude-haiku-4-5', costUsd: 0.0012 }),
      expect.objectContaining({ n: 2, model: 'claude-sonnet-4-5', costUsd: 0.0231 }),
    ]);
    expect(debug.totals).toMatchObject({ inputTokens: 6000, outputTokens: 760 });
    expect(debug.totals.costUsd).toBeCloseTo(0.0243, 6);
  });

  it('shows the first 20 KB of a large output, and the whole one as a download', async () => {
    const step = (await readChatMessageDebug(MESSAGE, ME))!.steps[0];
    const whole = JSON.stringify(big, null, 2);
    expect(step.outputCut).toBe(true);
    expect(step.outputBytes).toBe(new TextEncoder().encode(whole).length);
    expect(new TextEncoder().encode(step.output!).length).toBe(DEBUG_OUTPUT_BYTES);
    expect(whole.startsWith(step.output!)).toBe(true);
    expect(await readChatStepOutput(MESSAGE, ME, 1)).toBe(whole);
    expect(await readChatStepOutput(MESSAGE, ME, 2)).toBeNull();
    expect(await readChatStepOutput(MESSAGE, ME, 9)).toBeNull();
  });

  it("finds the answer by its run's id too, and nothing for an unknown one", async () => {
    expect((await readChatMessageDebug(RUN, ME))!.steps).toHaveLength(2);
    expect(await readChatMessageDebug('66666666-6666-4666-8666-666666666666', ME)).toBeNull();
  });

  it("reads nothing of another workspace's answer, even for staff", async () => {
    expect(await readChatMessageDebug(MESSAGE, ELSEWHERE)).toBeNull();
    expect(await readChatMessageDebug(RUN, ELSEWHERE)).toBeNull();
    expect(await readChatStepOutput(MESSAGE, ELSEWHERE, 1)).toBeNull();
    // Nor an answer whose chat is gone.
    fake.db.tables.chat_conversations = [];
    expect(await readChatMessageDebug(MESSAGE, ME)).toBeNull();
    expect(fake.db.log).not.toContainEqual(['prompt_improve_usage', 'select']);
  });

  it("reads a teammate's answer only when their chat is shared with the team, and never a deleted chat", async () => {
    const chat = fake.db.tables.chat_conversations[0] as Record<string, unknown>;
    chat.user_id = TEAMMATE;
    expect(await readChatMessageDebug(MESSAGE, ME)).toBeNull();
    expect(await readChatMessageDebug(RUN, ME)).toBeNull();
    expect(await readChatStepOutput(MESSAGE, ME, 1)).toBeNull();
    expect(fake.db.log).not.toContainEqual(['prompt_improve_usage', 'select']);
    expect(fake.db.log).not.toContainEqual(['chat_run_steps', 'select']);
    chat.shared_at = '2026-10-30T09:00:00.000Z';
    expect((await readChatMessageDebug(MESSAGE, ME))!.steps).toHaveLength(2);
    chat.deleted_at = '2026-10-30T10:00:00.000Z';
    expect(await readChatMessageDebug(MESSAGE, ME)).toBeNull();
    chat.user_id = STAFF;
    expect(await readChatMessageDebug(MESSAGE, ME)).toBeNull();
  });

  it('reads only the step asked for, for Download full', async () => {
    const filters: [string, unknown][] = [];
    const from = fake.db.from.bind(fake.db);
    fake.db.from = (table: string) => {
      const builder = from(table);
      if (table !== 'chat_run_steps') return builder;
      const eq = builder.eq.bind(builder);
      builder.eq = (column: string, value: unknown) => {
        filters.push([column, value]);
        return eq(column, value);
      };
      return builder;
    };
    await readChatStepOutput(MESSAGE, ME, 1);
    expect(filters).toEqual([
      ['run_id', RUN],
      ['position', 1],
    ]);
  });

  it('can never go to the browser as an event', async () => {
    const debug = (await readChatMessageDebug(MESSAGE, ME))!;
    const step = { n: 1, kind: 'read' as const, status: 'done' as const, label: 'Read Citations' };
    expect(() =>
      chatEvent('step.finished', 1, { step: { ...step, ...debug.steps[0] } as never }),
    ).toThrow(/can't go to the browser/);
    expect(() =>
      chatEvent('run.finished', 2, {
        workingMs: 1,
        stepCount: 1,
        sources: [],
        generatedAt: '2026-10-30T09:00:00.000Z',
        dataAsOf: null,
        ...{ modelCalls: debug.modelCalls, totals: debug.totals },
      } as never),
    ).toThrow(/can't go to the browser/);
  });
});
