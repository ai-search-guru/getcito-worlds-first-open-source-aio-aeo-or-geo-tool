import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import {
  actionContextTags,
  actionEventText,
  actionGoal,
  actionTexts,
  assigneeLabel,
  eventTaskText,
  humanizeKind,
  labelInitials,
  pickedAssignee,
  taskText,
} from './display';
import { ACTION_KINDS } from './registry';
import type { ActionItem } from '@/lib/actions/actionCenter';
import messages from '../../../messages/en.json';

/** Resolves an actionCenter.actionTexts key the way next-intl would, minus
 *  the ICU formatting — enough to prove a key exists and is reached. */
const t = (key: string, values?: Record<string, string | number>) => {
  const scope: Record<string, unknown> = key.includes('.')
    ? (messages.actionCenter.actionTexts as unknown as Record<string, unknown>)
    : (messages.actionCenter.actionTasks as unknown as Record<string, unknown>);
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], scope);
  if (typeof value !== 'string') throw new Error(`missing message: ${key}`);
  // Enough ICU to prove the value reached the message; next-intl does the
  // real formatting at runtime. Plurals collapse to their `other` branch.
  return value
    .replace(/\{(\w+), plural, one \{[^}]*\} other \{([^}]*)\}\}/g, (_m, name, other) =>
      String(other).replace('#', String(values?.[name] ?? '')),
    )
    .replace(/\{\s*(\w+)\s*\}/g, (match, name) =>
      values && name in values ? String(values[name]) : match,
    );
};

const action = (over: Partial<ActionItem>) =>
  ({
    kind: 'recover_visibility',
    category: 'recover',
    payload: {},
    signalCount: 1,
    ...over,
  }) as ActionItem;

