// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CHAT_EVENT_TYPES,
  CHAT_STEP_KINDS,
  chatEvent,
  clientEventProblems,
  isChatEventType,
  isChatHref,
  maskIds,
  type ChatDeliverable,
  type ChatEvent,
  type ChatEventPayloads,
  type ChatEventType,
  type ChatForbiddenKey,
  type ChatHref,
  type ChatStep,
} from './events';

/**
 * Chat's streamed events: one of every type goes to the browser; none of
 * them carries a tool's name, a debug record, an id field, money or a link
 * out of the app, and a uuid in their text shows as "…".
 */

const UUID = '7d3f2c1a-9b8e-4c6d-a5f4-3e2d1c0b9a87';
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EDITOR: ChatHref = `/dashboard/content/editor/${UUID}`;

const STEP: ChatStep = {
  n: 2,
  kind: 'read',
  status: 'done',
  label: 'Read Citations',
  detail: 'Pricing prompts · Last 30 days · ChatGPT, Perplexity · 42 rows',
  scope: {
    subject: 'Pricing prompts',
    dateRange: 'Last 30 days',
    platforms: ['ChatGPT', 'Perplexity'],
  },
  rowCount: 42,
  dataAsOf: '2026-10-29T06:00:00.000Z',
};

const SUMMARY = {
  workingMs: 72_000,
  stepCount: 7,
  sources: [
    { label: 'Citations', count: 42 },
    { label: 'Prompts', count: 12 },
  ],
};

const DELIVERABLE: ChatDeliverable = {
  title: 'Pricing FAQ',
  type: 'document',
  formats: ['md', 'docx'],
  status: 'draft',
  href: EDITOR,
};

