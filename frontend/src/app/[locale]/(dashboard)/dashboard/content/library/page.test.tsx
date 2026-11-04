import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import { libraryTabCounts, type ContentDraftListItem } from '@/lib/content/drafts';
import ContentLibraryPage from './page';

const getContentDrafts = vi.fn();
const getContentStartOptions = vi.fn();
const markContentDraftReady = vi.fn();
const setContentDraftStatus = vi.fn();
const archiveContentDraft = vi.fn();
const deleteContentDraft = vi.fn();
const getContentDraftPages = vi.fn();
// No white label kit: downloads keep GetCito's names (exportName.test.ts has a kit's).
vi.mock('@/lib/actions/whiteLabel', () => ({
  getExportBranding: async () => ({ ok: true, branding: null }),
}));
vi.mock('@/lib/actions/contentDrafts', () => ({
  getContentDraftPages: (...args: unknown[]) => getContentDraftPages(...args),
  // A list stands for a brand under the cap: its tabs count its rows.
  getContentDrafts: async (...args: unknown[]) => {
    const read = await getContentDrafts(...args);
    return Array.isArray(read) ? { drafts: read, counts: libraryTabCounts(read) } : read;
  },
  getContentStartOptions: (...args: unknown[]) => getContentStartOptions(...args),
  createContentDraft: vi.fn(),
  markContentDraftReady: (...args: unknown[]) => markContentDraftReady(...args),
  setContentDraftStatus: (...args: unknown[]) => setContentDraftStatus(...args),
  archiveContentDraft: (...args: unknown[]) => archiveContentDraft(...args),
  deleteContentDraft: (...args: unknown[]) => deleteContentDraft(...args),
}));
const role = vi.hoisted(() => ({ canManage: true }));
const takeDownDraft = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/cmsTakeDown', () => ({ takeDownDraft }));
const chat = vi.hoisted(() => ({ on: false }));
vi.mock('@/components/context/ChatAgenticProvider', () => ({ useChatAgentic: () => chat.on }));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => role }));
// Start's Team: its assignee picker reads the team, and the sent task is assigned.
vi.mock('@/lib/actions/team', () => ({ listBrandMembers: vi.fn(async () => []) }));
vi.mock('@/lib/actions/actionCenter', () => ({ assignAction: vi.fn() }));
const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push }),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const saveBlob = vi.hoisted(() => vi.fn());
vi.mock('@/lib/download', () => ({ saveBlob }));
const readCmsStatuses = vi.hoisted(() => vi.fn());
const readDraftCms = vi.hoisted(() => vi.fn());
const sendPagesToCms = vi.hoisted(() => vi.fn());
const refreshWebflowPublished = vi.hoisted(() => vi.fn());
const refreshWordPressPublished = vi.hoisted(() => vi.fn());
const refreshFramerPublished = vi.hoisted(() => vi.fn());
const refreshWixPublished = vi.hoisted(() => vi.fn());
// Mark published (CE-013).
const publishPage = vi.hoisted(() => vi.fn());
const readPublishAddress = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/publishClient', () => ({ publishPage, readPublishAddress }));
vi.mock('@/lib/content/cmsSendClient', () => ({
  readCmsStatuses,
  refreshWebflowPublished,
  refreshWordPressPublished,
  refreshFramerPublished,
  refreshWixPublished,
  readDraftCms,
  sendPagesToCms,
  readKeptFields: vi.fn(async () => new Map()),
  readDeliveries: vi.fn(async () => []),
}));
// The brand's Webflow connection (#1331, phase 2): none here.
vi.mock('@/lib/webflowClient', () => ({
  readWebflow: async () => ({ ok: true, configured: false, connection: null }),
}));
// Nor its WordPress site (00294).
vi.mock('@/lib/wordpressClient', () => ({
  readWordPress: async () => ({ ok: true, configured: false, connection: null }),
}));
// Nor its Framer collection (00295).
vi.mock('@/lib/framerClient', () => ({
  readFramer: async () => ({ ok: true, configured: false, connection: null }),
}));
vi.mock('@/lib/actions/contentAuthors', () => ({ getContentAuthors: vi.fn(async () => null) }));
// The workspace's plan: active unless a test says it's read-only.
const gate = vi.hoisted(() => ({ isLocked: false, openUpgrade: vi.fn() }));
vi.mock('@/components/context/upgradeGate', () => ({
  useUpgradeGate: () => ({
    isLocked: gate.isLocked,
    openUpgrade: gate.openUpgrade,
    // As the real one: read-only, the dialog with the action's label instead.
    guard:
      <Args extends unknown[], Result>(
        fn: (...args: Args) => Result,
        options: { action?: string } = {},
      ) =>
      (...args: Args) => {
        if (!gate.isLocked) return fn(...args);
        gate.openUpgrade(options.action);
        return undefined;
      },
  }),
  useUpgradeDialog: () => null,
}));