describe('actionTexts', () => {
  it.each(ACTION_KINDS)('has written copy for %s', (kind) => {
    expect(() => actionTexts(action({ kind }), t)).not.toThrow();
    expect(() => actionGoal(kind, t)).not.toThrow();
  });

  it("holds copy for all sixty-two definitions, the eleven person-sent kinds and the catalog check's", () => {
    expect(ACTION_KINDS).toHaveLength(74);
  });

  it('names a product or category sent from Product Visibility after it (ECOM-013)', () => {
    expect(
      actionTexts(action({ kind: 'shopping_product', payload: { title: 'Ridge 30L Backpack' } }), t)
        .title,
    ).toBe('Get Ridge 30L Backpack on the shelf');
    expect(
      actionTexts(action({ kind: 'shopping_category', payload: { title: 'Hiking backpacks' } }), t)
        .title,
    ).toBe('Win “Hiking backpacks” in AI answers');
    expect(actionContextTags(action({ kind: 'shopping_product', payload: {} }), t)).toEqual([]);
  });

  it('names pages sent from AI Traffic after their list and page, or how many (AT-006)', () => {
    const cited = {
      reason: 'cited_not_clicked',
      pageCount: 1,
      citations: 80,
      targetEntity: 'pages',
      targetCount: 1,
      targets: [{ id: '/guides/espresso', label: '/guides/espresso' }],
    };
    const texts = actionTexts(action({ kind: 'traffic_pages', payload: cited }), t);
    expect(texts.title).toBe('Turn AI answers citing /guides/espresso into visits');
    // Plurals read as their `other` branch here (see `t` above).
    expect(texts.description).toBe(
      'Sent from AI Traffic Analytics: AI answers cited these pages 80 times in the range, and none sent a visit.',
    );
    const skipped = {
      reason: 'no_ai_traffic',
      pageCount: 10,
      citations: 6,
      targetEntity: 'pages',
      targetCount: 10,
      targets: [{ id: '/gifts', label: '/gifts' }],
    };
    const many = actionTexts(action({ kind: 'traffic_pages', payload: skipped }), t);
    expect(many.title).toBe('Capture AI traffic for 10 pages');
    expect(many.description).toBe(
      'Sent from AI Traffic Analytics: 10 pages with visitors or in your sitemap that got no AI visit in the range.',
    );
    // An action without the list it came from still reads, from its targets.
    expect(
      actionTexts(
        action({ kind: 'traffic_pages', payload: { targetEntity: 'pages', targetCount: 2 } }),
        t,
      ).title,
    ).toBe('Earn AI visits for 2 pages');
    const tags = actionContextTags(
      action({ kind: 'traffic_pages', payload: skipped, signalCount: 0 }),
      (key: string) => key,
    );
    expect(tags).not.toContain('tags.signals');
  });

  it('names answers sent from Mentions after their prompt, or how many (MS-08)', () => {
    const one = { mentionCount: 3, negativeCount: 2, promptCount: 1, promptText: 'Best beans?' };
    const texts = actionTexts(action({ kind: 'mention_review', payload: one }), t);
    expect(texts.title).toBe('Improve how AI describes you for "Best beans?"');
    expect(texts.description).toBe(
      'Sent from Mentions: 3 answers naming your brand, 2 of them negative.',
    );
    const many = { mentionCount: 2, negativeCount: 0, promptCount: 4 };
    const manyTexts = actionTexts(action({ kind: 'mention_review', payload: many }), t);
    expect(manyTexts.title).toBe('Improve how AI describes you across 4 prompts');
    expect(manyTexts.description).toBe('Sent from Mentions: 2 answers naming your brand.');
    const tags = actionContextTags(
      action({ kind: 'mention_review', payload: many, signalCount: 0 }),
      (key: string) => key,
    );
    expect(tags).not.toContain('tags.signals');
    // Every prompt removed since (AC-009): its plain title, never "0 prompts".
    const none = { mentionCount: 2, negativeCount: 0, promptCount: 0 };
    expect(actionTexts(action({ kind: 'mention_review', payload: none }), t).title).toBe(
      t('mention_review.titleGeneric'),
    );
    // Its first prompt removed, the one left isn't the one promptText names.
    const left = {
      mentionCount: 3,
      negativeCount: 0,
      promptCount: 1,
      promptText: 'Best beans?',
      promptIds: ['p1', 'p2'],
      removedKeys: ['p1'],
    };
    expect(actionTexts(action({ kind: 'mention_review', payload: left }), t).title).toBe(
      t('mention_review.titleMany', { count: 1 }),
    );
    const otherRemoved = { ...left, removedKeys: ['p2'] };
    expect(actionTexts(action({ kind: 'mention_review', payload: otherRemoved }), t).title).toBe(
      'Improve how AI describes you for "Best beans?"',
    );
  });

  it('names a topic opportunity after its topic and demand (VIS-011)', () => {
    const payload = { topicName: 'GEO tools for agencies', demand: 92_000 };
    expect(actionTexts(action({ kind: 'topic_opportunity', payload }), t).title).toBe(
      'Capture 46–190k/mo of estimated AI demand in GEO tools for agencies',
    );
    const tags = actionContextTags(
      action({ kind: 'topic_opportunity', payload, signalCount: 0 }),
      (key: string) => key,
    );
    expect(tags).not.toContain('tags.signals');
  });

  it('names a topic gap after its topic, competitor and gap (VIS-010)', () => {
    const payload = { topicName: 'AI Rank Tracker', competitorName: 'Peec AI', gap: 26.5 };
    expect(actionTexts(action({ kind: 'topic_competitor_gap', payload }), t).title).toBe(
      'Close the 26.5-pt gap with Peec AI in AI Rank Tracker',
    );
    // Sent by a person: no "0 signals" chip.
    const tags = actionContextTags(
      action({ kind: 'topic_competitor_gap', payload, signalCount: 0 }),
      (key: string) => key,
    );
    expect(tags).not.toContain('tags.signals');
  });

  it('names an Improve action after its prompt, with its own why and goal', () => {
    const payload = {
      title: 'Improve position: "best coffee"',
      why: 'Not mentioned on Perplexity.',
      goal: 'Get the brand mentioned early and cited for "best coffee" on Perplexity.',
    };
    const texts = actionTexts(action({ kind: 'prompt_improve', payload }), t);
    expect(texts).toEqual({ title: payload.title, description: payload.why });
    expect(actionGoal('prompt_improve', t, payload)).toBe(payload.goal);
    expect(actionGoal('prompt_improve', t)).toBe(
      messages.actionCenter.actionTexts.prompt_improve.goal,
    );
  });

  it('names an opportunity action after the work it was sent for', () => {
    const texts = actionTexts(
      action({ kind: 'content_opportunity', payload: { title: 'Expand the tool list' } }),
      t,
    );
    expect(texts.title).toBe('Expand the tool list');
    // Its year as Content shows it: a past one reads as this year.
    const year = new Date().getUTCFullYear();
    const dated = actionTexts(
      action({ kind: 'content_opportunity', payload: { title: 'Best tools of 2025' } }),
      t,
    );
    expect(dated.title).toBe(`Best tools of ${Math.max(year, 2025)}`);
  });

  it('names a draft sent from the Content Editor after its page (CE-015)', () => {
    const write = actionTexts(
      action({
        kind: 'content_draft',
        payload: { title: 'CRM for real estate teams', method: 'create' },
      }),
      t,
    );
    expect(write.title).toBe('Write: CRM for real estate teams');
    expect(write.description).toBe(messages.actionCenter.actionTexts.content_draft.description);
    const optimize = actionTexts(
      action({ kind: 'content_draft', payload: { title: 'Pricing', method: 'optimize' } }),
      t,
    );
    expect(optimize.title).toBe('Optimize: Pricing');
    // An untitled draft is named by its prompts, as every kind is.
    expect(
      actionTexts(
        action({ kind: 'content_draft', payload: { targetCount: 3, targetEntity: 'prompts' } }),
        t,
      ).title,
    ).not.toBe('');
  });

  it('names a live page linking products that no longer sell after it (shopping path, part 7)', () => {
    const products = [
      { id: 'p1', title: 'Storm Shell 2', state: 'sold_out' },
      { id: 'p2', title: 'Pack-Lite Jacket', state: 'sold_out' },
    ];
    const soldOut = actionTexts(
      action({
        kind: 'shopping_links',
        payload: { title: 'Best rain jackets for 2026', products, soldOut: true },
      }),
      t,
    );
    expect(soldOut.title).toBe('Best rain jackets for 2026: 2 products are sold out');
    expect(soldOut.description).toContain('2 products');
    // Not all sold out, and no title: the page's path, and "no longer sells".
    expect(
      actionTexts(
        action({
          kind: 'shopping_links',
          payload: {
            pageUrl: 'https://shop.example/blog/rain-jackets/',
            products,
            soldOut: false,
          },
        }),
        t,
      ).title,
    ).toBe('/blog/rain-jackets: 2 products no longer sell');
    expect(actionContextTags(action({ kind: 'shopping_links', payload: {} }), t)).toEqual([]);
  });

  /**
   * The specification's title rule: "Recover 7 lost citations", never
   * "Recover citations". Every definition's title names its targets.
   */
  it.each(ACTION_KINDS)('%s names its targets in the title', (kind) => {
    const texts = actionTexts(
      action({ kind, payload: { targetCount: 7, targetEntity: 'prompts' } }),
      t,
    );
    if (messages.actionCenter.actionTexts[kind].title.includes('{targets}')) {
      expect(texts.title).toContain('7 prompts');
    }
  });

  /** An action raised before the library has no targets on its payload, and
   *  must not read "0 prompts". */
  it('falls back to a title without a count', () => {
    const texts = actionTexts(action({ kind: 'recover_lost_citations', payload: {} }), t);
    expect(texts.title).toBe(messages.actionCenter.actionTexts.recover_lost_citations.titleGeneric);
  });

  /**
   * The server's definition registry grows on its own release cycle, so the
   * web will meet kinds it has never heard of. Hiding them was the old
   * behaviour and the wrong one: the work is real, and a row nobody can read
   * still beats a row nobody sees.
   */
  it('presents a kind it has never heard of rather than failing on it', () => {
    const texts = actionTexts(action({ kind: 'seize_the_means', category: 'growth' }), t);

    expect(texts.title).toBe('Seize the means');
    expect(texts.description).toBe(messages.actionCenter.actionTexts.unknown.description);
    expect(actionGoal('seize_the_means', t)).toBe(messages.actionCenter.actionTexts.unknown.goal);
  });
});

