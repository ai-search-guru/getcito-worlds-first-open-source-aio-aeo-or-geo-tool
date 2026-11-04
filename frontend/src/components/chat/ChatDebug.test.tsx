import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider } from '@/components/context/RoleProvider';
import type { ChatListItem } from '@/lib/chat/conversations';
import type { ChatMessageDebug } from '@/lib/chat/staffDebug';

/**
 * Chat's staff Debug view (CHAT-03 items 25–26; W1-15): the Debug switch is
 * in the open chat's ⋯ menu for GetCito staff only, and on, an answer
 * shows each step's tool, input, output (Download full past 20 KB), latency
 * and cache hit, and its model calls with tokens and cost in USD.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/dashboard/chat',
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock('./ChatListProvider', () => ({
  useChatList: () => ({
    status: 'ready',
    chats: [],
    total: 0,
    archived: 0,
    refresh: vi.fn(),
    update: vi.fn(),
  }),
}));
const download = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/download', () => download);

const { ChatActionsProvider } = await import('./ChatActions');
const { ChatDebugProvider, useChatDebug } = await import('./ChatDebug');
const { ChatHeaderMenu } = await import('./ChatMenus');
const { StaffDebug } = await import('./run/StaffDebug');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ID = 'cccccccc-0000-4000-8000-000000000001';
const RUN = '44444444-4444-4444-8444-444444444444';
const chat: ChatListItem = {
  id: ID,
  title: 'Board update',
  brand: null,
  pinned: false,
  archived: false,
  shared: false,
  mine: true,
  ownerInitials: null,
  lastMessageAt: '2026-10-30T09:00:00Z',
  unread: false,
  state: 'idle',
  step: null,
  progress: null,
  finishedAt: null,
};

const DEBUG: ChatMessageDebug = {
  status: 'done',
  model: 'auto',
  effort: 'normal',
  error: null,
  steps: [
    {
      n: 1,
      kind: 'read',
      status: 'done',
      label: 'Read Citations',
      tool: 'list_citations',
      input: { days: 30 },
      output: '{\n  "rows": [',
      outputBytes: 48_000,
      outputCut: true,
      error: null,
      latencyMs: 840,
      cacheHit: true,
      truncated: false,
      resultTokens: 1200,
    },
  ],
  modelCalls: [
    {
      n: null,
      model: 'claude-haiku-4-5',
      inputTokens: 1800,
      outputTokens: 60,
      cacheReadTokens: 1500,
      cacheWriteTokens: 0,
      costUsd: 0.0012,
      latencyMs: 900,
      at: '2026-10-30T09:00:01.000Z',
    },
  ],
  totals: { inputTokens: 1800, outputTokens: 60, costUsd: 0.0012 },
};

let root: Root;
let host: HTMLDivElement;
let urls: string[];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  urls = [];
  download.saveBlob.mockClear();
  globalThis.fetch = vi.fn(async (url: string) => {
    urls.push(url);
    if (url.endsWith('?full=1')) return new Response('{"rows": []}', { status: 200 });
    return Response.json({ ok: true, debug: DEBUG });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

let debug: ReturnType<typeof useChatDebug> = null;
function Grab() {
  const value = useChatDebug();
  useEffect(() => {
    debug = value;
  });
  return null;
}

async function render(node: ReactNode, staff: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role="admin">
          <ChatActionsProvider>
            <ChatDebugProvider staff={staff}>
              <Grab />
              {node}
            </ChatDebugProvider>
          </ChatActionsProvider>
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

async function openMenu() {
  const trigger = host.querySelector<HTMLElement>('[data-action="header.more"]')!;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    trigger.click();
  });
}
const item = (name: string) => document.querySelector<HTMLElement>(`[data-action="${name}"]`);

describe('the Debug switch', () => {
  it('is not in the ⋯ menu for anyone but staff', async () => {
    await render(<ChatHeaderMenu chat={chat} />, false);
    await openMenu();
    expect(item('activity.open')).not.toBeNull();
    expect(item('chat.debug')).toBeNull();
    expect(debug).toMatchObject({ staff: false, on: false });
  });

  it('is in the ⋯ menu for staff, and switches Debug on and off', async () => {
    await render(<ChatHeaderMenu chat={chat} />, true);
    await openMenu();
    const toggle = item('chat.debug')!;
    expect(toggle.textContent).toContain('Debug');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await act(async () => toggle.click());
    expect(debug).toMatchObject({ staff: true, on: true });
    await act(async () => debug!.toggle());
    expect(debug!.on).toBe(false);
  });
});

/** Opens an answer's Debug view: only an answer opened is read. */
async function openDebug() {
  await act(async () => item('debug.open')!.click());
}

describe('StaffDebug', () => {
  it('reads nothing until it is opened, and only the answer opened', async () => {
    await render(
      <>
        <StaffDebug runId={RUN} status="done" />
        <StaffDebug runId="44444444-4444-4444-8444-444444444445" status="done" />
      </>,
      true,
    );
    expect(urls).toEqual([]);
    expect(host.textContent).not.toContain('list_citations');
    await openDebug();
    expect(urls).toEqual([`/api/internal/chat/messages/${RUN}/debug`]);
    expect(item('debug.open')!.getAttribute('aria-expanded')).toBe('true');
  });

  it("shows each step's tool, input, output and measure, and the model calls with cost", async () => {
    await render(<StaffDebug runId={RUN} status="done" />, true);
    await openDebug();
    expect(urls).toEqual([`/api/internal/chat/messages/${RUN}/debug`]);
    const text = host.textContent!;
    expect(text).toContain('Debug · staff only');
    expect(text).toContain('Step 1 · Read Citations');
    expect(text).toContain('list_citations');
    expect(text).toContain('840 ms');
    expect(text).toContain('Cache hit');
    expect(text).toContain('"days": 30');
    expect(text).toContain('First 20 KB of 47 KB');
    expect(text).toContain(
      'claude-haiku-4-5 · 1,800 in / 60 out tokens · cache 1,500 read / 0 write · $0.001200 · 900 ms',
    );
    expect(text).toContain('Total · 1,800 in / 60 out tokens · $0.001200');
  });

  it('downloads a step’s whole output past the first 20 KB', async () => {
    await render(<StaffDebug runId={RUN} status="done" />, true);
    await openDebug();
    await act(async () => item('debug.downloadFull')!.click());
    expect(urls).toContain(`/api/internal/chat/messages/${RUN}/debug?full=1`);
    expect(download.saveBlob).toHaveBeenCalledWith(
      expect.objectContaining({ size: expect.any(Number) }),
      'step-1-output.json',
    );
  });

  it('says so when the record can’t be read, as for anyone but staff (403)', async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ ok: false, code: 'forbidden' }, { status: 403 }),
    ) as unknown as typeof fetch;
    await render(<StaffDebug runId={RUN} status="done" />, true);
    await openDebug();
    expect(host.textContent).toContain("Couldn't read the debug record.");
    expect(host.textContent).not.toContain('list_citations');
  });
});