/** jsdom's Blob has no text(): read it as a browser's FileReader would. */
const readText = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });
const brandState = vi.hoisted(() => ({
  activeBrandId: 'brand-1' as string | null,
  brands: [{ id: 'brand-1', industry: 'Travel & Hospitality', shoppingModeEnabled: false }],
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (selector: (state: typeof brandState) => unknown) => selector(brandState),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const row = (over: Partial<ContentDraftListItem>): ContentDraftListItem => ({
  id: 'd1',
  title: 'Pipeline forecasting',
  pageType: 'feature_page',
  method: 'optimize',
  status: 'in_review',
  author: 'user',
  createdBy: { id: 'u1', fullName: 'Ada Lovelace', avatarUrl: null },
  isMine: true,
  agentState: null,
  createdAt: '2026-10-18T09:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  archivedAt: null,
  origin: 'editor',
  conversation: null,
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function renderPage() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ContentLibraryPage />
      </NextIntlClientProvider>,
    );
  });
}

/** A draft's last send, as readCmsStatuses returns it. */
const sendOf = (status: string) => ({
  status,
  target: 'webhook',
  at: '2026-10-24T10:00:00Z',
  httpStatus: status === 'failed' ? 500 : 200,
  error: null,
  publishedUrl: null,
});
const lastSendBox = () => container.querySelector('[aria-label="Last send"]');

const tab = (name: string) =>
  [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((el) =>
    el.textContent?.startsWith(name),
  )!;

beforeEach(() => {
  brandState.activeBrandId = 'brand-1';
  gate.isLocked = false;
  gate.openUpgrade.mockReset();
  window.history.replaceState(null, '', '/dashboard/content/library');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getContentDrafts.mockReset();
  refreshWebflowPublished.mockReset().mockResolvedValue([]);
  refreshWordPressPublished.mockReset().mockResolvedValue([]);
  refreshFramerPublished.mockReset().mockResolvedValue([]);
  refreshWixPublished.mockReset().mockResolvedValue([]);
  readPublishAddress.mockReset().mockResolvedValue('https://acme.example/pipeline-forecasting');
  publishPage.mockReset().mockResolvedValue({
    ok: true,
    publishedUrl: 'https://acme.example/pipeline-forecasting',
    publishedAt: '2026-10-25T10:00:00Z',
    onBrandDomain: true,
    taskCompleted: false,
  });
  getContentStartOptions.mockReset().mockResolvedValue({
    opportunities: [],
    prompts: [],
    promptsSeen: 0,
    topics: [],
  });
  push.mockReset();
  toast.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
  markContentDraftReady.mockReset().mockResolvedValue({ status: 'ready', tasksDone: 0 });
  setContentDraftStatus.mockReset().mockResolvedValue(undefined);
  archiveContentDraft.mockReset().mockResolvedValue(undefined);
  deleteContentDraft.mockReset().mockResolvedValue(undefined);
  getContentDraftPages.mockReset().mockImplementation(async (_brand: string, ids: string[]) => ({
    pages: ids.map((id) => ({
      id,
      title: 'Pipeline forecasting',
      bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams trust it.</p>',
      sourceUrl: 'https://acme.example/pricing',
    })),
    rest: [],
  }));
  saveBlob.mockReset();
  readCmsStatuses.mockReset().mockResolvedValue(new Map());
  readDraftCms.mockReset().mockResolvedValue({ fields: {}, publishedUrl: null, last: null });
  sendPagesToCms.mockReset().mockResolvedValue({
    ok: true,
    deliveries: [{ id: 'x1', draftId: 'd1', status: 'sent' }],
  });
  role.canManage = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Content Library', () => {
  it('lists the brand’s drafts with who wrote them, and counts each tab', async () => {
    // Dates this year read "Oct 18"; an older one keeps its year.
    vi.useFakeTimers({ now: new Date('2026-10-22T12:00:00Z'), toFake: ['Date'] });
    getContentDrafts.mockResolvedValue([
      row({}),
      row({
        id: 'd2',
        title: 'Northwind vs HubSpot',
        pageType: 'comparison',
        method: 'create',
        author: 'agent',
        createdBy: null,
        isMine: false,
      }),
      row({
        id: 'd3',
        title: '',
        status: 'published',
        isMine: false,
        createdBy: { id: 'u2', fullName: null, avatarUrl: null, email: 'grace@acme.com' },
        createdAt: '2025-12-30T10:00:00Z',
      }),
    ]);
    await renderPage();
    vi.useRealTimers();

    expect(getContentDrafts).toHaveBeenCalledWith('brand-1');
    expect(tab('All').textContent).toBe('All3');
    expect(tab('In review').textContent).toBe('In review2');
    expect(tab('Ready').textContent).toBe('Ready0');

    // After each row's box to pick it (admins and managers).
    const rows = [...container.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].slice(1).map((td) => td.textContent),
    );
    // Created and Updated where the AEO score was; the last cell is the row menu.
    expect(rows[0]).toEqual([
      'Pipeline forecasting',
      'Feature page',
      'Optimize',
      'AL' + 'You',
      // Made in (W4-10).
      'Content Editor',
      'In review',
      'Oct 18',
      'Oct 20',
      '',
    ]);
    expect(rows[1].slice(0, 6)).toEqual([
      'Northwind vs HubSpot',
      'Comparison',
      'Create',
      'Content Agent',
      'Content Editor',
      'In review',
    ]);
    // No title yet; a teammate with no name is named by e-mail.
    expect(rows[2][0]).toBe('Untitled');
    expect(rows[2][3]).toBe('Ggrace@acme.com');
    expect(rows[2][6]).toBe('Dec 30, 2025');
    expect([...container.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      // The box to pick every row listed.
      '',
      'Content',
      'Type',
      'Method',
      'By',
      'Made in',
      'Status',
      'Created',
      'Updated',
      'Row actions',
    ]);

    const link = container.querySelector('tbody a')!;
    expect(link.getAttribute('href')).toBe('/dashboard/content/editor/d1');
  });

  it('counts each tab in all past the cap, and says the list holds the latest', async () => {
    getContentDrafts.mockResolvedValue({
      drafts: [row({}), row({ id: 'd2', status: 'published' })],
      counts: { all: 812, draft: 300, in_review: 12, ready: 0, published: 500, archived: 3 },
    });
    await renderPage();
    expect(tab('All').textContent).toBe('All812');
    expect(tab('Published').textContent).toBe('Published500');
    expect(container.textContent).toContain('Showing the 2 changed most recently of 812.');

    await act(async () => {
      tab('Ready').click();
    });
    expect(container.textContent).not.toContain('changed most recently');
  });

  it('shows a tab’s drafts only, and keeps the tab in the URL', async () => {
    getContentDrafts.mockResolvedValue([row({}), row({ id: 'd2', status: 'published' })]);
    await renderPage();

    await act(async () => {
      tab('Published').click();
    });
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(window.location.search).toBe('?tab=published');

    await act(async () => {
      tab('Ready').click();
    });
    expect(container.textContent).toContain('Nothing marked ready.');
  });

  it('shows where the Content Agent is, and reads the list again while it writes', async () => {
    vi.useFakeTimers();
    try {
      getContentDrafts.mockResolvedValue([
        row({ status: 'draft', author: 'agent', agentState: 'writing' }),
        row({ id: 'd2', status: 'draft', agentState: 'failed' }),
        // Written by hand after the agent failed, and marked ready.
        row({ id: 'd3', status: 'ready', agentState: 'failed' }),
      ]);
      await renderPage();
      const status = [...container.querySelectorAll('tbody tr')].map(
        (tr) => tr.querySelectorAll('td')[6].textContent,
      );
      expect(status).toEqual(['Agent writing…', 'Agent failed', 'Ready']);
      expect(getContentDrafts).toHaveBeenCalledTimes(1);

      getContentDrafts.mockResolvedValue([row({ status: 'in_review', author: 'agent' })]);
      await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
      expect(getContentDrafts).toHaveBeenCalledTimes(2);
      expect(container.querySelector('tbody tr td:nth-child(7)')!.textContent).toBe('In review');
      await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
      expect(getContentDrafts).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the agent as Chat lists a run, with the new Chat on', async () => {
    chat.on = true;
    try {
      getContentDrafts.mockResolvedValue([
        row({ status: 'draft', author: 'agent', agentState: 'writing' }),
        row({ id: 'd2', status: 'draft', agentState: 'failed' }),
      ]);
      await renderPage();
      const lines = [...container.querySelectorAll('[data-slot="agent-state-line"]')];
      expect(lines.map((line) => line.textContent)).toEqual(['Agent writing…', 'Agent failed']);
      expect(
        lines.map((line) =>
          line.querySelector('[data-slot="list-dot"]')?.getAttribute('data-state'),
        ),
      ).toEqual(['running', 'failed']);
    } finally {
      chat.on = false;
    }
  });

  it('opens the tab the URL names', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?tab=in_review');
    getContentDrafts.mockResolvedValue([row({}), row({ id: 'd2', status: 'draft' })]);
    await renderPage();
    expect(tab('In review').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('says what the Library is for while it is empty', async () => {
    getContentDrafts.mockResolvedValue([]);
    await renderPage();
    expect(container.textContent).toContain('Nothing written yet');
    expect(container.textContent).toContain(
      'Pages you and the Content Agent write or change in GetCito show up here.',
    );
  });

  it('offers a retry when the read fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getContentDrafts.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([row({})]);
    await renderPage();
    expect(container.textContent).toContain("Couldn't load the Library.");

    const retry = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Try again',
    )!;
    await act(async () => {
      retry.click();
    });
    expect(getContentDrafts).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    error.mockRestore();
  });

  it('opens New content for the brand', async () => {
    getContentDrafts.mockResolvedValue([]);
    await renderPage();
    const newContent = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'New content',
    )!;
    await act(async () => newContent.click());
    expect(getContentStartOptions).toHaveBeenCalledWith('brand-1');
    expect(document.body.textContent).toContain('Pick how you want to start.');
    expect(push).not.toHaveBeenCalled();
  });

  it('opens New content once when the URL asks (Content › Editor with no draft)', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?new=1');
    getContentDrafts.mockResolvedValue([]);
    await renderPage();
    expect(document.body.textContent).toContain('Pick how you want to start.');
    // Closed, it doesn't open again on a reload.
    expect(window.location.search).toBe('');
  });

  it('asks for a brand when none is selected', async () => {
    brandState.activeBrandId = null;
    await renderPage();
    expect(getContentDrafts).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Select a brand to see its content.');
  });
});