/** A page sent from a Site Audit report (learning D2). */
describe('actionTexts for a page sent from Site Audit', () => {
  const tTexts = createTranslator({
    locale: 'en',
    messages,
    namespace: 'actionCenter.actionTexts',
  });
  it('names the page and how many checks it fails', () => {
    expect(
      actionTexts(
        {
          kind: 'audit_page',
          payload: {
            targets: [{ id: 'https://acme.example/blog/espresso', label: '/blog/espresso' }],
            checks: [{ key: 'faq-schema' }, { key: 'json-ld-validity' }],
          },
        },
        tTexts as unknown as (key: string, values?: Record<string, string | number>) => string,
      ),
    ).toEqual({
      title: 'Fix the issues Site Audit found on /blog/espresso',
      description:
        'Sent from Site Audit: the page fails 2 checks. Audit it again once fixed to see them pass.',
    });
  });
});

describe('actionTexts for a finding sent from Chat', () => {
  it('reads the title and the finding the person approved, and its goal', () => {
    const sent = action({
      kind: 'chat_finding',
      payload: {
        source: 'chat',
        title: 'Win back pricing citations on /pricing',
        why: 'Google AI Overviews stopped citing /pricing for 2 prompts.',
        goal: 'Get /pricing cited again for pricing prompts.',
      },
    });
    expect(actionTexts(sent, t)).toEqual({
      title: 'Win back pricing citations on /pricing',
      description: 'Google AI Overviews stopped citing /pricing for 2 prompts.',
    });
    expect(actionGoal('chat_finding', t, sent.payload)).toBe(
      'Get /pricing cited again for pricing prompts.',
    );
    expect(actionGoal('chat_finding', t, {})).toBe(
      'Do the tasks, so the prompts and pages this finding names move in AI answers.',
    );
    // No detection signals: no "0 signals" chip.
    expect(actionContextTags({ ...sent, signalCount: 0 }, t)).toEqual([]);
  });
});

