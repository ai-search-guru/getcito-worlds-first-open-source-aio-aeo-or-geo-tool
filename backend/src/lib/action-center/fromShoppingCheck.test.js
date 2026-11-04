import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { fakeDb } from '../catalog/__fixtures__/fakeDb.js';
import {
  REST_DAYS,
  SHOPPING_LINKS_ACTION_KIND,
  shoppingLinksDedupKey,
  shoppingLinksTask,
  syncShoppingLinksAction,
} from './fromShoppingCheck.js';

/** A live page linking products that no longer sell (shopping path, part 7). */

const BRAND = 'brand-1';
const NOW = new Date('2026-10-27T09:00:00Z');
const PAGE = 'https://shop.example/blog/rain-jackets';
const DRAFT = { id: 'd1', title: 'Best rain jackets for 2026' };

const bad = (id, state = 'sold_out', title = `Jacket ${id}`) => ({ id, title, state });
const page = (badProducts, swaps = []) => ({
  draft: DRAFT,
  pageUrl: PAGE,
  check: { bad: badProducts, swaps },
});

describe('shoppingLinksTask', () => {
  it("names what no longer sells and why, the path's products to link instead, and how it's done", () => {
    const task = shoppingLinksTask({
      draftId: 'd1',
      pageUrl: PAGE,
      bad: [bad('p1', 'sold_out', 'Storm Shell 2'), bad('p2', 'refused', 'Pack-Lite Jacket')],
      swaps: [
        { id: 'p3', title: 'Storm Shell 3' },
        { id: 'p4', title: 'Pack-Lite Pro' },
      ],
    });
    expect(task.title).toBe('Swap the 2 products that no longer sell');
    expect(task.details).toMatchObject({
      source: 'shopping_check',
      draftId: 'd1',
      url: PAGE,
      where: PAGE,
      check: 'auto',
      type: 'content',
    });
    expect(task.details.why).toBe(
      "Storm Shell 2 is sold out; Pack-Lite Jacket is refused by Merchant Center. Readers and AI answers that follow those links land on a product they can't buy.",
    );
    expect(task.details.how).toEqual([
      'Open the page in the Content Editor.',
      'Remove or replace the links to Storm Shell 2 and Pack-Lite Jacket.',
      "Link Storm Shell 3 and Pack-Lite Pro instead: in stock, from the page's shopping path.",
      'Publish the page again.',
    ]);
    expect(task.details.doneWhen).toMatch(/after the next catalog sync/);
    // No change text: the nightly page sweep (AC-010) leaves it to the shopping check.
    expect(task.details.change).toBeUndefined();
  });

  it('names three products and counts the rest, and has no swap step without products to swap in', () => {
    const task = shoppingLinksTask({
      pageUrl: PAGE,
      bad: [bad('a'), bad('b'), bad('c'), bad('d', 'gone'), bad('e', 'sold_out', '')],
      swaps: [],
    });
    expect(task.title).toBe('Swap the 5 products that no longer sell');
    expect(task.details.why).toMatch(
      /^Jacket a is sold out; Jacket b .*; Jacket c .*; and 2 more\./,
    );
    expect(task.details.how).toEqual([
      'Open the page in the Content Editor.',
      'Remove or replace the links to Jacket a, Jacket b, Jacket c and 2 more.',
      'Publish the page again.',
    ]);
    const one = shoppingLinksTask({ pageUrl: PAGE, bad: [bad('a', 'gone', '')], swaps: [] });
    expect(one.title).toBe('Swap the product that no longer sells');
    expect(one.details.why).toMatch(/^A product is no longer in your catalog\./);
  });

  it('keeps a long name short in the steps', () => {
    const task = shoppingLinksTask({
      pageUrl: PAGE,
      bad: [bad('a', 'sold_out', 'x'.repeat(200))],
      swaps: [],
    });
    expect(task.details.how[1].length).toBeLessThan(120);
  });
});