describe('Send to CMS from a Library row (#1331)', () => {
  const pick = async (title: string, item: string) => {
    const trigger = container.querySelector<HTMLElement>(`[aria-label="Actions for ${title}"]`)!;
    await act(async () => trigger.click());
    const found = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent === item,
    )!;
    await act(async () => found.click());
  };
  const dialog = () => document.querySelector('[role="dialog"]');
  const inDialog = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (b) => b.textContent === name,
    )!;

  it('opens the Send dialog on the row’s page, and reads the sends again once it went', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    expect(readCmsStatuses).toHaveBeenCalledWith(['d1']);
    await pick('Pipeline forecasting', 'Send to CMS');
    expect(getContentDraftPages).toHaveBeenCalledWith('brand-1', ['d1']);
    expect(dialog()!.textContent).toContain('Send to CMS');
    // The live page's own address part.
    expect(document.querySelector<HTMLInputElement>('#cms-slug')!.value).toBe('pricing');

    await act(async () => inDialog('Send').click());
    expect(sendPagesToCms).toHaveBeenCalledWith(
      'brand-1',
      [
        expect.objectContaining({
          draftId: 'd1',
          slug: 'pricing',
          html: '<p>Teams trust it.</p>',
          // Authors come with Quality (CE-038): while it is off, none goes.
          author: null,
        }),
      ],
      'webhook',
    );
    expect(dialog()).toBeNull();
    expect(readCmsStatuses).toHaveBeenCalledTimes(2);
  });

  it('fills a placeholder in the editor', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    getContentDraftPages.mockResolvedValue({
      pages: [
        {
          id: 'd1',
          title: 'Pipeline forecasting',
          bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams save [figure] hours.</p>',
          sourceUrl: null,
          authorId: null,
          reviewerId: null,
          authorConfirmed: false,
          language: null,
          pageType: null,
          isNew: false,
          schemaLeftOut: false,
        },
      ],
      rest: [],
    });
    await renderPage();
    await pick('Pipeline forecasting', 'Send to CMS');
    expect(inDialog('Send').disabled).toBe(true);
    await act(async () => inDialog('Fill now').click());
    expect(push).toHaveBeenCalledWith('/dashboard/content/editor/d1');
  });

  it('says when the page couldn’t be read', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    getContentDraftPages.mockResolvedValue({ pages: [], rest: [] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderPage();
    await pick('Pipeline forecasting', 'Send to CMS');
    expect(toast.error).toHaveBeenCalledWith("Couldn't open the page to send. Try again.");
    expect(dialog()).toBeNull();
  });

  it('shows each row’s last send beside its status', async () => {
    getContentDrafts.mockResolvedValue([
      row({}),
      row({ id: 'd2', title: 'Churn guide', status: 'published' }),
      row({ id: 'd3', title: 'Never sent' }),
    ]);
    readCmsStatuses.mockResolvedValue(
      new Map([
        [
          'd1',
          {
            status: 'failed',
            at: '2026-10-24T10:00:00Z',
            httpStatus: 500,
            error: 'The webhook answered 500',
            publishedUrl: null,
          },
        ],
        [
          'd2',
          {
            status: 'published',
            at: '2026-10-24T11:00:00Z',
            httpStatus: 200,
            error: null,
            publishedUrl: 'https://acme.example/churn',
          },
        ],
      ]),
    );
    await renderPage();
    const marks = [
      ...container.querySelectorAll<HTMLElement>(
        '[aria-label^="The last send"], [aria-label^="Published"]',
      ),
    ];
    expect(marks.map((el) => [el.tagName, el.getAttribute('aria-label')])).toEqual([
      ['BUTTON', expect.stringMatching(/^The last send to your CMS failed, Oct 24, 2026/)],
      ['A', expect.stringMatching(/^Published Oct 24, 2026/)],
    ]);
    expect(marks[1].getAttribute('href')).toBe('https://acme.example/churn');
  });

  it('says a page sent to Webflow is a draft item there', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    readCmsStatuses.mockResolvedValue(
      new Map([
        [
          'd1',
          {
            status: 'sent',
            target: 'webflow',
            at: '2026-10-24T10:00:00Z',
            httpStatus: null,
            error: null,
            publishedUrl: null,
          },
        ],
      ]),
    );
    await renderPage();
    expect(
      container.querySelector('[aria-label^="In Webflow as a draft item since Oct 24, 2026"]'),
    ).not.toBeNull();
    // Webflow says when it goes live: asked once as the Library opens.
    expect(refreshWebflowPublished).toHaveBeenCalledTimes(1);
    expect(refreshWebflowPublished).toHaveBeenCalledWith('brand-1');
  });

  it('reads the list again when pages sent to Webflow went live there', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    readCmsStatuses.mockResolvedValue(
      new Map([
        [
          'd1',
          {
            status: 'sent',
            target: 'webflow',
            at: '2026-10-24T10:00:00Z',
            httpStatus: null,
            error: null,
            publishedUrl: null,
          },
        ],
      ]),
    );
    refreshWebflowPublished.mockResolvedValue(['d1']);
    await renderPage();
    await act(async () => {});
    expect(getContentDrafts).toHaveBeenCalledTimes(2);
    // Once a brand per visit, however often the list is read.
    expect(refreshWebflowPublished).toHaveBeenCalledTimes(1);
  });

  it('doesn’t ask Webflow or WordPress by itself while the workspace is read-only', async () => {
    gate.isLocked = true;
    getContentDrafts.mockResolvedValue([row({}), row({ id: 'd2', title: 'Churn' })]);
    const sent = (target: string) => ({
      status: 'sent',
      target,
      at: '2026-10-24T10:00:00Z',
      httpStatus: null,
      error: null,
      publishedUrl: null,
    });
    readCmsStatuses.mockResolvedValue(
      new Map([
        ['d1', sent('webflow')],
        ['d2', sent('wordpress')],
      ]),
    );
    await renderPage();
    // What is stored is listed; nothing is asked of the API.
    expect(container.textContent).toContain('Pipeline forecasting');
    expect(refreshWebflowPublished).not.toHaveBeenCalled();
    expect(refreshWordPressPublished).not.toHaveBeenCalled();
  });

  it('doesn’t ask Webflow for a brand with no page there', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    expect(refreshWebflowPublished).not.toHaveBeenCalled();
    expect(refreshWordPressPublished).not.toHaveBeenCalled();
    expect(refreshFramerPublished).not.toHaveBeenCalled();
    expect(refreshWixPublished).not.toHaveBeenCalled();
  });

  /** Wix (00372): its Blog's draft posts, asked once whether they went live. */
  it('says a page sent to Wix is a draft post there, and asks Wix once', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    readCmsStatuses.mockResolvedValue(
      new Map([
        [
          'd1',
          {
            status: 'sent',
            target: 'wix',
            at: '2026-10-28T10:00:00Z',
            httpStatus: null,
            error: null,
            publishedUrl: null,
          },
        ],
      ]),
    );
    await renderPage();
    await act(async () => {});
    expect(
      container.querySelectorAll('[aria-label^="In Wix as a draft post since Oct 28, 2026"]'),
    ).toHaveLength(1);
    expect(refreshWixPublished).toHaveBeenCalledTimes(1);
    expect(refreshWixPublished).toHaveBeenCalledWith('brand-1');
  });

  it('says a page sent to WordPress is a draft post there, and asks WordPress once', async () => {
    getContentDrafts.mockResolvedValue([row({}), row({ id: 'd2', title: 'Churn' })]);
    const sent = (target: string) => ({
      status: 'sent',
      target,
      at: '2026-10-24T10:00:00Z',
      httpStatus: null,
      error: null,
      publishedUrl: null,
    });
    readCmsStatuses.mockResolvedValue(
      new Map([
        ['d1', sent('wordpress')],
        ['d2', sent('wordpress')],
      ]),
    );
    refreshWordPressPublished.mockResolvedValue(['d1']);
    await renderPage();
    await act(async () => {});
    expect(
      container.querySelectorAll('[aria-label^="In WordPress as a draft post since Oct 24, 2026"]'),
    ).toHaveLength(2);
    // WordPress says when a post goes live: asked once, the list read again as it marked one.
    expect(refreshWordPressPublished).toHaveBeenCalledTimes(1);
    expect(refreshWordPressPublished).toHaveBeenCalledWith('brand-1');
    expect(getContentDrafts).toHaveBeenCalledTimes(2);
    expect(refreshWebflowPublished).not.toHaveBeenCalled();
  });

  it('asks Webflow and WordPress once each when pages went to both', async () => {
    getContentDrafts.mockResolvedValue([row({}), row({ id: 'd2', title: 'Churn' })]);
    const sent = (target: string) => ({
      status: 'sent',
      target,
      at: '2026-10-24T10:00:00Z',
      httpStatus: null,
      error: null,
      publishedUrl: null,
    });
    readCmsStatuses.mockResolvedValue(
      new Map([
        ['d1', sent('webflow')],
        ['d2', sent('wordpress')],
      ]),
    );
    refreshWebflowPublished.mockResolvedValue(['d1']);
    refreshWordPressPublished.mockResolvedValue(['d2']);
    await renderPage();
    await act(async () => {});
    expect(refreshWebflowPublished).toHaveBeenCalledTimes(1);
    expect(refreshWordPressPublished).toHaveBeenCalledTimes(1);
    expect(refreshWebflowPublished).toHaveBeenCalledWith('brand-1');
    expect(refreshWordPressPublished).toHaveBeenCalledWith('brand-1');
    expect(refreshFramerPublished).not.toHaveBeenCalled();
  });

  it('says a page sent to Framer is a draft item there, and asks Framer once', async () => {
    getContentDrafts.mockResolvedValue([
      row({}),
      row({ id: 'd2', title: 'Churn' }),
      row({ id: 'd3', title: 'Pricing' }),
    ]);
    const sent = (status: string, error: string | null = null) => ({
      status,
      target: 'framer',
      at: '2026-10-24T10:00:00Z',
      httpStatus: null,
      error,
      publishedUrl: null,
    });
    readCmsStatuses.mockResolvedValue(
      new Map([
        ['d1', sent('sent')],
        ['d2', sent('sent')],
        // Its item deleted in Framer since (framer-status).
        ['d3', sent('failed', 'Removed in Framer')],
      ]),
    );
    refreshFramerPublished.mockResolvedValue(['d1']);
    await renderPage();
    await act(async () => {});
    expect(
      container.querySelectorAll('[aria-label^="In Framer as a draft item since Oct 24, 2026"]'),
    ).toHaveLength(2);
    // Framer says when an item goes live: asked once, the list read again as it marked one.
    expect(refreshFramerPublished).toHaveBeenCalledTimes(1);
    expect(refreshFramerPublished).toHaveBeenCalledWith('brand-1');
    expect(getContentDrafts).toHaveBeenCalledTimes(2);
    expect(refreshWebflowPublished).not.toHaveBeenCalled();
    expect(refreshWordPressPublished).not.toHaveBeenCalled();

    const mark = container.querySelector<HTMLElement>(
      '[aria-label^="The last send to Framer failed, Oct 24, 2026"]',
    )!;
    await act(async () => {
      mark.focus();
      mark.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.body.textContent).toContain('Removed in Framer');
  });

  it('doesn’t ask Framer when none of its pages is in Framer as a draft item', async () => {
    getContentDrafts.mockResolvedValue([
      row({}),
      row({ id: 'd2', title: 'Churn' }),
      row({ id: 'd3', title: 'Pricing' }),
    ]);
    const last = (status: string) => ({
      status,
      target: 'framer',
      at: '2026-10-24T10:00:00Z',
      httpStatus: null,
      error: null,
      publishedUrl: null,
    });
    readCmsStatuses.mockResolvedValue(
      new Map([
        ['d1', last('queued')],
        ['d2', last('failed')],
        ['d3', last('published')],
      ]),
    );
    await renderPage();
    await act(async () => {});
    expect(container.querySelector('[aria-label^="Sending to Framer since"]')).not.toBeNull();
    expect(refreshFramerPublished).not.toHaveBeenCalled();
  });

  it('asks Framer again for another brand, once a brand per visit', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    readCmsStatuses.mockResolvedValue(
      new Map([
        [
          'd1',
          {
            status: 'sent',
            target: 'framer',
            at: '2026-10-24T10:00:00Z',
            httpStatus: null,
            error: null,
            publishedUrl: null,
          },
        ],
      ]),
    );
    await renderPage();
    await act(async () => {});
    expect(refreshFramerPublished).toHaveBeenCalledTimes(1);
    expect(refreshFramerPublished).toHaveBeenLastCalledWith('brand-1');
    brandState.activeBrandId = 'brand-2';
    await renderPage();
    await act(async () => {});
    expect(refreshFramerPublished).toHaveBeenCalledTimes(2);
    expect(refreshFramerPublished).toHaveBeenLastCalledWith('brand-2');
    // Back to the first: read already on this visit.
    brandState.activeBrandId = 'brand-1';
    await renderPage();
    await act(async () => {});
    expect(refreshFramerPublished).toHaveBeenCalledTimes(2);
  });

  it('asks Webflow, WordPress and Framer once each when pages went to all three', async () => {
    getContentDrafts.mockResolvedValue([
      row({}),
      row({ id: 'd2', title: 'Churn' }),
      row({ id: 'd3', title: 'Pricing' }),
    ]);
    const sent = (target: string) => ({
      status: 'sent',
      target,
      at: '2026-10-24T10:00:00Z',
      httpStatus: null,
      error: null,
      publishedUrl: null,
    });
    readCmsStatuses.mockResolvedValue(
      new Map([
        ['d1', sent('webflow')],
        ['d2', sent('wordpress')],
        ['d3', sent('framer')],
      ]),
    );
    refreshWebflowPublished.mockResolvedValue(['d1']);
    refreshWordPressPublished.mockResolvedValue(['d2']);
    refreshFramerPublished.mockResolvedValue(['d3']);
    await renderPage();
    await act(async () => {});
    for (const refresh of [
      refreshWebflowPublished,
      refreshWordPressPublished,
      refreshFramerPublished,
    ]) {
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledWith('brand-1');
    }
  });

  it('says the workflow’s reason for a page its webhook took that then failed', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    readCmsStatuses.mockResolvedValue(
      new Map([
        [
          'd1',
          {
            status: 'failed',
            at: '2026-10-24T10:00:00Z',
            httpStatus: 200,
            error: 'Slug already taken',
            publishedUrl: null,
          },
        ],
      ]),
    );
    await renderPage();
    const mark = container.querySelector<HTMLElement>('[aria-label^="The last send"]')!;
    await act(async () => {
      mark.focus();
      mark.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.body.textContent).toContain('Slug already taken');
    expect(document.body.textContent).not.toContain('The webhook answered 200');
  });

  it('isn’t offered on an archived draft, which the server doesn’t send', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?tab=archived');
    getContentDrafts.mockResolvedValue([row({ archivedAt: '2026-10-21T08:00:00Z' })]);
    await renderPage();
    const trigger = container.querySelector<HTMLElement>(
      '[aria-label="Actions for Pipeline forecasting"]',
    )!;
    await act(async () => trigger.click());
    const items = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((el) => el.textContent)).toContain('Restore');
    expect(items.map((el) => el.textContent)).not.toContain('Send to CMS');
  });

  it('sends to the draft’s own brand, should the brand switch while its page is read', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    let answer: (read: unknown) => void = () => {};
    getContentDraftPages.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await renderPage();
    await pick('Pipeline forecasting', 'Send to CMS');
    brandState.activeBrandId = 'brand-2';
    await renderPage();
    await act(async () =>
      answer({
        pages: [
          {
            id: 'd1',
            title: 'Pipeline forecasting',
            bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams trust it.</p>',
            sourceUrl: null,
            authorId: null,
            authorConfirmed: false,
            language: null,
            pageType: null,
            isNew: false,
            schemaLeftOut: false,
          },
        ],
        rest: [],
      }),
    );
    await act(async () => inDialog('Send').click());
    expect(sendPagesToCms).toHaveBeenCalledWith(
      'brand-1',
      [expect.objectContaining({ draftId: 'd1' })],
      'webhook',
    );
  });

  it('is for admins and managers only', async () => {
    role.canManage = false;
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    const trigger = container.querySelector<HTMLElement>(
      '[aria-label="Actions for Pipeline forecasting"]',
    )!;
    await act(async () => trigger.click());
    const items = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((el) => el.textContent)).not.toContain('Send to CMS');
  });
});

