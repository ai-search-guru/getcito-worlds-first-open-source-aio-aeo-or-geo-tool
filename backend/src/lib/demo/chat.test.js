import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { chat, chatRows, hideDemoChats, MAX_PEOPLE } = await import('./chat.js');
const { actionCenterRows } = await import('./actionCenter.js');
const { demoId } = await import('./random.js');
const S = await import('./stats.js');
const { RUNS } = await import('./core.js');

/**
 * The demo brand's Chat (demo Chat): each person's sample chats, whose
 * answers are counted from the demo's own answers and link to its actions
 * and drafts.
 */

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const ORG_ID = '22222222-3333-4444-8555-666666666666';
const NOW = new Date('2026-10-28T12:00:00Z');
const PEOPLE = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002'];
const rows = await chatRows({
  brandId: BRAND_ID,
  now: NOW,
  organizationId: ORG_ID,
  userIds: PEOPLE,
});
const answers = rows.messages.filter((m) => m.role === 'assistant');

describe('chatRows', () => {
  it('gives each person their own chats on the demo brand', () => {
    expect(rows.conversations).toHaveLength(10);
    for (const person of PEOPLE) {
      const own = rows.conversations.filter((c) => c.user_id === person);
      expect(own).toHaveLength(5);
      for (const c of own) {
        expect(c).toMatchObject({ organization_id: ORG_ID, brand_id: BRAND_ID });
        expect(c.touched_brand_ids).toEqual([BRAND_ID]);
      }
    }
    const ids = Object.values(rows).flatMap((list) => list.map((r) => r.id).filter(Boolean));
    expect(new Set(ids).size).toBe(ids.length);
    // One chat was asked from a page's side panel.
    expect(rows.conversations.filter((c) => c.origin === 'panel')).toHaveLength(2);
  });

  it('keeps each question before its answer, with the answer’s run, steps and end', () => {
    for (const run of rows.runs) {
      const answer = rows.messages.find((m) => m.id === run.message_id);
      expect(answer.role).toBe('assistant');
      expect(run).toMatchObject({ conversation_id: answer.conversation_id, status: 'done' });
      expect(Date.parse(run.finished_at)).toBeGreaterThan(Date.parse(run.started_at));
      const steps = rows.steps.filter((s) => s.run_id === run.id);
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.map((s) => s.position)).toEqual(steps.map((_, i) => i + 1));
      for (const step of steps) {
        expect(step).toMatchObject({ kind: 'read', status: 'done' });
        expect(step.label).toMatch(/^Read /);
      }
      const [end] = rows.events.filter((e) => e.run_id === run.id);
      expect(end).toMatchObject({ seq: 1, type: 'run.finished' });
      expect(end.data.stepCount).toBe(steps.length);
      expect(end.data.sources.length).toBeGreaterThan(0);
    }
    for (const c of rows.conversations) {
      const messages = rows.messages.filter((m) => m.conversation_id === c.id);
      expect(messages.map((m) => m.role)).toEqual(
        messages.map((_, i) => (i % 2 === 0 ? 'user' : 'assistant')),
      );
      const times = messages.map((m) => Date.parse(m.created_at));
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    }
  });

  it('dates everything before now, the chat at its latest answer', () => {
    const dates = [
      ...rows.conversations.flatMap((c) => [c.created_at, c.last_message_at]),
      ...rows.messages.map((m) => m.created_at),
      ...rows.runs.map((r) => r.finished_at),
    ];
    for (const date of dates) expect(Date.parse(date)).toBeLessThanOrEqual(NOW.getTime());
    for (const c of rows.conversations) {
      const ends = rows.runs
        .filter((r) => r.conversation_id === c.id)
        .map((r) => Date.parse(r.finished_at));
      expect(Date.parse(c.last_message_at)).toBe(Math.max(...ends));
      // Already read: the menu lists it with the chats, not as news in the Inbox.
      expect(Date.parse(c.last_read_at)).toBeGreaterThan(Date.parse(c.last_message_at));
      expect(Date.parse(c.last_read_at)).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it('leaves the next moves under each chat’s latest answer only', () => {
    for (const c of rows.conversations) {
      const runs = rows.runs.filter((r) => r.conversation_id === c.id);
      const latest = runs.at(-1);
      for (const run of runs.slice(0, -1)) {
        expect(rows.moves.filter((m) => m.run_id === run.id)).toEqual([]);
      }
      const moves = rows.moves.filter((m) => m.run_id === latest.id);
      expect(moves.length).toBeLessThanOrEqual(4);
      for (const move of moves) {
        expect(move.label.length).toBeLessThanOrEqual(80);
        expect(move.prompt.length).toBeLessThanOrEqual(80);
        expect(move.class).toBe('read');
      }
    }
  });

  it('counts its figures from the demo’s answers', () => {
    const results = S.demoContext(BRAND_ID, NOW).rows.results;
    const latest = S.brandStats(S.runResults(results, [RUNS - 1]));
    const before = S.brandStats(S.runResults(results, [RUNS - 2]));
    const visibility = answers.find((m) => m.content_md.includes('of AI answers** in the latest'));
    expect(visibility.content_md).toContain(
      `**Brewline is named in ${latest.mentionRate}% of AI answers** in the latest check, ${
        latest.mentionRate > before.mentionRate ? 'up from' : 'down from'
      } ${before.mentionRate}%`,
    );
    for (const a of answers) expect(a.content_md).not.toMatch(/undefined|NaN|null/);
  });

  it('links only to the demo’s own actions and drafts, and names no real site', async () => {
    const actions = new Set(
      (await actionCenterRows({ brandId: BRAND_ID, now: NOW })).actions.map((a) => a.id),
    );
    const drafts = new Set(
      ['low-acid-guide', 'freshness-update', 'pause-skip-help'].map((key) =>
        demoId(BRAND_ID, `draft:${key}`),
      ),
    );
    const links = answers.flatMap((a) =>
      [...a.content_md.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]),
    );
    expect(links.length).toBeGreaterThan(4);
    for (const link of links) {
      const action = link.match(/^\/dashboard\/action-center\/actions\/([0-9a-f-]{36})$/);
      const draft = link.match(/^\/dashboard\/content\/editor\/([0-9a-f-]{36})$/);
      expect(action || draft, link).toBeTruthy();
      if (action) expect(actions.has(action[1]), link).toBe(true);
      if (draft) expect(drafts.has(draft[1]), link).toBe(true);
    }
    const text = rows.messages.map((m) => m.content_md).join('\n');
    for (const domain of text.match(/\b[a-z0-9-]+\.[a-z]{2,}\b/g) ?? []) {
      expect(domain, domain).toMatch(/\.example$/);
    }
  });
});

/** A client over `tables`, enough for build's reads and writes. */
function fakeDb(tables) {
  const writes = [];
  const from = (table) => {
    const q = { filters: [], op: 'select', payload: null };
    const run = () => {
      if (q.op === 'upsert') {
        writes.push(table);
        (tables[table] ??= []).push(...q.payload);
        return { data: null, error: null };
      }
      if (q.op === 'delete') {
        tables[table] = (tables[table] ?? []).filter(
          (r) => !q.filters.every(([c, v]) => r[c] === v),
        );
        return { data: null, error: null };
      }
      const hit = (tables[table] ?? []).filter((r) => q.filters.every(([c, v]) => r[c] === v));
      return { data: hit, error: null };
    };
    const chain = {
      select: () => chain,
      upsert: (payload) => ((q.op = 'upsert'), (q.payload = payload), chain),
      insert: (payload) => ((q.op = 'upsert'), (q.payload = payload), chain),
      delete: () => ((q.op = 'delete'), chain),
      eq: (c, v) => (q.filters.push([c, v]), chain),
      order: () => chain,
      limit: (n) => ((q.limit = n), chain),
      single: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (resolve, reject) => {
        const out = run();
        if (q.limit) out.data = out.data?.slice(0, q.limit);
        return Promise.resolve(out).then(resolve, reject);
      },
    };
    return chain;
  };
  return { from, writes };
}

describe('chat.build', () => {
  it('writes every person’s chats, each row after the one it points at', async () => {
    const tables = {
      brands: [{ id: BRAND_ID, organization_id: ORG_ID }],
      profiles: [
        { id: PEOPLE[0], organization_id: ORG_ID },
        { id: PEOPLE[1], organization_id: ORG_ID },
        { id: 'someone-else', organization_id: 'other-org' },
      ],
    };
    const db = fakeDb(tables);
    expect(await chat.build({ brandId: BRAND_ID, now: NOW, db })).toEqual({ chats: 10, people: 2 });
    expect(db.writes.slice(0, 3)).toEqual(['chat_conversations', 'chat_messages', 'chat_runs']);
    expect(db.writes.slice(3).sort()).toEqual([
      'chat_next_moves',
      'chat_run_events',
      'chat_run_steps',
    ]);
    expect(new Set(tables.chat_conversations.map((c) => c.user_id))).toEqual(new Set(PEOPLE));
  });

  it('writes nothing for an organization without people, and at most MAX_PEOPLE sets', async () => {
    const db = fakeDb({ brands: [{ id: BRAND_ID, organization_id: ORG_ID }], profiles: [] });
    expect(await chat.build({ brandId: BRAND_ID, now: NOW, db })).toEqual({ chats: 0, people: 0 });
    expect(db.writes).toEqual([]);

    const many = Array.from({ length: MAX_PEOPLE + 5 }, (_, i) => ({
      id: `p-${i}`,
      organization_id: ORG_ID,
    }));
    const big = fakeDb({ brands: [{ id: BRAND_ID, organization_id: ORG_ID }], profiles: many });
    expect(await chat.build({ brandId: BRAND_ID, now: NOW, db: big })).toMatchObject({
      people: MAX_PEOPLE,
    });
  });

  it('is cleared by its chats, the rest of its rows going with them', () => {
    // index.js clears a module's `tables` by brand before building it; the
    // messages, runs, steps, events and moves cascade from chat_conversations.
    expect(chat.tables).toEqual(['chat_conversations']);
    expect(chat.inPlace).toBeUndefined();
  });
});

describe('hideDemoChats', () => {
  it('deletes the demo brand’s chats only', async () => {
    const tables = {
      chat_conversations: [
        { id: 'c1', brand_id: BRAND_ID },
        { id: 'c2', brand_id: 'another-brand' },
      ],
    };
    await hideDemoChats(fakeDb(tables), BRAND_ID);
    expect(tables.chat_conversations.map((c) => c.id)).toEqual(['c2']);
  });
});