describe('syncShoppingLinksAction', () => {
  it('opens a Fix action with one task and a History line for a live page linking a sold-out product', async () => {
    const fake = fakeDb();
    const result = await syncShoppingLinksAction(
      BRAND,
      page([bad('p1', 'sold_out', 'Storm Shell 2')], [{ id: 'p3', title: 'Storm Shell 3' }]),
      { db: fake.db, now: NOW },
    );
    expect(result).toBe('opened');
    const [action] = fake.rows('actions');
    expect(action).toMatchObject({
      brand_id: BRAND,
      kind: SHOPPING_LINKS_ACTION_KIND,
      category: 'fix',
      impact: 'medium',
      kpi_keys: [],
      dedup_key: shoppingLinksDedupKey('d1'),
      payload: {
        source: 'shopping_check',
        draftId: 'd1',
        title: 'Best rain jackets for 2026',
        pageUrl: PAGE,
        pages: [PAGE],
        productIds: ['p1'],
        soldOut: true,
        swaps: [{ id: 'p3', title: 'Storm Shell 3' }],
        targetEntity: 'pages',
        targetCount: 1,
        targets: [{ id: PAGE, label: 'Best rain jackets for 2026' }],
      },
    });
    expect(action.priority_score).toEqual(expect.any(Number));
    const [task] = fake.rows('action_tasks');
    expect(task).toMatchObject({
      action_id: action.id,
      position: 1,
      title: 'Swap the product that no longer sells',
      status: 'todo',
    });
    expect(fake.rows('action_events')).toEqual([
      expect.objectContaining({ action_id: action.id, event: 'created', actor_id: null }),
    ]);
  });

  it('weighs three or more products as high impact, and says when not all are sold out', async () => {
    const fake = fakeDb();
    await syncShoppingLinksAction(BRAND, page([bad('a'), bad('b', 'refused'), bad('c')]), {
      db: fake.db,
      now: NOW,
    });
    expect(fake.rows('actions')[0]).toMatchObject({
      impact: 'high',
      payload: { soldOut: false },
    });
  });

  it('keeps the open action while the page still links them: no second one', async () => {
    const fake = fakeDb();
    await syncShoppingLinksAction(BRAND, page([bad('p1')]), { db: fake.db, now: NOW });
    const again = await syncShoppingLinksAction(BRAND, page([bad('p1'), bad('p2')]), {
      db: fake.db,
      now: NOW,
    });
    expect(again).toBe('kept');
    expect(fake.rows('actions')).toHaveLength(1);
    expect(fake.rows('action_tasks')).toHaveLength(1);
  });

  it('completes its task as checked automatically and the action, each in its History, once the page links none', async () => {
    const fake = fakeDb();
    await syncShoppingLinksAction(BRAND, page([bad('p1')]), { db: fake.db, now: NOW });
    fake.rows('actions')[0].status = 'in_progress';
    const later = new Date('2026-10-28T09:00:00Z');
    const result = await syncShoppingLinksAction(BRAND, page([]), { db: fake.db, now: later });
    expect(result).toBe('closed');
    expect(fake.rows('actions')[0]).toMatchObject({
      status: 'completed',
      completed_at: later.toISOString(),
    });
    const [task] = fake.rows('action_tasks');
    expect(task).toMatchObject({ status: 'completed', skip_reason: null });
    // Its card's last check, as AC-010's checks keep it; the task's own details stay.
    expect(task.details).toMatchObject({
      source: 'shopping_check',
      draftId: 'd1',
      autoCheck: {
        at: later.toISOString(),
        triedAt: later.toISOString(),
        url: PAGE,
        passed: true,
        missing: [],
      },
    });
    // AC-010's line: "Checked automatically and done: {task}{title}".
    expect(fake.rows('action_events').map((e) => [e.event, e.data])).toEqual([
      ['created', expect.any(Object)],
      [
        'task_checked',
        { taskId: task.id, task: null, title: 'Swap the product that no longer sells' },
      ],
      ['status_changed', { to: 'completed', source: 'shopping_check' }],
    ]);
  });

  it("leaves the action open when someone's own task on it is still open", async () => {
    const fake = fakeDb();
    await syncShoppingLinksAction(BRAND, page([bad('p1')]), { db: fake.db, now: NOW });
    const [action] = fake.rows('actions');
    fake.rows('action_tasks').push({
      id: 't-own',
      action_id: action.id,
      position: 2,
      title: 'Tell the store team',
      status: 'todo',
      details: null,
    });
    const later = new Date('2026-10-28T09:00:00Z');
    const result = await syncShoppingLinksAction(BRAND, page([]), { db: fake.db, now: later });
    expect(result).toBe('kept');
    expect(action.status).toBe('new');
    // Its task done, the action moves up its list.
    expect(action.updated_at).toBe(later.toISOString());
    const statuses = Object.fromEntries(fake.rows('action_tasks').map((t) => [t.title, t.status]));
    expect(statuses).toEqual({
      'Swap the product that no longer sells': 'completed',
      'Tell the store team': 'todo',
    });
  });

  it("opens nothing for a page that links none, and none past the run's cap", async () => {
    const fake = fakeDb();
    expect(await syncShoppingLinksAction(BRAND, page([]), { db: fake.db, now: NOW })).toBe('none');
    expect(
      await syncShoppingLinksAction(BRAND, page([bad('p1')]), {
        db: fake.db,
        now: NOW,
        open: false,
      }),
    ).toBe('held');
    expect(fake.rows('actions')).toHaveLength(0);
  });

  it("doesn't raise the same products again once dismissed; a newly sold-out one does", async () => {
    const fake = fakeDb();
    await syncShoppingLinksAction(BRAND, page([bad('p1'), bad('p2')]), { db: fake.db, now: NOW });
    Object.assign(fake.rows('actions')[0], {
      status: 'dismissed',
      created_at: '2026-10-27T09:00:00Z',
    });
    const month = new Date('2026-11-27T09:00:00Z');
    expect(
      await syncShoppingLinksAction(BRAND, page([bad('p1')]), { db: fake.db, now: month }),
    ).toBe('resting');
    expect(
      await syncShoppingLinksAction(BRAND, page([bad('p1'), bad('p9')]), {
        db: fake.db,
        now: month,
      }),
    ).toBe('opened');
    expect(fake.rows('actions')).toHaveLength(2);
  });

  it(`raises a closed action's products again only after ${REST_DAYS} days`, async () => {
    const fake = fakeDb();
    await syncShoppingLinksAction(BRAND, page([bad('p1')]), { db: fake.db, now: NOW });
    // Marked done by hand while the page still links it.
    Object.assign(fake.rows('actions')[0], {
      status: 'completed',
      completed_at: NOW.toISOString(),
      created_at: NOW.toISOString(),
    });
    const soon = new Date(NOW.getTime() + (REST_DAYS - 1) * 86_400_000);
    expect(
      await syncShoppingLinksAction(BRAND, page([bad('p1')]), { db: fake.db, now: soon }),
    ).toBe('resting');
    const after = new Date(NOW.getTime() + (REST_DAYS + 1) * 86_400_000);
    expect(
      await syncShoppingLinksAction(BRAND, page([bad('p1')]), { db: fake.db, now: after }),
    ).toBe('opened');
  });

  it("reads only this brand's actions for the page", async () => {
    const fake = fakeDb();
    fake.rows('actions').push({
      id: 'other',
      brand_id: 'brand-2',
      dedup_key: shoppingLinksDedupKey('d1'),
      status: 'new',
      payload: {},
    });
    expect(await syncShoppingLinksAction(BRAND, page([bad('p1')]), { db: fake.db, now: NOW })).toBe(
      'opened',
    );
  });
});