describe('Take down from a Library row (AUTONOMOUS-GO-LIVE PR 10)', () => {
  const live = (target: string, over = {}) =>
    new Map([
      [
        'd1',
        {
          status: 'published',
          target,
          at: '2026-11-01T10:00:00Z',
          httpStatus: null,
          error: null,
          publishedUrl: 'https://acme.example/blog/pipeline-forecasting',
          ...over,
        },
      ],
    ]);
  const menu = async () => {
    const trigger = container.querySelector<HTMLElement>(
      '[aria-label="Actions for Pipeline forecasting"]',
    )!;
    await act(async () => trigger.click());
    return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  };

  it('takes a page live in Webflow down, says so, and reads the row again', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    readCmsStatuses.mockResolvedValue(live('webflow'));
    takeDownDraft.mockResolvedValue({ ok: true, target: 'webflow' });
    await renderPage();
    const item = (await menu()).find((el) => el.textContent === 'Take down')!;
    await act(async () => item.click());
    const dialog = document.querySelector('[data-slot="take-down-dialog"]')!;
    expect(dialog.textContent).toContain('Take down “Pipeline forecasting”?');
    expect(dialog.textContent).toContain(
      'It leaves acme.example now and goes back to a draft in Webflow.',
    );
    const reads = readCmsStatuses.mock.calls.length;
    await act(async () =>
      (dialog.querySelector('[data-action="takeDown.confirm"]') as HTMLElement).click(),
    );
    expect(takeDownDraft).toHaveBeenCalledWith('d1');
    expect(toast.success).toHaveBeenCalledWith('Taken down. It’s a draft in Webflow again.');
    expect(readCmsStatuses.mock.calls.length).toBeGreaterThan(reads);
  });

  it.each([
    ['live in Wix', 'wix', {}, true],
    ['live in Framer, which publishes the whole site', 'framer', {}, false],
    ['sent to the webhook', 'webhook', {}, false],
    ['only sent to Webflow', 'webflow', { status: 'sent', publishedUrl: null }, false],
  ] as const)('on a page %s: offered %s', async (_case, target, over, offered) => {
    getContentDrafts.mockResolvedValue([row({})]);
    readCmsStatuses.mockResolvedValue(live(target, over));
    await renderPage();
    expect((await menu()).some((el) => el.textContent === 'Take down')).toBe(offered);
  });

  it('isn’t offered to an Analyst', async () => {
    role.canManage = false;
    getContentDrafts.mockResolvedValue([row({})]);
    readCmsStatuses.mockResolvedValue(live('wordpress'));
    await renderPage();
    expect((await menu()).some((el) => el.textContent === 'Take down')).toBe(false);
  });

  it('shows a page taken down beside its status', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    readCmsStatuses.mockResolvedValue(
      live('wordpress', { status: 'taken_down', at: '2026-11-02T09:30:00Z' }),
    );
    await renderPage();
    expect(
      container.querySelector(
        '[aria-label^="Taken down Nov 2, 2026"][aria-label$=": a draft post in WordPress again"]',
      ),
    ).not.toBeNull();
    expect((await menu()).some((el) => el.textContent === 'Take down')).toBe(false);
  });
});