/** One of every type, as the stream would send it. */
const SAMPLES: { [K in ChatEventType]: () => Extract<ChatEvent, { type: K }> } = {
  'step.started': () => chatEvent('step.started', 1, { step: { ...STEP, status: 'running' } }),
  'step.updated': () => chatEvent('step.updated', 2, { step: { ...STEP, status: 'running' } }),
  'step.finished': () => chatEvent('step.finished', 3, { step: STEP }),
  'text.delta': () => chatEvent('text.delta', 4, { text: 'Citations on Perplexity fell **18%**' }),
  'text.replaced': () =>
    chatEvent('text.replaced', 5, { text: "Perplexity'deki atıflar **%18** düştü" }),
  'ask.created': () =>
    chatEvent('ask.created', 5, {
      n: 3,
      question: 'Which pages should I check?',
      options: [
        { label: '/pricing', detail: 'Lost 6 citations', recommended: true },
        { label: 'Generate an image', costMultiplier: 2 },
      ],
      allowOther: true,
      multi: false,
    }),
  'deliverable.created': () => chatEvent('deliverable.created', 6, DELIVERABLE),
  'why.ready': () =>
    chatEvent('why.ready', 6, {
      n: 1,
      metric: 'citations',
      unit: 'pts',
      periodA: { from: '2026-10-12', to: '2026-10-18' },
      periodB: { from: '2026-10-19', to: '2026-10-25' },
      valueA: 58,
      valueB: 52,
      delta: -6,
      se: 0.8,
      noise: 'beyond_normal_swing',
      direction: 'declined',
      changeDay: '2026-10-24',
      causes: [
        {
          kind: 'lost_citation_to_competitor',
          share: 62,
          points: -3.7,
          offset: false,
          confidence: 'high',
          cells: 14,
          urls: ['acme.example/blog/what-is-aeo'],
          rows: [
            {
              prompt: 'what is answer engine optimization',
              before: 'acme.example/blog/what-is-aeo',
              now: 'lumora.example/aeo-guide-2026',
              date: '2026-10-23',
              answer: true,
            },
          ],
        },
      ],
      remainder: { kind: 'unexplained', points: -2.3, share: 38 },
      excludedCells: 2,
      stableCells: 40,
      partial: false,
      engines: ['google-aio'],
      runs: { a: 214, b: 198, cells: 42 },
    }),
  'confirm.required': () =>
    chatEvent('confirm.required', 7, {
      n: 4,
      action: 'Add 12 prompts to tracking',
      target: 'Pricing · Northwind CRM',
      digest: '3f2a9c0d41b7e6a85c1d2e3f',
      canDontAskAgain: false,
    }),
  next_moves: () =>
    chatEvent('next_moves', 8, {
      moves: [{ label: 'Turn this into actions', prompt: 'Turn these findings into actions' }],
    }),
  'usage.updated': () => chatEvent('usage.updated', 9, { percentUsed: 44, runPercent: 0.3 }),
  'run.finished': () =>
    chatEvent('run.finished', 10, {
      ...SUMMARY,
      generatedAt: '2026-10-29T09:14:00.000Z',
      dataAsOf: '2026-10-29T06:00:00.000Z',
    }),
  'run.error': () => chatEvent('run.error', 11, { ...SUMMARY, code: 'timeout' }),
  'run.paused_cap': () => chatEvent('run.paused_cap', 12, SUMMARY),
  'run.stopped': () => chatEvent('run.stopped', 17, { ...SUMMARY, reason: 'person' }),
  'access.denied': () =>
    chatEvent('access.denied', 18, {
      asked: 'You asked: Save drafts in Content · Pricing FAQ.',
      rule: {
        kind: 'role',
        detail: "Your role is Analyst, and Analysts can't do this.",
        source: 'Settings › Team › Roles & access',
      },
      whoCan: 'Admins and Managers can do this.',
      nextActions: ['ask_admin', 'see_access'],
    }),
  'action.sent': () =>
    chatEvent('action.sent', 19, {
      kind: 'action_created',
      actionNo: 1271,
      title: 'Win back pricing citations on /pricing',
      href: `/dashboard/action-center/actions/${UUID}`,
    }),
  'tasks.updated': () =>
    chatEvent('tasks.updated', 20, {
      tasks: [
        {
          at: 1,
          title: 'Add FAQ block + schema to /pricing',
          priority: 86,
          category: 'fix',
          status: 'writing',
          due: '2026-11-01',
        },
      ],
      ready: 0,
      total: 1,
      due: 1,
    }),
  'deliverable.updated': () => chatEvent('deliverable.updated', 13, { ...DELIVERABLE, version: 2 }),
  'suggestion.created': () => chatEvent('suggestion.created', 14, { count: 3 }),
  'suggestion.resolved': () => chatEvent('suggestion.resolved', 15, { count: 1 }),
  'page.opened': () => chatEvent('page.opened', 16, { where: 'here', href: EDITOR }),
  'whats_new.ready': () =>
    chatEvent('whats_new.ready', 17, {
      entries: [
        {
          slug: 'agent-center',
          feature: 'Agent Center',
          lines: ['Why.', 'What.', 'How it helps.'],
          href: '/dashboard/agents',
          onPlans: 'Growth and Enterprise',
        },
      ],
    }),
};

/** Every key in a type, at any depth. */
type KeysDeep<T> = T extends readonly (infer U)[]
  ? KeysDeep<U>
  : T extends object
    ? { [K in keyof T]-?: K | KeysDeep<T[K]> }[keyof T]
    : never;

/** Builds a step event with one key the types don't allow, as loose code could. */
const stepWith = (key: string, value: unknown = 'x') =>
  chatEvent('step.finished', 1, { step: { ...STEP, [key]: value } as ChatStep });

/** The keys a payload may never have, each as loose code could spell it. */
const FORBIDDEN = {
  tool: [
    'tool',
    'tools',
    'toolName',
    'tool_name',
    'toolCall',
    'toolInput',
    'toolOutput',
    'toolResult',
  ],
  raw: ['input', 'output', 'args', 'arguments', 'params'],
  debug: ['debug', 'debug_json', 'debugJson', 'tokens', 'tokensIn', 'promptTokens', 'latencyMs'],
  money: ['usd', 'costUsd', 'cost_usd', 'dollars', 'price', 'priceCents', 'amount', 'spend'],
  cost: ['cost', 'runCost', 'run_cost', 'cents', 'run_cents'],
  id: ['id', 'ids', 'brandId', 'brand_id', 'promptIds', 'citation_ids'],
};