describe('humanizeKind', () => {
  it('reads a definition id as the phrase it was written to be', () => {
    expect(humanizeKind('expand_platform_visibility')).toBe('Expand platform visibility');
  });

  it('leaves a single word alone but for its capital', () => {
    expect(humanizeKind('recover')).toBe('Recover');
  });
});

describe('taskText', () => {
  it('names what a library task acts on', () => {
    expect(
      taskText(
        {
          taskKey: 'analyze_citations',
          title: null,
          titleParams: { count: 11, entity: 'sources' },
        },
        t,
      ),
    ).toBe('Analyze citations across 11 sources');
  });

  /** Nothing about a planned task's text is stored — only which message it
   *  is and what it names — so the plan survives translation. */
  it('renders the target variant when the planner resolved one', () => {
    const text = taskText(
      {
        taskKey: 'compare_platforms',
        title: null,
        titleParams: { platform: 'gemini-web', bestPlatform: 'chatgpt-web' },
      },
      t,
    );

    expect(text).toContain('gemini-web');
    expect(text).toContain('chatgpt-web');
  });

  it('falls back to the plain message when nothing was resolvable', () => {
    expect(taskText({ taskKey: 'compare_platforms', title: null, titleParams: {} }, t)).toBe(
      messages.actionCenter.actionTasks.compare_platforms,
    );
  });

  it('treats a task with no params at all like one with empty params', () => {
    expect(taskText({ taskKey: 'validate', title: null }, t)).toBe(
      messages.actionCenter.actionTasks.validate,
    );
  });

  /** A title someone typed wins over any template, params or not. */
  it('prefers what the user wrote', () => {
    expect(
      taskText({ taskKey: 'validate', title: 'Ask the agency', titleParams: { a: 1 } }, t),
    ).toBe('Ask the agency');
  });

  it('renders nothing for a task with neither a title nor a key', () => {
    expect(taskText({ taskKey: null, title: null }, t)).toBe('');
  });
});