describe('picking rows to send together (#1331)', () => {
  const box = (label: string) =>
    container.querySelector<HTMLButtonElement>(`[role="checkbox"][aria-label="${label}"]`);
  const barButton = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === name,
    );

  it('sends the rows picked from the bar, then clears them and reads the sends again', async () => {
    getContentDrafts.mockResolvedValue([row({}), row({ id: 'd2', title: 'Churn guide' })]);
    await renderPage();
    expect(barButton('Send to CMS')).toBeUndefined();
    await act(async () => box('Select Churn guide')!.click());
    expect(container.textContent).toContain('1 page selected');
    expect(box('Select all pages listed')!.getAttribute('data-state')).toBe('indeterminate');

    await act(async () => barButton('Send to CMS')!.click());
    await act(async () => {});
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Send 1 page to your CMS');
    expect(getContentDraftPages).toHaveBeenCalledWith('brand-1', ['d2']);

    const close = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Cancel',
    )!;
    await act(async () => close.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).not.toContain('page selected');
    expect(readCmsStatuses).toHaveBeenCalledTimes(2);
  });

  it('takes up to 25 pages a send', async () => {
    getContentDrafts.mockResolvedValue(
      Array.from({ length: 26 }, (_, i) => row({ id: `d${i}`, title: `Draft ${i}` })),
    );
    await renderPage();
    await act(async () => box('Select all pages listed')!.click());
    expect(container.textContent).toContain('26 pages selected');
    expect(container.textContent).toContain('Up to 25 pages a send');
    expect(barButton('Send to CMS')!.disabled).toBe(true);

    await act(async () => box('Select Draft 0')!.click());
    expect(barButton('Send to CMS')!.disabled).toBe(false);
    await act(async () => barButton('Clear')!.click());
    expect(container.textContent).not.toContain('pages selected');
  });

  it('reads the rows’ sends again while a page is on its way', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      getContentDrafts.mockResolvedValue([row({})]);
      const status = (state: string) =>
        new Map([
          [
            'd1',
            {
              status: state,
              at: '2026-10-24T10:00:00Z',
              httpStatus: null,
              error: null,
              publishedUrl: null,
            },
          ],
        ]);
      readCmsStatuses.mockResolvedValueOnce(status('queued')).mockResolvedValue(status('sent'));
      await renderPage();
      expect(readCmsStatuses).toHaveBeenCalledTimes(1);
      await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
      expect(readCmsStatuses).toHaveBeenCalledTimes(2);
      // Sent: no more reads.
      await act(async () => void (await vi.advanceTimersByTimeAsync(20_000)));
      expect(readCmsStatuses).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the rows picked when the tab changes', async () => {
    getContentDrafts.mockResolvedValue([row({}), row({ id: 'd2', title: 'Churn guide' })]);
    await renderPage();
    await act(async () => box('Select Churn guide')!.click());
    expect(container.textContent).toContain('1 page selected');
    await act(async () => tab('In review').click());
    await act(async () => tab('All').click());
    expect(container.textContent).not.toContain('page selected');
    expect(box('Select Churn guide')!.getAttribute('data-state')).toBe('unchecked');
  });

  it('has no boxes for members, nor under Archived', async () => {
    role.canManage = false;
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    expect(container.querySelector('[role="checkbox"]')).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    role.canManage = true;
    window.history.replaceState(null, '', '/dashboard/content/library?tab=archived');
    getContentDrafts.mockResolvedValue([row({ archivedAt: '2026-10-21T08:00:00Z' })]);
    await renderPage();
    expect(container.textContent).toContain('Pipeline forecasting');
    expect(container.querySelector('[role="checkbox"]')).toBeNull();
  });
});