describe('chat events', () => {
  it('lists every type once, and builds each one for the browser', () => {
    expect([...CHAT_EVENT_TYPES].sort()).toEqual(Object.keys(SAMPLES).sort());
    for (const type of CHAT_EVENT_TYPES) {
      const event = SAMPLES[type]();
      expect(event.type).toBe(type);
      expect(clientEventProblems(event)).toEqual([]);
    }
  });

  it('sends no tool, debug, id or money field, and no uuid outside a link', () => {
    const events = CHAT_EVENT_TYPES.map((type) => SAMPLES[type]());
    const wire = JSON.stringify(events, (key, value) => (key === 'href' ? undefined : value));
    expect(wire).not.toMatch(/"tools?([A-Z_]\w*)?":|"(input|output|args|arguments|params)":/);
    expect(wire).not.toMatch(/"[^"]*(debug|token|latency|usd|dollar|price|amount|spend)[^"]*":/i);
    expect(wire).not.toMatch(/"(\w*_)?(cost|cents?)":|"\w*[a-z0-9](Cost|Cents?)":/);
    expect(wire).not.toMatch(/"(\w*_ids?|\w*[a-z]Ids?|ids?)":/);
    expect(wire).not.toMatch(UUID_ANYWHERE);
  });

  it('has no forbidden key in any payload type', () => {
    type PayloadKey = KeysDeep<ChatEventPayloads[ChatEventType]>;
    expectTypeOf<Extract<PayloadKey, ChatForbiddenKey>>().toBeNever();
  });

  it('names every forbidden key in the type too', () => {
    // Each spelling the run-time check refuses is a ChatForbiddenKey…
    expectTypeOf<
      'toolInput' | 'toolOutput' | 'toolResult' | 'params'
    >().toExtend<ChatForbiddenKey>();
    expectTypeOf<'tokensIn' | 'latencyMs' | 'debugJson'>().toExtend<ChatForbiddenKey>();
    expectTypeOf<
      'costUsd' | 'priceCents' | 'runCost' | 'run_cost' | 'amount'
    >().toExtend<ChatForbiddenKey>();
    expectTypeOf<'brandId' | 'brand_id' | 'promptIds'>().toExtend<ChatForbiddenKey>();
    // …and the keys a payload has, or may, aren't.
    expectTypeOf<
      Extract<
        'tooltip' | 'costMultiplier' | 'runPercent' | 'percentUsed' | 'href',
        ChatForbiddenKey
      >
    >().toBeNever();
  });

  it("refuses a tool's name, even when the types are got around", () => {
    expect(() =>
      chatEvent('step.started', 1, {
        step: {
          n: 1,
          kind: 'read',
          status: 'running',
          label: 'Read Citations',
          // @ts-expect-error a step has no tool: the browser never gets one
          tool: 'list_citations',
        },
      }),
    ).toThrow(/event\.data\.step\.tool: a tool or its input or output/);
    for (const key of [...FORBIDDEN.tool, ...FORBIDDEN.raw]) {
      expect(() => stepWith(key), key).toThrow(`step.${key}: a tool or its input or output`);
    }
  });

  it('refuses a debug record, tokens or latency', () => {
    for (const key of FORBIDDEN.debug) {
      expect(() => stepWith(key, { brand: 'Northwind' }), key).toThrow(
        `step.${key}: a debug record`,
      );
    }
  });

  it('refuses money: usage is a percent of the monthly limit', () => {
    for (const key of [...FORBIDDEN.money, ...FORBIDDEN.cost]) {
      const usage = { percentUsed: 44, [key]: 0.04 } as { percentUsed: number };
      expect(() => chatEvent('usage.updated', 1, usage), key).toThrow(`data.${key}: money`);
    }
  });

  it('refuses an id field, by any name', () => {
    for (const key of FORBIDDEN.id) {
      const step = { ...STEP, scope: { ...STEP.scope, [key]: 'x' } } as ChatStep;
      expect(() => chatEvent('step.finished', 1, { step }), key).toThrow(`scope.${key}: an id`);
    }
  });

  it('lets through the keys that only look alike', () => {
    for (const key of ['tooltip', 'costMultiplier', 'runPercent', 'percentUsed', 'stepCount']) {
      expect(() => stepWith(key), key).not.toThrow();
    }
  });

  it('shows a uuid in the text as "…" instead of stopping the run', () => {
    const step = chatEvent('step.finished', 1, {
      step: {
        ...STEP,
        label: `Opened /products/${UUID}`,
        scope: { platforms: ['ChatGPT', UUID.toUpperCase()] },
      },
    }).data.step;
    expect(step.label).toBe('Opened /products/…');
    expect(step.scope?.platforms).toEqual(['ChatGPT', '…']);

    const confirm = chatEvent('confirm.required', 1, {
      n: 1,
      action: 'Archive 3 prompts',
      target: `See https://example.com/a/${UUID}?b=${UUID}`,
      digest: '9c0d41b7e6a85c1d2e3f3f2a',
      canDontAskAgain: false,
    }).data;
    expect(confirm.target).toBe('See https://example.com/a/…?b=…');
    expect(maskIds('no ids here')).toBe('no ids here');
  });

  it("doesn't change what it's given", () => {
    const step = { ...STEP, label: `Read prompt ${UUID}` };
    chatEvent('step.finished', 1, { step });
    expect(step.label).toBe(`Read prompt ${UUID}`);
  });

  it("leaves the answer's text to the engine, but not its keys", () => {
    const delta = chatEvent('text.delta', 1, { text: `You asked about ${UUID}` });
    expect(delta.data.text).toBe(`You asked about ${UUID}`);
    const text = { text: 'ok', brand_id: UUID } as { text: string };
    expect(() => chatEvent('text.delta', 1, text)).toThrow(/event\.data\.brand_id: an id/);
  });

  it("keeps an app link whole, ids and all, so a card's Open works", () => {
    expect(SAMPLES['deliverable.created']().data.href).toBe(EDITOR);
    expect(SAMPLES['deliverable.updated']().data.href).toBe(EDITOR);
    expect(SAMPLES['page.opened']().data.href).toBe(EDITOR);
    const plain = chatEvent('deliverable.created', 1, { ...DELIVERABLE, href: undefined });
    expect(clientEventProblems(plain)).toEqual([]);
  });

  it('refuses a link out of the app, a query or a step out of /dashboard/', () => {
    const bad = [
      'https://example.com/dashboard/x',
      '//example.com/dashboard/x',
      'javascript:alert(1)',
      '/dashboard/content?draft=1',
      '/dashboard/content#top',
      '/dashboard//example.com',
      '/dashboard/../admin',
      '/dashboard/%2e%2e/admin',
      '/dashboard/a\\b',
      ' /dashboard/x',
      '/settings',
      '/dashboard',
    ];
    for (const href of bad) {
      expect(isChatHref(href), href).toBe(false);
      const page = { where: 'editor', href } as ChatEventPayloads['page.opened'];
      expect(() => chatEvent('page.opened', 1, page), href).toThrow(
        'event.data.href: not a path in the app',
      );
    }
    expect(isChatHref('/dashboard/content/library')).toBe(true);
    expect(isChatHref(`/dashboard/chat/files/${UUID}`)).toBe(true);
    // @ts-expect-error an href is a path under /dashboard/
    const outside: ChatHref = 'https://example.com';
    expect(isChatHref(outside)).toBe(false);
  });

  it("knows its own types, so the browser can skip a newer server's", () => {
    expect(isChatEventType('step.started')).toBe(true);
    expect(isChatEventType('page.opened')).toBe(true);
    expect(isChatEventType('click.required')).toBe(false);
    expect(isChatEventType('toString')).toBe(false);
    expect(isChatEventType(undefined)).toBe(false);
  });
});

describe('step kinds', () => {
  it('match the kinds the migrations put in chat_step_kinds', () => {
    const dir = fileURLToPath(new URL('../../../../supabase/migrations', import.meta.url));
    const seeded = new Set<string>();
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      const sql = readFileSync(`${dir}/${file}`, 'utf8').replace(/--[^\n]*/g, '');
      const inserts = sql.matchAll(
        /insert\s+into\s+(?:public\.)?chat_step_kinds\s*\(\s*kind\s*\)\s*values([^;]*);/gi,
      );
      for (const [, values] of inserts) {
        for (const [, kind] of values.matchAll(/\(\s*'([a-z_]+)'\s*\)/g)) seeded.add(kind);
      }
    }
    expect([...seeded].sort()).toEqual([...CHAT_STEP_KINDS].sort());
  });
});
