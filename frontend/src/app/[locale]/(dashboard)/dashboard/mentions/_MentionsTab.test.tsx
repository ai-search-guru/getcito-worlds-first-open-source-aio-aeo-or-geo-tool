import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { DEFAULT_MENTIONS_FILTERS } from '@/lib/mentionsFilters';
import { DEFAULT_MENTIONS_TABLE, type MentionRow, type MentionsList } from '@/lib/mentionsList';
import type { Competitor } from '@/types';
import { MentionsListTab } from './_MentionsTab';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

const listMentions = vi.fn();
const getMentionResponse = vi.fn();
const sendMentionsToActionCenter = vi.fn();
const overrideMentionSentiment = vi.fn();
vi.mock('@/lib/actions/mentions', () => ({
  listMentions: (...args: unknown[]) => listMentions(...args),
  getMentionResponse: (...args: unknown[]) => getMentionResponse(...args),
  sendMentionsToActionCenter: (...args: unknown[]) => sendMentionsToActionCenter(...args),
  overrideMentionSentiment: (...args: unknown[]) => overrideMentionSentiment(...args),
}));
let canManage = true;
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({ role: canManage ? 'admin' : 'analyst', canManage, canAdmin: canManage }),
}));
const suggestContentForPrompt = vi.fn();
vi.mock('@/lib/actions/content', () => ({
  suggestContentForPrompt: (...args: unknown[]) => suggestContentForPrompt(...args),
  getGenerationJobStatus: vi.fn(),
}));
const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push }),
}));
const toast = vi.hoisted(() => ({
  loading: vi.fn(() => 'toast-1'),
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock('sonner', () => ({ toast }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const row = (over: Partial<MentionRow>): MentionRow => ({
  id: 'r1',
  createdAt: '2026-10-16T11:28:06Z',
  promptId: 'p1',
  promptText: 'Best espresso beans?',
  topicId: 't1',
  topicName: 'Beans',
  platform: 'gemini-web',
  model: 'gemini-2.5-flash',
  region: 'DE',
  sentiment: 'negative',
  occurrences: 1,
  position: 2,
  brandsNamed: 3,
  coMentioned: [{ competitorId: 'c1', name: 'Crema Club', position: 1 }],
  excerpt: 'Crema Club is first; Acme Coffee is pricier.',
  groupKey: null,
  groupCount: null,
  ...over,
});

const list = (over: Partial<MentionsList> = {}): MentionsList => ({
  total: 2,
  prompts: 1,
  rows: [row({}), row({ id: 'r2', platform: 'claude', sentiment: 'positive', coMentioned: [] })],
  brandTerms: ['Acme Coffee', 'acme.com'],
  ...over,
});

const competitors: Competitor[] = [
  { id: 'c1', brandId: 'b1', name: 'Crema Club', domain: 'cremaclub.com' },
];

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

function render(node: React.ReactNode, isLocked = false) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          {node}
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

// Export CSV itself is covered in _HeaderActions.test.tsx; the table hands it the ticked rows.
const exporter = { ready: true, busy: null, exportCsv: vi.fn(), copySummary: vi.fn() };

const tab = (props: Partial<React.ComponentProps<typeof MentionsListTab>> = {}) => (
  <MentionsListTab
    brandId="b1"
    filters={DEFAULT_MENTIONS_FILTERS}
    competitors={competitors}
    brandDomains={['acme.com']}
    showCountry={false}
    exporter={exporter}
    {...props}
  />
);

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '', '/dashboard/mentions?tab=mentions');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  listMentions.mockReset();
  getMentionResponse.mockReset();
  sendMentionsToActionCenter.mockReset();
  overrideMentionSentiment.mockReset();
  exporter.exportCsv.mockReset();
  canManage = true;
  suggestContentForPrompt.mockReset();
  push.mockReset();
  Object.values(toast).forEach((fn) => fn.mockClear());
  vi.useRealTimers();
});

describe('MentionsListTab', () => {
  it('reads a page with the URL controls and lists the mentions with the names marked', async () => {
    window.history.replaceState(
      null,
      '',
      '/dashboard/mentions?tab=mentions&sentiment=negative&with=c1',
    );
    listMentions.mockResolvedValue(list());
    render(tab());
    await settle();

    expect(listMentions).toHaveBeenCalledTimes(1);
    const [brandId, , table, page] = listMentions.mock.calls[0];
    expect([brandId, table, page]).toEqual([
      'b1',
      { sentiment: 'negative', competitor: 'c1', sort: 'newest', group: '' },
      0,
    ]);
    expect(container.textContent).toContain('2 responses · 1 prompt');

    const rows = container.querySelectorAll('tbody tr[tabindex]');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Best espresso beans?');
    expect(rows[0].textContent).toContain('Negative');
    expect(rows[0].textContent).toContain('#2 of 3');
    const marks = [...rows[0].querySelectorAll('mark')].map((m) => [m.textContent, m.className]);
    expect(marks[0][0]).toBe('Crema Club');
    expect(marks[0][1]).toContain('bg-muted');
    expect(marks[1][0]).toBe('Acme Coffee');
    expect(marks[1][1]).toContain('bg-primary');
    expect(rows[1].textContent).toContain('—');
  });

  it('heads each group with its name and size', async () => {
    window.history.replaceState(null, '', '/dashboard/mentions?tab=mentions&group=platform');
    listMentions.mockResolvedValue(
      list({
        rows: [
          row({ id: 'a', platform: 'gemini-web', groupKey: 'gemini-web', groupCount: 12 }),
          row({ id: 'b', platform: 'gemini-web', groupKey: 'gemini-web', groupCount: 12 }),
          row({ id: 'c', platform: 'claude', groupKey: 'claude', groupCount: 1 }),
        ],
      }),
    );
    render(tab());
    await settle();
    expect(
      [...container.querySelectorAll('tbody td[colspan]')].map((td) => td.textContent),
    ).toEqual(['Gemini · 12 mentions', 'Claude · 1 mention']);
  });

  it('opens the answer: header, excerpt, the full response marked, and typed citations', async () => {
    listMentions.mockResolvedValue(list());
    getMentionResponse.mockResolvedValue({
      response:
        '## Picks\n\n- **Acme Coffee** for [beans](https://acme.com/beans)\n- Crema Club for price',
      citations: [
        { url: 'https://www.acme.com/beans', title: 'Our beans', startIndex: 0, endIndex: 0 },
        { url: 'https://cremaclub.com/x', title: '', startIndex: 0, endIndex: 0 },
        { url: 'https://reddit.com/r/coffee', title: 'Thread', startIndex: 0, endIndex: 0 },
      ],
    });
    render(tab());
    await settle();

    const first = container.querySelector('tbody tr[tabindex]') as HTMLElement;
    await act(async () => {
      first.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getMentionResponse).toHaveBeenCalledWith('b1', 'r1');

    const drawer = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(drawer).not.toBeNull();
    const text = drawer.textContent ?? '';
    expect(text).toContain('Gemini · gemini-2.5-flash');
    expect(text).toContain('Best espresso beans?');
    expect(text).toContain('Position #2 of 3');
    expect(text).toContain('Topic: Beans');
    expect(drawer.querySelector('a[href="/dashboard/prompts/p1"]')).not.toBeNull();
    expect(text).toContain('Crema Club#1');

    // The answer's names are marked inside the rendered markdown, bold and list items included.
    const listItems = [...drawer.querySelectorAll('li')].filter((li) => li.closest('.prose'));
    expect(listItems[0].querySelector('strong mark')?.textContent).toBe('Acme Coffee');
    expect(listItems[1].querySelector('mark')?.textContent).toBe('Crema Club');

    expect(text).toContain('Citations in this answer (3)');
    const cited = [...drawer.querySelectorAll('ul.divide-y li')].map((li) => li.textContent);
    expect(cited[0]).toContain('You');
    expect(cited[1]).toContain('cremaclub.com');
    expect(cited[1]).toContain('Competitor');
    expect(cited[2]).toContain('Forum');
  });

  it('sends the ticked answers to the Action Center as one action', async () => {
    listMentions.mockResolvedValue(list());
    sendMentionsToActionCenter.mockResolvedValue({ actionId: 'a1', actionNo: 62, created: true });
    render(tab());
    await settle();

    const boxes = () => [...container.querySelectorAll('button[role="checkbox"]')] as HTMLElement[];
    // The header's box, then one per row.
    expect(boxes()).toHaveLength(3);
    act(() => boxes()[1].click());
    expect(container.textContent).toContain('1 answer selected');
    // Ticking doesn't open the answer.
    expect(getMentionResponse).not.toHaveBeenCalled();
    act(() => boxes()[0].click());
    expect(container.textContent).toContain('2 answers selected');

    const send = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Send to Action Center',
    ) as HTMLElement;
    await act(async () => {
      send.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sendMentionsToActionCenter).toHaveBeenCalledWith('b1', [
      { id: 'r1', excerpt: 'Crema Club is first; Acme Coffee is pricier.' },
      { id: 'r2', excerpt: 'Crema Club is first; Acme Coffee is pricier.' },
    ]);
    expect(toast.success).toHaveBeenCalledWith(
      'Sent to the Action Center',
      expect.objectContaining({ description: 'AC-62 · 2 answers' }),
    );
    const [, options] = toast.success.mock.calls[0] as unknown as [
      string,
      { action: { onClick: () => void } },
    ];
    options.action.onClick();
    expect(push).toHaveBeenCalledWith('/dashboard/action-center/actions?action=a1');
    // Sent: the selection is cleared.
    expect(container.textContent).not.toContain('selected');
  });

  it('sends nothing on a read-only workspace: Send to Action Center opens the upgrade dialog', async () => {
    openUpgrade.mockReset();
    listMentions.mockResolvedValue(list());
    render(tab(), true);
    await settle();
    const boxes = [...container.querySelectorAll('button[role="checkbox"]')] as HTMLElement[];
    act(() => boxes[1].click());
    const send = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Send to Action Center',
    ) as HTMLElement;
    await act(async () => {
      send.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Sending actions needs a plan');
    expect(sendMentionsToActionCenter).not.toHaveBeenCalled();
    // Nothing went: the selection stays.
    expect(container.textContent).toContain('1 answer selected');
  });

  it("exports the ticked answers under the table's controls", async () => {
    window.history.replaceState(null, '', '/dashboard/mentions?tab=mentions&sentiment=negative');
    listMentions.mockResolvedValue(list());
    render(tab());
    await settle();
    const boxes = [...container.querySelectorAll('button[role="checkbox"]')] as HTMLElement[];
    act(() => boxes[2].click());

    const exportButton = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Export',
    ) as HTMLElement;
    act(() => exportButton.click());
    expect(exporter.exportCsv).toHaveBeenCalledWith(
      { ...DEFAULT_MENTIONS_TABLE, sentiment: 'negative' },
      { total: 2, prompts: 1, rows: [expect.objectContaining({ id: 'r2' })] },
    );
  });

  it('sends one answer, and suggests content for its prompt, from the drawer', async () => {
    listMentions.mockResolvedValue(list());
    getMentionResponse.mockResolvedValue({ response: 'Acme Coffee.', citations: [] });
    sendMentionsToActionCenter.mockResolvedValue({ actionId: 'a9', actionNo: 9, created: false });
    suggestContentForPrompt.mockResolvedValue({ ok: true, existingId: 'opp-1' });
    render(tab());
    await settle();
    await act(async () => {
      (container.querySelector('tbody tr[tabindex]') as HTMLElement).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    const drawer = document.body.querySelector('[role="dialog"]') as HTMLElement;
    const button = (label: string) =>
      [...drawer.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLElement;

    await act(async () => {
      button('Send to Action Center').click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sendMentionsToActionCenter).toHaveBeenCalledWith('b1', [
      { id: 'r1', excerpt: 'Crema Club is first; Acme Coffee is pricier.' },
    ]);
    expect(toast.info).toHaveBeenCalledWith(
      'Already in the Action Center',
      expect.objectContaining({ description: 'AC-9 is open with these answers.' }),
    );

    await act(async () => {
      button('Suggest content').click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(suggestContentForPrompt).toHaveBeenCalledWith('p1', expect.any(String));
    expect(toast.info).toHaveBeenCalledWith(
      'This prompt already has a content suggestion',
      expect.objectContaining({ description: 'Best espresso beans?' }),
    );
  });

  it('says why a content suggestion failed, in plain words', async () => {
    listMentions.mockResolvedValue(list());
    getMentionResponse.mockResolvedValue({ response: 'Acme Coffee.', citations: [] });
    suggestContentForPrompt.mockResolvedValue({
      ok: false,
      error: 'Unauthorized',
      failure: 'workspace',
    });
    render(tab());
    await settle();
    await act(async () => {
      (container.querySelector('tbody tr[tabindex]') as HTMLElement).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    const drawer = document.body.querySelector('[role="dialog"]') as HTMLElement;
    await act(async () => {
      (
        [...drawer.querySelectorAll('button')].find(
          (b) => b.textContent === 'Suggest content',
        ) as HTMLElement
      ).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    // Not the raw "Unauthorized": the reason, and what to do about it.
    expect(toast.error).toHaveBeenCalledWith(
      "This brand isn't in your workspace. Switch to one of your brands.",
      expect.objectContaining({
        id: 'toast-1',
        description: 'Best espresso beans?',
        action: expect.objectContaining({ label: 'Your brands' }),
      }),
    );
  });

  it("shows an answer's last correction, and lets a manager correct it", async () => {
    listMentions.mockResolvedValue(list());
    getMentionResponse.mockResolvedValue({
      response: 'Acme Coffee.',
      citations: [],
      override: {
        sentiment: 'negative',
        previousSentiment: 'neutral',
        note: 'Calls us pricey',
        userName: 'Demo User',
        createdAt: '2026-10-16T10:00:00Z',
      },
    });
    overrideMentionSentiment.mockResolvedValue({
      changed: true,
      sentiment: 'positive',
      override: {
        sentiment: 'positive',
        previousSentiment: 'negative',
        note: 'Praises the roast',
        userName: 'Demo User',
        createdAt: '2026-10-17T10:00:00Z',
      },
    });
    render(tab());
    await settle();
    await act(async () => {
      (container.querySelector('tbody tr[tabindex]') as HTMLElement).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    const drawer = () => document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(drawer().textContent).toContain('Corrected by Demo User on Oct 16, 2026 · was Neutral');
    expect(drawer().textContent).toContain('“Calls us pricey”');

    const button = (label: string) =>
      [...drawer().querySelectorAll('button')].find((b) => b.textContent === label) as HTMLElement;
    act(() => button('Sentiment is wrong?').click());
    // The current sentiment is chosen, so there is nothing to save yet.
    expect(button('Save correction').hasAttribute('disabled')).toBe(true);
    act(() => button('Positive').click());
    const note = drawer().querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(note, 'Praises the roast');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      button('Save correction').click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(overrideMentionSentiment).toHaveBeenCalledWith('r1', 'positive', 'Praises the roast');
    expect(toast.success).toHaveBeenCalledWith(
      'Sentiment corrected',
      expect.objectContaining({ description: 'This answer now counts as Positive everywhere.' }),
    );
    // The drawer and the row show the new sentiment at once, with the new history.
    expect(drawer().textContent).toContain('Corrected by Demo User on Oct 17, 2026 · was Negative');
    const firstRow = container.querySelector('tbody tr[tabindex]') as HTMLElement;
    expect(firstRow.textContent).toContain('Positive');
    expect(firstRow.textContent).not.toContain('Negative');
  });

  it('reads the page again when a correction takes a row out of the sentiment filter', async () => {
    window.history.replaceState(null, '', '/dashboard/mentions?tab=mentions&sentiment=negative');
    listMentions.mockResolvedValue(list());
    getMentionResponse.mockResolvedValue({
      response: 'Acme Coffee.',
      citations: [],
      override: null,
    });
    overrideMentionSentiment.mockResolvedValue({
      changed: true,
      sentiment: 'neutral',
      override: null,
    });
    render(tab());
    await settle();
    expect(listMentions).toHaveBeenCalledTimes(1);
    await act(async () => {
      (container.querySelector('tbody tr[tabindex]') as HTMLElement).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    const drawer = document.body.querySelector('[role="dialog"]') as HTMLElement;
    const button = (label: string) =>
      [...drawer.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLElement;
    act(() => button('Sentiment is wrong?').click());
    act(() => button('Neutral').click());
    await act(async () => {
      button('Save correction').click();
      await vi.advanceTimersByTimeAsync(0);
    });
    await settle();
    expect(listMentions).toHaveBeenCalledTimes(2);
  });

  it('offers no correction to analysts', async () => {
    canManage = false;
    listMentions.mockResolvedValue(list());
    getMentionResponse.mockResolvedValue({
      response: 'Acme Coffee.',
      citations: [],
      override: null,
    });
    render(tab());
    await settle();
    await act(async () => {
      (container.querySelector('tbody tr[tabindex]') as HTMLElement).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    const drawer = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(drawer.textContent).not.toContain('Sentiment is wrong?');
    // Suggesting content costs AI: an admin's or a manager's (2026-10-29).
    const labels = [...drawer.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Send to Action Center');
    expect(labels).not.toContain('Suggest content');
  });

  it('keeps its page when a read fails, and says so', async () => {
    listMentions.mockResolvedValueOnce(list({ total: 250 }));
    render(tab());
    await settle();
    const next = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Next');
    listMentions.mockRejectedValueOnce(new Error('timeout'));
    await act(async () => {
      next?.click();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(listMentions).toHaveBeenCalledTimes(2);
    expect(listMentions.mock.calls[1][3]).toBe(1);
    expect(container.textContent).toContain("Couldn't load the mentions.");
    // No silent jump back to the first page.
    await settle();
    expect(listMentions).toHaveBeenCalledTimes(2);
  });

  it('says when nothing matches, and asks for dates on an empty custom range', async () => {
    listMentions.mockResolvedValue(list({ total: 0, prompts: 0, rows: [] }));
    render(tab());
    await settle();
    expect(container.textContent).toContain('No mentions match these filters.');

    render(tab({ filters: { ...DEFAULT_MENTIONS_FILTERS, range: 'custom' } }));
    await settle();
    expect(container.textContent).toContain('Choose a start or end date to see the mentions.');
  });
});