describe('a Library row’s menu (00233)', () => {
  const menuItems = async (title: string) => {
    const trigger = container.querySelector<HTMLElement>(`[aria-label="Actions for ${title}"]`)!;
    await act(async () => trigger.click());
    return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  };
  const pick = async (title: string, item: string) => {
    const found = (await menuItems(title)).find((el) => el.textContent === item)!;
    await act(async () => found.click());
  };

  it('keeps a list filtered by Last send on show when it is read again in another order', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?sent=failed');
    const first = row({});
    const second = row({ id: 'd2', title: 'Churn guide' });
    getContentDrafts.mockResolvedValueOnce([first, second]).mockResolvedValue([second, first]);
    readCmsStatuses.mockResolvedValue(
      new Map([
        ['d1', sendOf('failed')],
        ['d2', sendOf('failed')],
      ]),
    );
    await renderPage();
    // The second read of the sends never answers: the drafts are the same.
    readCmsStatuses.mockReturnValue(new Promise(() => {}));
    await pick('Pipeline forecasting', 'In progress');
    expect(getContentDrafts).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(container.textContent).toContain('Churn guide');
    expect(container.textContent).toContain('Pipeline forecasting');
  });

  it('sets a status, Ready as the editor’s Mark ready, and reads the list again', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    const items = await menuItems('Pipeline forecasting');
    expect(items.map((el) => el.textContent)).toEqual([
      'In progress',
      'In review',
      'Ready',
      'Published',
      'Export Word',
      'Export Excel',
      'Export CSV',
      'Export HTML',
      'Export Markdown',
      'Send to CMS',
      'Send to Archive',
      'Delete',
    ]);
    // Its own status is the one already set.
    expect(items[1].hasAttribute('data-disabled')).toBe(true);

    await act(async () => items[2].click());
    expect(markContentDraftReady).toHaveBeenCalledWith('d1');
    expect(getContentDrafts).toHaveBeenCalledTimes(2);

    // Published asks where the page is live (CE-013), from where it can tell.
    await pick('Pipeline forecasting', 'Published');
    expect(setContentDraftStatus).not.toHaveBeenCalledWith('d1', 'published');
    expect(readPublishAddress).toHaveBeenCalledWith('d1');
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector<HTMLInputElement>('#publish-url')!.value).toBe(
      'https://acme.example/pipeline-forecasting',
    );
    const save = [...dialog.querySelectorAll('button')].find(
      (b) => b.textContent === 'Mark published',
    )!;
    await act(async () => save.click());
    expect(publishPage).toHaveBeenCalledWith('d1', 'https://acme.example/pipeline-forecasting');
    expect(getContentDrafts).toHaveBeenCalledTimes(3);
  });

  it('lets members set a status only', async () => {
    role.canManage = false;
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    expect((await menuItems('Pipeline forecasting')).map((el) => el.textContent)).toEqual([
      'In progress',
      'In review',
      'Ready',
      'Published',
      'Export Word',
      'Export Excel',
      'Export CSV',
      'Export HTML',
      'Export Markdown',
    ]);
  });

  it('archives with an Undo, and keeps archived drafts under Archived, to restore', async () => {
    getContentDrafts.mockResolvedValue([
      row({}),
      row({ id: 'd2', title: 'Old pricing page', archivedAt: '2026-10-21T08:00:00Z' }),
    ]);
    await renderPage();
    expect(tab('All').textContent).toBe('All1');
    expect(tab('Archived').textContent).toBe('Archived1');
    expect(container.textContent).not.toContain('Old pricing page');

    await pick('Pipeline forecasting', 'Send to Archive');
    expect(archiveContentDraft).toHaveBeenCalledWith('d1', true);
    expect(toast).toHaveBeenCalledWith('Archived: Pipeline forecasting', {
      action: { label: 'Undo', onClick: expect.any(Function) },
    });
    await act(async () => toast.mock.calls[0][1].action.onClick());
    expect(archiveContentDraft).toHaveBeenLastCalledWith('d1', false);

    await act(async () => tab('Archived').click());
    expect(container.textContent).toContain('Old pricing page');
    // An archived page is restored before it's marked live (CE-013).
    const published = (await menuItems('Old pricing page')).find(
      (el) => el.textContent === 'Published',
    )!;
    expect(published.hasAttribute('data-disabled')).toBe(true);
    await act(async () =>
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    await pick('Old pricing page', 'Restore');
    expect(archiveContentDraft).toHaveBeenLastCalledWith('d2', false);
  });

  it('deletes only once confirmed', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    await pick('Pipeline forecasting', 'Delete');
    expect(deleteContentDraft).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Delete “Pipeline forecasting”?');

    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Delete',
    )!;
    await act(async () => confirm.click());
    expect(deleteContentDraft).toHaveBeenCalledWith('d1');
    expect(toast.success).toHaveBeenCalledWith('Deleted: Pipeline forecasting');
    expect(getContentDrafts).toHaveBeenCalledTimes(2);
  });

  it('says what to do when a newer draft does the same work as the one restored', async () => {
    archiveContentDraft.mockRejectedValue(new Error('newer_draft'));
    getContentDrafts.mockResolvedValue([row({ archivedAt: '2026-10-21T10:00:00Z' })]);
    window.history.replaceState(null, '', '/dashboard/content/library?tab=archived');
    await renderPage();
    await pick('Pipeline forecasting', 'Restore');
    expect(toast.error).toHaveBeenCalledWith(
      "A newer draft does this task's work. Archive or delete it first, then restore this one.",
    );
  });

  it('exports one draft’s page, as the editor’s Export', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    await pick('Pipeline forecasting', 'Export Markdown');
    await act(async () => {});
    expect(getContentDraftPages).toHaveBeenCalledWith('brand-1', ['d1']);
    const [blob, name] = saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe('getcito_content_pipeline-forecasting.md');
    expect(await readText(blob)).toBe('# Pipeline forecasting\n\nTeams trust it.\n');
  });

  it("gives an optimize draft's CSV the live page's slug, for a CMS import to update it", async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    await pick('Pipeline forecasting', 'Export CSV');
    await act(async () => {});
    const [blob, name] = saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe('getcito_content_pipeline-forecasting.csv');
    const [header, line] = (await readText(blob)).replace(/^\uFEFF/, '').split('\n');
    expect(header.split(',')[3]).toBe('Slug');
    // Title, Meta title, Meta description, then the live page's slug.
    expect(line).toMatch(/^Pipeline forecasting,Pipeline forecasting,Teams trust it\.,pricing,/);
  });

  it('says so when the server refuses the archive', async () => {
    archiveContentDraft.mockRejectedValue(new Error('forbidden'));
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    await pick('Pipeline forecasting', 'Send to Archive');
    expect(toast.error).toHaveBeenCalledWith(
      'Only admins and managers can archive or delete content.',
    );
  });
});