/**
 * Events carry a task's key, not its text: an event records what happened,
 * and the text is a rendering choice that may change afterwards.
 */
describe('eventTaskText', () => {
  const withHas = Object.assign((key: string) => t(key), {
    has: (key: string) => key in messages.actionCenter.actionTasks,
  });

  it('renders the task in the reader’s language', () => {
    expect(eventTaskText('validate', withHas)).toBe(messages.actionCenter.actionTasks.validate);
  });

  /** A task this build has no copy for still has to read as a sentence. */
  it('humanises a key it has no copy for', () => {
    expect(eventTaskText('seize_the_means', withHas)).toBe('seize the means');
  });

  it('renders nothing when the event named no task', () => {
    expect(eventTaskText(undefined, withHas)).toBe('');
    expect(eventTaskText('', withHas)).toBe('');
    expect(eventTaskText(42, withHas)).toBe('');
  });
});

describe('actionEventText', () => {
  const page = createTranslator({ locale: 'en', messages, namespace: 'actionCenter.actionsPage' });
  const tPage = (key: string, values?: Record<string, string | number>) =>
    page(key as Parameters<typeof page>[0], values);
  const event = (name: string, data: Record<string, unknown>) => ({
    id: 'e1',
    event: name,
    data,
    actorId: null,
    createdAt: '2026-10-16T00:00:00Z',
  });

  it('names a task sent onward and where it went', () => {
    expect(
      actionEventText(
        event('task_sent', { to: 'content', title: 'Add a table to /pricing' }),
        tPage,
        t,
      ),
    ).toBe('Sent to Content: Add a table to /pricing');
    expect(actionEventText(event('task_sent', { to: 'webhook', title: 'x' }), tPage, t)).toBe(
      'Sent to the webhook: x',
    );
    // Added to the open opportunity on its question instead of a second one.
    expect(
      actionEventText(event('task_sent', { to: 'content', merged: true, title: 'x' }), tPage, t),
    ).toBe('Added to the open Content opportunity for the same question: x');
  });

  it('says a stale action was kept (00432)', () => {
    expect(actionEventText(event('still_relevant', {}), tPage, t)).toBe(
      'Kept as still relevant: no longer stale',
    );
  });

  it('names a Chat agent run on the action, how it ended, and Run with Chat (W2-17)', () => {
    expect(
      actionEventText(
        event('agent_run_started', { source: 'chat', agent: 'Citation win-back' }),
        tPage,
        t,
      ),
    ).toBe('Agent run started · Citation win-back');
    expect(
      actionEventText(
        event('agent_run_completed', { agent: 'Citation win-back', to: 'done' }),
        tPage,
        t,
      ),
    ).toBe('Agent run completed · Citation win-back');
    expect(
      actionEventText(
        event('agent_run_completed', {
          agent: 'Citation win-back',
          to: 'stopped',
          stop_reason: 'action_closed',
        }),
        tPage,
        t,
      ),
    ).toBe('Agent run stopped · Citation win-back · action closed');
    expect(actionEventText(event('chat_started', { source: 'chat' }), tPage, t)).toBe(
      'Chat started on this action',
    );
    // A page the agent sent out on its own (AUTONOMOUS-GO-LIVE §6.4).
    expect(
      actionEventText(
        event('agent_went_live', {
          source: 'chat',
          agent: 'Publisher',
          title: 'Pricing FAQ',
          to: 'Webflow',
        }),
        tPage,
        t,
      ),
    ).toBe('Publisher sent “Pricing FAQ” to Webflow on its own');
    expect(
      actionEventText(
        event('agent_went_live', { agent: null, title: 'Pricing FAQ', to: 'Wix' }),
        tPage,
        t,
      ),
    ).toBe('An agent sent “Pricing FAQ” to Wix on its own');
    // A deleted agent's lines end without a name, and without an empty separator.
    expect(actionEventText(event('agent_run_started', { agent: null }), tPage, t)).toBe(
      'Agent run started',
    );
    expect(
      actionEventText(event('agent_run_completed', { agent: null, to: 'failed' }), tPage, t),
    ).toBe('Agent run failed');
  });

  it('reads the 30-day position result with its counts', () => {
    expect(
      actionEventText(event('position_outcome_recorded', { improved: 2, measurable: 3 }), tPage, t),
    ).toBe('30-day result: position improved on 2 of 3 platforms');
    expect(
      actionEventText(event('position_outcome_recorded', { improved: 0, measurable: 0 }), tPage, t),
    ).toBe('30-day result: not enough data to compare positions');
  });

  it('names a checked task once: its title when renamed, else its library name (#1565)', () => {
    expect(
      actionEventText(event('task_checked', { task: 'refresh_content', title: null }), tPage, t),
    ).toBe('Checked automatically and done: Refresh outdated content');
    // A line written before the API sent one name carries both: the title alone.
    expect(
      actionEventText(
        event('task_checked', { task: 'refresh_content', title: 'Refresh the pricing page' }),
        tPage,
        t,
      ),
    ).toBe('Checked automatically and done: Refresh the pricing page');
  });

  /** What Chat did, from its History events (CHAT-09 §D–E; the owner's decision of 2026-10-31). */
  it('says an action came from Chat, and what Chat attached, added or finished', () => {
    expect(actionEventText(event('created', { source: 'chat' }), tPage, t)).toBe(
      'Action created from Chat',
    );
    expect(actionEventText(event('created', { source: 'traffic_pages' }), tPage, t)).toBe(
      'Action created',
    );
    expect(actionEventText(event('created', {}), tPage, t)).toBe('Action created');
    expect(
      actionEventText(
        event('file_attached', {
          source: 'chat',
          task: null,
          title: 'Add a pricing FAQ block to /pricing',
          file: 'Pricing FAQ',
        }),
        tPage,
        t,
      ),
    ).toBe('Attached from Chat to Add a pricing FAQ block to /pricing: “Pricing FAQ”');
    // A library task is named by its template, once.
    expect(
      actionEventText(
        event('task_ready_for_review', { source: 'chat', task: 'refresh_content', title: null }),
        tPage,
        t,
      ),
    ).toBe('Ready for review, from Chat: Refresh outdated content');
    expect(
      actionEventText(
        event('evidence_attached', { source: 'chat', finding: 'Lost 6 citations on /pricing.' }),
        tPage,
        t,
      ),
    ).toBe('Finding added from Chat: “Lost 6 citations on /pricing.”');
    // Undo of an action Chat sent, by who clicked it (CHAT-20 §10b).
    expect(
      actionEventText(event('cancelled', { source: 'chat', via: 'undo', by: 'Alex' }), tPage, t),
    ).toBe('Cancelled from Chat by Alex · undo');
    expect(actionEventText(event('cancelled', { source: 'chat', by: null }), tPage, t)).toBe(
      'Cancelled from Chat by a teammate · undo',
    );
    // A finding added with its note and sources, and which one was withdrawn.
    expect(
      actionEventText(
        event('evidence_attached', {
          source: 'chat',
          finding: 'Lost 6 citations.',
          note: 'Same pages as this action',
          sources: ['Citations', '/pricing'],
        }),
        tPage,
        t,
      ),
    ).toBe(
      'Finding added from Chat: “Lost 6 citations.” · Note: Same pages as this action · From: Citations, /pricing',
    );
    expect(
      actionEventText(
        event('evidence_withdrawn', { source: 'chat', finding: 'Lost 6 citations.' }),
        tPage,
        t,
      ),
    ).toBe('Finding from Chat withdrawn with Undo: “Lost 6 citations.”');
  });

  it("passes a task's own title and the measured verdict", () => {
    expect(actionEventText(event('task_added', { title: 'Ask the agency' }), tPage, t)).toBe(
      'Task added: “Ask the agency”',
    );
    expect(actionEventText(event('outcome_measured', { outcome: 'improved' }), tPage, t)).toBe(
      'Result: metrics improved after this action closed',
    );
  });

  /** Read three times after the close, each result names its day (learning B1). */
  it('names the reading a result came from, and the final one', () => {
    expect(
      actionEventText(event('outcome_measured', { outcome: 'improved', day: 14 }), tPage, t),
    ).toBe('Day 14 · Result: metrics improved after this action closed');
    expect(
      actionEventText(
        event('outcome_measured', { outcome: 'mixed', day: 30, final: true }),
        tPage,
        t,
      ),
    ).toBe('Day 30, final · Result: mixed after this action closed');
  });
});

