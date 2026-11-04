import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider } from '@/components/context/RoleProvider';
import { chatEvent, type ChatEvent } from '@/lib/chat/events';
import type { ChatThread } from '@/lib/chat/thread';

/**
 * Chat's page view (Wave 1 wiring): the composer sends to the run API with
 * the person's mode and files, the answer streams in as RunAnswer, Steer
 * stops the run first, a question card is answered from the card or the
 * composer, the latest answer's next moves send their prompt and give the
 * composer its ghost, and a teammate's shared chat is read only.
 */

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const gate = vi.hoisted(() => {
  const state = {
    isLocked: false,
    openUpgrade: vi.fn(),
    guard:
      <Args extends unknown[]>(fn: (...args: Args) => unknown, options?: { action?: string }) =>
      (...args: Args) =>
        state.isLocked ? state.openUpgrade(options?.action) : fn(...args),
  };
  return state;
});
vi.mock('@/components/context/upgradeGate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/context/upgradeGate')>()),
  useUpgradeGate: () => gate,
}));
vi.mock('@/lib/actions/chatAccessRequests', () => ({ requestAccess: vi.fn() }));
// A deliverable's task clicks (W2-12): the server's, not these tests'.
vi.mock('@/lib/actions/chatTaskCard', () => ({
  markTaskDoneFromCard: vi.fn(),
  attachOnlyFromCard: vi.fn(),
  undoTaskDoneFromCard: vi.fn(),
}));
vi.mock('@/lib/actions/chatReferences', () => ({
  searchChatReferences: vi.fn(async () => ({ ok: true, references: [] })),
}));
vi.mock('@/lib/chat/uploadClient', () => ({ uploadChatFile: vi.fn(), dropChatUpload: vi.fn() }));
vi.mock('@/lib/actions/chatPrefs', () => ({
  saveUsageNoticePeriod: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (selector: (s: { activeBrandId: string }) => unknown) =>
    selector({ activeBrandId: '22222222-2222-4222-8222-222222222222' }),
}));
const aiUsage = vi.hoisted(() => ({
  usage: null as Record<string, unknown> | null,
  refresh: vi.fn(),
}));
vi.mock('@/components/context/AiUsageProvider', () => ({
  useAiUsage: () => ({ usage: aiUsage.usage, refresh: aiUsage.refresh }),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ChatThreadView } = await import('./ChatThreadView');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const CHAT = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';

/** A run's answer as the API streams it, ending finished. */
function stream(events: ChatEvent[]): ReadableStream<Uint8Array> {
  const text = events
    .map((e) => `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}
const finished = [
  chatEvent('text.delta', 1, { text: 'Two pages lost most of it.' }),
  chatEvent('run.finished', 2, {
    workingMs: 8000,
    stepCount: 0,
    sources: [],
    generatedAt: '2026-10-30T09:14:00.000Z',
    dataAsOf: null,
  }),
];

let calls: { url: string; init?: RequestInit }[];
/** The run API: a new run streams `finished`; anything else answers {}. */
async function runApi(url: string, init?: RequestInit) {
  calls.push({ url, init });
  if (url === '/api/chat/runs') {
    return new Response(stream(finished), {
      status: 200,
      headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN },
    });
  }
  return new Response('{}', { status: 200 });
}
const fetchMock = vi.fn(runApi);

let container: HTMLDivElement;
let root: Root;

async function render(props: Partial<Parameters<typeof ChatThreadView>[0]> = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role="admin">
          <ChatThreadView
            thread={null}
            variant="home"
            defaultMode="ask_first"
            fullAutoOpen={false}
            {...props}
          />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}
const box = () => container.querySelector('textarea')!;
async function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(box(), value);
    box().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function enter() {
  await act(async () => {
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

beforeEach(() => {
  aiUsage.usage = null;
  aiUsage.refresh.mockClear();
  calls = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(runApi);
  toast.error.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/dashboard/chat');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('ChatThreadView', () => {
  it('starts a chat from Home with the person’s mode and brand, and streams the answer in', async () => {
    await render();
    expect(box().rows).toBe(2);
    expect(container.querySelector('[role="radio"][aria-checked="true"]')!.textContent).toBe(
      'Ask me first',
    );
    await type('Why did citations drop?');
    await enter();
    const sent = calls.find((c) => c.url === '/api/chat/runs')!;
    expect(JSON.parse(String(sent.init!.body))).toMatchObject({
      message: 'Why did citations drop?',
      mode: 'ask_first',
      brandId: '22222222-2222-4222-8222-222222222222',
    });
    expect(container.textContent).toContain('Why did citations drop?');
    expect(container.textContent).toContain('Two pages lost most of it.');
    // Stamped in the person's own time zone.
    expect(container.textContent).toContain('Generated Oct 30, 2026 · ');
    expect(window.location.pathname).toBe(`/dashboard/chat/${CHAT}`);
  });

  it('in the side panel, keeps the page’s address and tells the panel the chat', async () => {
    window.history.replaceState(null, '', '/dashboard/mentions');
    const onConversation = vi.fn();
    await render({
      variant: 'panel',
      onConversation,
      empty: <p>Hi Sam, ask anything about this page.</p>,
    });
    expect(container.textContent).toContain('Hi Sam, ask anything about this page.');
    await type('Why did mentions drop?');
    await enter();
    expect(window.location.pathname).toBe('/dashboard/mentions');
    expect(onConversation).toHaveBeenCalledWith(CHAT);
    expect(container.textContent).not.toContain('Hi Sam');
  });

  it('sends the page’s chips and the @ objects with the message, as its scope (W1-08)', async () => {
    const chart = { type: 'chart' as const, id: 'mentions-trend', label: 'Mentions over time' };
    await render({
      variant: 'panel',
      onConversation: vi.fn(),
      chips: [
        { key: 'page', label: 'Mentions & Sentiment' },
        { key: 'filter:platform', label: 'ChatGPT', value: 'chatgpt-web' },
      ],
      pageRoute: '/dashboard/mentions',
      draft: { nonce: 1, reference: chart },
    });
    await type('Why the drop?');
    await enter();
    const sent = calls.find((c) => c.url === '/api/chat/runs')!;
    expect(JSON.parse(String(sent.init!.body))).toMatchObject({
      message: 'Why the drop?',
      origin: 'panel',
      originPage: '/dashboard/mentions',
      context: {
        route: '/dashboard/mentions',
        chips: [
          { key: 'page', label: 'Mentions & Sentiment' },
          { key: 'filter:platform', label: 'ChatGPT', value: 'chatgpt-web' },
        ],
      },
      references: [chart],
    });
  });

  it('puts its actions under a finished answer, In Files once filed, and what it made as cards', async () => {
    const thread = {
      conversationId: CHAT,
      title: 'Citations',
      brandId: null,
      mine: true,
      messages: [
        { role: 'user', text: 'Find the drop', generatedAt: null, dataAsOf: null, timezone: null },
        {
          role: 'assistant',
          text: 'Two pages lost most of it.',
          generatedAt: '2026-10-30T09:14:00.000Z',
          dataAsOf: null,
          timezone: 'UTC',
          run: {
            runId: RUN,
            status: 'done',
            steps: [],
            fileId: 'f1',
            deliverables: [
              {
                title: 'Pricing FAQ',
                type: 'document',
                formats: ['html', 'md'],
                status: 'draft',
                href: '/dashboard/content/editor/d1',
                filed: 'in_files',
              },
            ],
          },
        },
      ],
    } as unknown as ChatThread;
    await render({ thread, variant: 'dock' });
    const bar = container.querySelector('[role="toolbar"][aria-label="Answer actions"]')!;
    expect(
      [...bar.querySelectorAll('[aria-label]')].map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Copy', 'Download', 'In Files', 'Open in Content Editor', 'Send to Action Center']);
    // What the run made shows as its card, its page open in the editor.
    const card = container.querySelector('[data-slot="deliverable-card"]')!;
    expect(card.getAttribute('aria-label')).toBe('Pricing FAQ');
    expect(card.querySelector('a')!.getAttribute('href')).toBe('/dashboard/content/editor/d1');
  });

  it('keeps the text when the run API refuses it', async () => {
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ ok: false, error: 'Slow down a little.' }, { status: 429 });
    });
    await render();
    await type('Hello');
    await enter();
    expect(toast.error).toHaveBeenCalledWith('Slow down a little.');
    expect(box().value).toBe('Hello');
    expect(container.querySelector('ol')).toBeNull();
  });

  it('opens the plans when the run API says the chat is on the demo brand', async () => {
    gate.openUpgrade.mockClear();
    vi.mocked(toast.error).mockClear();
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Response.json(
        { ok: false, failure: 'subscription', error: 'demo_brand', code: 'demo_brand' },
        { status: 402 },
      );
    });
    await render();
    await type('And on Gemini?');
    await enter();
    expect(gate.openUpgrade).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('steers a run under way: Stop first, then the text as the next message', async () => {
    const thread: ChatThread = {
      conversationId: CHAT,
      title: 'Citations',
      brandId: null,
      mine: true,
      messages: [
        { role: 'user', text: 'Find the drop', generatedAt: null, dataAsOf: null, timezone: null },
        {
          role: 'assistant',
          text: '',
          generatedAt: null,
          dataAsOf: null,
          timezone: 'UTC',
          run: { runId: RUN, status: 'running', steps: [] },
        },
      ],
    } as unknown as ChatThread;
    // The run under way is read again from its events: still working.
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(new ReadableStream({ start: () => {} }), { status: 200 });
    });
    await render({ thread, variant: 'dock' });
    await type('only blog pages');
    await enter();
    const urls = calls.map((c) => c.url);
    expect(urls.indexOf(`/api/chat/runs/${RUN}/stop`)).toBeGreaterThan(-1);
    expect(urls.indexOf(`/api/chat/runs/${RUN}/stop`)).toBeLessThan(urls.indexOf('/api/chat/runs'));
    const sent = calls.find((c) => c.url === '/api/chat/runs')!;
    expect(JSON.parse(String(sent.init!.body))).toMatchObject({
      message: 'only blog pages',
      conversationId: CHAT,
    });
  });

  it('after a reload, still says why a run failed, and Retry sends the question again (W1-15)', async () => {
    const reason = "Chat couldn't check your AI usage just now, so it didn't start this step.";
    const thread = {
      conversationId: CHAT,
      title: 'Citations',
      brandId: null,
      mine: true,
      messages: [
        { role: 'user', text: 'Find the drop', generatedAt: null, dataAsOf: null, timezone: null },
        {
          role: 'assistant',
          text: '',
          generatedAt: null,
          dataAsOf: null,
          timezone: 'UTC',
          run: {
            runId: RUN,
            status: 'error',
            steps: [],
            fileId: null,
            deliverables: [],
            summary: { workingMs: 3000, stepCount: 0, sources: [] },
            errorReason: reason,
          },
        },
      ],
    } as unknown as ChatThread;
    await render({ thread, variant: 'dock' });
    const box = container.querySelector('[data-slot="run-error"]')!;
    expect(box.textContent).toContain('Stopped: something went wrong');
    expect(box.textContent).toContain(reason);
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-action="run.retry"]')!.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const sent = calls.find((c) => c.url === '/api/chat/runs')!;
    expect(JSON.parse(String(sent.init!.body))).toMatchObject({
      message: 'Find the drop',
      conversationId: CHAT,
    });
    expect(container.textContent).toContain('Two pages lost most of it.');
    // Retry is on the latest answer only: the failed one has none now.
    expect(container.querySelector('[data-slot="run-error"]')).not.toBeNull();
    expect(container.querySelector('[data-action="run.retry"]')).toBeNull();

    // A teammate's shared chat only reads: no Retry.
    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ thread: { ...thread, mine: false }, variant: 'dock' });
    expect(container.querySelector('[data-action="run.retry"]')).toBeNull();

    // A question sent with files or a page scope can't go again as it was: no Retry.
    const scoped = {
      ...thread,
      messages: [{ ...thread.messages[0], resendable: false }, thread.messages[1]],
    } as ChatThread;
    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ thread: scoped, variant: 'dock' });
    expect(container.querySelector('[data-slot="run-error"]')).not.toBeNull();
    expect(container.querySelector('[data-action="run.retry"]')).toBeNull();

    // Paused at the AI limit, the composer is off, and so is Retry.
    aiUsage.usage = {
      plan: 'growth',
      planName: 'Growth',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      unlimited: false,
      percentUsed: 100,
      features: [],
      chatMetered: true,
    };
    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ thread, variant: 'dock' });
    expect(container.querySelector('[data-slot="run-error"]')).not.toBeNull();
    expect(container.querySelector('[data-action="run.retry"]')).toBeNull();
  });

  it('retries a question with the page chips and @ objects it was sent with', async () => {
    const chart = { type: 'chart' as const, id: 'mentions-trend', label: 'Mentions over time' };
    const chips = [
      { key: 'page', label: 'Mentions & Sentiment' },
      { key: 'filter:platform', label: 'ChatGPT', value: 'chatgpt-web' },
    ];
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        stream([
          chatEvent('run.error', 1, {
            workingMs: 1000,
            stepCount: 0,
            sources: [],
            code: 'failed',
            reason: 'Something went wrong, so Chat stopped here.',
          }),
        ]),
        { status: 200, headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN } },
      );
    });
    await render({
      variant: 'panel',
      onConversation: vi.fn(),
      chips,
      pageRoute: '/dashboard/mentions',
      draft: { nonce: 1, reference: chart },
    });
    await type('Why the drop?');
    await enter();
    const retry = container.querySelector<HTMLButtonElement>('[data-action="run.retry"]')!;
    await act(async () => retry.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const sent = calls.filter((c) => c.url === '/api/chat/runs');
    expect(sent).toHaveLength(2);
    const [first, again] = sent.map((c) => JSON.parse(String(c.init!.body)));
    expect(again).toMatchObject({
      message: 'Why the drop?',
      conversationId: CHAT,
      context: { route: '/dashboard/mentions', chips },
      references: [chart],
    });
    expect(again.context).toEqual(first.context);
    expect(again.references).toEqual(first.references);
    expect(again.attachmentIds).toBeUndefined();
  });

  it('sends the shortcut picked from the / menu with its message, and again on Retry (W2-09)', async () => {
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        stream([
          chatEvent('run.error', 1, {
            workingMs: 1000,
            stepCount: 0,
            sources: [],
            code: 'failed',
            reason: 'Something went wrong, so Chat stopped here.',
          }),
        ]),
        { status: 200, headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN } },
      );
    });
    await render({ variant: 'panel', onConversation: vi.fn() });
    await type('/an');
    await enter();
    expect(box().value).toBe('Analyze ');
    await type('Analyze the mentions drop');
    await enter();
    const retry = container.querySelector<HTMLButtonElement>('[data-action="run.retry"]')!;
    await act(async () => retry.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const sent = calls
      .filter((c) => c.url === '/api/chat/runs')
      .map((c) => JSON.parse(String(c.init!.body)));
    expect(sent.map((body) => [body.message, body.shortcutId])).toEqual([
      ['Analyze the mentions drop', 'analyze'],
      ['Analyze the mentions drop', 'analyze'],
    ]);
  });

  it('stops following a run once the view goes: no reconnect, no warning', async () => {
    const thread = {
      conversationId: CHAT,
      title: 'Citations',
      brandId: null,
      mine: true,
      messages: [
        { role: 'user', text: 'Find the drop', generatedAt: null, dataAsOf: null, timezone: null },
        {
          role: 'assistant',
          text: '',
          generatedAt: null,
          dataAsOf: null,
          timezone: 'UTC',
          run: { runId: RUN, status: 'running', steps: [], fileId: null, deliverables: [] },
        },
      ],
    } as unknown as ChatThread;
    // The stream ends with no end: the view would reconnect after a second.
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(stream([]), { status: 200 });
    });
    await render({ thread, variant: 'dock' });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(container.textContent).toContain('Reconnecting…');
    await act(async () => root.unmount());
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(calls.filter((c) => c.url.includes('/events'))).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
    root = createRoot(container);
  });

  it('cancels a stream still open once the view goes', async () => {
    const thread = {
      conversationId: CHAT,
      title: 'Citations',
      brandId: null,
      mine: true,
      messages: [
        { role: 'user', text: 'Find the drop', generatedAt: null, dataAsOf: null, timezone: null },
        {
          role: 'assistant',
          text: '',
          generatedAt: null,
          dataAsOf: null,
          timezone: 'UTC',
          run: { runId: RUN, status: 'running', steps: [], fileId: null, deliverables: [] },
        },
      ],
    } as unknown as ChatThread;
    const cancel = vi.fn();
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(new ReadableStream({ start: () => {}, cancel }), { status: 200 });
    });
    await render({ thread, variant: 'dock' });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(cancel).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalled();
    root = createRoot(container);
  });

  it('says "Reconnecting…" when the stream drops, and resumes after the last event', async () => {
    const started = chatEvent('step.started', 1, {
      step: { n: 1, kind: 'read', label: 'Read Citations', status: 'running' },
    });
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      // The connection breaks after the first events, with no end.
      const text = [started, chatEvent('text.delta', 2, { text: 'Two pages ' })]
        .map((e) => `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
        .join('');
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
          setTimeout(() => controller.error(new TypeError('network error')), 0);
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN },
      });
    });
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        stream([
          chatEvent('step.finished', 3, {
            step: { n: 1, kind: 'read', label: 'Read Citations', status: 'done', rowCount: 18 },
          }),
          chatEvent('text.delta', 4, { text: 'lost most of it.' }),
          chatEvent('run.finished', 5, {
            workingMs: 8000,
            stepCount: 1,
            sources: [{ label: 'Citations', count: 18 }],
            generatedAt: '2026-10-30T09:14:00.000Z',
            dataAsOf: null,
          }),
        ]),
        { status: 200 },
      );
    });
    await render();
    await type('Why did citations drop?');
    await enter();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    const header = () => container.querySelector('[data-action="answer.toggleSteps"]')!;
    expect(header().textContent).toContain('Reconnecting…');
    expect(container.textContent).toContain('Two pages');

    await act(async () => new Promise((resolve) => setTimeout(resolve, 1100)));
    expect(calls.map((c) => c.url)).toContain(`/api/chat/runs/${RUN}/events?after=2`);
    expect(container.textContent).not.toContain('Reconnecting…');
    expect(container.textContent).toContain('Two pages lost most of it.');
    expect(header().textContent).toContain('Read Citations');
  });

  it('after a reload, shows the kept steps and keeps streaming from the run’s events', async () => {
    const thread = {
      conversationId: CHAT,
      title: 'Citations',
      brandId: null,
      mine: true,
      messages: [
        { role: 'user', text: 'Find the drop', generatedAt: null, dataAsOf: null, timezone: null },
        {
          role: 'assistant',
          text: '',
          generatedAt: null,
          dataAsOf: null,
          timezone: 'UTC',
          run: {
            runId: RUN,
            status: 'running',
            steps: [{ n: 1, kind: 'read', label: 'Read Citations', status: 'running' }],
            fileId: null,
            deliverables: [],
            summary: null,
            errorReason: null,
          },
        },
      ],
    } as unknown as ChatThread;
    let open: ReadableStreamDefaultController<Uint8Array> | null = null;
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            open = controller;
          },
        }),
        { status: 200 },
      );
    });
    await render({ thread, variant: 'dock' });
    // The kept step shows while the events come.
    expect(container.textContent).toContain('Read Citations');
    expect(calls.map((c) => c.url)).toContain(`/api/chat/runs/${RUN}/events?after=0`);
    const frame = (e: ChatEvent) =>
      new TextEncoder().encode(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    await act(async () => {
      open!.enqueue(
        frame(
          chatEvent('step.started', 1, {
            step: { n: 1, kind: 'read', label: 'Read Citations', status: 'running' },
          }),
        ),
      );
      open!.enqueue(frame(chatEvent('text.delta', 2, { text: 'Two pages lost most of it.' })));
      open!.enqueue(frame({ ...finished[1], seq: 3 }));
      open!.close();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('Two pages lost most of it.');
    expect(container.textContent).toContain('Generated Oct 30, 2026');
  });

  describe('a question card (CHAT-07)', () => {
    /** Its place among the questions asked together, when there are more. */
    let batch: { at: number; of: number } | undefined;
    const asked = () => [
      chatEvent('step.started', 1, {
        step: { n: 1, kind: 'ask', status: 'waiting', label: 'Waiting for your answer' },
      }),
      chatEvent('ask.created', 2, {
        n: 1,
        question: 'Which page should the FAQ go on?',
        options: [
          { label: '/pricing', recommended: true },
          { label: '/features', recommended: false },
        ],
        allowOther: false,
        multi: false,
        ...(batch ? { batch } : {}),
      }),
    ];
    const goesOn = (answer: string) => [
      chatEvent('step.finished', 3, {
        step: {
          n: 1,
          kind: 'ask',
          status: 'done',
          label: 'Which page should the FAQ go on?',
          detail: answer,
        },
      }),
      chatEvent('text.delta', 4, { text: 'Writing it.' }),
      chatEvent('run.finished', 5, {
        workingMs: 8000,
        stepCount: 1,
        sources: [],
        generatedAt: '2026-10-30T09:14:00.000Z',
        dataAsOf: null,
      }),
    ];
    beforeEach(() => {
      batch = undefined;
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === '/api/chat/runs') {
          return new Response(stream(asked()), {
            status: 200,
            headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN },
          });
        }
        if (url.startsWith(`/api/chat/runs/${RUN}/events`)) {
          // After a Stop: the question's step skipped, and the run stopped.
          return new Response(
            stream([
              chatEvent('step.finished', 3, {
                step: {
                  n: 1,
                  kind: 'ask',
                  status: 'skipped',
                  label: 'Question skipped',
                  detail: 'Stopped',
                },
              }),
              chatEvent('run.stopped', 4, {
                workingMs: 4000,
                stepCount: 1,
                sources: [],
                reason: 'person',
              }),
            ]),
            { status: 200 },
          );
        }
        if (url.startsWith(`/api/chat/runs/${RUN}/answer`)) {
          const body = JSON.parse(String(init!.body)) as { selected: number[]; other?: string };
          return new Response(
            stream(goesOn(body.other ?? ['/pricing', '/features'][body.selected[0]])),
            {
              status: 200,
            },
          );
        }
        return new Response('{}', { status: 200 });
      });
    });
    afterEach(() => {
      fetchMock.mockImplementation(runApi);
    });

    it('waits on the card, sends its answer to the run and folds it to one line', async () => {
      await render();
      await type('Write a pricing FAQ');
      await enter();
      const card = container.querySelector('[data-slot="question-card"]')!;
      expect(card.querySelector('h3')!.textContent).toBe('Which page should the FAQ go on?');
      // The stream settled on the card: no reconnect.
      expect(calls.filter((c) => c.url.includes('/events'))).toHaveLength(0);
      // The composer offers the Recommended option as its ghost, with Send, Stop beside it,
      // and an answer's length; no files or @ data go with an answer.
      expect(
        container.querySelector('[data-action="composer.acceptGhost"]')!.textContent,
      ).toContain('/pricing');
      expect(container.querySelector('[data-action="composer.send"]')).not.toBeNull();
      expect(container.querySelector('[data-action="composer.stop"]')).not.toBeNull();
      expect(box().maxLength).toBe(500);
      expect(container.textContent).toContain("Your message answers Chat's question");
      await act(async () => {
        container.querySelectorAll<HTMLElement>('[data-action="question.pick"]')[1].click();
      });
      await act(async () => {
        container.querySelector<HTMLElement>('[data-action="question.next"]')!.click();
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      const answer = calls.find((c) => c.url.includes('/answer'))!;
      expect(answer.url).toBe(`/api/chat/runs/${RUN}/answer?after=2`);
      expect(JSON.parse(String(answer.init!.body))).toEqual({
        n: 1,
        selected: [1],
        other: null,
        skipped: false,
        via: 'card',
      });
      expect(container.querySelector('[data-slot="question-card"]')).toBeNull();
      expect(container.querySelector('[data-slot="question-answered"]')!.textContent).toBe(
        'Which page should the FAQ go on?/features',
      );
      expect(container.textContent).toContain('Writing it.');
    });

    it('says the next question asked with it comes up', async () => {
      batch = { at: 1, of: 2 };
      await render();
      await type('Write a pricing FAQ');
      await enter();
      expect(container.querySelector('[data-slot="question-card"]')!.textContent).toContain(
        '1 of 2',
      );
      await act(async () => {
        container.querySelector<HTMLElement>('[data-action="question.next"]')!.click();
      });
      expect(toast).toHaveBeenCalledWith('Answer saved · question 2 of 2 next');
    });

    it('picks the option the composer’s message names (the ghost after Tab)', async () => {
      await render();
      await type('Write a pricing FAQ');
      await enter();
      await type('/features');
      await enter();
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      const answer = calls.find((c) => c.url.includes('/answer'))!;
      expect(JSON.parse(String(answer.init!.body))).toMatchObject({
        selected: [1],
        other: null,
        via: 'composer',
      });
    });

    it('stops the run from the composer while it asks: the question is left skipped', async () => {
      await render();
      await type('Write a pricing FAQ');
      await enter();
      await act(async () => {
        box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(calls.map((c) => c.url)).toContain(`/api/chat/runs/${RUN}/stop`);
      expect(container.querySelector('[data-slot="question-card"]')).toBeNull();
      expect(calls.some((c) => c.url.includes('/answer'))).toBe(false);
      // Stopped: Send again, no Stop.
      expect(container.querySelector('[data-action="composer.stop"]')).toBeNull();
    });

    it('takes the composer’s message as the answer, without a new run or a Stop', async () => {
      await render();
      await type('Write a pricing FAQ');
      await enter();
      await type('The blog');
      await enter();
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(calls.filter((c) => c.url === '/api/chat/runs')).toHaveLength(1);
      expect(calls.some((c) => c.url.endsWith('/stop'))).toBe(false);
      const answer = calls.find((c) => c.url.includes('/answer'))!;
      expect(JSON.parse(String(answer.init!.body))).toEqual({
        n: 1,
        selected: [],
        other: 'The blog',
        skipped: false,
        via: 'composer',
      });
      expect(container.querySelector('[data-slot="question-answered"]')!.textContent).toBe(
        'Which page should the FAQ go on?The blog',
      );
    });
  });

  /** CHAT-09 items 18–19: Send to Action Center on the latest answer, and what it sent. */
  describe('Send to Action Center (CHAT-09 §E)', () => {
    const answered = (run: object = {}) =>
      ({
        conversationId: CHAT,
        title: 'Citations',
        brandId: null,
        mine: true,
        messages: [
          {
            role: 'user',
            text: 'Why did AIO drop?',
            generatedAt: null,
            dataAsOf: null,
            timezone: null,
          },
          {
            role: 'assistant',
            text: 'Two pages lost most of it.',
            generatedAt: '2026-10-30T09:14:00.000Z',
            dataAsOf: null,
            timezone: 'UTC',
            run: { runId: RUN, status: 'done', steps: [], fileId: null, deliverables: [], ...run },
          },
        ],
      }) as unknown as ChatThread;
    const sendButton = () =>
      container.querySelector<HTMLElement>('[data-action="answer.sendToActionCenter"]');

    it('asks Chat to propose the latest answer as an action, on its card', async () => {
      await render({ thread: answered(), variant: 'dock' });
      await act(async () => sendButton()!.click());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      const sent = calls.find((c) => c.url === '/api/chat/runs')!;
      expect(JSON.parse(String(sent.init!.body))).toMatchObject({
        message: 'Send this finding to Action Center as an action.',
        // The answer's run goes with it: the server reads whether it read outside text (§16a).
        fromRunId: RUN,
      });
    });

    it("isn't offered to an Analyst, or on a teammate's shared chat", async () => {
      act(() => root.unmount());
      root = createRoot(container);
      await act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
            <RoleProvider role="analyst">
              <ChatThreadView
                thread={answered()}
                variant="dock"
                defaultMode="ask_first"
                fullAutoOpen={false}
              />
            </RoleProvider>
          </NextIntlClientProvider>,
        );
      });
      expect(sendButton()).toBeNull();
      act(() => root.unmount());
      root = createRoot(container);
      await render({ thread: { ...answered(), mine: false }, variant: 'dock' });
      expect(sendButton()).toBeNull();
    });

    it('shows what it sent with Open in Actions, after a reload too', async () => {
      await render({
        thread: answered({
          sent: [
            {
              kind: 'action_created',
              actionNo: 1271,
              title: 'Win back pricing citations',
              href: '/dashboard/action-center/actions/a1',
            },
          ],
        }),
        variant: 'dock',
      });
      const card = container.querySelector('[data-slot="action-sent-card"]')!;
      expect(card.textContent).toContain('Sent to Action Center · AC-1271');
      expect(card.textContent).toContain('Win back pricing citations');
      expect(card.querySelector('a')!.getAttribute('href')).toBe(
        '/dashboard/action-center/actions/a1',
      );
      expect(card.querySelector('a')!.textContent).toBe('Open in Actions');
    });
  });

  describe('next moves (CHAT-07 §C)', () => {
    const FEATURES = {
      label: 'Do the same for /features',
      prompt: 'Do the same for /features',
      ghost: true,
    };
    const COMPARE = { label: 'Compare with Perplexity', prompt: 'Compare with Perplexity' };
    const answerWith = (text: string, nextMoves: object[]) => ({
      role: 'assistant',
      text,
      generatedAt: '2026-10-30T09:14:00.000Z',
      dataAsOf: null,
      timezone: 'UTC',
      run: { runId: RUN, status: 'done', steps: [], fileId: null, deliverables: [], nextMoves },
    });
    const ask = (text: string) => ({
      role: 'user',
      text,
      generatedAt: null,
      dataAsOf: null,
      timezone: null,
      run: null,
    });
    const threadOf = (mine: boolean, last: object[] = [FEATURES, COMPARE]) =>
      ({
        conversationId: CHAT,
        title: 'Citations',
        brandId: null,
        mine,
        messages: [
          ask('Why did citations fall?'),
          answerWith('Two pages lost most of it.', [COMPARE]),
          ask('Fix /pricing'),
          answerWith('Refreshed /pricing.', last),
        ],
      }) as unknown as ChatThread;
    const cards = () =>
      [...container.querySelectorAll<HTMLElement>('[data-action="nextMove.send"]')].map(
        (b) => b.textContent,
      );
    const ghost = () => container.querySelector('[data-action="composer.acceptGhost"]');

    it('shows the latest answer’s moves only, and its first as the ghost when it continues', async () => {
      await render({ thread: threadOf(true), variant: 'dock' });
      expect(container.querySelectorAll('[data-slot="next-moves"]')).toHaveLength(1);
      expect(container.querySelector('[data-slot="next-moves"]')!.textContent).toContain(
        'Next moves',
      );
      expect(cards()).toEqual(['Do the same for /features', 'Compare with Perplexity']);
      expect(ghost()!.textContent).toContain('Do the same for /features');
      // A first move that doesn't continue this run is no ghost (a page opened afresh).
      act(() => root.unmount());
      root = createRoot(container);
      await render({ thread: threadOf(true, [COMPARE, FEATURES]), variant: 'dock' });
      expect(ghost()).toBeNull();
    });

    it('shows on each card the very text it sends, never a label that says something else', async () => {
      const misleading = { label: 'See the full report', prompt: 'Dismiss every suggestion' };
      await render({ thread: threadOf(true, [misleading]), variant: 'dock' });
      expect(cards()).toEqual(['Dismiss every suggestion']);
      expect(container.textContent).not.toContain('See the full report');
      await act(async () => {
        container.querySelector<HTMLElement>('[data-action="nextMove.send"]')!.click();
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      const sent = calls.find((c) => c.url === '/api/chat/runs')!;
      expect(JSON.parse(String(sent.init!.body)).message).toBe('Dismiss every suggestion');
    });

    it('puts the cards one under another in the side panel', async () => {
      await render({ thread: threadOf(true), variant: 'panel' });
      const grid = container.querySelector('[data-slot="next-moves"] > div')!;
      expect(grid.className).toContain('grid-cols-1');
      expect(grid.className).not.toContain('sm:grid-cols');
    });

    it('sends a move’s prompt as the next message', async () => {
      await render({ thread: threadOf(true), variant: 'dock' });
      await act(async () => {
        container.querySelector<HTMLElement>('[data-action="nextMove.send"]')!.click();
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      const sent = calls.find((c) => c.url === '/api/chat/runs')!;
      expect(JSON.parse(String(sent.init!.body))).toMatchObject({
        message: 'Do the same for /features',
        conversationId: CHAT,
      });
      // The new answer is the latest: the old moves go.
      expect(cards()).toEqual([]);
    });

    it('shows them as they stream in, once the run finished', async () => {
      fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(
          stream([
            chatEvent('text.delta', 1, { text: 'Two pages lost most of it.' }),
            chatEvent('next_moves', 2, { moves: [FEATURES] }),
            ...finished.slice(1).map((e) => ({ ...e, seq: 3 })),
          ]),
          { status: 200, headers: { 'x-chat-conversation': CHAT, 'x-chat-run': RUN } },
        );
      });
      await render();
      await type('Why did citations fall?');
      await enter();
      expect(cards()).toEqual(['Do the same for /features']);
    });

    it('shows none in a teammate’s shared chat', async () => {
      await render({ thread: threadOf(false), variant: 'dock' });
      expect(container.querySelector('[data-slot="next-moves"]')).toBeNull();
    });
  });

  it('keeps the steer’s text, and sends nothing, when the Stop isn’t taken', async () => {
    const thread = {
      conversationId: CHAT,
      title: 'Citations',
      brandId: null,
      mine: true,
      messages: [
        { role: 'user', text: 'Find the drop', generatedAt: null, dataAsOf: null, timezone: null },
        {
          role: 'assistant',
          text: '',
          generatedAt: null,
          dataAsOf: null,
          timezone: 'UTC',
          run: { runId: RUN, status: 'running', steps: [] },
        },
      ],
    } as unknown as ChatThread;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/stop')) return Response.json({ ok: false }, { status: 500 });
      return new Response(new ReadableStream({ start: () => {} }), { status: 200 });
    });
    await render({ thread, variant: 'dock' });
    await type('only blog pages');
    await enter();
    expect(calls.some((c) => c.url === `/api/chat/runs/${RUN}/stop`)).toBe(true);
    expect(calls.some((c) => c.url === '/api/chat/runs')).toBe(false);
    expect(box().value).toBe('only blog pages');
    expect(toast.error).toHaveBeenCalledWith("Couldn't send that. Try again.");
  });

  it('says the Admin, not the plan, closed Full auto for this person', async () => {
    await render({ fullAutoOpen: false, fullAutoOffByAdmin: true });
    const fullAuto = [...container.querySelectorAll('[role="radio"]')].find((el) =>
      el.textContent?.startsWith('Full auto'),
    )!;
    expect(fullAuto.getAttribute('aria-disabled')).toBe('true');
    expect(fullAuto.textContent).toContain('Off by Admin');
    expect(fullAuto.textContent).not.toContain('Needs Growth');
  });

  it('only reads a teammate’s shared chat', async () => {
    const thread = {
      conversationId: CHAT,
      title: 'Their chat',
      brandId: null,
      mine: false,
      messages: [],
    } as unknown as ChatThread;
    await render({ thread, variant: 'dock' });
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.textContent).toContain(
      'A teammate shared this chat with you: you can read it, not add to it.',
    );
    expect(container.querySelector('a')!.getAttribute('href')).toBe('/dashboard/chat');
  });

  it('pauses at the AI limit: the composer is off and says why', async () => {
    aiUsage.usage = {
      plan: 'growth',
      planName: 'Growth',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      unlimited: false,
      percentUsed: 100,
      features: [],
      chatMetered: true,
    };
    await render();
    expect(box().disabled).toBe(true);
    expect(box().placeholder).toBe('AI limit reached · models on your own key still work');
    expect(container.textContent).toContain("You've used this month's AI limit.");

    aiUsage.usage = { ...aiUsage.usage, trial: true };
    await render();
    expect(box().placeholder).toBe('Your trial AI limit is used up');
  });

  it('keeps the composer on at the limit when Chat runs on the workspace’s own key', async () => {
    aiUsage.usage = {
      plan: 'enterprise',
      planName: 'Enterprise',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      unlimited: false,
      percentUsed: 100,
      features: [],
      chatMetered: true,
    };
    await render({ onOwnKey: true });
    expect(box().disabled).toBe(false);
    expect(box().placeholder).not.toBe('AI limit reached · models on your own key still work');
  });

  it('reads the AI usage again once a run stops working, not before', async () => {
    await render();
    expect(aiUsage.refresh).not.toHaveBeenCalled();
    await type('What changed this week?');
    await enter();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(container.textContent).toContain('Two pages lost most of it.');
    expect(aiUsage.refresh).toHaveBeenCalledTimes(1);
  });
});