describe('the Library’s Export and Created filter (CE-002)', () => {
  const openExport = async () => {
    const trigger = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Export',
    )!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.click();
    });
    return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  };
  /** CSV: the quickest of the files to write. */
  const csvItem = (items: HTMLElement[]) => items.find((el) => el.textContent === 'Export CSV')!;

  it('reads a long list’s pages fifty at a time, in order', async () => {
    getContentDrafts.mockResolvedValue(
      Array.from({ length: 120 }, (_, i) => row({ id: `d${i}`, title: `Draft ${i}` })),
    );
    await renderPage();
    const items = await openExport();
    await act(async () => csvItem(items).click());
    await act(async () => {});

    const calls = getContentDraftPages.mock.calls as [string, string[]][];
    expect(calls.map(([, ids]) => ids.length)).toEqual([50, 50, 20]);
    expect(calls.flatMap(([, ids]) => ids)).toEqual(Array.from({ length: 120 }, (_, i) => `d${i}`));
    const csv = await readText((saveBlob.mock.calls[0] as [Blob, string])[0]);
    // Every draft once: a row starts with its title (a page's text spans lines).
    expect(csv.match(/^Draft \d+,/gm)).toHaveLength(120);
  });

  it('goes on from the ids a call left for its size, before the next slice', async () => {
    getContentDrafts.mockResolvedValue(
      Array.from({ length: 60 }, (_, i) => row({ id: `d${i}`, title: `Draft ${i}` })),
    );
    const page = (id: string) => ({
      id,
      title: 'Pipeline forecasting',
      bodyHtml: '<p>x</p>',
      sourceUrl: null,
    });
    // The first call reads 30 of its 50 and leaves 20.
    getContentDraftPages.mockImplementationOnce(async (_brand: string, ids: string[]) => ({
      pages: ids.slice(0, 30).map(page),
      rest: ids.slice(30),
    }));
    await renderPage();
    const items = await openExport();
    await act(async () => csvItem(items).click());
    await act(async () => {});

    const calls = getContentDraftPages.mock.calls as [string, string[]][];
    expect(calls.map(([, ids]) => [ids[0], ids.length])).toEqual([
      ['d0', 50],
      ['d30', 30],
    ]);
    const csv = await readText((saveBlob.mock.calls[0] as [Blob, string])[0]);
    expect(csv.match(/^Draft \d+,/gm)).toHaveLength(60);
  });

  it('exports the drafts listed, with their pages, as CSV', async () => {
    getContentDrafts.mockResolvedValue([
      row({}),
      row({ id: 'd2', title: 'Churn guide', author: 'agent', status: 'ready' }),
    ]);
    await renderPage();
    const items = await openExport();
    expect(items.map((el) => el.textContent)).toEqual([
      'Export Word',
      'Export Excel',
      'Export CSV',
    ]);
    await act(async () => csvItem(items).click());
    await act(async () => {});

    expect(getContentDraftPages).toHaveBeenCalledWith('brand-1', ['d1', 'd2']);
    const [blob, name] = saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toMatch(/^getcito_content_library_all_\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readText(blob);
    expect(csv).toContain(
      'Pipeline forecasting,In review,Optimize,Feature page,Ada Lovelace,2026-10-18',
    );
    expect(csv).toContain('Churn guide,Ready,Optimize,Feature page,Content Agent');
    expect(csv).toContain('Teams trust it.');
  });

  it('lists only the drafts created in the range the URL names, and exports those', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?created=7d');
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    getContentDrafts.mockResolvedValue([
      row({ id: 'new', title: 'Fresh page', createdAt: recent }),
      row({ id: 'old', title: 'Old page', createdAt: '2026-01-05T09:00:00Z' }),
    ]);
    await renderPage();
    expect(container.textContent).toContain('Fresh page');
    expect(container.textContent).not.toContain('Old page');

    const items = await openExport();
    await act(async () => csvItem(items).click());
    await act(async () => {});
    expect(getContentDraftPages).toHaveBeenCalledWith('brand-1', ['new']);
  });

  it('lists only the drafts whose last send is as the URL names, and exports those (#1331)', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?sent=failed');
    getContentDrafts.mockResolvedValue([
      row({ id: 'd1', title: 'Failed page' }),
      row({ id: 'd2', title: 'Sent page' }),
      row({ id: 'd3', title: 'Unsent page' }),
    ]);
    readCmsStatuses.mockResolvedValue(
      new Map([
        ['d1', sendOf('failed')],
        ['d2', sendOf('sent')],
      ]),
    );
    await renderPage();
    expect(container.textContent).toContain('Failed page');
    expect(container.textContent).not.toContain('Sent page');
    expect(container.textContent).not.toContain('Unsent page');
    expect(container.querySelector('[aria-label="Last send"]')!.textContent).toContain(
      'Last send: Failed',
    );

    const items = await openExport();
    await act(async () => csvItem(items).click());
    await act(async () => {});
    expect(getContentDraftPages).toHaveBeenCalledWith('brand-1', ['d1']);
  });

  it('lists the drafts never sent', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?sent=never');
    getContentDrafts.mockResolvedValue([
      row({ id: 'd1', title: 'Sent page' }),
      row({ id: 'd2', title: 'Unsent page' }),
    ]);
    readCmsStatuses.mockResolvedValue(new Map([['d1', sendOf('published')]]));
    await renderPage();
    expect(container.textContent).toContain('Unsent page');
    expect(container.textContent).not.toContain('Sent page');
  });

  it('leaves Last send out for a brand that sent no page', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    expect(lastSendBox()).toBeNull();
    expect(container.querySelector('[aria-label="Created"]')).not.toBeNull();
  });

  it('shows Last send once a page was sent', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    readCmsStatuses.mockResolvedValue(new Map([['d1', sendOf('sent')]]));
    await renderPage();
    expect(container.querySelector('[aria-label="Last send"]')!.textContent).toContain(
      'Last send: Any',
    );
  });

  it('waits for the sends before it filters by them, rather than list every draft', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?sent=failed');
    getContentDrafts.mockResolvedValue([
      row({ id: 'd1', title: 'Failed page' }),
      row({ id: 'd2', title: 'Unsent page' }),
    ]);
    let answer: (sends: Map<string, unknown>) => void = () => {};
    readCmsStatuses.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await renderPage();
    expect(container.textContent).not.toContain('Unsent page');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    await act(async () => answer(new Map([['d1', sendOf('failed')]])));
    expect(container.textContent).toContain('Failed page');
    expect(container.textContent).not.toContain('Unsent page');
  });

  it('lists nothing to export while the sends it filters by are read', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?sent=never');
    getContentDrafts.mockResolvedValue([row({})]);
    readCmsStatuses.mockReturnValue(new Promise(() => {}));
    await renderPage();
    const exportButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Export',
    )!;
    expect(exportButton.disabled).toBe(true);
  });

  it('leaves Last send out on a brand that sent none, after one that did', async () => {
    getContentDrafts.mockImplementation(async (brandId: string) =>
      brandId === 'brand-1' ? [row({})] : [],
    );
    readCmsStatuses.mockResolvedValue(new Map([['d1', sendOf('sent')]]));
    await renderPage();
    expect(lastSendBox()).not.toBeNull();
    brandState.activeBrandId = 'brand-2';
    await renderPage();
    expect(lastSendBox()).toBeNull();
  });

  it('blames the Created filter when it is the one that leaves nothing', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?created=7d&sent=failed');
    getContentDrafts.mockResolvedValue([row({ createdAt: '2026-01-05T09:00:00Z' })]);
    readCmsStatuses.mockResolvedValue(new Map([['d1', sendOf('failed')]]));
    await renderPage();
    expect(container.textContent).toContain('Nothing in this tab was created in this period.');
  });

  it('says nothing of the cap while Last send narrows the list', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?sent=failed');
    getContentDrafts.mockResolvedValue([row({}), row({ id: 'd2', title: 'Churn guide' })]);
    readCmsStatuses.mockResolvedValue(new Map([['d1', sendOf('failed')]]));
    await renderPage();
    expect(container.textContent).not.toContain('Churn guide');
    expect(container.textContent).not.toContain('changed most recently');
  });

  it('says when nothing in the tab matches the Last send filter', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?sent=queued');
    getContentDrafts.mockResolvedValue([row({})]);
    readCmsStatuses.mockResolvedValue(new Map([['d1', sendOf('sent')]]));
    await renderPage();
    expect(container.textContent).toContain('No page in this tab matches the Last send filter.');
  });

  it('says when nothing in the tab was created in the range', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?created=30d');
    getContentDrafts.mockResolvedValue([row({ createdAt: '2026-01-05T09:00:00Z' })]);
    await renderPage();
    expect(container.textContent).toContain('Nothing in this tab was created in this period.');
    const exportButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Export',
    )!;
    expect(exportButton.disabled).toBe(true);
  });
});