/**
 * Every event written to an action's trail is a line in the drawer's History
 * tab, and an event with no message there shows next-intl's missing-message
 * text instead. The events are read from the source that writes them — the
 * server actions and the Node server's Action Center engine — so one added
 * there without copy fails here, not in the drawer.
 */
describe('History events', () => {
  const source = readFileSync(join(__dirname, '../actions/actionCenter.ts'), 'utf8');
  const logged = [...source.matchAll(/logEvent\(\s*\w+,\s*\w+,\s*'(\w+)'/g)].map(
    (match) => match[1],
  );

  // The engine writes through a `logEvent(actionId, 'event', …)` helper or
  // inserts the row itself with `event: 'event'`.
  const engineDir = join(__dirname, '../../../../backend/src/lib/action-center');
  const written = readdirSync(engineDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.js') && !file.endsWith('.test.js'))
    .flatMap((file) => [
      ...readFileSync(join(engineDir, file), 'utf8').matchAll(
        /logEvent\(\s*[\w.]+,\s*'(\w+)'|event: '(\w+)'/g,
      ),
    ])
    .map((match) => match[1] ?? match[2]);

  // Chat writes its own (CHAT-09 §D–E): its changes, and their Undo.
  const chatWritten = ['../actions/chatActionCenter.ts', '../chat/undoActionCenter.ts'].flatMap(
    (file) =>
      [
        ...readFileSync(join(__dirname, file), 'utf8').matchAll(
          /event: '(\w+)'|historyEvent\([^,]+,\s*'(\w+)'/g,
        ),
      ].map((match) => match[1] ?? match[2]),
  );

  const tPage = createTranslator({
    locale: 'en',
    messages,
    namespace: 'actionCenter.actionsPage',
    onError: (error) => {
      throw error;
    },
  });
  /** The values the drawer formats every event with. */
  const values = {
    to: 'done',
    count: 2,
    task: 'Validate the change',
    tool: 'site_audit',
    improved: 1,
    measurable: 2,
    title: 'Ask the agency',
    outcome: 'improved',
    reviews: 0,
    day: 0,
    final: 'no',
    source: '',
    finding: 'Lost 6 citations',
    file: 'Pricing FAQ',
    by: 'Alex',
  };
  const eventText = (event: string, data: Partial<typeof values> = {}) =>
    tPage(`drawer.events.${event}` as Parameters<typeof tPage>[0], { ...values, ...data });

  /** A pattern that stopped matching would pass every check below by
   *  checking nothing. */
  it('reads the events the server actions log', () => {
    expect(logged).toEqual(
      expect.arrayContaining(['status_changed', 'task_added', 'task_edited', 'task_deleted']),
    );
  });

  it('reads the events the Node server writes', () => {
    expect(written).toEqual(
      expect.arrayContaining([
        'created',
        'signals_linked',
        'task_ran',
        'task_run_failed',
        'task_awaiting_approval',
        'position_outcome_recorded',
        'outcome_measured',
      ]),
    );
  });

  it("reads the events Chat writes, and their Undo's", () => {
    expect(chatWritten.sort()).toEqual([
      'cancelled',
      'evidence_attached',
      'evidence_withdrawn',
      'file_attached',
      'file_detached',
      'task_ready_for_review',
      'task_review_withdrawn',
    ]);
  });

  it.each([...new Set([...logged, ...written, ...chatWritten])])(
    'has a History line for %s',
    (event) => {
      expect(() => eventText(event)).not.toThrow();
    },
  );

  /** Tasks the writer left for review are said after the ones it wrote (AC-010). */
  it('says how many tasks wait for review, when any do', () => {
    expect(eventText('tasks_generated', { count: 3 })).toBe(
      "3 tasks written from the action's evidence",
    );
    expect(eventText('tasks_generated', { count: 0, reviews: 2 })).toBe(
      "0 tasks written from the action's evidence; 2 wait for review",
    );
  });

  /** A task its automatic check closed, named as the drawer names it (AC-010). */
  it('says a task passed its automatic check', () => {
    expect(eventText('task_checked', { task: 'Refresh outdated content', title: '' })).toBe(
      'Checked automatically and done: Refresh outdated content',
    );
  });

  /** The validation sweep records one of four verdicts, and each reads in
   *  words — "after this action closed", never "because of it". */
  it.each([
    ['improved', 'Result: metrics improved after this action closed'],
    ['declined', 'Result: metrics declined after this action closed'],
    ['no_meaningful_change', 'Result: no meaningful change in metrics after this action closed'],
    ['not_measurable', 'Result: could not be measured'],
  ])('says what the measurement found: %s', (outcome, text) => {
    expect(eventText('outcome_measured', { outcome })).toBe(text);
  });

  /** A verdict this build has no words for still reads as a result. */
  it('reads an unknown or missing verdict as a plain result', () => {
    expect(eventText('outcome_measured', { outcome: 'pending_measurement' })).toBe(
      'Result measured',
    );
    expect(eventText('outcome_measured', { outcome: '' })).toBe('Result measured');
  });

  /** A task someone added or renamed is named as they typed it. */
  it('names the task in its own words', () => {
    expect(eventText('task_added')).toBe('Task added: “Ask the agency”');
    expect(eventText('task_renamed')).toBe('Task renamed to “Ask the agency”');
    expect(eventText('task_deleted')).toBe('Task deleted');
  });
});

describe('pickedAssignee', () => {
  const members = [
    { userId: 'u1', email: 'ada@acme.example', fullName: 'Ada Lovelace', avatarUrl: 'a.png' },
    { userId: 'u2', email: 'cg@acme.example', fullName: null, avatarUrl: null },
  ];

  it("shows the picked member at once, a nameless one by e-mail (#1147's patch)", () => {
    expect(pickedAssignee('u1', members)).toEqual({
      id: 'u1',
      fullName: 'Ada Lovelace',
      avatarUrl: 'a.png',
      email: 'ada@acme.example',
    });
    const nameless = pickedAssignee('u2', members);
    expect(nameless?.email).toBe('cg@acme.example');
    expect(assigneeLabel(nameless!)).toBe('cg@acme.example');
  });

  it('is nobody for Unassigned, and an id alone for a member the list no longer has', () => {
    expect(pickedAssignee(null, members)).toBeNull();
    expect(pickedAssignee('gone', members)).toEqual({
      id: 'gone',
      fullName: null,
      avatarUrl: null,
      email: null,
    });
  });
});

describe('assigneeLabel and labelInitials', () => {
  it('names an assignee by name, else by e-mail, else not at all', () => {
    expect(assigneeLabel({ fullName: ' Ada Lovelace ', email: 'ada@acme.example' })).toBe(
      'Ada Lovelace',
    );
    expect(assigneeLabel({ fullName: null, email: 'cg@acme.example' })).toBe('cg@acme.example');
    expect(assigneeLabel({ fullName: '  ', email: null })).toBeNull();
    expect(assigneeLabel({ fullName: null })).toBeNull();
  });

  it("takes up to two initials from a name's words or an e-mail's name", () => {
    expect(labelInitials('Ada Lovelace')).toBe('AL');
    expect(labelInitials('ada.lovelace@acme.example')).toBe('AL');
    expect(labelInitials('cg@acme.example')).toBe('C');
    expect(labelInitials('Grace Brewster Hopper')).toBe('GB');
  });
});