describe('the Library on a read-only workspace (plan not active)', () => {
  const pick = async (title: string, item: string) => {
    const trigger = container.querySelector<HTMLElement>(`[aria-label="Actions for ${title}"]`)!;
    await act(async () => trigger.click());
    const found = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent === item,
    )!;
    await act(async () => found.click());
  };
  const buttonNamed = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === name,
    )!;

  beforeEach(() => {
    gate.isLocked = true;
  });

  it('opens the upgrade dialog from New content, Send and the row menu, and changes nothing', async () => {
    getContentDrafts.mockResolvedValue([row({}), row({ id: 'd2', title: 'Churn guide' })]);
    await renderPage();

    await act(async () => buttonNamed('New content').click());
    expect(gate.openUpgrade).toHaveBeenLastCalledWith('Creating content needs a plan');
    expect(getContentStartOptions).not.toHaveBeenCalled();

    await pick('Pipeline forecasting', 'Ready');
    expect(gate.openUpgrade).toHaveBeenLastCalledWith('Marking a page ready needs a plan');
    await pick('Pipeline forecasting', 'Published');
    expect(gate.openUpgrade).toHaveBeenLastCalledWith('Marking a page published needs a plan');
    await pick('Pipeline forecasting', 'In progress');
    expect(gate.openUpgrade).toHaveBeenLastCalledWith("Changing a page's status needs a plan");
    await pick('Pipeline forecasting', 'Send to CMS');
    expect(gate.openUpgrade).toHaveBeenLastCalledWith('Sending to your CMS needs a plan');
    await pick('Pipeline forecasting', 'Send to Archive');
    expect(gate.openUpgrade).toHaveBeenLastCalledWith('Archiving content needs a plan');
    await pick('Pipeline forecasting', 'Delete');
    expect(gate.openUpgrade).toHaveBeenLastCalledWith('Deleting content needs a plan');

    // Picking rows is no action; sending them is.
    const box = container.querySelector<HTMLButtonElement>(
      '[role="checkbox"][aria-label="Select Churn guide"]',
    )!;
    await act(async () => box.click());
    await act(async () => buttonNamed('Send to CMS').click());
    expect(gate.openUpgrade).toHaveBeenLastCalledWith('Sending to your CMS needs a plan');

    expect(gate.openUpgrade).toHaveBeenCalledTimes(8);
    expect(markContentDraftReady).not.toHaveBeenCalled();
    expect(setContentDraftStatus).not.toHaveBeenCalled();
    expect(readPublishAddress).not.toHaveBeenCalled();
    expect(archiveContentDraft).not.toHaveBeenCalled();
    expect(getContentDraftPages).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('still exports a page', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    await pick('Pipeline forecasting', 'Export Markdown');
    await act(async () => {});
    expect(saveBlob).toHaveBeenCalledTimes(1);
    expect(gate.openUpgrade).not.toHaveBeenCalled();
  });

  it('doesn’t open New content by itself when the URL asks', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?new=1');
    getContentDrafts.mockResolvedValue([]);
    await renderPage();
    expect(document.body.textContent).not.toContain('Pick how you want to start.');
    expect(window.location.search).toBe('');
    expect(gate.openUpgrade).not.toHaveBeenCalled();
  });
});

describe('the Library’s Shopping path column (00352)', () => {
  const checked = (bad: { id: string; title: string; state: 'sold_out' | 'refused' | 'gone' }[]) =>
    ({
      state: bad.length ? 'attention' : 'ok',
      readFrom: 'page',
      checkedAt: '2026-10-27T03:00:00Z',
      categories: 1,
      categoriesLinked: 1,
      products: 4,
      productsLinked: 4,
      bad,
    }) as const;
  const drafts = [
    row({
      id: 'a',
      title: 'Best rain jackets',
      shopping: checked([
        { id: 'p1', title: 'Storm Shell 2', state: 'sold_out' },
        { id: 'p2', title: 'Pack-Lite Jacket', state: 'sold_out' },
      ]),
    }),
    row({ id: 'b', title: 'How to choose boots', shopping: checked([]) }),
    row({ id: 'c', title: 'How we test', shopping: { state: 'none' } }),
    row({ id: 'd', title: 'Trail shoes', shopping: { state: 'unchecked' } }),
  ];
  const shop = () => {
    brandState.brands = [{ id: 'brand-1', industry: 'Retail', shoppingModeEnabled: true }];
  };
  afterEach(() => {
    brandState.brands = [
      { id: 'brand-1', industry: 'Travel & Hospitality', shoppingModeEnabled: false },
    ];
  });

  it('shows on an online shop what each page’s links do with its shopping path', async () => {
    shop();
    getContentDrafts.mockResolvedValue(drafts);
    await renderPage();
    const headers = [...container.querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toContain('Shopping path');
    const cells = [...container.querySelectorAll('tbody tr')].map(
      (tr) => tr.querySelectorAll('td')[7]?.textContent,
    );
    expect(cells).toEqual(['2 sold out', 'OK', 'None', 'Not checked yet']);
  });

  it('lists the pages that need attention when the URL asks, and says so when there are none', async () => {
    shop();
    window.history.replaceState(null, '', '/dashboard/content/library?shopping=attention');
    getContentDrafts.mockResolvedValue(drafts);
    await renderPage();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.textContent).toContain('Best rain jackets');

    getContentDrafts.mockResolvedValue(drafts.slice(1));
    root.unmount();
    root = createRoot(container);
    await renderPage();
    expect(container.textContent).toContain('No page listed here has a shopping path like this.');
  });

  it('isn’t there for a brand that doesn’t sell online', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?shopping=attention');
    getContentDrafts.mockResolvedValue(drafts);
    await renderPage();
    expect([...container.querySelectorAll('th')].map((th) => th.textContent)).not.toContain(
      'Shopping path',
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4);
  });
});

describe('the Library’s Made in column and filter (00463, W4-10)', () => {
  const CHAT = 'cccccccc-0000-4000-8000-000000000001';
  const madeIn = () =>
    [...container.querySelectorAll<HTMLElement>('[data-slot="made-in"]')].map(
      (el) => el.textContent,
    );
  afterEach(() => {
    chat.on = false;
    window.history.replaceState(null, '', '/dashboard/content/library');
  });

  it('says where each draft was made, with Open chat to a chat the member may open', async () => {
    chat.on = true;
    getContentDrafts.mockResolvedValue([
      row({
        id: 'd1',
        title: 'From chat',
        origin: 'chat',
        conversation: { id: CHAT, title: 'Pricing FAQ' },
      }),
      row({ id: 'd2', title: 'From a task', origin: 'action_center' }),
      // Another's chat: its title isn't readable, so no link.
      row({ id: 'd3', title: 'From a teammate’s chat', origin: 'chat', conversation: null }),
    ]);
    await renderPage();
    expect(madeIn()).toEqual(['Chat', 'Action Center', 'Chat']);
    // Below xl, the same on a line under By: only for a draft made outside the editor.
    expect(
      [...container.querySelectorAll('[data-slot="made-in-short"]')].map((el) => el.textContent),
    ).toEqual(['in Chat', 'in Action Center', 'in Chat']);
    // In its column, and on that line: the one chat the member may open.
    const links = [...container.querySelectorAll('[data-action="library.openChat"]')];
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe(`/dashboard/chat/${CHAT}`);
      expect(link.textContent).toBe('Open chat');
    }
    expect(container.querySelector('[aria-label="Made in"]')!.textContent).toContain(
      'Made in: All',
    );
  });

  it('has no Open chat with the new Chat off', async () => {
    getContentDrafts.mockResolvedValue([
      row({ origin: 'chat', conversation: { id: CHAT, title: 'Pricing FAQ' } }),
    ]);
    await renderPage();
    expect(madeIn()).toEqual(['Chat']);
    expect(container.querySelector('[data-action="library.openChat"]')).toBeNull();
  });

  it('leaves the filter out while every draft was made in the editor', async () => {
    getContentDrafts.mockResolvedValue([row({})]);
    await renderPage();
    expect(madeIn()).toEqual(['Content Editor']);
    expect(container.querySelector('[data-slot="made-in-short"]')).toBeNull();
    expect(container.querySelector('[aria-label="Made in"]')).toBeNull();
  });

  it('lists only the drafts made where the URL’s filter says', async () => {
    window.history.replaceState(null, '', '/dashboard/content/library?madeIn=chat');
    getContentDrafts.mockResolvedValue([
      row({ id: 'd1', title: 'Chat page', origin: 'chat' }),
      row({ id: 'd2', title: 'Editor page' }),
    ]);
    await renderPage();
    expect(container.textContent).toContain('Chat page');
    expect(container.textContent).not.toContain('Editor page');
    expect(container.querySelector('[aria-label="Made in"]')!.textContent).toContain(
      'Made in: Chat',
    );
  });
});
