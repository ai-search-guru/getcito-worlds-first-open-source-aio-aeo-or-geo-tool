import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { Editor } from '@tiptap/core';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';
import { PlanProvider } from '@/components/context/PlanProvider';
import { UpgradeDialogProvider } from '@/components/context/UpgradeDialogProvider';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import { ChatAgenticProvider } from '@/components/context/ChatAgenticProvider';
import type { ContentAuthor } from '@/lib/content/authors';
import type { ContentDraft } from '@/lib/content/drafts';
import type { DraftSuggestion } from '@/lib/content/suggestions';
import { passageKey, type CitedPassage } from '@/lib/content/citedPassages';
import { encodeHtmlBlock } from '@/lib/content/htmlAllowlist';
import { activeRules, ruleSet } from '@/lib/content/rules';
import { CLAIMS_EVERY_MS } from './_useClaims';
import { PROOF_READ_EVERY_MS, PROOF_READ_SLACK_MS } from './_usePageRead';
import ContentEditorPage from './page';

const getContentDraft = vi.fn();
const markContentDraftReady = vi.fn();
const unmarkContentDraftReady = vi.fn();
const saveContentDraft = vi.fn();
const setContentDraftPageType = vi.fn();
const setContentDraftAuthor = vi.fn();
const setContentDraftReviewer = vi.fn();
const keepDraftSource = vi.fn();
const confirmDraftAuthor = vi.fn();
const checkDraftClaims = vi.fn();
const readDraftPage = vi.fn();
const getOwnImages = vi.fn();
const getDraftConfirmations = vi.fn();
const getCatalogMatch = vi.fn();
const confirmDraftItem = vi.fn();
const confirmOwnImage = vi.fn();
const getBrandFacts = vi.fn();
const checkDraftLinks = vi.fn();
const getSiteTrust = vi.fn();
// No white label kit: downloads keep GetCito's names (exportName.test.ts has a kit's).
vi.mock('@/lib/actions/whiteLabel', () => ({
  getExportBranding: async () => ({ ok: true, branding: null }),
}));
vi.mock('@/lib/actions/audits', () => ({
  getSiteTrust: (...args: unknown[]) => getSiteTrust(...args),
}));
const getContentAuthors = vi.fn();
vi.mock('@/lib/actions/contentAuthors', () => ({
  getContentAuthors: (...args: unknown[]) => getContentAuthors(...args),
}));
const getDraftInputs = vi.fn();
const saveDraftInputs = vi.fn();
vi.mock('@/lib/actions/contentDraftInputs', () => ({
  getDraftInputs: (...args: unknown[]) => getDraftInputs(...args),
  saveDraftInputs: (...args: unknown[]) => saveDraftInputs(...args),
}));
const getContentImpact = vi.fn();
// Mark published (CE-013).
const publishPage = vi.hoisted(() => vi.fn());
const readPublishAddress = vi.hoisted(() => vi.fn(async () => 'https://acme.example.com/pipeline'));
const readLiveUrl = vi.hoisted(() => vi.fn(async () => 'https://acme.example.com/pipeline'));
vi.mock('@/lib/content/publishClient', () => ({ publishPage, readPublishAddress, readLiveUrl }));
const getContentResults = vi.fn();
const getContentConversions = vi.fn();
const getDraftSources = vi.fn();
const setDraftSourceIncluded = vi.fn();
const readAgentRun = vi.fn();
const stopAgentRun = vi.fn();
const readAutoHandOff = vi.fn();
vi.mock('@/lib/content/agentRunsClient', () => ({
  readAgentRun: (...args: unknown[]) => readAgentRun(...args),
  stopAgentRun: (...args: unknown[]) => stopAgentRun(...args),
  readAutoHandOff: (...args: unknown[]) => readAutoHandOff(...args),
}));
// Site Audit's estimate (customer priorities item 9): none read, unless a test says.
const readAuditEstimate = vi.fn();
vi.mock('@/lib/content/auditEstimate', async (importOriginal) => ({
  ...(await importOriginal()),
  readAuditEstimate: (...args: unknown[]) => readAuditEstimate(...args),
}));
const getDraftBrief = vi.fn();
const rebuildDraftBrief = vi.fn();
const saveDraftRules = vi.fn();
const getMyRuleSets = vi.fn();
const saveMyRuleSet = vi.fn();
const getDraftVersions = vi.fn();
const getDraftHandoffs = vi.fn();
const restoreDraftVersion = vi.fn();
const getCitedPassages = vi.fn();
const getDraftSuggestions = vi.fn();
const getLastRestoreAt = vi.fn();
// What the page's last rewrite came to (Length's reach): none unless a test gives one.
const getLastPageRewrite = vi.fn();
const decideDraftSuggestions = vi.fn();
const keepAgentBeforeVersion = vi.fn();
const fixDraftRules = vi.fn();
const handOffDraft = vi.fn();
const startAgentWriting = vi.fn();
const startPageRewrite = vi.fn();
vi.mock('@/lib/actions/brandFacts', () => ({
  getBrandFacts: (...args: unknown[]) => getBrandFacts(...args),
}));
vi.mock('@/lib/actions/contentDrafts', () => ({
  fixDraftRules: (...args: unknown[]) => fixDraftRules(...args),
  handOffDraft: (...args: unknown[]) => handOffDraft(...args),
  startAgentWriting: (...args: unknown[]) => startAgentWriting(...args),
  startPageRewrite: (...args: unknown[]) => startPageRewrite(...args),
  getDraftSuggestions: (...args: unknown[]) => getDraftSuggestions(...args),
  getLastRestoreAt: (...args: unknown[]) => getLastRestoreAt(...args),
  getLastPageRewrite: (...args: unknown[]) => getLastPageRewrite(...args),
  decideDraftSuggestions: (...args: unknown[]) => decideDraftSuggestions(...args),
  keepAgentBeforeVersion: (...args: unknown[]) => keepAgentBeforeVersion(...args),
  getCitedPassages: (...args: unknown[]) => getCitedPassages(...args),
  getDraftVersions: (...args: unknown[]) => getDraftVersions(...args),
  getDraftHandoffs: (...args: unknown[]) => getDraftHandoffs(...args),
  restoreDraftVersion: (...args: unknown[]) => restoreDraftVersion(...args),
  getMyRuleSets: (...args: unknown[]) => getMyRuleSets(...args),
  saveMyRuleSet: (...args: unknown[]) => saveMyRuleSet(...args),
  saveDraftRules: (...args: unknown[]) => saveDraftRules(...args),
  getDraftSources: (...args: unknown[]) => getDraftSources(...args),
  setDraftSourceIncluded: (...args: unknown[]) => setDraftSourceIncluded(...args),
  getDraftBrief: (...args: unknown[]) => getDraftBrief(...args),
  rebuildDraftBrief: (...args: unknown[]) => rebuildDraftBrief(...args),
  getContentImpact: (...args: unknown[]) => getContentImpact(...args),
  getContentResults: (...args: unknown[]) => getContentResults(...args),
  getContentConversions: (...args: unknown[]) => getContentConversions(...args),
  getContentDraft: (...args: unknown[]) => getContentDraft(...args),
  markContentDraftReady: (...args: unknown[]) => markContentDraftReady(...args),
  unmarkContentDraftReady: (...args: unknown[]) => unmarkContentDraftReady(...args),
  saveContentDraft: (...args: unknown[]) => saveContentDraft(...args),
  setContentDraftPageType: (...args: unknown[]) => setContentDraftPageType(...args),
  setContentDraftAuthor: (...args: unknown[]) => setContentDraftAuthor(...args),
  setContentDraftReviewer: (...args: unknown[]) => setContentDraftReviewer(...args),
  keepDraftSource: (...args: unknown[]) => keepDraftSource(...args),
  confirmDraftAuthor: (...args: unknown[]) => confirmDraftAuthor(...args),
  checkDraftClaims: (...args: unknown[]) => checkDraftClaims(...args),
  readDraftPage: (...args: unknown[]) => readDraftPage(...args),
  getOwnImages: (...args: unknown[]) => getOwnImages(...args),
  getDraftConfirmations: (...args: unknown[]) => getDraftConfirmations(...args),
  getCatalogMatch: (...args: unknown[]) => getCatalogMatch(...args),
  confirmDraftItem: (...args: unknown[]) => confirmDraftItem(...args),
  confirmOwnImage: (...args: unknown[]) => confirmOwnImage(...args),
  checkDraftLinks: (...args: unknown[]) => checkDraftLinks(...args),
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ draftId: 'd1' }) }));
// The month's AI usage (AI usage spec): none to meter unless a test sets it.
const aiUsage = vi.hoisted(() => ({
  usage: null as import('@/lib/billing/aiUsage').AiUsage | null,
  refresh: vi.fn(),
}));
vi.mock('@/components/context/AiUsageProvider', () => ({ useAiUsage: () => aiUsage }));
const readDraftAiUsage = vi.hoisted(() => vi.fn());
vi.mock('@/lib/billing/aiUsageClient', () => ({
  readDraftAiUsage: (...args: unknown[]) => readDraftAiUsage(...args),
  readUsageLimits: async () => ({ auditPages: null, promptLocations: null }),
}));
const usageAt = (percentUsed: number): import('@/lib/billing/aiUsage').AiUsage => ({
  plan: 'growth',
  planName: 'Growth',
  periodStart: '2026-10-20T09:00:00.000Z',
  periodEnd: '2026-11-20T09:00:00.000Z',
  unlimited: false,
  percentUsed,
  features: [],
});
const routerPush = vi.hoisted(() => vi.fn());
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: routerPush }),
}));
const brandState = vi.hoisted(() => ({
  activeBrandId: 'b1' as string | null,
  brands: [{ id: 'b1' }, { id: 'b2' }],
  setActiveBrand: vi.fn(),
  updateBrand: vi.fn(),
}));
const updateBrand = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/brand', () => ({ updateBrand }));
// Brief › Shopping path (shopping path, part 3) reads its own path: none here.
const getShoppingCheck = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null));
vi.mock('@/lib/actions/shoppingPath', () => ({
  getDraftShoppingPath: vi.fn(async () => ({ path: null })),
  buildDraftShoppingPath: vi.fn(),
  saveDraftShoppingPath: vi.fn(),
  searchCatalogProducts: vi.fn(async () => []),
  getProductsForBlock: vi.fn(async () => []),
  getShoppingCheck,
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (selector: (state: typeof brandState) => unknown) => selector(brandState),
}));
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
);
vi.mock('mammoth', () => ({
  default: {
    convertToHtml: async () => ({
      value:
        '<h2>From Word</h2><p>Body <strong>bold</strong> <img src="data:image/png;base64,AA"></p>',
    }),
  },
}));
vi.mock('sonner', () => ({ toast }));
const saveBlob = vi.hoisted(() => vi.fn());
vi.mock('@/lib/download', () => ({ saveBlob }));
// The header reads the page's last send as it opens: none, unless a test says.
const readDraftCms = vi.hoisted(() => vi.fn(async () => null as unknown));
const sendPagesToCms = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/cmsSendClient', () => ({ readDraftCms, sendPagesToCms }));
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

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, and its ranges can't be measured. ProseMirror measures
// one when it scrolls the cursor into view (after inserting a block), which
// otherwise throws after the test, on a timer.
// Nor can jsdom's files be read as text or bytes, as browsers' can.
function readBlob<T>(blob: Blob, read: (reader: FileReader) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as T);
    reader.onerror = () => reject(reader.error);
    read(reader);
  });
}
if (!('text' in Blob.prototype)) {
  Object.assign(Blob.prototype, {
    text(this: Blob) {
      return readBlob<string>(this, (r) => r.readAsText(this));
    },
    arrayBuffer(this: Blob) {
      return readBlob<ArrayBuffer>(this, (r) => r.readAsArrayBuffer(this));
    },
  });
}
if (!('getClientRects' in Range.prototype)) {
  Object.assign(Range.prototype, {
    getClientRects: () => [] as unknown as DOMRectList,
    getBoundingClientRect: () => new DOMRect(),
  });
}

// An in-memory localStorage: the test environment has none.
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
});

const draft = (over: Partial<ContentDraft> = {}): ContentDraft => ({
  id: 'd1',
  brandId: 'b1',
  title: 'Pipeline forecasting',
  pageType: 'feature_page',
  pageTypeSource: 'user',
  siteType: 'b2b',
  sourceUrl: null,
  publishedUrl: null,
  method: 'optimize',
  status: 'in_review',
  bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams trust it.</p>',
  author: 'agent',
  authorId: null,
  reviewerId: null,
  rules: { set: null, source: null, overrides: {}, textRules: [] },
  keptSources: [],
  authorConfirmed: { real: false, profile: false },
  action: null,
  conversation: null,
  agentState: null,
  agentSince: null,
  agentRun: null,
  updatedAt: '2026-10-20T10:00:00Z',
  archivedAt: null,
  qualityHandoff: false,
  schemaLeftOut: false,
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function renderPage(role: TeamRole = 'admin', { chatOn = false } = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChatAgenticProvider enabled={chatOn}>
          <RoleProvider role={role}>
            <ContentEditorPage />
          </RoleProvider>
        </ChatAgenticProvider>
      </NextIntlClientProvider>,
    );
  });
  // The editor mounts on the client after the first render.
  await act(async () => {});
}

const button = (name: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === name || b.textContent === name,
  );

/** A panel tab's name, without the open-rules count Instructions carries. */
const tabName = (el: Element | null | undefined) => el?.firstChild?.textContent;
/** The panel's tab picked now, and Instructions' segment. */
const selectedTab = () =>
  tabName(container.querySelector('aside [role="tab"][aria-selected="true"]'));
const selectedSegment = () =>
  container
    .querySelector('aside [role="radio"][aria-checked="true"]')
    ?.textContent?.replace(/\d+ open$/, '');

/** Picks one of the side panel's tabs, or one of Instructions' segments. */
async function pickTab(name: string) {
  // Brief and Rules are Instructions' two segments (Content Editor v1.1, CE-028).
  if (name === 'Brief' || name === 'Rules') {
    if (selectedTab() !== 'Instructions') await pickTab('Instructions');
    const segment = [...container.querySelectorAll<HTMLElement>('aside [role="radio"]')].find(
      (el) => el.textContent?.startsWith(name),
    )!;
    await act(async () => segment.click());
    return;
  }
  const tab = [...container.querySelectorAll<HTMLElement>('aside [role="tab"]')].find(
    (el) => tabName(el) === name,
  )!;
  await act(async () => {
    tab.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    tab.click();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  aiUsage.usage = null;
  aiUsage.refresh.mockReset();
  readDraftAiUsage.mockReset().mockResolvedValue(3.7);
  getContentDraft.mockReset();
  markContentDraftReady.mockReset();
  unmarkContentDraftReady.mockReset().mockResolvedValue({ status: 'in_review', tasksReopened: 0 });
  saveBlob.mockReset();
  setContentDraftPageType.mockReset().mockResolvedValue(undefined);
  setContentDraftAuthor.mockReset().mockResolvedValue(undefined);
  setContentDraftReviewer.mockReset().mockResolvedValue(undefined);
  keepDraftSource.mockReset();
  confirmDraftAuthor.mockReset().mockResolvedValue(undefined);
  checkDraftClaims.mockReset().mockResolvedValue({ blocks: [], pending: 0, limited: false });
  readDraftPage.mockReset().mockResolvedValue({ error: 'off' });
  getOwnImages.mockReset().mockResolvedValue([]);
  getDraftConfirmations.mockReset().mockResolvedValue([]);
  getCatalogMatch.mockReset().mockResolvedValue({ connected: false, product: null });
  confirmDraftItem.mockReset().mockResolvedValue('ok');
  confirmOwnImage.mockReset().mockResolvedValue('ok');
  getBrandFacts.mockReset().mockResolvedValue({
    facts: [],
    pages: [],
    checkedAt: null,
    recheckAt: null,
    paused: false,
    noDomain: false,
  });
  checkDraftLinks.mockReset().mockResolvedValue({ links: [], skipped: [] });
  getSiteTrust.mockReset().mockRejectedValue(new Error('not in this test'));
  getContentAuthors.mockReset().mockResolvedValue(null);
  getDraftInputs
    .mockReset()
    .mockResolvedValue({ experience: '', data: [], getcitoData: [], quotes: [] });
  saveDraftInputs.mockReset().mockImplementation(async (_id, inputs) => inputs);
  saveContentDraft
    .mockReset()
    .mockResolvedValue({ ok: true, updatedAt: '2026-10-20T10:00:00Z', bodyHash: 'h0' });
  getContentImpact.mockReset().mockResolvedValue(null);
  getContentConversions.mockReset().mockResolvedValue(null);
  publishPage.mockReset();
  readPublishAddress.mockReset().mockResolvedValue('https://acme.example.com/pipeline');
  getContentResults.mockReset().mockResolvedValue(null);
  getDraftSources.mockReset().mockResolvedValue(null);
  readAgentRun.mockReset().mockResolvedValue(null);
  readAuditEstimate.mockReset().mockResolvedValue({ error: 'failed' });
  stopAgentRun.mockReset().mockResolvedValue({ stopped: true });
  getDraftBrief.mockReset().mockResolvedValue({ brief: null });
  rebuildDraftBrief.mockReset();
  saveDraftRules.mockReset().mockResolvedValue(undefined);
  getMyRuleSets.mockReset().mockResolvedValue({});
  saveMyRuleSet.mockReset().mockResolvedValue(undefined);
  getDraftVersions.mockReset().mockResolvedValue([]);
  getDraftHandoffs.mockReset().mockResolvedValue([]);
  readAutoHandOff.mockReset().mockResolvedValue(false);
  restoreDraftVersion.mockReset();
  getCitedPassages.mockReset().mockResolvedValue([]);
  getDraftSuggestions.mockReset().mockResolvedValue([]);
  getLastRestoreAt.mockReset().mockResolvedValue(null);
  getLastPageRewrite.mockReset().mockResolvedValue(null);
  decideDraftSuggestions.mockReset().mockResolvedValue(1);
  keepAgentBeforeVersion.mockReset().mockResolvedValue(undefined);
  fixDraftRules.mockReset().mockResolvedValue({ count: 0 });
  handOffDraft.mockReset().mockResolvedValue({ count: 0 });
  startAgentWriting.mockReset().mockResolvedValue({ started: true });
  startPageRewrite.mockReset().mockResolvedValue({ started: true });
  localStorage.clear();
  brandState.activeBrandId = 'b1';
  brandState.setActiveBrand.mockReset();
  brandState.updateBrand.mockReset();
  updateBrand.mockReset();
  toast.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  toast.info.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the content editor', () => {
  it('shows the month’s AI usage before History, with this page’s share, and its banner from 80%', async () => {
    aiUsage.usage = usageAt(84);
    getContentDraft.mockResolvedValue(draft());
    await renderPage();
    const meter = button('AI 84% used this month, close to the limit')!;
    expect(meter.closest('header')).not.toBeNull();
    expect(
      meter.compareDocumentPosition(button('History')!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Narrower than 1280px, the percent alone, as Next's label goes (Next step spec §3b).
    expect(meter.querySelector('span')!.className).toContain('hidden xl:inline');
    expect(container.textContent).toContain("You've used 84% of this month's AI limit.");

    await act(async () => meter.click());
    await act(async () => {});
    expect(readDraftAiUsage).toHaveBeenCalledWith('d1');
    expect(document.querySelector('[data-slot="popover-content"]')!.textContent).toContain(
      'This page this month3.7%',
    );
  });

  it('opens the draft with its title, type, method, status and length', async () => {
    getContentDraft.mockResolvedValue(draft());
    await renderPage();

    expect(getContentDraft).toHaveBeenCalledWith('d1');
    const header = container.querySelector('header')!;
    expect(header.querySelector('h1')!.textContent).toBe('Pipeline forecasting');
    expect(header.textContent).toContain('Saved');
    // The page's tags on a line of their own, under the title.
    const [top, tags] = header.children;
    expect(top.textContent).not.toContain('In review');
    expect(tags.textContent).toContain('Feature page');
    expect(tags.textContent).toContain('Optimize');
    expect(tags.textContent).toContain('In review');
    expect(tags.textContent).toMatch(/\d+\/\d+ rules/);
    expect(container.querySelector('a[href="/dashboard/content/library"]')).not.toBeNull();

    // The page's text, against a feature page's 3,000-character target.
    expect(container.querySelector('[role="toolbar"]')!.textContent).toContain(
      '35 / 3,000 characters · 5 words',
    );
    for (const name of ['Heading 1', 'Bold', 'Link', 'Numbered list', 'Insert a table']) {
      expect(button(name)).toBeDefined();
    }
    // The HTML block is named, not only an icon.
    expect(button('Add an HTML block')!.textContent).toBe('Add HTML');
    expect(container.querySelector('.ProseMirror h1')!.textContent).toBe('Pipeline forecasting');
  });

  it('shows Site Audit’s estimate in the header, read from the page as it goes out (customer priorities item 9)', async () => {
    readAuditEstimate.mockResolvedValue({
      estimate: {
        score: 62,
        categories: { structure: 78, content: 55, authority: 40, trust: 72, eeat: 48 },
        checks: { page: 18, site: 13, ai: 0 },
      },
    });
    getContentDraft.mockResolvedValue(draft());
    await renderPage();
    await act(() => new Promise((resolve) => setTimeout(resolve, 1_100)));

    // In Quality, not the header: it keeps one score (editor UX review 2026-11-03, decision c).
    const [, tags] = container.querySelector('header')!.children;
    expect(tags.textContent).not.toContain('Audit ≈');
    expect(
      container.querySelector('[data-slot="audit-estimate"]')?.textContent ?? '',
    ).not.toContain('Audit ≈');
    const [draftId, brandId, doc] = readAuditEstimate.mock.calls.at(-1)!;
    expect([draftId, brandId]).toEqual(['d1', 'b1']);
    // The whole page, its head too, as Export's HTML file has it.
    expect(doc).toMatch(/^<!doctype html>/);
    expect(doc).toContain('<title>Pipeline forecasting</title>');
    expect(doc).toContain('<h1>Pipeline forecasting</h1>');
  });

  it('remembers the draft for Content › Editor, per brand', async () => {
    getContentDraft.mockResolvedValue(draft());
    await renderPage();
    expect(localStorage.getItem('aeo:content-last-draft:b1')).toBe('d1');
  });

  it('remembers nothing for a draft that isn’t there', async () => {
    getContentDraft.mockResolvedValue(null);
    await renderPage();
    expect(localStorage.getItem('aeo:content-last-draft:b1')).toBeNull();
  });

  it('keeps one H1: Heading 1 is off outside the title', async () => {
    getContentDraft.mockResolvedValue(draft());
    await renderPage();
    const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
      .editor;

    await act(async () => void editor.commands.setTextSelection(editor.state.doc.content.size - 2));
    // Off, yet still says why on hover.
    const off = button('A page has one H1, its title: use Heading 2 here')!;
    expect(off.getAttribute('aria-disabled')).toBe('true');
    expect(off.title).toBe('A page has one H1, its title: use Heading 2 here');
    await act(async () => off.click());
    expect(editor.getHTML()).not.toContain('<h1>Teams trust it.</h1>');
    await act(async () => void editor.commands.setTextSelection(2));
    expect(button('Heading 1')!.getAttribute('aria-disabled')).toBeNull();
  });

  it('tags a new page as one', async () => {
    getContentDraft.mockResolvedValue(
      draft({
        method: 'create',
        pageType: 'product_page',
        status: 'draft',
        title: '',
        bodyHtml: '',
      }),
    );
    await renderPage();
    const header = container.querySelector('header')!;
    expect(header.textContent).toContain('Product page · New page');
    expect(header.querySelector('h1')!.textContent).toBe('Untitled');
    expect(container.querySelector('[role="toolbar"]')!.textContent).toContain(
      '0 / 1,200 characters · 0 words',
    );
  });

  describe('the page type', () => {
    const typeMenu = () =>
      container.querySelector<HTMLButtonElement>('header button[aria-label^="Page type:"]')!;
    /** Opens the page type menu and returns its types. */
    async function openTypes() {
      const trigger = typeMenu();
      await act(async () => {
        trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        trigger.click();
      });
      return [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    }
    /** Replaces the page through the HTML view. */
    async function rewrite(html: string) {
      await act(async () => button('Edit as HTML')!.click());
      const source = container.querySelector('textarea')!;
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!;
      await act(async () => {
        setValue.call(source, html);
        source.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => button('Back to visual')!.click());
    }

    it('follows the page while it is detected, and keeps the type the person picks', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          title: 'Northwind vs HubSpot',
          bodyHtml: '<h1>Northwind vs HubSpot</h1>',
          pageType: 'comparison',
          pageTypeSource: 'detected',
        }),
      );
      await renderPage();
      expect(typeMenu().textContent).toBe('Comparison');
      expect(typeMenu().title).toBe('Detected from the page as you write. Pick a type to keep it.');

      await rewrite('<h1>How to clean CRM data</h1>');
      // It reads the page once typing pauses.
      await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
      expect(typeMenu().textContent).toBe('How-to guide');

      const types = await openTypes();
      expect(types.map((item) => item.textContent)).toEqual([
        'Feature page',
        'Use case page',
        'Comparison',
        'Alternatives page',
        'Best-of list',
        'How-to guide',
        'Definition page',
        'Integration',
        'Pricing',
        'Docs / FAQ',
        'Blog post',
      ]);
      expect(document.body.textContent).toContain('B2B SaaS page types');
      await act(async () => types.find((item) => item.textContent === 'Pricing')!.click());
      expect(setContentDraftPageType).toHaveBeenCalledWith('d1', 'pricing');
      expect(typeMenu().textContent).toBe('Pricing');
      expect(typeMenu().title).toBe('');

      // Picked: the page no longer changes it.
      await rewrite('<h1>Northwind vs HubSpot</h1>');
      await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
      expect(typeMenu().textContent).toBe('Pricing');
    });

    it('offers a shop its own types, and keeps a type from another kind of site listed', async () => {
      getContentDraft.mockResolvedValue(
        draft({ siteType: 'ecommerce', pageType: 'feature_page', method: 'create' }),
      );
      await renderPage();
      expect(typeMenu().textContent).toBe('Feature page · New page');
      const types = await openTypes();
      expect(types.map((item) => item.textContent)).toEqual([
        'Product page',
        'Category page',
        'Collection page',
        'Buying guide',
        'Best-of list',
        'Comparison',
        'Alternatives page',
        'How-to guide',
        'Definition page',
        'Sizing guide',
        'Help & FAQ',
        'Policy',
        'Blog post',
        'Feature page',
      ]);
    });

    describe('its site type (Quality CE-056)', () => {
      afterEach(() => {
        delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
      });

      it('is set for the whole brand from the menu once phase 2 is live', async () => {
        process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
        updateBrand.mockResolvedValue({ id: 'b1', siteType: 'ecommerce' });
        getContentDraft.mockResolvedValue(
          draft({ siteType: 'b2b', pageType: 'feature_page', pageTypeSource: 'user' }),
        );
        await renderPage();
        expect(getMyRuleSets).toHaveBeenCalledTimes(1);
        const items = await openTypes();
        expect(items.slice(0, 5).map((item) => item.textContent)).toEqual([
          'B2B SaaS',
          'E-commerce',
          'B2C',
          'Mobile app',
          'Feature page',
        ]);
        // No site type picked yet: the one shown is guessed.
        expect(document.body.textContent).toContain('Guessed until someone picks one.');
        await act(async () => items[1].click());
        expect(updateBrand).toHaveBeenCalledWith('b1', { siteType: 'ecommerce' });
        expect(brandState.updateBrand).toHaveBeenCalledWith('b1', {
          id: 'b1',
          siteType: 'ecommerce',
        });
        expect(toast).toHaveBeenCalledWith('Site type set to E-commerce for the whole brand.');
        // My rules are kept per site type: read again once it is saved.
        expect(getMyRuleSets).toHaveBeenCalledTimes(2);
        // A shop's page types now, the type picked kept on the list.
        const types = (await openTypes()).map((item) => item.textContent);
        expect(types.slice(4, 6)).toEqual(['Product page', 'Category page']);
        expect(types.at(-1)).toBe('Feature page');

        // Kept as it was when it can't be saved.
        vi.spyOn(console, 'error').mockImplementation(() => {});
        updateBrand.mockRejectedValueOnce(new Error('rls'));
        await act(async () =>
          document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[2].click(),
        );
        expect(toast.error).toHaveBeenCalledWith("Couldn't change the site type. Try again.");
        expect((await openTypes())[4].textContent).toBe('Product page');
      });

      it('saves a detected page type again for the new site type', async () => {
        process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
        updateBrand.mockResolvedValue({ id: 'b1', siteType: 'ecommerce' });
        getContentDraft.mockResolvedValue(draft({ siteType: 'b2b', pageTypeSource: 'detected' }));
        await renderPage();
        await act(async () => (await openTypes())[1].click());
        // The server reads the type again on a save (after the autosave's pause).
        await vi.waitFor(() => expect(saveContentDraft).toHaveBeenCalledTimes(1), {
          timeout: 3_000,
        });
      });

      it('stays in Brand settings for members, and before phase 2', async () => {
        process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
        getContentDraft.mockResolvedValue(draft({ siteType: 'b2b', pageType: 'feature_page' }));
        await renderPage('analyst');
        expect((await openTypes())[0].textContent).toBe('Feature page');
        await act(async () => root.unmount());
        root = createRoot(container);

        process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
        await renderPage();
        expect((await openTypes())[0].textContent).toBe('Feature page');
        expect(updateBrand).not.toHaveBeenCalled();
      });
    });

    it('puts the type back when picking it fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      setContentDraftPageType.mockRejectedValue(new Error('not_found'));
      getContentDraft.mockResolvedValue(draft({ siteType: 'ecommerce', pageType: 'product_page' }));
      await renderPage();
      const types = await openTypes();
      await act(async () => types.find((item) => item.textContent === 'Policy')!.click());
      expect(toast.error).toHaveBeenCalledWith("Couldn't change the page type. Try again.");
      expect(typeMenu().textContent).toBe('Product page');
    });

    it('names the existing page an optimize draft is for beside its type', async () => {
      getContentDraft.mockResolvedValue(
        draft({ sourceUrl: 'https://northwind.example/features/pipeline-forecasting/' }),
      );
      await renderPage();
      expect(typeMenu().textContent).toBe('Feature page · /features/pipeline-forecasting');
      expect(typeMenu().title).toBe('https://northwind.example/features/pipeline-forecasting/');
    });

    it('keeps the type it had while the page shows none, as a save does', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          title: 'Notes',
          bodyHtml: '<h1>Notes</h1>',
          pageType: 'blog_post',
          pageTypeSource: 'detected',
        }),
      );
      await renderPage();
      expect(typeMenu().textContent).toContain('Blog post');
      await rewrite('<h1>Northwind vs HubSpot</h1>');
      // It reads the page once typing pauses.
      await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
      expect(typeMenu().textContent).toContain('Comparison');
      // Then nothing on the page tells a type: the last one stays.
      await rewrite('<h1>More notes</h1>');
      await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
      expect(typeMenu().textContent).toContain('Comparison');
    });

    it('says when no type is detected yet', async () => {
      getContentDraft.mockResolvedValue(
        draft({ pageType: null, pageTypeSource: 'detected', method: 'create' }),
      );
      await renderPage();
      expect(typeMenu().textContent).toBe('Set page type · New page');
    });
  });

  describe('the Content Agent writing it (CE-015)', () => {
    it('reads the month’s AI usage again once the agent has written the page', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        getContentDraft.mockResolvedValue(
          draft({
            status: 'draft',
            agentState: 'writing',
            agentSince: new Date().toISOString(),
            bodyHtml: '<h1>Pipeline forecasting</h1>',
          }),
        );
        await renderPage();
        expect(aiUsage.refresh).not.toHaveBeenCalled();

        getContentDraft.mockResolvedValue(
          draft({
            status: 'in_review',
            author: 'agent',
            bodyHtml: '<h1>Pipeline</h1><p>Written.</p>',
          }),
        );
        await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
        await act(async () => {});
        expect(aiUsage.refresh).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('waits while the agent writes, then opens on what it wrote', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        getContentDraft.mockResolvedValue(
          draft({
            status: 'draft',
            agentState: 'writing',
            agentSince: new Date(Date.now() - 65_000).toISOString(),
            bodyHtml: '<h1>Pipeline forecasting</h1>',
          }),
        );
        await renderPage();
        const status = container.querySelector('[role="status"]')!;
        expect(status.textContent).toContain('Content Agent is working on this page');
        // Its steps on a live page, the one it is on with the time it has taken.
        const steps = [...status.querySelectorAll('li')];
        expect(steps.map((li) => li.textContent?.replace(/\d+:\d\d$/, ''))).toEqual([
          'Read the live page and its sources',
          'Set aside the passages AI answers quote',
          'Suggesting changes',
          'Opens here with the suggestions to review',
        ]);
        expect(steps[2].getAttribute('aria-current')).toBe('step');
        expect(steps[2].textContent).toMatch(/1:0[56]$/);
        // Under two minutes, the usual wait.
        expect(status.textContent).toContain('Usually a minute or two.');
        expect(status.textContent).not.toContain('Taking longer than usual');
        expect(container.querySelector('.ProseMirror')).toBeNull();

        getContentDraft.mockResolvedValue(
          draft({
            status: 'in_review',
            author: 'agent',
            bodyHtml: '<h1>Pipeline</h1><p>Written.</p>',
          }),
        );
        await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
        await act(async () => {});
        expect(getContentDraft).toHaveBeenCalledTimes(2);
        expect(container.querySelector('.ProseMirror')!.textContent).toContain('Written.');
        expect(container.querySelector('header')!.textContent).toContain('In review');
      } finally {
        vi.useRealTimers();
      }
    });

    it('says when the wait is longer than usual', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          status: 'draft',
          method: 'create',
          agentState: 'writing',
          agentSince: new Date(Date.now() - 150_000).toISOString(),
        }),
      );
      await renderPage();
      const status = container.querySelector('[role="status"]')!;
      expect(status.querySelector('[aria-current="step"]')!.textContent).toMatch(
        /^Writing the page2:3[01]$/,
      );
      expect(status.textContent).toContain('Taking longer than usual.');
      expect(status.textContent).not.toContain('Usually a minute or two.');
    });

    it('shows its real steps, and stops it with nothing changed (CE-027/035)', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          status: 'draft',
          method: 'create',
          agentState: 'writing',
          agentSince: new Date().toISOString(),
        }),
      );
      readAgentRun.mockResolvedValue({
        id: 'r1',
        kind: 'write',
        steps: [
          { key: 'read_rules', count: 9 },
          { key: 'gather_sources', count: 52 },
          { key: 'write_page', count: null },
          { key: 'check_sources', count: null },
        ],
        step: 2,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        stoppedAt: null,
        outcome: null,
      });
      await renderPage();
      await act(async () => {});
      const status = container.querySelector('[role="status"]')!;
      expect([...status.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
        'Reading 9 rules',
        'Gathering 52 sources',
        'Writing the page',
        'Checking sources',
      ]);
      expect(status.querySelector('[aria-current="step"]')!.textContent).toBe('Writing the page');
      // No spinning ring anywhere (v1.1 §2.4).
      expect(status.querySelector('.animate-spin')).toBeNull();

      const reads = getContentDraft.mock.calls.length;
      await act(async () => button('Stop')!.click());
      expect(stopAgentRun).toHaveBeenCalledWith('d1', 'b1', 'r1');
      expect(toast).toHaveBeenCalledWith('Stopped · nothing was changed');
      // The page as the server left it, let go of.
      expect(getContentDraft.mock.calls.length).toBe(reads + 1);
    });

    it('moves while it works, with a line on what it does, and stands still with reduced motion (CE-026)', async () => {
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      });
      try {
        getContentDraft.mockResolvedValue(
          draft({
            status: 'draft',
            method: 'create',
            agentState: 'writing',
            agentSince: new Date().toISOString(),
          }),
        );
        readAgentRun.mockResolvedValue({
          id: 'r1',
          kind: 'write',
          steps: [
            { key: 'read_rules', count: 9 },
            { key: 'gather_sources', count: 52 },
            { key: 'write_page', count: null },
            { key: 'check_sources', count: null },
          ],
          step: 2,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          stoppedAt: null,
          outcome: null,
        });
        await renderPage();
        await act(async () => {});
        const status = container.querySelector('[role="status"]')!;
        // The agent's tile breathes, the step under way has its sweep and dots.
        expect(status.querySelector('.animate-agent-breathe')).not.toBeNull();
        const now = status.querySelector('[aria-current="step"]')!;
        expect(now.textContent).toBe('Writing the page');
        expect(now.querySelector('.animate-agent-sweep')).not.toBeNull();
        expect(now.querySelector('.animate-agent-dot')).not.toBeNull();
        // One line at a time on what it does, with what its run read.
        expect(status.textContent).toContain("Answering the page's main question first");
        await act(async () => void (await vi.advanceTimersByTimeAsync(4_000)));
        expect(status.textContent).toContain('Giving each section one question to answer');
        expect(status.textContent).not.toContain("Answering the page's main question first");
        await act(async () => void (await vi.advanceTimersByTimeAsync(4_000)));
        expect(status.textContent).toContain('Keeping to 9 rules');
        await act(async () => void (await vi.advanceTimersByTimeAsync(4_000)));
        expect(status.textContent).toContain('Drawing on 52 sources');
        // The page drawn in, line by line.
        expect(container.querySelectorAll('.animate-agent-fill').length).toBeGreaterThan(0);
        // No spinning ring, and all of it still with reduced motion.
        expect(container.querySelector('.animate-spin')).toBeNull();
        const moving = [...container.querySelectorAll('[class*="animate-agent"], .animate-in')];
        expect(
          moving.every((el) =>
            /motion-reduce:(animate-none|hidden)/.test(el.getAttribute('class')!),
          ),
        ).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('says what it does on a live page', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        getContentDraft.mockResolvedValue(
          draft({
            status: 'draft',
            agentState: 'writing',
            agentSince: new Date(Date.now() - 4_000).toISOString(),
          }),
        );
        await renderPage();
        const status = container.querySelector('[role="status"]')!;
        // Optimize, its second line: the passages it keeps.
        expect(status.textContent).toContain('Leaving passages AI quotes as they are');
        expect(status.querySelector('[aria-current="step"] .animate-agent-sweep')).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('says nothing of rules or sources its run read none of', async () => {
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      });
      try {
        getContentDraft.mockResolvedValue(
          draft({
            status: 'draft',
            method: 'create',
            agentState: 'writing',
            agentSince: new Date().toISOString(),
          }),
        );
        readAgentRun.mockResolvedValue({
          id: 'r1',
          kind: 'write',
          steps: [
            { key: 'read_rules', count: 0 },
            { key: 'gather_sources', count: 0 },
            { key: 'write_page', count: null },
          ],
          step: 2,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          stoppedAt: null,
          outcome: null,
        });
        await renderPage();
        await act(async () => {});
        const status = container.querySelector('[role="status"]')!;
        const said: string[] = [];
        for (let i = 0; i < 5; i++) {
          said.push(status.textContent!);
          await act(async () => void (await vi.advanceTimersByTimeAsync(4_000)));
        }
        expect(said.join(' ')).toContain('Looking up facts it lacks, with their sources');
        expect(said.join(' ')).not.toMatch(/Keeping to|Drawing on/);
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows a live page’s Start, which runs as a Fix, and stops it', async () => {
      getContentDraft.mockResolvedValue(
        draft({ status: 'draft', agentState: 'writing', agentSince: new Date().toISOString() }),
      );
      readAgentRun.mockResolvedValue({
        id: 'r2',
        kind: 'fix',
        steps: [
          { key: 'read_rules', count: 7 },
          { key: 'gather_sources', count: 3 },
          { key: 'write_changes', count: null },
          { key: 'check_sources', count: null },
        ],
        step: 2,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        stoppedAt: null,
        outcome: null,
      });
      await renderPage();
      await act(async () => {});
      const status = container.querySelector('[role="status"]')!;
      // Its real steps, not the fixed list, and its Stop.
      expect([...status.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
        'Reading 7 rules',
        'Gathering 3 sources',
        'Writing changes',
        'Checking sources',
      ]);
      await act(async () => button('Stop')!.click());
      expect(stopAgentRun).toHaveBeenCalledWith('d1', 'b1', 'r2');
    });

    it('shows Write this building the brief first, and stops it (customer priorities item 9)', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          status: 'draft',
          method: 'create',
          agentState: 'writing',
          agentRun: 'write',
          agentSince: new Date().toISOString(),
        }),
      );
      readAgentRun.mockResolvedValue({
        id: 'r5',
        kind: 'brief',
        steps: [
          { key: 'gather_sources', count: 12 },
          { key: 'write_outline', count: null },
          { key: 'match_fanouts', count: null },
        ],
        step: 1,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        stoppedAt: null,
        outcome: null,
      });
      await renderPage();
      await act(async () => {});
      const status = container.querySelector('[role="status"]')!;
      expect(status.textContent).toContain("Content Agent is building this page's brief");
      expect(status.querySelector('[aria-current="step"]')).not.toBeNull();
      await act(async () => button('Stop')!.click());
      expect(stopAgentRun).toHaveBeenCalledWith('d1', 'b1', 'r5');
    });

    it('shows only the run the page waits on: a rewrite’s on a new page, never another kind’s', async () => {
      for (const [method, agentRun, kind, shown] of [
        // A new page's rewrite: its run is a rewrite, not the Start's write.
        ['create', 'rewrite', 'rewrite', true],
        ['create', 'rewrite', 'write', false],
        ['create', 'write', 'fix', false],
        ['optimize', 'rewrite', 'fix', false],
      ] as const) {
        getContentDraft.mockResolvedValue(
          draft({
            status: 'draft',
            method,
            agentState: 'writing',
            agentRun,
            agentSince: new Date().toISOString(),
          }),
        );
        readAgentRun.mockResolvedValue({
          id: 'r3',
          kind,
          steps: [{ key: 'check_sources', count: null }],
          step: 0,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          stoppedAt: null,
          outcome: null,
        });
        await renderPage();
        await act(async () => {});
        // Another run's: the fixed list stays, with no Stop for it.
        expect(
          container.querySelector('[role="status"]')!.textContent!.includes('Checking sources'),
        ).toBe(shown);
        expect(button('Stop') !== undefined).toBe(shown);
        await act(async () => root.unmount());
        root = createRoot(container);
      }
    });

    it('reads the draft at once when its run ends, its steps shown till then', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        getContentDraft.mockResolvedValue(
          draft({
            status: 'draft',
            method: 'create',
            agentState: 'writing',
            agentSince: new Date().toISOString(),
          }),
        );
        const writingRun = {
          id: 'r1',
          kind: 'write' as const,
          steps: [
            { key: 'write_page' as const, count: null },
            { key: 'check_sources' as const, count: null },
          ],
          step: 1,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          stoppedAt: null,
          outcome: null,
        };
        readAgentRun.mockResolvedValue(writingRun);
        await renderPage();
        await act(async () => {});
        const reads = getContentDraft.mock.calls.length;

        readAgentRun.mockResolvedValue({
          ...writingRun,
          step: 2,
          finishedAt: new Date().toISOString(),
          outcome: 'done',
        });
        await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
        await act(async () => {});
        // Not on the page's next look (5 s): now.
        expect(getContentDraft.mock.calls.length).toBe(reads + 1);
        // The run's steps stay, never the fixed list for a moment.
        const status = container.querySelector('[role="status"]')!;
        expect([...status.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
          'Writing the page',
          'Checking sources',
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('says the agent couldn’t finish, and tries again with the page and rules in effect', async () => {
      getContentDraft.mockResolvedValue(draft({ status: 'draft', agentState: 'failed' }));
      await renderPage();
      const alert = container.querySelector('[role="alert"]')!;
      expect(alert.textContent).toContain("The Content Agent couldn't finish this page.");

      await act(async () => button('Try again')!.click());
      await act(async () => {});
      expect(startAgentWriting).toHaveBeenCalledWith(
        'd1',
        'b1',
        expect.objectContaining({ textRules: [], locked: [] }),
      );
      const [, , request] = startAgentWriting.mock.calls[0];
      expect(request.rules.length).toBeGreaterThan(0);
      // The page now waits for the agent.
      expect(container.querySelector('[role="status"]')!.textContent).toContain(
        'Content Agent is working on this page',
      );
    });

    it('keeps the page when the agent can’t start again', async () => {
      startAgentWriting.mockResolvedValue({ error: 'ai_budget' });
      getContentDraft.mockResolvedValue(draft({ status: 'draft', agentState: 'failed' }));
      await renderPage();
      await act(async () => button('Try again')!.click());
      await act(async () => {});
      expect(toast.error).toHaveBeenCalledWith(
        "This month's AI usage is spent, so the agent didn't start.",
      );
      expect(container.querySelector('.ProseMirror')).not.toBeNull();
      await act(async () => button('Close')!.click());
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it('takes the band away once another run starts here (editor UX review 2026-11-03)', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          status: 'draft',
          agentState: 'failed',
          bodyHtml: '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p>',
        }),
      );
      getDraftSuggestions.mockResolvedValue([]);
      fixDraftRules.mockResolvedValue({ count: 0 });
      await renderPage();
      const failed = () =>
        [...container.querySelectorAll('[role="alert"]')].find((a) =>
          a.textContent?.includes("The Content Agent couldn't finish this page."),
        );
      expect(failed()).toBeDefined();
      // Fix open rules from Rules: the run before it is behind the page now.
      await act(async () =>
        container.querySelector<HTMLButtonElement>('header button[aria-label^="Rules "]')!.click(),
      );
      await act(async () =>
        [...container.querySelectorAll<HTMLButtonElement>('aside button')]
          .find((b) => b.textContent === 'Fix open rules')!
          .click(),
      );
      await act(async () => {});
      expect(fixDraftRules).toHaveBeenCalled();
      expect(failed()).toBeUndefined();
    });
  });

  it('marks the draft ready once', async () => {
    getContentDraft.mockResolvedValue(draft());
    markContentDraftReady.mockResolvedValue({ status: 'ready', tasksDone: 0 });
    await renderPage();

    await act(async () => button('Mark ready')!.click());
    expect(markContentDraftReady).toHaveBeenCalledWith('d1');
    expect(toast.success).toHaveBeenCalledWith(
      "Marked ready. Publish it on your site when you're ready.",
    );
    // Marked: Ready, in green, where Mark ready was; a click moves it back to review.
    expect(button('Mark ready')).toBeUndefined();
    const ready = button('Ready: click to move it back to review')!;
    expect(ready.textContent).toBe('Ready');
    await act(async () => ready.click());
    expect(unmarkContentDraftReady).toHaveBeenCalledWith('d1');
    expect(toast).toHaveBeenCalledWith('Back in review.');
    expect(button('Mark ready')!.disabled).toBe(false);
  });

  it('keeps Ready when moving it back fails, and a page published meanwhile published', async () => {
    getContentDraft.mockResolvedValue(draft({ status: 'ready' }));
    unmarkContentDraftReady.mockRejectedValueOnce(new Error('network'));
    await renderPage();
    await act(async () => button('Ready: click to move it back to review')!.click());
    expect(toast.error).toHaveBeenCalledWith("Couldn't move it back to review.");
    expect(button('Ready: click to move it back to review')).toBeDefined();

    unmarkContentDraftReady.mockResolvedValueOnce({ status: 'published', tasksReopened: 0 });
    await act(async () => button('Ready: click to move it back to review')!.click());
    expect(toast).toHaveBeenCalledWith('Its status is now Published, so it stays.');
    // Its live address, for the Live page tab.
    expect(readLiveUrl).toHaveBeenCalledWith('d1');
    // Published, a click opens its live address (CE-013).
    expect(button('Published')!.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('says Published on a published page, a click away from its live address (CE-013)', async () => {
    getContentDraft.mockResolvedValue(
      draft({ status: 'published', publishedUrl: 'https://acme.example.com/pipeline' }),
    );
    await renderPage();
    expect(button('Mark ready')).toBeUndefined();
    expect(button('Published')!.getAttribute('aria-disabled')).not.toBe('true');
    await act(async () => button('Published')!.click());
    expect(readPublishAddress).toHaveBeenCalledWith('d1');
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Mark published');
  });

  it('holds Published on an archived page until it’s restored, as the Library does', async () => {
    getContentDraft.mockResolvedValue(
      draft({ status: 'published', archivedAt: '2026-10-25T10:00:00Z' }),
    );
    await renderPage();
    expect(button('Published')!.getAttribute('aria-disabled')).toBe('true');
    await act(async () => button('Published')!.click());
    expect(readPublishAddress).not.toHaveBeenCalled();
  });

  it('asks for the address of a page marked published without one on the Live page tab', async () => {
    getContentDraft.mockResolvedValue(draft({ status: 'published', method: 'create' }));
    const width = window.innerWidth;
    window.innerWidth = 1440;
    try {
      await renderPage();
      await pickTab('Live page');
      expect(container.textContent).toContain(
        "This page is marked published without its live address, so there's nothing to measure.",
      );
      expect(getContentImpact).not.toHaveBeenCalled();
    } finally {
      window.innerWidth = width;
    }
  });

  it('measures the address a page went live at on the Live page tab, not the page it optimized', async () => {
    getContentDraft.mockResolvedValue(
      draft({
        status: 'published',
        sourceUrl: 'https://acme.example.com/pricing',
        publishedUrl: 'https://acme.example.com/pricing-2026',
      }),
    );
    const width = window.innerWidth;
    window.innerWidth = 1440;
    try {
      await renderPage();
      await pickTab('Live page');
      expect(getContentImpact).toHaveBeenCalledWith(
        'b1',
        'https://acme.example.com/pricing-2026',
        30,
      );
    } finally {
      window.innerWidth = width;
    }
  });

  it('marks a ready page published from Next step, and the Live page tab measures its address', async () => {
    getContentDraft.mockResolvedValue(draft({ status: 'ready', method: 'create' }));
    publishPage.mockResolvedValue({
      ok: true,
      publishedUrl: 'https://acme.example.com/pipeline',
      publishedAt: '2026-10-25T10:00:00Z',
      onBrandDomain: true,
      taskCompleted: false,
    });
    const width = window.innerWidth;
    window.innerWidth = 1440;
    // Next step comes with Quality.
    process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
    try {
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'analyst' },
      });
      await renderPage();
      // The header's Next step: Ready to publish, Mark published beside Export.
      const next = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Next'),
      )!;
      await act(async () => {
        next.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        next.click();
      });
      await act(async () => {
        [...document.querySelectorAll<HTMLButtonElement>('button')]
          .find((b) => b.textContent === 'Mark published')!
          .click();
      });
      await act(async () => {
        [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
          .find((b) => b.textContent === 'Mark published')!
          .click();
      });
      expect(publishPage).toHaveBeenCalledWith('d1', 'https://acme.example.com/pipeline');
      expect(button('Published')).toBeDefined();
      await pickTab('Live page');
      expect(getContentImpact).toHaveBeenCalledWith('b1', 'https://acme.example.com/pipeline', 30);
    } finally {
      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
      window.innerWidth = width;
    }
  });

  it('holds Next step’s Mark published on an archived page, saying why', async () => {
    getContentDraft.mockResolvedValue(
      draft({ status: 'ready', method: 'create', archivedAt: '2026-10-25T10:00:00Z' }),
    );
    const width = window.innerWidth;
    window.innerWidth = 1440;
    process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
    try {
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'analyst' },
      });
      await renderPage();
      const next = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Next'),
      )!;
      await act(async () => {
        next.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        next.click();
      });
      const mark = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === 'Mark published',
      )!;
      expect(mark.disabled).toBe(true);
      const why = document.getElementById(mark.getAttribute('aria-describedby')!);
      expect(why!.textContent).toBe('This page is archived. Restore it in the Library first.');
    } finally {
      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
      window.innerWidth = width;
    }
  });

  it("puts the caret at the end of the page's H1 when the title is clicked", async () => {
    getContentDraft.mockResolvedValue(draft());
    await renderPage();
    const title = container.querySelector<HTMLButtonElement>('header h1 button')!;
    expect(title.textContent).toBe('Pipeline forecasting');
    await act(async () => title.click());
    const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
      .editor;
    // The H1 is the page's first block: its end is its text's length past its start.
    expect(editor.state.selection.from).toBe(1 + 'Pipeline forecasting'.length);
  });

  it('puts the caret where the title comes from with no H1, and asks for the page while HTML shows', async () => {
    getContentDraft.mockResolvedValue(
      draft({ bodyHtml: '<p></p><h2>Pipeline forecasting</h2><p>Teams trust it.</p>' }),
    );
    await renderPage();
    const title = container.querySelector<HTMLButtonElement>('header h1 button')!;
    await act(async () => title.click());
    const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
      .editor;
    // The empty line (2 positions), then the H2's text.
    expect(editor.state.selection.from).toBe(2 + 1 + 'Pipeline forecasting'.length);

    await act(async () => button('Edit as HTML')!.click());
    await act(async () => title.click());
    expect(toast).toHaveBeenCalledWith(
      "Rename it in the HTML view's text, or close the view to rename it in the page.",
    );
    // History waits while the HTML view holds the page, and says why.
    const history = button('History')!;
    expect(document.getElementById(history.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Go back to the page to use History',
    );
  });

  it('links the chat it was made in, with the new Chat on (W4-10)', async () => {
    const CHAT = 'cccccccc-0000-4000-8000-000000000001';
    getContentDraft.mockResolvedValue(draft({ conversation: { id: CHAT, title: 'Pricing FAQ' } }));
    await renderPage('admin', { chatOn: true });
    const bar = container.querySelector('[data-slot="draft-chat-bar"]')!;
    expect(bar.textContent).toBe('From chat: Pricing FAQ');
    expect(bar.querySelector('a')!.getAttribute('href')).toBe(`/dashboard/chat/${CHAT}`);

    // Not with the new Chat off, nor for a draft made elsewhere.
    act(() => root.unmount());
    root = createRoot(container);
    await renderPage('admin');
    expect(container.querySelector('[data-slot="draft-chat-bar"]')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    getContentDraft.mockResolvedValue(draft());
    await renderPage('admin', { chatOn: true });
    expect(container.querySelector('[data-slot="draft-chat-bar"]')).toBeNull();
  });

  it('links the action the draft is the work of, and says Ready completed its task', async () => {
    getContentDraft.mockResolvedValue(draft({ action: { id: 'act-1', number: 214 } }));
    markContentDraftReady.mockResolvedValue({ status: 'ready', tasksDone: 1 });
    await renderPage();

    const note = [...container.querySelectorAll('p')].find((p) =>
      p.textContent?.startsWith('This draft is the work of'),
    )!;
    expect(note.textContent).toBe(
      'This draft is the work of Action AC-214. Mark ready completes its task there.',
    );
    expect(note.querySelector('a')!.getAttribute('href')).toBe(
      '/dashboard/action-center/actions?action=act-1',
    );

    await act(async () => button('Mark ready')!.click());
    expect(toast.success).toHaveBeenCalledWith(
      "Marked ready, and its task in Action AC-214 is done. Publish it on your site when you're ready.",
    );
    expect(note.textContent).toBe('This draft is the work of Action AC-214.');

    // Taken back, the task Ready completed is open again.
    unmarkContentDraftReady.mockResolvedValueOnce({ status: 'in_review', tasksReopened: 1 });
    await act(async () => button('Ready: click to move it back to review')!.click());
    expect(toast).toHaveBeenCalledWith(
      'Back in review, and its task in Action AC-214 is open again.',
    );
  });

  describe('history', () => {
    const versions = [
      {
        id: 'v2',
        origin: 'ready',
        title: 'Pipeline forecasting',
        createdAt: '2026-10-19T09:00:00Z',
      },
      { id: 'v1', origin: 'import', title: 'Old title', createdAt: '2026-10-12T09:42:00Z' },
    ];
    /** Opens History and returns its versions. */
    async function openHistory() {
      const trigger = button('History')!;
      await act(async () => {
        trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        trigger.click();
      });
      await act(async () => {});
      return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    }

    it('lists earlier versions with their origin', async () => {
      getContentDraft.mockResolvedValue(draft());
      getDraftVersions.mockResolvedValue(versions);
      await renderPage();

      const items = await openHistory();
      expect(getDraftVersions).toHaveBeenCalledWith('d1');
      expect(document.body.textContent).toContain('Version history · kept 90 days');
      expect(document.body.textContent).toContain('NowThis draft, as you see it');
      expect(items.map((item) => item.textContent)).toEqual([
        expect.stringMatching(/^Marked ready.* · kept on Mark readyRestore$/),
        expect.stringMatching(/^Live page.* · imported from the URLRestore$/),
      ]);
      expect(document.body.textContent).toContain(
        'Restoring makes a new version. Nothing is lost.',
      );
    });

    it('lists the hand-offs among the versions by time, with nothing to restore (CE-051)', async () => {
      getContentDraft.mockResolvedValue(draft());
      getDraftVersions.mockResolvedValue(versions);
      getDraftHandoffs.mockResolvedValue([
        {
          id: 'r1',
          origin: 'auto',
          outcome: 'done',
          checks: 6,
          startedAt: '2026-10-15T09:00:00Z',
        },
      ]);
      await renderPage();
      const items = await openHistory();
      expect(getDraftHandoffs).toHaveBeenCalledWith('d1');
      // Only the versions restore; the hand-off sits between them.
      expect(items).toHaveLength(2);
      const body = document.body.textContent!;
      const text = body.slice(body.indexOf('Version history'));
      expect(text).toContain('Handed off automatically');
      expect(text).toContain('6 checks · its changes were suggestions to review');
      expect(text.indexOf('Marked ready')).toBeLessThan(text.indexOf('Handed off automatically'));
      expect(text.indexOf('Handed off automatically')).toBeLessThan(text.indexOf('Live page'));
    });

    it('says when there is nothing to restore yet', async () => {
      getContentDraft.mockResolvedValue(draft());
      await renderPage();
      expect(await openHistory()).toHaveLength(0);
      expect(document.body.textContent).toContain('No earlier versions yet. Mark ready keeps one.');
    });

    it('restores a version in place, after saving what was waiting', async () => {
      getContentDraft.mockResolvedValue(draft());
      getDraftVersions.mockResolvedValue(versions);
      restoreDraftVersion.mockResolvedValue({
        title: 'Old title',
        bodyHtml: '<h1>Old title</h1><p>As the live page had it.</p>',
        updatedAt: '2026-10-21T10:00:00Z',
      });
      await renderPage();
      // An edit still waiting for its save.
      await act(async () => button('Edit as HTML')!.click());
      const source = container.querySelector('textarea')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          source,
          '<h1>Pipeline forecasting</h1><p>Edited.</p>',
        );
        source.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => button('Back to visual')!.click());
      expect(saveContentDraft).not.toHaveBeenCalled();

      const items = await openHistory();
      await act(async () => items[1].click());
      await act(async () => {});

      expect(saveContentDraft).toHaveBeenCalledWith('d1', {
        title: 'Pipeline forecasting',
        bodyHtml: '<h1>Pipeline forecasting</h1><p>Edited.</p>',
        base: {
          updatedAt: '2026-10-20T10:00:00Z',
          bodyHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      });
      expect(restoreDraftVersion).toHaveBeenCalledWith('d1', 'v1');
      expect(saveContentDraft.mock.invocationCallOrder[0]).toBeLessThan(
        restoreDraftVersion.mock.invocationCallOrder[0],
      );
      expect(container.querySelector('.ProseMirror')!.textContent).toBe(
        'Old titleAs the live page had it.',
      );
      expect(container.querySelector('header h1')!.textContent).toBe('Old title');
      expect(toast.success).toHaveBeenCalledWith(
        'Restored “Live page”. The page before it is in History.',
      );
      // Nothing from before the restore is sent after it.
      expect(saveContentDraft).toHaveBeenCalledTimes(1);
      expect(container.querySelector('header')!.textContent).toContain('Saved');
    });

    it('restores once for two quick clicks', async () => {
      getContentDraft.mockResolvedValue(draft());
      getDraftVersions.mockResolvedValue(versions);
      restoreDraftVersion.mockReturnValue(new Promise(() => {}));
      await renderPage();
      const items = await openHistory();
      await act(async () => {
        items[1].click();
        items[1].click();
      });
      // One restore, one "Before a restore" (editor test 2026-10-25: two in a minute).
      expect(restoreDraftVersion).toHaveBeenCalledTimes(1);
    });

    it('sets aside the agent’s open suggestions for the page before, and closes its card', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml: '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p>',
        }),
      );
      getDraftVersions.mockResolvedValue(versions);
      getDraftSuggestions.mockResolvedValue([
        {
          id: 'n1',
          batchId: 'b2',
          actionId: null,
          actionNo: null,
          kind: 'replace' as const,
          blockText: 'We delve into how teams forecast.',
          beforeText: 'delve into',
          afterText: 'look at',
          reason: 'remove an AI trace (rule)',
          ruleKeys: ['aiTraces'],
          status: 'open' as const,
        },
      ]);
      restoreDraftVersion.mockResolvedValue({
        title: 'Old title',
        bodyHtml: '<h1>Old title</h1><p>As the live page had it.</p>',
        updatedAt: '2026-10-21T10:00:00Z',
      });
      await renderPage();
      const card = () => container.querySelector('[role="region"][aria-label="Agent suggestions"]');
      expect(card()).not.toBeNull();
      const items = await openHistory();
      await act(async () => items[1].click());
      await act(async () => {});
      expect(decideDraftSuggestions).toHaveBeenCalledWith(['n1'], 'rejected');
      // Its Undo all would undo nothing on the page restored.
      expect(card()).toBeNull();
      // Said, as they counted toward AI usage.
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringMatching(
          /^Restored “.+”\. The agent’s open change was for the page before, so it was set aside\.$/,
        ),
      );
    });

    it('waits while a restore runs: the card’s buttons and the agent’s runs', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml: '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p>',
        }),
      );
      getDraftVersions.mockResolvedValue(versions);
      getDraftSuggestions.mockResolvedValue([
        {
          id: 'n1',
          batchId: 'b2',
          actionId: null,
          actionNo: null,
          kind: 'replace' as const,
          blockText: 'We delve into how teams forecast.',
          beforeText: 'delve into',
          afterText: 'look at',
          reason: 'remove an AI trace (rule)',
          ruleKeys: ['aiTraces'],
          status: 'open' as const,
        },
      ]);
      let restored: (value: unknown) => void = () => {};
      restoreDraftVersion.mockReturnValue(new Promise((r) => (restored = r)));
      await renderPage();
      const accept = () =>
        [
          ...container
            .querySelector('[role="region"][aria-label="Agent suggestions"]')!
            .querySelectorAll('button'),
        ].find((b) => b.textContent === 'Accept all')!;
      const items = await openHistory();
      await act(async () => items[1].click());
      // The decision would land under the restore setting the same ones aside.
      expect(accept().disabled || accept().hasAttribute('data-disabled')).toBe(true);
      // The card on the page too.
      const inPage = [
        ...container
          .querySelector('.ProseMirror [data-suggestion="n1"]')!
          .querySelectorAll('button'),
      ].find((b) => b.textContent === 'Accept')!;
      await act(async () => inPage.click());
      await act(async () =>
        restored({
          title: 'Old title',
          bodyHtml: '<h1>Old title</h1><p>We delve into how teams forecast.</p>',
          updatedAt: '2026-10-21T10:00:00Z',
        }),
      );
      await act(async () => {});
      expect(decideDraftSuggestions).toHaveBeenCalledTimes(1);
      expect(decideDraftSuggestions).toHaveBeenCalledWith(['n1'], 'rejected');
    });

    // A batch, decided or open, the agent left on 21 October.
    const ranBefore = (status: 'accepted' | 'open') => [
      {
        id: 'a1',
        batchId: 'b2',
        actionId: null,
        actionNo: null,
        kind: 'replace' as const,
        blockText: 'Teams delve into how they forecast.',
        beforeText: 'delve into',
        afterText: 'look at',
        reason: 'remove an AI trace (rule)',
        ruleKeys: ['aiTraces'],
        status,
        createdAt: '2026-10-21T10:00:00Z',
      },
    ];
    const agentCard = () =>
      container.querySelector('[role="region"][aria-label="Agent suggestions"]');

    it('holds Try again while a restore runs', async () => {
      getContentDraft.mockResolvedValue(draft({ status: 'draft', agentState: 'failed' }));
      getDraftVersions.mockResolvedValue(versions);
      restoreDraftVersion.mockReturnValue(new Promise(() => {}));
      await renderPage();
      const items = await openHistory();
      await act(async () => items[1].click());
      expect(button('Try again')!.disabled).toBe(true);
      await act(async () => button('Try again')!.click());
      expect(startAgentWriting).not.toHaveBeenCalled();
    });

    it('says how many open changes it set aside', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml:
            '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p><p>Teams trust it.</p>',
        }),
      );
      getDraftVersions.mockResolvedValue(versions);
      const open = {
        batchId: 'b2',
        actionId: null,
        actionNo: null,
        kind: 'replace' as const,
        reason: 'remove an AI trace (rule)',
        ruleKeys: ['aiTraces'],
        status: 'open' as const,
      };
      getDraftSuggestions.mockResolvedValue([
        {
          ...open,
          id: 'n1',
          blockText: 'We delve into how teams forecast.',
          beforeText: 'delve into',
          afterText: 'look at',
        },
        {
          ...open,
          id: 'n2',
          blockText: 'Teams trust it.',
          beforeText: 'trust',
          afterText: 'rely on',
        },
      ]);
      restoreDraftVersion.mockResolvedValue({
        title: 'Old title',
        bodyHtml: '<h1>Old title</h1><p>As the live page had it.</p>',
        updatedAt: '2026-10-21T10:00:00Z',
      });
      await renderPage();
      const items = await openHistory();
      await act(async () => items[1].click());
      await act(async () => {});
      expect(decideDraftSuggestions).toHaveBeenCalledWith(['n1', 'n2'], 'rejected');
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringMatching(
          /^Restored “.+”\. The agent’s 2 open changes were for the page before, so they were set aside\.$/,
        ),
      );
    });

    it('sets nothing aside when the version is the page as it is', async () => {
      const body = '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p>';
      getContentDraft.mockResolvedValue(draft({ bodyHtml: body }));
      getDraftVersions.mockResolvedValue(versions);
      getDraftSuggestions.mockResolvedValue([
        {
          id: 'n1',
          batchId: 'b2',
          actionId: null,
          actionNo: null,
          kind: 'replace' as const,
          blockText: 'We delve into how teams forecast.',
          beforeText: 'delve into',
          afterText: 'look at',
          reason: 'remove an AI trace (rule)',
          ruleKeys: ['aiTraces'],
          status: 'open' as const,
        },
      ]);
      // The server left the draft as it was, and says so (00289).
      restoreDraftVersion.mockResolvedValue({
        title: 'Pipeline forecasting',
        bodyHtml: body,
        updatedAt: '2026-10-20T10:00:00Z',
        restored: false,
      });
      await renderPage();
      const items = await openHistory();
      await act(async () => items[1].click());
      await act(async () => {});
      expect(decideDraftSuggestions).not.toHaveBeenCalled();
      expect(
        container.querySelector('[role="region"][aria-label="Agent suggestions"]'),
      ).not.toBeNull();
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringMatching(/^“.+” is the page as it is: nothing changed\.$/),
      );
    });

    it('opens the card closed for a batch from before the page was last restored', async () => {
      getContentDraft.mockResolvedValue(
        draft({ bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams look at how they forecast.</p>' }),
      );
      getLastRestoreAt.mockResolvedValue('2026-10-22T09:00:00Z');
      getDraftSuggestions.mockResolvedValue(ranBefore('accepted'));
      await renderPage();
      // After a reload, or in another tab: its Undo all was for the page before.
      expect(getLastRestoreAt).toHaveBeenCalledWith('d1');
      expect(agentCard()).toBeNull();
    });

    it('still shows a batch from before the restore with open changes to decide', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams delve into how they forecast.</p>',
        }),
      );
      getLastRestoreAt.mockResolvedValue('2026-10-22T09:00:00Z');
      getDraftSuggestions.mockResolvedValue(ranBefore('open'));
      await renderPage();
      expect(agentCard()).not.toBeNull();
    });

    it('shows a batch left after the last restore as ever', async () => {
      getContentDraft.mockResolvedValue(
        draft({ bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams look at how they forecast.</p>' }),
      );
      getLastRestoreAt.mockResolvedValue('2026-10-20T09:00:00Z');
      getDraftSuggestions.mockResolvedValue(ranBefore('accepted'));
      await renderPage();
      expect(agentCard()).not.toBeNull();
    });

    it('shows the batch as ever when the last restore can’t be read', async () => {
      getContentDraft.mockResolvedValue(
        draft({ bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams look at how they forecast.</p>' }),
      );
      getLastRestoreAt.mockRejectedValue(new Error('offline'));
      getDraftSuggestions.mockResolvedValue(ranBefore('accepted'));
      await renderPage();
      expect(agentCard()).not.toBeNull();
    });

    it('closes the card of a batch already decided: its Undo all and last run were for the page before', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml:
            '<h1>Pipeline forecasting</h1><p>Teams look at how they forecast.</p><p>Teams trust it.</p>',
        }),
      );
      getDraftVersions.mockResolvedValue(versions);
      const decided = {
        batchId: 'b2',
        actionId: null,
        actionNo: null,
        kind: 'replace' as const,
        reason: 'remove an AI trace (rule)',
        ruleKeys: ['aiTraces'],
      };
      getDraftSuggestions.mockResolvedValue([
        {
          ...decided,
          id: 'a1',
          blockText: 'Teams delve into how they forecast.',
          beforeText: 'delve into',
          afterText: 'look at',
          status: 'accepted' as const,
        },
        // Its passage is on the version restored too.
        {
          ...decided,
          id: 'r1',
          blockText: 'Teams trust it.',
          beforeText: 'trust',
          afterText: 'rely on',
          status: 'rejected' as const,
        },
      ]);
      restoreDraftVersion.mockResolvedValue({
        title: 'Old title',
        bodyHtml:
          '<h1>Old title</h1><p>Teams delve into how they forecast.</p><p>Teams trust it.</p>',
        updatedAt: '2026-10-21T10:00:00Z',
      });
      await renderPage();
      const card = () => container.querySelector('[role="region"][aria-label="Agent suggestions"]');
      expect(card()).not.toBeNull();
      const items = await openHistory();
      await act(async () => items[1].click());
      await act(async () => {});
      // Nothing open to set aside.
      expect(decideDraftSuggestions).not.toHaveBeenCalled();
      expect(card()).toBeNull();
    });

    it('leaves the agent’s open suggestions on its card when they can’t be set aside', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml: '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p>',
        }),
      );
      getDraftVersions.mockResolvedValue(versions);
      getDraftSuggestions.mockResolvedValue([
        {
          id: 'n1',
          batchId: 'b2',
          actionId: null,
          actionNo: null,
          kind: 'replace' as const,
          blockText: 'We delve into how teams forecast.',
          beforeText: 'delve into',
          afterText: 'look at',
          reason: 'remove an AI trace (rule)',
          ruleKeys: ['aiTraces'],
          status: 'open' as const,
        },
      ]);
      decideDraftSuggestions.mockRejectedValue(new Error('offline'));
      restoreDraftVersion.mockResolvedValue({
        title: 'Old title',
        bodyHtml: '<h1>Old title</h1><p>We delve into how teams forecast.</p>',
        updatedAt: '2026-10-21T10:00:00Z',
      });
      await renderPage();
      const items = await openHistory();
      await act(async () => items[1].click());
      await act(async () => {});
      // Still open on the server: on the card to decide, never shown as set aside.
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringMatching(/^Restored “.+”\. The page before it is in History\.$/),
      );
      const card = container.querySelector('[role="region"][aria-label="Agent suggestions"]');
      expect(card).not.toBeNull();
      expect(
        [...card!.querySelectorAll('button')].some((b) => b.textContent === 'Accept all'),
      ).toBe(true);
    });

    it('waits while a decision on the agent’s changes saves', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml: '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p>',
        }),
      );
      getDraftSuggestions.mockResolvedValue([
        {
          id: 'n1',
          batchId: 'b2',
          actionId: null,
          actionNo: null,
          kind: 'replace' as const,
          blockText: 'We delve into how teams forecast.',
          beforeText: 'delve into',
          afterText: 'look at',
          reason: 'remove an AI trace (rule)',
          ruleKeys: ['aiTraces'],
          status: 'open' as const,
        },
      ]);
      let saved: () => void = () => {};
      decideDraftSuggestions.mockReturnValueOnce(new Promise<void>((r) => (saved = r)));
      await renderPage();
      const card = container.querySelector('[role="region"][aria-label="Agent suggestions"]')!;
      await act(async () =>
        [...card.querySelectorAll('button')].find((b) => b.textContent === 'Accept all')!.click(),
      );
      // A restore now would set the same suggestions aside under the decision.
      expect(button('History')!.title).toBe("Saving your decision on the agent's changes…");
      expect(button('History')!.disabled || button('History')!.hasAttribute('data-disabled')).toBe(
        true,
      );
      await act(async () => saved());
      await act(async () => {});
      expect(button('History')!.disabled || button('History')!.hasAttribute('data-disabled')).toBe(
        false,
      );
    });

    it('keeps the page when the restore fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      getContentDraft.mockResolvedValue(draft());
      getDraftVersions.mockResolvedValue(versions);
      restoreDraftVersion.mockRejectedValue(new Error('not_found'));
      await renderPage();

      const items = await openHistory();
      await act(async () => items[0].click());
      await act(async () => {});

      expect(toast.error).toHaveBeenCalledWith("Couldn't restore it. Try again.");
      expect(container.querySelector('.ProseMirror')!.textContent).toBe(
        'Pipeline forecastingTeams trust it.',
      );
    });

    it('waits while the HTML view is open', async () => {
      getContentDraft.mockResolvedValue(draft());
      await renderPage();
      await act(async () => button('Edit as HTML')!.click());
      expect(button('History')!.title).toBe('Go back to the page to use History');
      expect(button('History')!.disabled || button('History')!.hasAttribute('data-disabled')).toBe(
        true,
      );
    });
  });

  describe('locked passages', () => {
    const QUOTED =
      'Northwind forecasts each deal from real activity: emails, meetings and stage changes.';
    const page = draft({
      sourceUrl: 'https://acme.example/forecasting',
      bodyHtml: `<h1>Pipeline forecasting</h1><p>${QUOTED}</p><p>Teams trust it.</p>`,
    });
    const cited = [
      {
        key: passageKey(QUOTED),
        platforms: [
          { platform: 'chatgpt-web', answers: 14 },
          { platform: 'perplexity-web', answers: 6 },
        ],
      },
    ];
    const editorOf = () =>
      (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    /** Where the quoted passage's text starts in the page. */
    const quotedAt = () => {
      let at = 0;
      editorOf().state.doc.descendants((node, pos) => {
        if (node.textContent === QUOTED && node.isTextblock) at = pos + 1;
        return !at;
      });
      return at;
    };
    const dialogText = () => document.querySelector('[role="dialog"]')?.textContent ?? null;
    const dialogButton = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (b) => b.textContent === name,
      )!;

    it('marks the passages AI answers quote, and counts them in the header', async () => {
      getContentDraft.mockResolvedValue(page);
      getCitedPassages.mockResolvedValue(cited);
      await renderPage();

      expect(getCitedPassages).toHaveBeenCalledWith('d1', [
        'Pipeline forecasting',
        QUOTED,
        'Teams trust it.',
      ]);
      const marked = container.querySelectorAll('.ProseMirror .cited-passage');
      expect(marked).toHaveLength(1);
      expect(marked[0].textContent).toBe(QUOTED);
      expect(marked[0].getAttribute('data-cited-label')).toBe(
        '✓ Cited by ChatGPT 14× and Perplexity 6× in 30 days · keep wording',
      );
      expect(container.querySelector('header')!.textContent).toContain('1 cited passage kept');
    });

    it('leaves long sentences only in quoted passages to the person, never sent to Fix', async () => {
      // Sentences up to 60 characters: the quoted passage's is the only long one.
      getContentDraft.mockResolvedValue(
        draft({
          ...page,
          bodyHtml: `${page.bodyHtml}<p>We delve into it.</p>`,
          rules: {
            set: null,
            source: null,
            overrides: { sentence: { value: '60' } },
            textRules: [],
          },
        }),
      );
      getCitedPassages.mockResolvedValue(cited);
      fixDraftRules.mockResolvedValue({ count: 0 });
      const width = window.innerWidth;
      window.innerWidth = 1024;
      try {
        await renderPage();
        await act(async () =>
          container
            .querySelector<HTMLButtonElement>('header button[aria-label^="Rules "]')!
            .click(),
        );
        expect(container.querySelector('aside')!.textContent).toContain(
          'Kept by AI citations · yours to decide',
        );
        await act(async () =>
          [...container.querySelector('aside')!.querySelectorAll<HTMLButtonElement>('button')]
            .find((b) => b.textContent === 'Fix open rules')!
            .click(),
        );
        await act(async () => {});
        const keys = fixDraftRules.mock.calls[0][2].rules.map((r: { key: string }) => r.key);
        expect(keys).toContain('aiTraces');
        expect(keys).not.toContain('sentence');
        // Within its Length (none set here): no overLength.
        expect(fixDraftRules.mock.calls[0][2]).not.toHaveProperty('overLength');
      } finally {
        window.innerWidth = width;
      }
    });

    it('reads nothing for a new page', async () => {
      getContentDraft.mockResolvedValue(draft({ sourceUrl: null }));
      await renderPage();
      expect(getCitedPassages).not.toHaveBeenCalled();
      expect(container.querySelector('.cited-passage')).toBeNull();
    });

    it('asks before typing in one, and keeps the wording', async () => {
      getContentDraft.mockResolvedValue(page);
      getCitedPassages.mockResolvedValue(cited);
      await renderPage();

      await act(async () => {
        editorOf().commands.setTextSelection(quotedAt() + 4);
        editorOf().view.dom.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }),
        );
      });
      expect(dialogText()).toContain('AI quotes this passage');
      expect(dialogText()).toContain(
        'ChatGPT 14× and Perplexity 6× quoted this wording in the last 30 days.',
      );

      await act(async () => dialogButton('Keep wording').click());
      expect(dialogText()).toBeNull();
      expect(container.querySelector('.cited-passage')!.textContent).toBe(QUOTED);
    });

    it('holds a change over one until the person says to edit anyway', async () => {
      getContentDraft.mockResolvedValue(page);
      getCitedPassages.mockResolvedValue(cited);
      await renderPage();

      const from = quotedAt();
      await act(async () => {
        editorOf().commands.insertContentAt({ from, to: from + QUOTED.length }, 'Rewritten.');
      });
      expect(container.querySelector('.cited-passage')!.textContent).toBe(QUOTED);
      expect(saveContentDraft).not.toHaveBeenCalled();
      expect(dialogText()).toContain('AI quotes this passage');

      await act(async () => dialogButton('Edit anyway').click());
      expect(dialogText()).toBeNull();
      expect(container.querySelector('.ProseMirror')!.textContent).toBe(
        'Pipeline forecastingRewritten.Teams trust it.',
      );
      // No longer the quoted wording: no longer locked or counted.
      expect(container.querySelector('.cited-passage')).toBeNull();
      expect(container.querySelector('header')!.textContent).not.toContain('cited passage');
    });

    it('holds a key once, even when its text follows the held keydown, and types it on Edit anyway', async () => {
      getContentDraft.mockResolvedValue(page);
      getCitedPassages.mockResolvedValue(cited);
      await renderPage();

      const at = quotedAt() + 4;
      await act(async () => {
        editorOf().commands.setTextSelection(at);
        editorOf().view.dom.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }),
        );
        // The same keystroke's text, as some keyboards still send it.
        editorOf().commands.insertContentAt(at, 'x');
      });
      await act(async () => dialogButton('Edit anyway').click());
      // The key pressed is typed, once.
      expect(container.querySelector('.ProseMirror')!.textContent).toContain(
        `${QUOTED.slice(0, 4)}x${QUOTED.slice(4)}`,
      );
      expect(container.querySelector('.cited-passage')).toBeNull();
    });

    it('deletes the character a held Backspace would, on Edit anyway', async () => {
      getContentDraft.mockResolvedValue(page);
      getCitedPassages.mockResolvedValue(cited);
      await renderPage();

      await act(async () => {
        editorOf().commands.setTextSelection(quotedAt() + 4);
        editorOf().view.dom.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
        );
      });
      await act(async () => dialogButton('Edit anyway').click());
      expect(container.querySelector('.ProseMirror')!.textContent).toContain(
        `${QUOTED.slice(0, 3)}${QUOTED.slice(4)}`,
      );
    });

    it('lets typing through once the person chose to edit it', async () => {
      getContentDraft.mockResolvedValue(page);
      getCitedPassages.mockResolvedValue(cited);
      await renderPage();
      const typeX = () =>
        act(async () => {
          editorOf().commands.setTextSelection(quotedAt() + 4);
          editorOf().view.dom.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }),
          );
        });

      await typeX();
      await act(async () => dialogButton('Edit anyway').click());
      await typeX();
      expect(dialogText()).toBeNull();
    });
  });

  describe('agent suggestions', () => {
    const VAGUE = 'Our forecasting is very accurate.';
    const page = draft({
      bodyHtml: `<h1>Pipeline forecasting</h1><p>${VAGUE}</p><p>Teams trust it.</p>`,
    });
    const suggestion = (over: Partial<DraftSuggestion>): DraftSuggestion => ({
      id: 's1',
      batchId: 'b1',
      actionId: 'a1',
      actionNo: 214,
      kind: 'replace',
      blockText: VAGUE,
      beforeText: VAGUE,
      afterText: 'Accuracy is shown per team, each week, against closed revenue.',
      reason: 'answer fan-out “how accurate is CRM forecasting”',
      ruleKeys: [],
      status: 'open',
      ...over,
    });
    const batch = [
      suggestion({}),
      suggestion({
        id: 's2',
        kind: 'insert',
        blockText: 'Teams trust it.',
        beforeText: '',
        afterText: '<h2>FAQ</h2><p>Does it work with custom stages? Yes, any stage.</p>',
        reason: 'add FAQ block (rule: 5 questions)',
      }),
    ];
    const cardOf = (id: string) =>
      container.querySelector<HTMLElement>(`.ProseMirror [data-suggestion="${id}"]`);
    const press = async (id: string, label: string) => {
      const target = [...cardOf(id)!.querySelectorAll('button')].find(
        (b) => b.textContent === label,
      )!;
      await act(async () => target.click());
      await act(async () => {});
    };
    const bar = () => container.querySelector('[role="region"][aria-label="Agent suggestions"]');
    const barButton = (label: string) =>
      [...bar()!.querySelectorAll('button')].find((b) => b.textContent === label)!;
    /** The page's own text: the cards are drawn over it, not part of it. */
    const pageText = () =>
      (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor.state.doc
        .textContent;

    it('shows each open suggestion where it applies, with the agent bar', async () => {
      getContentDraft.mockResolvedValue(page);
      getDraftSuggestions.mockResolvedValue(batch);
      await renderPage();

      expect(getDraftSuggestions).toHaveBeenCalledWith('d1');
      expect(bar()!.textContent).toContain('Content Agent has 2 suggestions for you');
      expect(bar()!.textContent).toContain('from Action AC-214');
      expect(bar()!.querySelector('a')!.getAttribute('href')).toBe(
        '/dashboard/action-center/actions?action=a1',
      );
      const replace = cardOf('s1')!;
      expect(replace.textContent).toContain(
        'Content Agent · answer fan-out “how accurate is CRM forecasting”',
      );
      expect(replace.querySelector('del')!.textContent).toBe(VAGUE);
      expect(replace.querySelector('ins')!.textContent).toBe(
        'Accuracy is shown per team, each week, against closed revenue.',
      );
      expect(cardOf('s2')!.textContent).toContain('Does it work with custom stages?');
      // The page itself is unchanged until one is accepted.
      expect(pageText()).not.toContain('Accuracy is shown');
    });

    it('reviews the first open suggestion: scrolls to it and marks it for a moment', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const scrolled = vi.fn();
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrolled;
      try {
        getContentDraft.mockResolvedValue(page);
        getDraftSuggestions.mockResolvedValue(batch);
        await renderPage();

        await act(async () => barButton('Review').click());
        expect(scrolled).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
        expect(scrolled.mock.contexts[0]).toBe(cardOf('s1'));
        expect(cardOf('s1')!.classList.contains('ring-2')).toBe(true);
        // Focused too, so the keyboard lands on it.
        expect(document.activeElement).toBe(cardOf('s1')!.querySelector('button'));
        await act(async () => vi.advanceTimersByTime(1200));
        expect(cardOf('s1')!.classList.contains('ring-2')).toBe(false);
      } finally {
        Element.prototype.scrollIntoView = original;
        vi.useRealTimers();
      }
    });

    it('accepts one into the page, keeping the page before it in History, and undoes it', async () => {
      getContentDraft.mockResolvedValue(page);
      getDraftSuggestions.mockResolvedValue(batch);
      await renderPage();

      await press('s1', 'Accept');
      expect(keepAgentBeforeVersion).toHaveBeenCalledWith('d1');
      expect(decideDraftSuggestions).toHaveBeenCalledWith(['s1'], 'accepted');
      expect(pageText()).toContain(
        'Accuracy is shown per team, each week, against closed revenue.',
      );
      expect(pageText()).not.toContain(VAGUE);
      expect(cardOf('s1')!.textContent).toContain('Accepted');
      expect(container.querySelector('.ProseMirror .agent-accepted-text')!.textContent).toBe(
        'Accuracy is shown per team, each week, against closed revenue.',
      );
      expect(bar()!.textContent).toContain('Content Agent has 1 suggestion for you');

      await press('s1', 'Undo');
      expect(decideDraftSuggestions).toHaveBeenLastCalledWith(['s1'], 'open');
      expect(pageText()).toContain(VAGUE);
      expect(cardOf('s1')!.querySelector('del')).not.toBeNull();
      // History kept the page once, before the first change.
      await press('s1', 'Accept');
      expect(keepAgentBeforeVersion).toHaveBeenCalledTimes(1);
    });

    it('puts a replace’s links on its words, shows where they go, and takes them off on undo', async () => {
      getContentDraft.mockResolvedValue(page);
      getDraftSuggestions.mockResolvedValue([
        suggestion({
          afterText: 'Accuracy is shown per team, as our pricing page explains.',
          afterLinks: [{ start: 35, end: 47, href: 'https://acme.example/pricing' }],
        }),
      ]);
      await renderPage();

      expect(cardOf('s1')!.textContent).toContain('Links: https://acme.example/pricing');
      expect(cardOf('s1')!.querySelector('span[title]')!.textContent).toBe('pricing page');
      await press('s1', 'Accept');
      const html = () =>
        (
          container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }
        ).editor.getHTML();
      expect(html()).toMatch(
        /<a [^>]*href="https:\/\/acme\.example\/pricing"[^>]*>pricing page<\/a>/,
      );

      await press('s1', 'Undo');
      expect(pageText()).toContain(VAGUE);
      expect(html()).not.toContain('<a ');
    });

    it('makes an accept again on the page when it changed while the decision was saved', async () => {
      getContentDraft.mockResolvedValue(page);
      getDraftSuggestions.mockResolvedValue(batch);
      let saved: () => void = () => {};
      decideDraftSuggestions.mockReturnValueOnce(new Promise<void>((r) => (saved = r)));
      await renderPage();

      await act(async () => {
        cardOf('s1')!
          .querySelectorAll('button')
          .forEach((b) => b.textContent === 'Accept' && b.click());
      });
      // An attachment read in while the decision is being saved.
      const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
        .editor;
      await act(async () => {
        editor.commands.insertContentAt(editor.state.doc.content.size, '<p>From a file.</p>');
      });
      await act(async () => saved());
      await act(async () => {});

      expect(pageText()).toContain(
        'Accuracy is shown per team, each week, against closed revenue.',
      );
      expect(pageText()).toContain('From a file.');
      expect(cardOf('s1')!.textContent).toContain('Accepted');
    });

    it('makes the change again at once, before saving back what no longer fits', async () => {
      getContentDraft.mockResolvedValue(page);
      getDraftSuggestions.mockResolvedValue(batch);
      let firstSaved: () => void = () => {};
      let backSaved: () => void = () => {};
      decideDraftSuggestions
        .mockReturnValueOnce(new Promise<void>((r) => (firstSaved = r)))
        .mockReturnValueOnce(new Promise<void>((r) => (backSaved = r)));
      await renderPage();

      await act(async () => barButton('Accept all').click());
      const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
        .editor;
      // While the decision is saved, the passage s2 goes after is rewritten.
      await act(async () => {
        let range: { from: number; to: number } | null = null;
        editor.state.doc.descendants((node, pos) => {
          if (node.isText && node.text === 'Teams trust it.') {
            range = { from: pos, to: pos + node.nodeSize };
          }
        });
        editor.commands.insertContentAt(range!, 'Teams rely on it.');
      });
      await act(async () => firstSaved());
      await act(async () => {});
      // s1 is on the page already; s2 goes back to review, and the page changes again meanwhile.
      expect(decideDraftSuggestions).toHaveBeenLastCalledWith(['s2'], 'open');
      expect(pageText()).toContain(
        'Accuracy is shown per team, each week, against closed revenue.',
      );
      await act(async () => {
        editor.commands.insertContentAt(editor.state.doc.content.size, '<p>From a file.</p>');
      });
      await act(async () => backSaved());
      await act(async () => {});

      expect(pageText()).toContain(
        'Accuracy is shown per team, each week, against closed revenue.',
      );
      expect(pageText()).toContain('Teams rely on it.');
      expect(pageText()).toContain('From a file.');
      expect(pageText()).not.toContain('FAQ');
      expect(cardOf('s1')!.textContent).toContain('Accepted');
    });

    it('rejects one, and restores it to review', async () => {
      getContentDraft.mockResolvedValue(page);
      getDraftSuggestions.mockResolvedValue(batch);
      await renderPage();

      await press('s2', 'Reject');
      expect(decideDraftSuggestions).toHaveBeenCalledWith(['s2'], 'rejected');
      expect(cardOf('s2')!.textContent).toContain('Rejected');
      expect(pageText()).not.toContain('FAQ');

      await press('s2', 'Restore');
      expect(decideDraftSuggestions).toHaveBeenLastCalledWith(['s2'], 'open');
      expect(cardOf('s2')!.textContent).toContain('Accept');
    });

    it('accepts all, says what is left, and undoes all', async () => {
      getContentDraft.mockResolvedValue(page);
      getDraftSuggestions.mockResolvedValue(batch);
      await renderPage();

      await act(async () => barButton('Accept all').click());
      await act(async () => {});
      expect(decideDraftSuggestions).toHaveBeenCalledWith(['s1', 's2'], 'accepted');
      expect(pageText()).toContain(
        'Accuracy is shown per team, each week, against closed revenue.Teams trust it.FAQDoes it work with custom stages? Yes, any stage.',
      );
      expect(bar()!.textContent).toMatch(
        /^All suggestions reviewed2 accepted · \d+\/\d+ rules · \d+ still open/,
      );
      // Not a full run's batch: nothing about running it again.
      expect(bar()!.textContent).not.toContain('a run makes at most');

      await act(async () => barButton('Undo all').click());
      await act(async () => {});
      expect(decideDraftSuggestions).toHaveBeenLastCalledWith(['s2', 's1'], 'open');
      expect(pageText()).toBe(`Pipeline forecasting${VAGUE}Teams trust it.`);
      expect(bar()!.textContent).toContain('Content Agent has 2 suggestions for you');
    });

    it('never applies one to a passage AI quotes, or to one the page changed', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          sourceUrl: 'https://acme.example/forecasting',
          bodyHtml: `<h1>Pipeline forecasting</h1><p>${VAGUE}</p><p>Teams trust it.</p>`,
        }),
      );
      getCitedPassages.mockResolvedValue([
        { key: passageKey(VAGUE), platforms: [{ platform: 'chatgpt-web', answers: 3 }] },
      ]);
      getDraftSuggestions.mockResolvedValue([
        suggestion({}),
        suggestion({ id: 's3', blockText: 'Gone since.', beforeText: 'Gone since.' }),
      ]);
      await renderPage();

      const locked = cardOf('s1')!;
      expect(locked.textContent).toContain("AI quotes this passage, so agents don't change it.");
      expect(
        [...locked.querySelectorAll('button')].find((b) => b.textContent === 'Accept')!.disabled,
      ).toBe(true);
      const stale = cardOf('s3')!;
      expect(stale.textContent).toContain('The page changed here since the agent read it.');

      await act(async () => barButton('Accept all').click());
      await act(async () => {});
      expect(pageText()).toContain(VAGUE);
      expect(decideDraftSuggestions).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        "2 suggestions couldn't be applied: the page changed there, AI quotes the passage, or a heading would get too long.",
      );
    });

    it('never glues an answer into a heading, and takes a short change to one', async () => {
      const ANSWER =
        'Pipeline forecasting? It predicts which deals close this quarter from the activity on each one, team by team, against the revenue that closed.';
      getContentDraft.mockResolvedValue(page);
      getDraftSuggestions.mockResolvedValue([
        suggestion({
          blockText: 'Pipeline forecasting',
          beforeText: 'Pipeline forecasting',
          afterText: ANSWER,
        }),
        suggestion({
          id: 's4',
          blockText: 'Pipeline forecasting',
          beforeText: 'forecasting',
          afterText: 'forecasting, explained',
        }),
      ]);
      await renderPage();

      const glued = cardOf('s1')!;
      expect(glued.textContent).toContain('This would put more than a heading into the heading.');
      expect(
        [...glued.querySelectorAll('button')].find((b) => b.textContent === 'Accept')!.disabled,
      ).toBe(true);
      await press('s4', 'Accept');
      expect(pageText()).toContain('Pipeline forecasting, explained');
      expect(pageText()).not.toContain('It predicts which deals');
    });

    it('leaves the page and the card as they were when the decision can’t be saved', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      getContentDraft.mockResolvedValue(page);
      getDraftSuggestions.mockResolvedValue([suggestion({})]);
      decideDraftSuggestions.mockRejectedValueOnce(new Error('offline'));
      await renderPage();

      await press('s1', 'Accept');
      expect(pageText()).toContain(VAGUE);
      expect(cardOf('s1')!.textContent).toContain('Accept');
      expect(toast.error).toHaveBeenCalled();
    });

    it('takes text with $ in it as written, so an accepted one can be undone', async () => {
      // String.replace would read "$$" in the page's words as "$".
      const before = 'Plans start at $$49, or $& with add-ons.';
      getContentDraft.mockResolvedValue(
        draft({ bodyHtml: `<h1>Pipeline forecasting</h1><p>${before}</p>` }),
      );
      getDraftSuggestions.mockResolvedValue([
        suggestion({ blockText: before, beforeText: before, afterText: 'Plans start at $49.' }),
      ]);
      decideDraftSuggestions.mockResolvedValue(undefined);
      await renderPage();

      await press('s1', 'Accept');
      expect(pageText()).toContain('Plans start at $49.');
      await press('s1', 'Undo');
      expect(pageText()).toContain(before);
    });

    it('waits with the HTML view until they are decided', async () => {
      getContentDraft.mockResolvedValue(page);
      getDraftSuggestions.mockResolvedValue(batch);
      await renderPage();

      await act(async () => button('Edit as HTML')!.click());
      expect(container.querySelector('textarea')).toBeNull();
      expect(toast).toHaveBeenCalledWith(
        'Accept or reject the 2 agent suggestions first, then edit as HTML.',
      );
    });
  });

  it('shows the page as HTML, and cleans it when it switches back', async () => {
    getContentDraft.mockResolvedValue(
      draft({
        bodyHtml:
          '<h1>Trail Runner X</h1><script type="application/ld+json">{"@type":"Product"}</script>',
      }),
    );
    await renderPage();
    // Schema JSON-LD shows as a labelled block, not as text.
    expect(container.querySelector('[data-json-ld]')!.textContent).toBe(
      '{ } Schema · Product (JSON-LD)',
    );

    await act(async () => button('Edit as HTML')!.click());
    const source = container.querySelector('textarea')!;
    expect(source.value).toBe(
      '<h1>Trail Runner X</h1>\n<script type="application/ld+json">{"@type":"Product"}</script>',
    );
    // The other tools wait while the HTML view is open.
    expect(button('Bold')!.disabled).toBe(true);

    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(
        source,
        `${source.value}<p style="color:red">New <script>alert(1)</script>line</p>`,
      );
      source.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Back to visual')!.click());

    expect(container.querySelector('textarea')).toBeNull();
    expect(toast).toHaveBeenCalledWith('HTML applied · 1 unsafe tag removed');
    const page = container.querySelector('.ProseMirror')!;
    expect(page.querySelector('p')!.outerHTML).toBe('<p>New line</p>');
    expect(page.querySelector('[data-json-ld]')).not.toBeNull();
    expect(page.textContent).not.toContain('alert');
  });

  it('goes back from an unedited HTML view without saving anything', async () => {
    getContentDraft.mockResolvedValue(draft());
    await renderPage();
    await act(async () => button('Edit as HTML')!.click());
    await act(async () => button('Back to visual')!.click());
    expect(container.querySelector('textarea')).toBeNull();
    expect(toast).not.toHaveBeenCalled();
    expect(container.querySelector('header')!.textContent).toContain('Saved');
  });

  it('keeps HTML blocks only in a paste copied from this editor', async () => {
    getContentDraft.mockResolvedValue(
      draft({
        bodyHtml: `<h1>Trail Runner X</h1><div data-html-block="${encodeHtmlBlock('<p>hi</p>')}"></div><p>End.</p>`,
      }),
    );
    await renderPage();
    const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
      .editor;
    const blocks = () => container.querySelectorAll('[data-html-block-view]').length;
    expect(blocks()).toBe(1);

    // jsdom has no ClipboardEvent, which pasteHTML makes.
    if (!('ClipboardEvent' in globalThis)) {
      Object.assign(globalThis, { ClipboardEvent: class extends Event {} });
    }
    // Copied here: the editor's own clipboard HTML.
    const { dom } = editor.view.serializeForClipboard(
      editor.state.doc.slice(0, editor.state.doc.content.size),
    );
    const own = dom.innerHTML;
    // Another ProseMirror site's copy says data-pm-slice too, without this tab's mark.
    const foreign = own.replace(/ data-ce-copy="[^"]*"/g, '');
    expect(foreign).toContain('data-pm-slice');
    await act(async () => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.view.pasteHTML(foreign);
    });
    expect(blocks()).toBe(1);
    await act(async () => {
      editor.view.pasteHTML(own);
    });
    expect(blocks()).toBe(2);
  });

  it('adds HTML blocks, shows their code as text, and copies one or the whole page', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    getContentDraft.mockResolvedValue(draft({ bodyHtml: '<h1>Trail Runner X</h1>' }));
    await renderPage();

    const code =
      '<iframe src="https://www.youtube.com/embed/x"></iframe>\n<script>track()</script>';
    await act(async () => button('Add an HTML block')!.click());
    const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Code"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(field, code);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'Add block')!.click();
    });
    await act(async () => {});

    const block = container.querySelector('[data-html-block-view]')!;
    expect(block.textContent).toContain('HTML block');
    expect(block.textContent).toContain('2 lines');
    // The code is text on the page, never markup: no iframe, no script runs.
    expect(block.querySelector('pre')!.textContent).toBe(code);
    expect(container.querySelector('.ProseMirror iframe, .ProseMirror script')).toBeNull();

    const copyBlock = [...block.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Copy HTML',
    )!;
    await act(async () => copyBlock.click());
    expect(writeText).toHaveBeenLastCalledWith(code);

    const copyPage = [...container.querySelectorAll<HTMLButtonElement>('header button')].find(
      (b) => b.getAttribute('aria-label') === 'Copy HTML',
    )!;
    await act(async () => copyPage.click());
    // The block went in where the cursor was: the start, as nothing was clicked.
    expect(writeText).toHaveBeenLastCalledWith(`${code}\n<h1>Trail Runner X</h1>`);
    expect(toast.success).toHaveBeenLastCalledWith('HTML copied');
  });

  const reviewerAuthor: ContentAuthor = {
    id: 'r1',
    name: 'Dr. Grace Hopper',
    title: 'Clinical Reviewer',
    bio: null,
    photoUrl: null,
    sameAs: [],
    userId: null,
    createdBy: 'u1',
    defaultFor: [],
    pages: 0,
  };
  /** Copy HTML with Quality on and Dr. Grace Hopper picked as the reviewer. */
  const copyWithReviewer = async (bodyHtml: string) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    getContentAuthors.mockResolvedValue({
      authors: [reviewerAuthor],
      brands: [{ id: 'b1', name: 'Acme' }],
      me: { id: 'u1', role: 'analyst' },
    });
    process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
    try {
      getContentDraft.mockResolvedValue(draft({ reviewerId: 'r1', bodyHtml }));
      await renderPage();
      await act(async () => button('Copy HTML')!.click());
      return writeText.mock.calls[0][0] as string;
    } finally {
      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
    }
  };

  it('copies the reviewer as WebPage metadata once the page names them', async () => {
    const copied = await copyWithReviewer(
      '<h1>Pipeline</h1><p>Reviewed by Dr. Grace Hopper</p><p>Teams trust it.</p>',
    );
    expect(copied).toMatch(/"@type":\s*"WebPage"/);
    expect(copied).toContain('"reviewedBy"');
    expect(copied).toMatch(/"name":\s*"Dr\. Grace Hopper"/);
  });

  it('copies no reviewedBy while the page doesn’t name the reviewer, as Before you publish says', async () => {
    const copied = await copyWithReviewer('<h1>Pipeline</h1><p>Teams trust it.</p>');
    expect(copied).toContain('<p>Teams trust it.</p>');
    expect(copied).not.toContain('reviewedBy');
  });

  it('copies and exports as before with Quality off: no reviewer, no authors read', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    getContentDraft.mockResolvedValue(
      draft({
        reviewerId: 'r1',
        bodyHtml: '<h1>Pipeline</h1><p>Reviewed by Dr. Grace Hopper</p>',
      }),
    );
    await renderPage();
    await act(async () => button('Copy HTML')!.click());
    expect(writeText.mock.calls[0][0]).not.toContain('reviewedBy');
    expect(getContentAuthors).not.toHaveBeenCalled();
  });

  it('exports the page from the header, as Markdown here', async () => {
    getContentDraft.mockResolvedValue(
      draft({ bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams <strong>trust</strong> it.</p>' }),
    );
    await renderPage();
    const trigger = [...container.querySelectorAll<HTMLButtonElement>('header button')].find(
      (b) => b.textContent === 'Export',
    )!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.click();
    });
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((i) => i.textContent)).toEqual([
      'Export Word',
      'Export Excel',
      'Export CSV',
      'Export HTML',
      'Export Markdown',
    ]);
    await act(async () => items[4].click());
    await act(async () => {});

    expect(saveBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe('getcito_content_pipeline-forecasting.md');
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blob);
    });
    expect(text).toBe('# Pipeline forecasting\n\nTeams **trust** it.\n');
  });

  it('shows the link the cursor is in, to open in a new tab', async () => {
    getContentDraft.mockResolvedValue(
      draft({ bodyHtml: '<p><a href="https://gartner.com/x">Gartner</a> says so.</p>' }),
    );
    await renderPage();
    const target = container.querySelector<HTMLAnchorElement>('[role="toolbar"] a')!;
    expect(target.getAttribute('href')).toBe('https://gartner.com/x');
    expect(target.target).toBe('_blank');
    expect(target.rel).toBe('noopener noreferrer');
    expect(target.textContent).toBe('gartner.com/x');
  });

  describe('attaching files', () => {
    const said = () =>
      toast.success.mock.calls.length +
      toast.error.mock.calls.length +
      toast.info.mock.calls.length;
    /** Attaches the files, and waits until each has said something or a preview opened. */
    async function attach(...files: File[]) {
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, 'files', { value: files, configurable: true });
      const before = said();
      await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      // Reading a file, and loading its reader the first time, take real time.
      for (let i = 0; i < 80; i++) {
        if (said() - before >= files.length || document.querySelector('[role="dialog"]')) break;
        await act(() => new Promise((resolve) => setTimeout(resolve, 25)));
      }
    }
    const dialogButton = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (b) => b.textContent === name,
      );

    beforeEach(async () => {
      getContentDraft.mockResolvedValue(draft({ bodyHtml: '<p>Intro</p>' }));
      await renderPage();
    });

    it('previews a CSV and inserts it as a table, its first row the header', async () => {
      await attach(new File(['Keyword,Volume\ncrm forecasting,210\npipeline,96\n'], 'kw.csv'));
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain('kw.csv');
      expect(dialog.textContent).toContain('2 rows · 2 columns');

      await act(async () => dialogButton('Insert as table')!.click());
      const table = container.querySelector('.ProseMirror table')!;
      expect([...table.querySelectorAll('th')].map((c) => c.textContent)).toEqual([
        'Keyword',
        'Volume',
      ]);
      expect(table.querySelectorAll('tr')).toHaveLength(3);
      expect(toast.success).toHaveBeenCalledWith('Table inserted from kw.csv · 2 rows');
    });

    it('puts the next import under a table, not in its cell', async () => {
      await attach(new File(['A,B\n1,2\n'], 'one.csv'));
      await act(async () => dialogButton('Insert as table')!.click());
      await attach(new File(['After the table'], 'note.txt'));
      const page = container.querySelector('.ProseMirror')!;
      expect(page.querySelectorAll('table')).toHaveLength(1);
      expect(page.querySelector('table')!.textContent).not.toContain('After the table');
      expect(page.textContent).toContain('After the table');
    });

    it('asks before inserting a table over 200 rows', async () => {
      const csv = ['n', ...Array.from({ length: 250 }, (_, i) => String(i))].join('\n');
      await attach(new File([csv], 'long.csv'));
      await act(async () => dialogButton('Insert as table')!.click());
      expect(container.querySelector('.ProseMirror table')).toBeNull();
      expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
        'This table has 250 rows.',
      );
      await act(async () => dialogButton('Insert all 250 rows')!.click());
      expect(container.querySelectorAll('.ProseMirror table tr')).toHaveLength(251);
    });

    it('inserts only the rows that fit in the page’s size limit, after saying so', async () => {
      const cell = 'x'.repeat(1000);
      const csv = ['a,b,c', ...Array.from({ length: 1000 }, () => `${cell},${cell},${cell}`)].join(
        '\n',
      );
      await attach(new File([csv], 'big.csv'));
      await act(async () => dialogButton('Insert as table')!.click());
      expect(container.querySelector('.ProseMirror table')).toBeNull();
      const note = document.querySelector('[role="dialog"]')!.textContent!;
      const fit = Number(
        /Only the first ([\d,]+) of 1,000 rows fit/.exec(note)![1].replace(',', ''),
      );
      expect(fit).toBeGreaterThan(100);
      expect(fit).toBeLessThan(1000);
      await act(async () => dialogButton(`Insert the first ${fit} rows`)!.click());
      expect(container.querySelectorAll('.ProseMirror table tr')).toHaveLength(fit + 1);
      // As the editor saves it, the page stays under the limit.
      const editorHtml = container.querySelector('.ProseMirror')!.innerHTML;
      expect(editorHtml.length).toBeLessThan(500_000);
    });

    it('imports Markdown and Word as content, cleaned like a paste', async () => {
      await attach(
        new File(
          ['## From Markdown\n\nA *note* with a [link](https://acme.com/?utm_source=x).'],
          'notes.md',
        ),
      );
      const page = container.querySelector('.ProseMirror')!;
      expect(page.querySelector('h2')!.textContent).toBe('From Markdown');
      expect(page.querySelector('a')!.getAttribute('href')).toBe('https://acme.com/');
      expect(toast.success).toHaveBeenLastCalledWith('notes.md imported');

      await attach(new File(['PK'], 'brief.docx'));
      expect([...page.querySelectorAll('h2')].map((h) => h.textContent)).toContain('From Word');
      expect(page.querySelector('img')).toBeNull();
      expect(toast.success).toHaveBeenLastCalledWith('brief.docx imported · 1 image left out');
    });

    it('says what it can’t take: images, old formats, large files', async () => {
      await attach(
        new File(['x'], 'shoe.png'),
        new File(['x'], 'old.xls'),
        new File(['x'.repeat(10 * 1024 * 1024 + 1)], 'huge.txt'),
      );
      expect(toast.info).toHaveBeenCalledWith(
        "Images can't be attached yet. Add shoe.png with Insert an image, by its address.",
      );
      expect(toast.error).toHaveBeenCalledWith('Save old.xls as .xlsx or .docx, then attach it.');
      expect(toast.error).toHaveBeenCalledWith('huge.txt is over 10 MB.');
      expect(container.querySelector('.ProseMirror')!.textContent).toBe('Intro');
    });
  });

  it('follows the draft’s brand in the sidebar', async () => {
    getContentDraft.mockResolvedValue(draft({ brandId: 'b2' }));
    await renderPage();
    expect(brandState.setActiveBrand).toHaveBeenCalledWith('b2');
  });

  it('says when the draft can’t be opened', async () => {
    getContentDraft.mockResolvedValue(null);
    await renderPage();
    expect(container.textContent).toContain(
      "This draft doesn't exist, or it belongs to another workspace.",
    );
    expect(container.querySelector('a[href="/dashboard/content/library"]')).not.toBeNull();
  });
});

describe('the side panel', () => {
  const panel = () => container.querySelector('aside');
  const innerWidth = window.innerWidth;
  afterEach(() => {
    window.innerWidth = innerWidth;
  });

  it('starts closed on a narrow window, and the header opens it', async () => {
    getContentDraft.mockResolvedValue(draft({ sourceUrl: 'https://acme.example.com/pricing' }));
    window.innerWidth = 1024;
    await renderPage();
    expect(panel()).toBeNull();
    expect(getContentImpact).not.toHaveBeenCalled();

    await act(async () => button('Show side panel')!.click());
    expect(panel()!.getAttribute('aria-label')).toBe('Side panel');
    // Instructions first, on Rules, what to act on; the live page reads only once it is picked.
    expect(selectedTab()).toBe('Instructions');
    expect(selectedSegment()).toBe('Rules');
    expect(getContentImpact).not.toHaveBeenCalled();
    await pickTab('Live page');
    // The page the draft optimizes, over 30 days.
    expect(getContentImpact).toHaveBeenCalledWith('b1', 'https://acme.example.com/pricing', 30);
    expect(getContentResults).toHaveBeenCalledWith('b1', 'https://acme.example.com/pricing', 30);
    expect(button('Hide side panel')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps its tabs down the right edge while closed, and opens on the one picked', async () => {
    getContentDraft.mockResolvedValue(draft());
    window.innerWidth = 1024;
    await renderPage();
    expect(panel()).toBeNull();
    const rail = () => container.querySelector('nav[aria-label="Side panel"]');
    const tabs = [...rail()!.querySelectorAll('button')];
    expect(tabs.map((b) => b.textContent)).toEqual(['Instructions', 'Sources', 'Live page']);
    expect(tabs[1].getAttribute('title')).toBe('Open Sources in the side panel');

    await act(async () => tabs[1].click());
    expect(panel()!.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      'Sources',
    );
    expect(rail()).toBeNull();
    expect(localStorage.getItem('aeo:content-editor-panel')).toBe('1');

    // Closed again from the header, the strip is back.
    await act(async () => button('Hide side panel')!.click());
    expect(panel()).toBeNull();
    expect(rail()).not.toBeNull();
  });

  // Brief › Shopping path (shopping path, part 3): an online shop's page that links products.
  it.each([
    [{ siteType: 'ecommerce', pageType: 'buying_guide' }, true],
    [{ siteType: 'b2b', pageType: 'buying_guide' }, false],
    [{ siteType: 'ecommerce', pageType: 'product_page' }, false],
  ] as const)('shows the shopping path in Brief for %o: %s', async (over, shown) => {
    getContentDraft.mockResolvedValue(draft(over));
    window.innerWidth = 1440;
    await renderPage();
    await pickTab('Brief');
    expect(panel()!.querySelector('section[aria-label="Shopping path"]') !== null).toBe(shown);
  });

  it('shows the Shopping rules once the path is read, and reads it again after a change in Brief', async () => {
    let land!: (value: unknown) => void;
    getShoppingCheck.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          land = resolve;
        }),
    );
    try {
      getContentDraft.mockResolvedValue(draft({ siteType: 'ecommerce', pageType: 'buying_guide' }));
      window.innerWidth = 1440;
      await renderPage();
      await pickTab('Rules');
      // While it's first read: no Shopping rules, and no count that would change.
      expect(panel()!.textContent).not.toContain('Links its category page');
      expect(panel()!.textContent).toContain('Reading the rules…');
      await act(async () =>
        land({ categories: ['shop.example/collections/boots'], products: [], site: null }),
      );
      expect(panel()!.textContent).toContain('Links its category page');
      expect(panel()!.textContent).toMatch(/\d+\/\d+ rules met/);

      // Brief › Shopping path picks again: the rules read the path again.
      const { buildDraftShoppingPath } = await import('@/lib/actions/shoppingPath');
      vi.mocked(buildDraftShoppingPath).mockResolvedValueOnce({ path: null, reason: 'no_match' });
      await pickTab('Brief');
      const reads = getShoppingCheck.mock.calls.length;
      await act(async () => button('Pick from the catalog')!.click());
      expect(getShoppingCheck.mock.calls.length).toBe(reads + 1);
    } finally {
      getShoppingCheck.mockReset().mockResolvedValue(null);
    }
  });

  it('points a page without fan-outs to Sources, where its prompts are added', async () => {
    getDraftSources.mockResolvedValue({
      data: {
        prompts: [],
        fanouts: [],
        citedPages: [],
        gscQueries: [],
        brandDomains: [],
        competitorDomains: [],
      },
      choices: [],
    });
    getContentDraft.mockResolvedValue(draft({ sourceUrl: 'https://acme.example.com/pricing' }));
    window.innerWidth = 1440;
    await renderPage();

    const add = [...panel()!.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Add prompts',
    )!;
    expect(add.title).toBe(
      "No fan-outs yet: they come from the page's prompts. Add its prompts in Sources.",
    );
    await act(async () => add.click());
    const selected = [...panel()!.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (el) => el.getAttribute('aria-selected') === 'true',
    );
    expect(selected!.textContent).toBe('Sources');
  });

  it('keeps "No fan-outs" for a draft with prompts whose answers ran no searches', async () => {
    getDraftSources.mockResolvedValue({
      data: {
        prompts: [
          {
            id: 'p1',
            text: 'Best CRM?',
            inDraft: true,
            citesPage: false,
            answers: 2,
            mentioned: 0,
          },
        ],
        fanouts: [],
        citedPages: [],
        gscQueries: [],
        brandDomains: [],
        competitorDomains: [],
      },
      choices: [],
    });
    getContentDraft.mockResolvedValue(draft({ sourceUrl: 'https://acme.example.com/pricing' }));
    window.innerWidth = 1440;
    await renderPage();

    expect(
      [...panel()!.querySelectorAll('button')].some((b) => b.textContent === 'Add prompts'),
    ).toBe(false);
    expect(panel()!.textContent).toContain('No fan-outs');
  });

  it('opens Sources only when its tab is picked, and reads Impact only when it is', async () => {
    getDraftSources.mockResolvedValue({
      data: {
        prompts: [],
        fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
        citedPages: [],
        gscQueries: [],
        brandDomains: [],
        competitorDomains: [],
      },
      choices: [],
    });
    getContentDraft.mockResolvedValue(draft({ sourceUrl: 'https://acme.example.com/pricing' }));
    window.innerWidth = 1440;
    await renderPage();
    // The editor reads the sources once on opening; the tab itself isn't there yet.
    expect(getDraftSources).toHaveBeenCalledTimes(1);
    expect(panel()!.textContent).not.toContain('pipeline forecasting');

    // The tab counts the sources in use, from the editor's one read.
    const tab = [...panel()!.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (el) => tabName(el) === 'Sources',
    )!;
    expect(tab.querySelector('[aria-hidden]')!.textContent).toBe('1');
    expect(tab.querySelector('.sr-only')!.textContent).toBe('1 source in use');
    await pickTab('Sources');
    // The tab shows the editor's one read: nothing is read again.
    expect(getDraftSources).toHaveBeenCalledTimes(1);
    // The draft's H1 carries the fan-out's words.
    expect(panel()!.textContent).toContain('pipeline forecasting');
    expect(panel()!.textContent).toContain('H1');
    expect(getContentImpact).not.toHaveBeenCalled();
  });

  // Item 12 of the editor round: the brief built, the agent works from it.
  it('hands a page in review to the agent from its brief, and waits for it', async () => {
    getDraftBrief.mockResolvedValue({
      brief: {
        goal: 'Win forecasting searches',
        audience: 'Sales leaders',
        outline: [
          {
            heading: 'How pipeline forecasting works',
            keyPoints: [],
            fanout: null,
            platform: null,
          },
        ],
        keywords: [],
        origin: 'rebuild',
        builtAt: '2026-10-21T10:00:00Z',
        builtFrom: { prompts: 0, fanouts: 1, pages: 0, queries: 0 },
      },
    });
    getContentDraft.mockResolvedValue(draft({ status: 'in_review' }));
    window.innerWidth = 1440;
    await renderPage();
    await pickTab('Brief');

    await act(async () => button('Suggest changes from brief')!.click());
    await act(async () => button('Start the agent')!.click());
    await act(async () => {});
    expect(startAgentWriting).toHaveBeenCalledWith(
      'd1',
      'b1',
      expect.objectContaining({ textRules: [], locked: [] }),
    );
    expect(container.querySelector('[role="status"]')!.textContent).toContain(
      'Content Agent is working on this page',
    );
  });

  it('rebuilds the brief from Sources and opens it', async () => {
    getDraftSources.mockResolvedValue({
      data: {
        prompts: [],
        fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
        citedPages: [],
        gscQueries: [],
        brandDomains: [],
        competitorDomains: [],
      },
      choices: [],
    });
    rebuildDraftBrief.mockResolvedValue({
      brief: {
        goal: 'Win forecasting searches',
        audience: 'Sales leaders',
        outline: [
          {
            heading: 'How pipeline forecasting works',
            keyPoints: [],
            fanout: 'pipeline forecasting',
            platform: 'copilot-web',
          },
        ],
        keywords: ['forecast accuracy', 'pipeline'],
        origin: 'rebuild',
        builtAt: '2026-10-21T10:00:00Z',
        builtFrom: { prompts: 0, fanouts: 1, pages: 0, queries: 0 },
      },
    });
    getContentDraft.mockResolvedValue(draft({ sourceUrl: 'https://acme.example.com/pricing' }));
    window.innerWidth = 1440;
    await renderPage();

    expect([...panel()!.querySelectorAll('[role="tab"]')].map(tabName)).toEqual([
      'Instructions',
      'Sources',
      'Live page',
    ]);
    // Brief first, then Rules: what to write, then how.
    expect([...panel()!.querySelectorAll('[role="radio"]')].map((el) => el.textContent)).toEqual([
      'Brief',
      expect.stringMatching(/^Rules\d+ open$/),
    ]);
    await pickTab('Sources');
    await act(async () => button('Rebuild with selection')!.click());

    expect(rebuildDraftBrief).toHaveBeenCalledWith(
      'd1',
      'b1',
      {
        promptIds: [],
        fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'] }],
        pages: [],
        queries: [],
        headings: [],
        length: 3000,
      },
      // The rules in effect, as the agent reads them.
      expect.any(Array),
    );
    const sent = (rebuildDraftBrief.mock.calls[0][3] as { key: string; name: string }[]).map(
      (rule) => rule.key,
    );
    expect(sent).toContain('length');
    // Not the editor's own (one H1), nor the brief's own keywords: a rebuild writes them anew.
    for (const key of ['oneH1', 'feedMatch', 'keywords']) expect(sent).not.toContain(key);
    expect(toast.success).toHaveBeenCalledWith('Brief rebuilt from 1 source');
    expect(selectedTab()).toBe('Instructions');
    expect(selectedSegment()).toBe('Brief');
    expect(panel()!.textContent).toContain('How pipeline forecasting works');
    expect(panel()!.textContent).toContain('Win forecasting searches');

    // The rules check against the brief just rebuilt, without a reload.
    await pickTab('Rules');
    expect(
      [...panel()!.querySelectorAll<HTMLInputElement>('input')].map((input) => input.value),
    ).toContain('forecast accuracy, pipeline');
  });

  it('shows the agent working while the brief rebuilds, and a stopped rebuild changes nothing', async () => {
    getDraftSources.mockResolvedValue({
      data: {
        prompts: [],
        fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
        citedPages: [],
        gscQueries: [],
        brandDomains: [],
        competitorDomains: [],
      },
      choices: [],
    });
    let answer: (value: { error: 'stopped' }) => void = () => {};
    rebuildDraftBrief.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    getContentDraft.mockResolvedValue(draft({ sourceUrl: 'https://acme.example.com/pricing' }));
    window.innerWidth = 1440;
    await renderPage();
    await pickTab('Sources');
    await act(async () => button('Rebuild with selection')!.click());
    const card = () => container.querySelector('[role="region"][aria-label="Agent suggestions"]');
    expect(card()!.getAttribute('aria-busy')).toBe('true');

    await act(async () => answer({ error: 'stopped' }));
    expect(toast).toHaveBeenCalledWith('Stopped · nothing was changed');
    expect(toast.error).not.toHaveBeenCalled();
    expect(card()).toBeNull();
  });

  it('stops showing the agent at work when the panel closes mid-rebuild', async () => {
    getDraftSources.mockResolvedValue({
      data: {
        prompts: [],
        fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
        citedPages: [],
        gscQueries: [],
        brandDomains: [],
        competitorDomains: [],
      },
      choices: [],
    });
    rebuildDraftBrief.mockReturnValue(new Promise(() => {}));
    getContentDraft.mockResolvedValue(draft({ sourceUrl: 'https://acme.example.com/pricing' }));
    window.innerWidth = 1440;
    await renderPage();
    await pickTab('Sources');
    await act(async () => button('Rebuild with selection')!.click());
    const card = () => container.querySelector('[role="region"][aria-label="Agent suggestions"]');
    expect(card()).not.toBeNull();

    // The rebuild is the panel's: once it's gone, nothing here waits on it.
    await act(async () => button('Hide side panel')!.click());
    expect(card()).toBeNull();
  });

  it('says under Run Agent which sources the agent writes from, live as Sources changes them', async () => {
    getDraftSources.mockResolvedValue({
      data: {
        prompts: [],
        fanouts: [
          { query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 },
          { query: 'forecast accuracy tips', platforms: ['chatgpt'], searched: 1 },
        ],
        citedPages: [],
        gscQueries: [],
        brandDomains: [],
        competitorDomains: [],
      },
      choices: [],
    });
    setDraftSourceIncluded.mockResolvedValue(undefined);
    getContentDraft.mockResolvedValue(draft());
    window.innerWidth = 1440;
    await renderPage();

    const line = () =>
      [...panel()!.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Uses your data'));
    expect(line()!.textContent).toBe(
      'Uses your data: 0 prompts · 2 fan-outs · 0 cited pages · 0 Search Console queries · Edit sources',
    );
    // Edit sources opens them.
    await act(async () => button('Edit sources')!.click());
    expect(selectedTab()).toBe('Sources');
    // Turning one off lowers the count under Run Agent at once.
    const box = panel()!.querySelector<HTMLElement>(
      '[role="checkbox"][aria-label="Use pipeline forecasting"]',
    )!;
    await act(async () => box.click());
    expect(setDraftSourceIncluded).toHaveBeenCalledWith('d1', {
      kind: 'fanout',
      ref: 'pipeline forecasting',
      included: false,
    });
    await pickTab('Rules');
    expect(line()!.textContent).toContain('· 1 fan-out ·');
    // Brief says the same under its card.
    await pickTab('Brief');
    expect(
      [...panel()!.querySelectorAll('p')].filter((p) =>
        p.textContent?.startsWith('Uses your data'),
      ),
    ).toHaveLength(2);
  });

  it('says nothing of the data while the sources can’t be read', async () => {
    // The default read fails (null): no line, no count on the tab.
    getContentDraft.mockResolvedValue(draft());
    window.innerWidth = 1440;
    await renderPage();
    expect(panel()!.textContent).not.toContain('Uses your data');
    expect(panel()!.textContent).not.toContain('No sources kept yet');
    expect(panel()!.querySelector('[role="tab"] [title]')).toBeNull();
  });

  it('says when the agent last wrote from the sources: a page it wrote, not a run that failed', async () => {
    getDraftSources.mockResolvedValue({
      data: {
        prompts: [],
        fanouts: [],
        citedPages: [],
        gscQueries: [],
        brandDomains: [],
        competitorDomains: [],
      },
      choices: [],
    });
    const wrote = new Date(Date.now() - 2 * 60_000).toISOString();
    getContentDraft.mockResolvedValue(draft({ agentState: null, agentSince: wrote }));
    window.innerWidth = 1440;
    await renderPage();
    await pickTab('Sources');
    expect(panel()!.textContent).toContain('Last used by Content Agent · 2 minutes ago');

    act(() => root.unmount());
    root = createRoot(container);
    getContentDraft.mockResolvedValue(draft({ agentState: 'failed', agentSince: wrote }));
    await renderPage();
    await pickTab('Sources');
    expect(panel()!.textContent).toContain('Not used by Content Agent yet');
  });

  it('holds the rules chip’s count until the rule set and the fan-outs are read', async () => {
    getContentDraft.mockResolvedValue(draft());
    getDraftSources.mockReturnValue(new Promise(() => {}));
    await renderPage();
    // 8 of 12 then 11 of 15 on first paint (editor test 2026-10-25): no count until it stands.
    const chip = container.querySelector<HTMLButtonElement>('header button[aria-label^="Rules "]')!;
    expect(chip.getAttribute('aria-label')).toBe('Rules · reading');
  });

  it('shows how many rules the page meets, and opens them from the header', async () => {
    getContentDraft.mockResolvedValue(
      draft({
        pageType: 'blog_post',
        bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams trust it in 2026.</p>',
      }),
    );
    window.innerWidth = 1024;
    await renderPage();
    expect(panel()).toBeNull();

    const chip = container.querySelector<HTMLButtonElement>('header button[aria-label^="Rules "]')!;
    const [met, total] = chip
      .getAttribute('aria-label')!
      .replace('Rules ', '')
      .replace(' met', '')
      .split('/')
      .map(Number);
    expect(total).toBeGreaterThan(met);

    await act(async () => chip.click());
    expect(selectedTab()).toBe('Instructions');
    expect(selectedSegment()).toBe('Rules');
    // The open rules, on the tab and on the segment.
    expect(panel()!.querySelector('[role="tab"] .sr-only')?.textContent).toBe(
      `${total - met} rules open`,
    );
    expect(panel()!.textContent).toContain(`${met}/${total} rules met`);

    // Turning a rule off for this draft saves it and takes it out of the count.
    const sentence = panel()!.querySelector<HTMLElement>(
      '[role="switch"][aria-label="Max sentence length: on or off"]',
    )!;
    await act(async () => sentence.click());
    expect(saveDraftRules).toHaveBeenCalledWith('d1', {
      set: null,
      source: 'default',
      overrides: { sentence: { on: false } },
      textRules: [],
    });
    expect(chip.getAttribute('aria-label')).toBe(`Rules ${met - 1}/${total - 1} met`);
    expect(toast).toHaveBeenCalledWith('Rule updated for this draft');
  });

  it('saves rule changes one at a time, the latest last, and says so once', async () => {
    getContentDraft.mockResolvedValue(draft({ pageType: 'blog_post' }));
    let finish: () => void = () => {};
    saveDraftRules.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    window.innerWidth = 1024;
    await renderPage();
    const chip = container.querySelector<HTMLButtonElement>('header button[aria-label^="Rules "]')!;
    await act(async () => chip.click());
    const toggle = (label: string) =>
      act(async () =>
        panel()!
          .querySelector<HTMLElement>(`[role="switch"][aria-label="${label}: on or off"]`)!
          .click(),
      );

    await toggle('Max sentence length');
    await toggle('FAQ block');
    await toggle('Max sentence length');
    // The first save is still under way: the others wait.
    expect(saveDraftRules).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await act(async () => {});
    // Then only the latest goes, holding every change.
    expect(saveDraftRules).toHaveBeenCalledTimes(2);
    expect(saveDraftRules.mock.calls[1][1].overrides).toEqual({
      sentence: { on: true },
      faq: { on: false },
    });
    expect(
      vi.mocked(toast).mock.calls.filter(([m]) => m === 'Rule updated for this draft'),
    ).toHaveLength(1);
  });

  it('says when the rules are too long to save, rather than failing the save', async () => {
    // 40 rules of 300 characters in a script of 3 bytes each: past the 32 KB check.
    const textRules = Array.from({ length: 40 }, (_, i) => ({
      id: `r${i}`,
      text: '日'.repeat(300),
      on: true,
    }));
    getContentDraft.mockResolvedValue(
      draft({
        pageType: 'blog_post',
        rules: { set: null, source: 'default', overrides: {}, textRules },
      }),
    );
    window.innerWidth = 1024;
    await renderPage();
    const chip = container.querySelector<HTMLButtonElement>('header button[aria-label^="Rules "]')!;
    await act(async () => chip.click());
    await act(async () =>
      panel()!
        .querySelector<HTMLElement>('[role="switch"][aria-label="Max sentence length: on or off"]')!
        .click(),
    );
    expect(saveDraftRules).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      'These rules are too long to save. Shorten or remove a rule first.',
    );
  });

  it('sets the Language rule from the brand’s language', async () => {
    brandState.brands = [{ id: 'b1', language: 'tr' } as never, { id: 'b2' }];
    try {
      getContentDraft.mockResolvedValue(draft({ pageType: 'blog_post' }));
      window.innerWidth = 1024;
      await renderPage();
      const chip = container.querySelector<HTMLButtonElement>(
        'header button[aria-label^="Rules "]',
      )!;
      await act(async () => chip.click());
      const values = [...panel()!.querySelectorAll<HTMLInputElement>('input')].map((i) => i.value);
      expect(values).toContain('Turkish');
      expect(values).not.toContain('English (US)');
    } finally {
      brandState.brands = [{ id: 'b1' }, { id: 'b2' }];
    }
  });

  describe('Quality (CE-036/039)', () => {
    const readable = draft({
      bodyHtml:
        '<h1>How do small teams forecast pipeline?</h1>' +
        '<p>Small teams forecast pipeline by looking at the deals they can close this month. They count each deal once and check it every week.</p>' +
        '<h2>Start with the deals you trust</h2>' +
        '<p>Pick the deals with a clear next step. Leave out the ones that went quiet. Write down the date you expect each one to close.</p>' +
        '<h2>Check the numbers every week</h2>' +
        '<p>Look at the list on the same day each week. Move a deal out when it slips. Add new deals only when the buyer has agreed to a date.</p>',
    });
    afterEach(() => {
      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
      vi.useRealTimers();
    });

    it('asks the API nothing by itself while the workspace is read-only (plan not active)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        getContentDraft.mockResolvedValue(
          draft({
            bodyHtml:
              readable.bodyHtml + '<p>See <a href="https://example.com/guide">the guide</a>.</p>',
          }),
        );
        await act(async () => {
          root.render(
            <NextIntlClientProvider locale="en" messages={messages}>
              <PlanProvider
                planId="starter"
                subscriptionActive={false}
                subscriptionStatus="canceled"
              >
                <RoleProvider role="admin">
                  <UpgradeDialogProvider>
                    <ContentEditorPage />
                  </UpgradeDialogProvider>
                </RoleProvider>
              </PlanProvider>
            </NextIntlClientProvider>,
          );
        });
        await act(async () => {});
        await act(async () => void (await vi.advanceTimersByTimeAsync(CLAIMS_EVERY_MS + 3_000)));
        // The page opens with what is stored; no link, claim or proof read is asked for.
        expect(container.querySelector('.ProseMirror')).not.toBeNull();
        expect(readDraftPage).not.toHaveBeenCalled();
        expect(checkDraftClaims).not.toHaveBeenCalled();
        expect(checkDraftLinks).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('weighs the checks by the page type in phase 3, and follows a type changed from Quality (CE-052)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '3';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'admin' },
      });
      // A feature page goes out under the brand: no author asked for.
      getContentDraft.mockResolvedValue(readable);
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const line = () =>
        [...panel()!.querySelectorAll('p')].find((p) =>
          p.textContent?.startsWith('Checks and weights for'),
        )!;
      expect(line().textContent).toContain(
        'Checks and weights for Feature page: your own screenshots',
      );
      const todos = () =>
        [...panel()!.querySelectorAll('[aria-label="Your to-dos"] li')].map(
          (li) => li.textContent?.split(' · ')[0],
        );
      expect(todos()).not.toContain('Add an author for the page');

      // Change opens the header's menu; a blog post asks for its author.
      await act(async () => line().querySelector('button')!.click());
      const blog = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (item) => item.textContent?.startsWith('Blog post'),
      )!;
      await act(async () => blog.click());
      expect(setContentDraftPageType).toHaveBeenCalledWith('d1', 'blog_post');
      expect(line().textContent).toContain('Checks and weights for Blog post: an author');
      expect(todos()).toContain('Add an author for the page');
    });

    it('asks a product page for its type rules and its shipping and returns in phase 3 (CE-052)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '3';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'admin' },
      });
      getContentDraft.mockResolvedValue({
        ...readable,
        pageType: 'product_page',
        siteType: 'ecommerce',
      });
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const text = panel()!.textContent!;
      expect(text).toContain('Checks and weights for Product page');
      // The Rules tab's specs table, read from the page; no sizes, so no fit questions.
      expect(text).toMatch(/1 page type rule not met: Specs table/);
      expect(text).toContain('Say how shipping and returns work');
      expect(text).not.toContain('Add an author for the page');
      // No product feed yet (CE-053): the price and stock aren't checked, and it says so.
      expect(getCatalogMatch).toHaveBeenCalledWith('d1', readable.title);
      expect(text).toContain("Price and stock aren't checked: no product feed is connected");
    });

    it('leaves a date in the person’s words alone, and replaces only its own old line (#1495 review)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '3';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'admin' },
      });
      const byline = 'By Jane Doe · Updated March 2023';
      const answer = 'We tested 9 CRMs in 2024; HubSpot fits small teams best.';
      getContentDraft.mockResolvedValue({
        ...readable,
        pageType: 'comparison',
        bodyHtml:
          `<h1>Best CRMs for small teams</h1><p>${byline}</p><p>${answer}</p>` +
          '<h2>How we picked</h2><p>We set each one up with a real pipeline and a team of three.</p>' +
          '<p>Last checked: May 2021</p>',
      });
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const row = [...panel()!.querySelectorAll('[aria-label="Your to-dos"] li')].find((li) =>
        li.textContent?.startsWith('Update when you last checked'),
      )!;
      expect(row.textContent).toContain('Add line replaces it with this month');
      await act(async () =>
        [...row.querySelectorAll('button')].find((b) => b.textContent === 'Add line')!.click(),
      );
      const { state } = (
        container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }
      ).editor;
      const blocks: string[] = [];
      state.doc.forEach((node) => void blocks.push(node.textContent));
      // The byline and the answer stay; the old line is this month's now, once.
      expect(blocks).toContain(byline);
      expect(blocks).toContain(answer);
      expect(blocks.filter((text) => text.startsWith('Last checked:'))).toEqual([
        expect.stringMatching(/^Last checked: \w+ \d{4}$/),
      ]);
      expect(blocks.at(-1)).not.toBe('Last checked: May 2021');
    });

    it('asks a comparison to show when it was last checked, and Add line puts it under the answer (CE-052)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '3';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'admin' },
      });
      getContentDraft.mockResolvedValue({ ...readable, pageType: 'comparison' });
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const row = () =>
        [...panel()!.querySelectorAll('[aria-label="Your to-dos"] li')].find((li) =>
          li.textContent?.startsWith('Show when you last checked'),
        )!;
      expect(row().textContent).toContain('Add line puts this month');
      await act(async () =>
        [...row().querySelectorAll('button')].find((b) => b.textContent === 'Add line')!.click(),
      );
      const { state } = (
        container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }
      ).editor;
      // Under the opening paragraph, the answer first.
      expect(state.doc.child(2).textContent).toMatch(/^Last checked: \w+ \d{4}$/);
      await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
      expect(row().textContent).toContain('The page shows when it was last checked');
    });

    it('replaces a stale check date with this month’s rather than adding a second (CE-052)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '3';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'admin' },
      });
      getContentDraft.mockResolvedValue({
        ...readable,
        pageType: 'comparison',
        bodyHtml: readable.bodyHtml.replace('</h1>', '</h1><p>Last checked: May 2021</p>'),
      });
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const row = [...panel()!.querySelectorAll('[aria-label="Your to-dos"] li')].find((li) =>
        li.textContent?.startsWith('Update when you last checked'),
      )!;
      await act(async () =>
        [...row.querySelectorAll('button')].find((b) => b.textContent === 'Add line')!.click(),
      );
      const { state } = (
        container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }
      ).editor;
      const texts: string[] = [];
      state.doc.forEach((node) => texts.push(node.textContent));
      expect(texts.filter((t) => t.startsWith('Last checked:'))).toHaveLength(1);
      expect(texts[1]).toMatch(/^Last checked: \w+ \d{4}$/);
      expect(texts[1]).not.toContain('2021');
    });

    it('shows nothing of Quality until its first phase is live', async () => {
      getContentDraft.mockResolvedValue(readable);
      window.innerWidth = 1440;
      await renderPage();
      expect(container.querySelector('header')!.textContent).not.toContain('Quality');
      expect(
        [...panel()!.querySelectorAll('[role="radio"]')].map((el) => el.textContent),
      ).not.toContainEqual(expect.stringContaining('Quality'));
    });

    it('saves the author the site names as confirmed, and puts it back when the save fails (00271)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'admin' },
      });
      getContentDraft.mockResolvedValue(readable);
      window.innerWidth = 1440;
      await renderPage();
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const box = () => panel()!.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
      expect(box().getAttribute('aria-checked')).toBe('false');
      await act(async () => box().click());
      expect(confirmDraftAuthor).toHaveBeenCalledWith(readable.id, 'real', true);
      expect(box().getAttribute('aria-checked')).toBe('true');
      expect(panel()!.textContent).toContain('Who stands behind the page60');

      vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        confirmDraftAuthor.mockRejectedValueOnce(new Error('offline'));
        await act(async () => box().click());
        expect(toast.error).toHaveBeenCalledWith("Couldn't save that. Try again.");
        expect(box().getAttribute('aria-checked')).toBe('true');

        // Unticking the author unticks the profile too: a failed save puts both back.
        const profile = () => panel()!.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[1]!;
        await act(async () => profile().click());
        expect(profile().getAttribute('aria-checked')).toBe('true');
        confirmDraftAuthor.mockRejectedValueOnce(new Error('offline'));
        await act(async () => box().click());
        expect(box().getAttribute('aria-checked')).toBe('true');
        expect(profile().getAttribute('aria-checked')).toBe('true');

        // One save at a time: the boxes wait for it.
        let saved!: () => void;
        confirmDraftAuthor.mockReturnValueOnce(new Promise<void>((resolve) => (saved = resolve)));
        await act(async () => profile().click());
        expect(profile().getAttribute('aria-checked')).toBe('false');
        expect(box().disabled).toBe(true);
        expect(profile().disabled).toBe(true);
        await act(async () => saved());
        expect(profile().disabled).toBe(false);
      } finally {
        vi.mocked(console.error).mockRestore();
      }
    });

    it('scores the page as written, in the header and Instructions › Quality', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      getContentDraft.mockResolvedValue(readable);
      window.innerWidth = 1440;
      await renderPage();
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      // Its band is read out too, not only shown in colour.
      expect(chip.textContent).toMatch(/^Quality \d+ · (Strong|Can improve|Needs work)$/);
      await act(async () => chip.click());
      expect(selectedSegment()).toMatch(/^Quality\d+ · (Strong|Can improve|Needs work)$/);
      expect(panel()!.textContent).toContain('Readability');
      expect(panel()!.textContent).toContain('Not a Google score.');
    });

    it('says it is reading until the page’s reads are in, then shows one score, not the partial ones', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      let authorsIn!: (read: unknown) => void;
      getContentAuthors.mockReturnValue(new Promise((resolve) => (authorsIn = resolve)));
      getContentDraft.mockResolvedValue(readable);
      window.innerWidth = 1440;
      await renderPage();
      const chip = () =>
        [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
          b.textContent?.startsWith('Quality'),
        );
      // Readability alone would say more than the page is worth: no number yet.
      expect(chip()?.textContent).toBe('Quality · reading…');
      await act(async () =>
        authorsIn({
          authors: [],
          brands: [{ id: 'b1', name: 'Acme' }],
          me: { id: 'u1', role: 'admin' },
        }),
      );
      expect(chip()?.textContent).toMatch(/^Quality \d+ · (Strong|Can improve|Needs work)$/);
      const score = chip()!.textContent!.match(/\d+/)![0];
      await act(async () => chip()!.click());
      expect(selectedSegment()).toContain(`Quality${score}`);
    });

    it('shows the score once the authors fail to load too', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        getContentAuthors.mockRejectedValue(new Error('offline'));
        getContentDraft.mockResolvedValue(readable);
        window.innerWidth = 1440;
        await renderPage();
        const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
          b.textContent?.startsWith('Quality'),
        );
        expect(chip?.textContent).toMatch(/^Quality \d+/);
      } finally {
        vi.mocked(console.error).mockRestore();
      }
    });

    it("asks for Your input in its second phase, and Add opens it at Brief's top (CE-048)", async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'admin' },
      });
      const experience = 'We tested weekly forecasts with twelve small sales teams.';
      getDraftInputs.mockResolvedValue({ experience, data: [], getcitoData: [], quotes: [] });
      getContentDraft.mockResolvedValue(readable);
      window.innerWidth = 1440;
      await renderPage();
      // In phase 2 E-E-A-T waits for the page's read (its visual proof), after the save.
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      expect(getDraftInputs).toHaveBeenCalledWith(readable.id);
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const row = [...panel()!.querySelectorAll('[aria-label="Your to-dos"] li')].find((li) =>
        li.textContent?.startsWith('Add your own experience'),
      )!;
      // Given, but the page doesn't use it yet.
      expect(row.textContent).toContain("It's in Your input, but the page doesn't use it yet");
      expect(
        [...panel()!.querySelectorAll('[aria-label="Your to-dos"] li')].map(
          (li) => li.textContent?.split(' · ')[0],
        ),
      ).toEqual([
        'Add an author for the page',
        "Complete the author's profile",
        'Add your own experience',
        'Add your own data',
        "Add an expert's quote",
      ]);

      await act(async () => row.querySelector('button')!.click());
      expect(selectedSegment()).toBe('Brief');
      const box = panel()!.querySelector<HTMLTextAreaElement>('#your-experience')!;
      expect(box.value).toBe(experience);
      expect(panel()!.textContent).toContain('Your input · used only as you write it');

      // A change is kept as the whole input.
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          box,
          `${experience} Forecasts missed by less.`,
        );
        box.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      });
      expect(saveDraftInputs).toHaveBeenCalledWith(readable.id, {
        experience: `${experience} Forecasts missed by less.`,
        data: [],
        getcitoData: [],
        quotes: [],
      });
    });

    it('scores without Your input when it can’t be read, and Brief offers to read it again', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        getContentAuthors.mockResolvedValue({
          authors: [],
          brands: [{ id: 'b1', name: 'Acme' }],
          me: { id: 'u1', role: 'admin' },
        });
        getDraftInputs.mockRejectedValueOnce(new Error('offline'));
        getContentDraft.mockResolvedValue(readable);
        window.innerWidth = 1440;
        await renderPage();
        // The claims are read after a save's pause: no score until they are.
        expect(qualityChip()?.textContent).toBe('Quality · reading…');
        await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
        expect(qualityChip()?.textContent).toMatch(/^Quality \d+/);
        await pickTab('Brief');
        const retry = [...panel()!.querySelectorAll('button')].find(
          (b) => b.textContent === 'Try again',
        )!;
        expect(retry.parentElement!.textContent).toBe("Couldn't read your input.Try again");
        await act(async () => retry.click());
        expect(getDraftInputs).toHaveBeenCalledTimes(2);
        expect(panel()!.querySelector('#your-experience')).not.toBeNull();
      } finally {
        vi.mocked(console.error).mockRestore();
        vi.useRealTimers();
      }
    });

    it('holds the score until the brand’s facts are read: Trust checks the page against them', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        getContentAuthors.mockResolvedValue({
          authors: [],
          brands: [{ id: 'b1', name: 'Acme' }],
          me: { id: 'u1', role: 'admin' },
        });
        let factsIn: (value: unknown) => void = () => {};
        getBrandFacts.mockReturnValue(new Promise((resolve) => (factsIn = resolve)));
        getContentDraft.mockResolvedValue(readable);
        window.innerWidth = 1440;
        await renderPage();
        await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
        // Every other read is in: the facts still hold it.
        expect(qualityChip()?.textContent).toBe('Quality · reading…');
        await act(async () =>
          factsIn({
            facts: [],
            pages: [],
            checkedAt: null,
            recheckAt: null,
            paused: false,
            noDomain: false,
          }),
        );
        expect(qualityChip()?.textContent).toMatch(
          /^Quality \d+ · (Strong|Can improve|Needs work)$/,
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('holds the score while an edit waits for its save: phase 2 reads the page as saved', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        getContentAuthors.mockResolvedValue({
          authors: [],
          brands: [{ id: 'b1', name: 'Acme' }],
          me: { id: 'u1', role: 'admin' },
        });
        getContentDraft.mockResolvedValue(readable);
        saveContentDraft.mockResolvedValue({
          ok: true,
          updatedAt: '2026-10-20T10:01:00Z',
          bodyHash: 'h1',
        });
        window.innerWidth = 1440;
        await renderPage();
        await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
        expect(qualityChip()?.textContent).not.toContain('updating');
        const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
          .editor;
        await act(async () => {
          editor.commands.insertContentAt(
            editor.state.doc.content.size,
            '<p>Forecasts missed by less each quarter.</p>',
          );
        });
        // Not saved yet: the claims read is the page's before the edit.
        expect(qualityChip()?.textContent).toContain('updating as the page is read');
        await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
        expect(saveContentDraft).toHaveBeenCalledTimes(1);
        // Saved: the score waits for its claims, asked a few seconds later.
        expect(qualityChip()?.textContent).toContain('updating as the page is read');
        await act(async () => void (await vi.advanceTimersByTimeAsync(CLAIMS_EVERY_MS)));
        expect(checkDraftClaims).toHaveBeenCalledTimes(2);
        expect(qualityChip()?.textContent).not.toContain('updating');
      } finally {
        vi.useRealTimers();
      }
    });

    it('holds the score until the page as saved is read for proof, then settles once (review, #1468)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        getContentAuthors.mockResolvedValue({
          authors: [],
          brands: [{ id: 'b1', name: 'Acme' }],
          me: { id: 'u1', role: 'admin' },
        });
        const read = {
          spots: [],
          proofs: [],
          regulated: null,
          pending: false,
          limited: false,
          paused: false,
        };
        let pageIn: (value: unknown) => void = () => {};
        readDraftPage
          .mockResolvedValueOnce(read)
          .mockReturnValueOnce(new Promise((resolve) => (pageIn = resolve)));
        getContentDraft.mockResolvedValue(readable);
        saveContentDraft.mockResolvedValue({
          ok: true,
          updatedAt: '2026-10-20T10:01:00Z',
          bodyHash: 'h1',
        });
        window.innerWidth = 1440;
        await renderPage();
        await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
        expect(readDraftPage).toHaveBeenCalledTimes(1);
        expect(qualityChip()?.textContent).not.toContain('updating');
        const shown = qualityChip()?.textContent;
        const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
          .editor;
        await act(async () => {
          editor.commands.insertContentAt(
            editor.state.doc.content.size,
            '<p>Forecasts missed by less each quarter.</p>',
          );
        });
        await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
        expect(saveContentDraft).toHaveBeenCalledTimes(1);
        // The claims are in; the page's read for the save waits for the API's minute.
        await act(async () => void (await vi.advanceTimersByTimeAsync(CLAIMS_EVERY_MS)));
        expect(checkDraftClaims).toHaveBeenCalledTimes(2);
        expect(qualityChip()?.textContent).toContain('updating as the page is read');
        await act(
          async () =>
            void (await vi.advanceTimersByTimeAsync(PROOF_READ_EVERY_MS + PROOF_READ_SLACK_MS)),
        );
        expect(readDraftPage).toHaveBeenCalledTimes(2);
        // Asked, not answered: the last settled score stays.
        expect(qualityChip()?.textContent).toContain(shown!.replace(/ ·.*$/, ''));
        expect(qualityChip()?.textContent).toContain('updating as the page is read');
        await act(async () => pageIn(read));
        expect(qualityChip()?.textContent).not.toContain('updating');
      } finally {
        vi.useRealTimers();
      }
    });

    /** The draft above, its Language rule changed for this draft. */
    const inLanguage = (language: { on?: boolean; value?: string }) => ({
      ...readable,
      rules: { set: null, source: 'default' as const, overrides: { language }, textRules: [] },
    });
    const qualityChip = () =>
      [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      );

    it('reads the page in its Language rule’s language, not the brand’s', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      // The brand writes in Japanese; this draft is in English, and is scored.
      brandState.brands = [{ id: 'b1', language: 'ja' } as never, { id: 'b2' }];
      try {
        getContentDraft.mockResolvedValue(inLanguage({ value: 'English (US)' }));
        window.innerWidth = 1440;
        await renderPage();
        expect(qualityChip()?.textContent).toMatch(/^Quality \d+/);
      } finally {
        brandState.brands = [{ id: 'b1' }, { id: 'b2' }];
      }
    });

    it('reads the brand’s language with the rule off, and says when it can’t read it yet', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      brandState.brands = [{ id: 'b1', language: 'ja' } as never, { id: 'b2' }];
      try {
        getContentDraft.mockResolvedValue(inLanguage({ on: false, value: 'English (US)' }));
        window.innerWidth = 1440;
        await renderPage();
        // Japanese has no spaces between words: no score, and no chip.
        expect(qualityChip()).toBeUndefined();
        const segment = [...panel()!.querySelectorAll<HTMLElement>('[role="radio"]')].find((el) =>
          el.textContent?.startsWith('Quality'),
        )!;
        await act(async () => segment.click());
        expect(panel()!.textContent).toContain("Readability isn't read for this language yet.");
      } finally {
        brandState.brands = [{ id: 'b1' }, { id: 'b2' }];
      }
    });

    it('marks the passage Show goes to for a moment, a second Show starting it again', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = vi.fn();
      try {
        const long = `Teams ${Array.from({ length: 39 }, () => 'plan').join(' ')}.`;
        getContentDraft.mockResolvedValue({
          ...readable,
          bodyHtml: `${readable.bodyHtml}<p>${long}</p>`,
        });
        window.innerWidth = 1440;
        await renderPage();
        await act(async () => qualityChip()!.click());
        const show = [...panel()!.querySelectorAll<HTMLButtonElement>('li button')].find(
          (b) => b.textContent === 'Show',
        )!;
        const marked = () => container.querySelector('.ProseMirror .ring-amber-300');

        await act(async () => show.click());
        expect(marked()!.textContent).toBe(long);
        await act(async () => vi.advanceTimersByTime(1000));
        await act(async () => show.click());
        // The first Show's timer doesn't take the second's mark away early.
        await act(async () => vi.advanceTimersByTime(500));
        expect(marked()).not.toBeNull();
        await act(async () => vi.advanceTimersByTime(700));
        expect(marked()).toBeNull();
      } finally {
        Element.prototype.scrollIntoView = original;
        vi.useRealTimers();
      }
    });
  });

  describe('Claims with no source (Quality CE-045)', () => {
    afterEach(() => {
      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
      vi.useRealTimers();
    });
    const said = 'Ledgerly is the fastest forecasting app.';
    const claimed = draft({
      bodyHtml: `<h1>Pipeline forecasting</h1><p>${said} It is easy to set up for any team.</p>`,
    });
    const redMarks = () => container.querySelectorAll('.ProseMirror .decoration-red-500');
    // Trust reads the page once the brand's domains are read, with the sources.
    beforeEach(() => {
      getDraftSources.mockResolvedValue({
        data: {
          prompts: [],
          fanouts: [],
          citedPages: [],
          gscQueries: [],
          brandDomains: ['acme.com'],
          competitorDomains: [],
        },
        choices: [],
      });
    });
    const openQuality = async () => {
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      return [...panel()!.querySelectorAll('li')].find((li) =>
        li.textContent?.includes('claim has no source'),
      )!;
    };

    it('underlines a claim the model read, and Quality offers Add source and Remove', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      checkDraftClaims.mockResolvedValue({
        blocks: [
          {
            text: `${said} It is easy to set up for any team.`,
            claims: [{ text: 'the fastest forecasting app', kind: 'superlative' }],
          },
        ],
        pending: 0,
        limited: false,
      });
      getContentDraft.mockResolvedValue(claimed);
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      // Not writing in the page: no block left for later.
      expect(checkDraftClaims).toHaveBeenCalledWith('d1', null);
      expect(redMarks()).toHaveLength(1);
      expect(redMarks()[0].textContent).toBe('the fastest forecasting app');
      expect(redMarks()[0].getAttribute('title')).toContain('No source for this claim');

      const row = await openQuality();
      expect(row.textContent).toContain('1 claim has no source');
      expect(row.textContent).toContain('AI check');
      // Add source: the claim selected, the link dialog open on it; Apply links those words.
      const add = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Add source')!;
      expect(add.getAttribute('aria-label')).toBe('Add a source to “the fastest forecasting app”');
      await act(async () => add.click());
      const field = document.querySelector<HTMLInputElement>('#content-link-href')!;
      expect(field).not.toBeNull();
      const { state } = (
        container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }
      ).editor;
      expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe(
        'the fastest forecasting app',
      );
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          field,
          'https://g2.example/forecasting',
        );
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const apply = [...document.querySelectorAll('button')].find(
        (b) => b.textContent === 'Apply',
      )!;
      await act(async () => apply.click());
      const link = container.querySelector<HTMLAnchorElement>(
        '.ProseMirror a[href="https://g2.example/forecasting"]',
      );
      expect(link?.textContent).toBe('the fastest forecasting app');
    });

    it('asks a category page to confirm its intro’s facts, kept by the facts, in phase 3 (CE-054)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '3';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const facts = ['Choose from 120+ daypacks for every trail.', 'Prices run $49–$199.'];
      // One fact confirmed before, in other words.
      getDraftConfirmations.mockResolvedValue([{ kind: 'intro_fact', key: 'intro:120+' }]);
      getContentDraft.mockResolvedValue({
        ...claimed,
        pageType: 'category_page',
        bodyHtml: `<h1>Daypacks</h1><p>${facts.join(' ')}</p><h2>All daypacks</h2><p>Packs for wet hikes.</p>`,
      });
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const row = () =>
        [...panel()!.querySelectorAll('[aria-label="Your to-dos"] li')].find((li) =>
          li.textContent?.startsWith("Confirm the intro's facts"),
        )!;
      // Only the open one is quoted.
      expect(row().textContent).toContain(`“${facts[1]}”`);
      expect(row().textContent).not.toContain(`“${facts[0]}”`);
      await act(async () =>
        [...row().querySelectorAll('button')].find((b) => b.textContent === 'Confirm')!.click(),
      );
      // One row for the facts not confirmed yet.
      expect(confirmDraftItem).toHaveBeenCalledTimes(1);
      expect(confirmDraftItem).toHaveBeenCalledWith('d1', 'intro_fact', 'intro:USD49-199');
      expect(row().textContent).toContain("You confirmed the intro's facts");
    });

    it('takes an intro confirm back when it can’t be saved (CE-054)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '3';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      confirmDraftItem.mockResolvedValue('full');
      getContentDraft.mockResolvedValue({
        ...claimed,
        pageType: 'category_page',
        bodyHtml: '<h1>Daypacks</h1><p>Choose from 120+ daypacks.</p><h2>All</h2><p>Packs.</p>',
      });
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const row = () =>
        [...panel()!.querySelectorAll('[aria-label="Your to-dos"] li')].find((li) =>
          li.textContent?.startsWith("Confirm the intro's facts"),
        )!;
      await act(async () =>
        [...row().querySelectorAll('button')].find((b) => b.textContent === 'Confirm')!.click(),
      );
      // Full: still open, Confirm there to try again.
      expect(row().textContent).not.toContain("You confirmed the intro's facts");
      expect([...row().querySelectorAll('button')].some((b) => b.textContent === 'Confirm')).toBe(
        true,
      );
      vi.mocked(console.error).mockRestore();
    });

    it('asks a feature page to confirm a customer case may be published, in phase 3 (CE-052)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '3';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const block = 'Acme cut its close time by 40% with Ledgerly in one quarter.';
      readDraftPage.mockResolvedValue({
        spots: [],
        proofs: [{ claim: 'Acme cut its close time by 40%', block, kind: 'customer_case' }],
        regulated: null,
        pending: false,
        limited: false,
        paused: false,
      });
      getContentDraft.mockResolvedValue({
        ...claimed,
        pageType: 'feature_page',
        bodyHtml: `${claimed.bodyHtml}<p>${block}</p>`,
      });
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      expect(getDraftConfirmations).toHaveBeenCalledWith('d1');
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const row = () =>
        [...panel()!.querySelectorAll('li')].find((li) =>
          li.textContent?.includes('Confirm you may publish the customer case'),
        )!;
      expect(row().textContent).toContain('only with their permission');
      await act(async () =>
        [...row().querySelectorAll('button')].find((b) => b.textContent === 'Confirm')!.click(),
      );
      expect(confirmDraftItem).toHaveBeenCalledWith(
        'd1',
        'customer_case',
        expect.stringMatching(/^case:/),
      );
      expect(row().textContent).toContain('You confirmed the customer may be named');
    });

    it("asks for the proof of the brand's own claim, and Add proof link selects it (CE-049)", async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const block = `${said} It is easy to set up for any team.`;
      checkDraftClaims.mockResolvedValue({
        blocks: [
          { text: block, claims: [{ text: 'the fastest forecasting app', kind: 'superlative' }] },
        ],
        pending: 0,
        limited: false,
      });
      readDraftPage.mockResolvedValue({
        spots: [],
        proofs: [{ claim: 'the fastest forecasting app', block, kind: 'ranking' }],
        regulated: null,
        pending: false,
        limited: false,
        paused: false,
      });
      getContentDraft.mockResolvedValue(claimed);
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      expect(readDraftPage).toHaveBeenCalledWith('d1');
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const row = [...panel()!.querySelectorAll('li')].find((li) =>
        li.textContent?.includes('Link the ranking or test behind “the fastest forecasting app”'),
      )!;
      expect(row.textContent).toContain('Link its proof, or soften the claim');
      // Its sentence is the person's to prove: not the agent's to source as well.
      expect(panel()!.textContent).not.toContain('claim has no source');
      await act(async () =>
        [...row.querySelectorAll('button')]
          .find((b) => b.textContent === 'Add proof link')!
          .click(),
      );
      expect(document.querySelector('#content-link-href')).not.toBeNull();
      const { state } = (
        container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }
      ).editor;
      expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe(
        'the fastest forecasting app',
      );
      // Linked to its proof: the row is checked, not gone.
      const field = document.querySelector<HTMLInputElement>('#content-link-href')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          field,
          'https://www.acme.com/benchmarks',
        );
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () =>
        [...document.querySelectorAll('button')].find((b) => b.textContent === 'Apply')!.click(),
      );
      // The page is read again once typing pauses.
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const done = [...panel()!.querySelectorAll('li')].find((li) =>
        li.textContent?.includes('the fastest forecasting app'),
      )!;
      expect(done.textContent).toContain('The proof is linked');
    });

    it('hands off with the customer cases’ paragraphs left as they are, in phase 3 (#1496 review)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '3';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Ledgerly' }],
        me: { id: 'u1', role: 'admin' },
      });
      const block = 'Acme cut its close time by 40% with Ledgerly in one quarter.';
      readDraftPage.mockResolvedValue({
        spots: [],
        proofs: [{ claim: 'Acme cut its close time by 40%', block, kind: 'customer_case' }],
        regulated: null,
        pending: false,
        limited: false,
        paused: false,
      });
      const long = `Teams ${Array.from({ length: 39 }, () => 'plan').join(' ')}.`;
      getContentDraft.mockResolvedValue({
        ...claimed,
        pageType: 'feature_page',
        bodyHtml: `${claimed.bodyHtml}<p>${block}</p><p>${long}</p>`,
      });
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const card = panel()!.querySelector('[aria-label="Hand it off to Content Agent"]')!;
      await act(async () =>
        [...card.querySelectorAll<HTMLButtonElement>('button')]
          .find((b) => b.textContent === 'Hand off')!
          .click(),
      );
      await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
      // The server leaves a locked passage as it is: the case's paragraph is one.
      expect(handOffDraft).toHaveBeenCalledWith(
        'd1',
        'b1',
        expect.objectContaining({ locked: expect.arrayContaining([block]) }),
      );
    });

    it("hands the page's open Quality suggestions off to the agent in one run (CE-051)", async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Ledgerly' }],
        me: { id: 'u1', role: 'admin' },
      });
      const long = `Teams ${Array.from({ length: 39 }, () => 'plan').join(' ')}.`;
      getContentDraft.mockResolvedValue({
        ...claimed,
        bodyHtml: `${claimed.bodyHtml}<p>${long}</p>`,
      });
      let answer: (value: { count: number }) => void = () => {};
      handOffDraft.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const card = panel()!.querySelector('[aria-label="Hand it off to Content Agent"]')!;
      expect(card.textContent).toContain('in one run, for you to review');
      await act(async () =>
        [...card.querySelectorAll<HTMLButtonElement>('button')]
          .find((b) => b.textContent === 'Hand off')!
          .click(),
      );
      await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
      expect(handOffDraft).toHaveBeenCalledWith(
        'd1',
        'b1',
        expect.objectContaining({
          origin: 'person',
          items: expect.arrayContaining([
            expect.objectContaining({
              key: 'readability:longSentences',
              detail: expect.stringContaining(long),
            }),
          ]),
        }),
      );
      // Its card is the one working; Rules' Run Agent isn't, and waits for it.
      expect(
        [...card.querySelectorAll('button')].find((b) => b.textContent === 'Working…'),
      ).toBeDefined();
      await pickTab('Rules');
      const others = [...panel()!.querySelectorAll('button')].filter((b) => !card.contains(b));
      expect(others.some((b) => b.textContent?.includes('Working'))).toBe(false);
      expect(others.find((b) => b.textContent === 'Fix open rules')?.disabled).toBe(true);
      expect(fixDraftRules).not.toHaveBeenCalled();
      await act(async () => answer({ count: 1 }));
      await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    });

    it('tells a hand-off how far past its Length the page is, and only then (#1552 review)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Ledgerly' }],
        me: { id: 'u1', role: 'admin' },
      });
      const long = `Teams ${Array.from({ length: 39 }, () => 'plan').join(' ')}.`;
      const handOff = async (length: string) => {
        getContentDraft.mockResolvedValue({
          ...claimed,
          bodyHtml: `${claimed.bodyHtml}<p>${long}</p>`,
          rules: {
            set: null,
            source: null,
            overrides: { length: { value: length } },
            textRules: [],
          },
        });
        window.innerWidth = 1440;
        await renderPage();
        await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
        const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
          b.textContent?.startsWith('Quality'),
        )!;
        await act(async () => chip.click());
        const card = panel()!.querySelector('[aria-label="Hand it off to Content Agent"]')!;
        await act(async () =>
          [...card.querySelectorAll<HTMLButtonElement>('button')]
            .find((b) => b.textContent === 'Hand off')!
            .click(),
        );
        await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
        return handOffDraft.mock.calls.at(-1)![2];
      };
      const again = async (length: string) => {
        await act(async () => root.unmount());
        root = createRoot(container);
        handOffDraft.mockClear();
        return handOff(length);
      };
      // A Length of 100: the page is past its band's top, 120.
      const first = await handOff('100');
      expect(first).toMatchObject({ overLength: { count: expect.any(Number), max: 120 } });
      // Its Length the page's own count: within its band, nothing said.
      expect(await again(String(first.overLength.count))).not.toHaveProperty('overLength');
      // A Length of 0 reads every page as long, at most 0: nothing said either.
      expect(await again('0')).not.toHaveProperty('overLength');
    });

    it('hands an imported page off on its own once Quality is read, once a draft, when its brand does (CE-051)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Ledgerly' }],
        me: { id: 'u1', role: 'admin' },
      });
      const long = `Teams ${Array.from({ length: 39 }, () => 'plan').join(' ')}.`;
      const imported = {
        ...claimed,
        author: 'user' as const,
        method: 'optimize' as const,
        qualityHandoff: true,
        bodyHtml: `${claimed.bodyHtml}<p>${long}</p>`,
      };
      getContentDraft.mockResolvedValue(imported);
      handOffDraft.mockResolvedValue({ error: 'already' });
      window.innerWidth = 1440;
      await renderPage();
      // Not before Quality is read.
      expect(handOffDraft).not.toHaveBeenCalled();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
      expect(readAutoHandOff).toHaveBeenCalledWith('d1', 'b1');
      expect(handOffDraft).toHaveBeenCalledTimes(1);
      expect(handOffDraft).toHaveBeenCalledWith(
        'd1',
        'b1',
        expect.objectContaining({
          origin: 'auto',
          items: expect.arrayContaining([
            expect.objectContaining({ key: 'readability:longSentences' }),
          ]),
        }),
      );
      // Another tab's run came first: nothing said.
      expect(toast.error).not.toHaveBeenCalled();
      // A brand that stopped handing off since: nothing said either.
      handOffDraft.mockClear().mockResolvedValue({ error: 'not_due' });
      act(() => root.unmount());
      root = createRoot(container);
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
      expect(handOffDraft).toHaveBeenCalledTimes(1);
      expect(toast.error).not.toHaveBeenCalled();

      // A draft that had it, or a brand that doesn't hand off: never.
      handOffDraft.mockClear();
      act(() => root.unmount());
      root = createRoot(container);
      readAutoHandOff.mockResolvedValue(true);
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      act(() => root.unmount());
      root = createRoot(container);
      readAutoHandOff.mockResolvedValue(false);
      getContentDraft.mockResolvedValue({ ...imported, qualityHandoff: false });
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      // Nor a published page.
      act(() => root.unmount());
      root = createRoot(container);
      getContentDraft.mockResolvedValue({ ...imported, status: 'published' as const });
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      expect(handOffDraft).not.toHaveBeenCalled();
    });

    it('asks a page that puts the brand forward for its disclosure, and Add line puts it under the H1 (CE-050)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const block = `${said} It is easy to set up for any team.`;
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Ledgerly' }],
        me: { id: 'u1', role: 'admin' },
      });
      readDraftPage.mockResolvedValue({
        spots: [],
        proofs: [],
        regulated: null,
        checks: {
          answerFirst: null,
          recommends: { quote: 'Ledgerly is the fastest forecasting app', block },
          disclosure: null,
          balance: null,
          how: null,
          cut: false,
          pageType: 'best_of',
        },
        pending: false,
        limited: false,
        paused: false,
      });
      getContentDraft.mockResolvedValue({
        ...claimed,
        pageType: 'best_of',
        pageTypeSource: 'user',
      });
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      await act(async () => button('Mark ready')!.click());
      const line = 'Disclosure: the product this page recommends is offered by Ledgerly.';
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain('The page recommends Ledgerly without a disclosure');
      await act(async () =>
        [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Add line')!.click(),
      );
      const { state } = (
        container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }
      ).editor;
      // Under the opening paragraph: the answer the H1 gets first stays first.
      expect(state.doc.child(0).textContent).toBe('Pipeline forecasting');
      expect(state.doc.child(1).textContent).toBe(block);
      expect(state.doc.child(2).textContent).toBe(line);
      expect(dialog.textContent).toContain('Disclosure added');
      // Opened again before the page is read (it reads the page a moment after
      // an edit): added, not offered twice.
      await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
      await act(async () =>
        [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Close')?.click(),
      );
      await act(async () => button('Mark ready')!.click());
      const again = document.querySelector('[role="dialog"]')!;
      expect(again.textContent).toContain('Disclosure added');
      expect([...again.querySelectorAll('button')].some((b) => b.textContent === 'Add line')).toBe(
        false,
      );
    });

    it('puts the disclosure line under the answer past a hero image, and counts it before the next read (review, #1480)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const block = `${said} It is easy to set up for any team.`;
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Ledgerly' }],
        me: { id: 'u1', role: 'admin' },
      });
      readDraftPage.mockResolvedValue({
        spots: [],
        proofs: [],
        regulated: null,
        checks: {
          answerFirst: null,
          recommends: { quote: 'Ledgerly is the fastest forecasting app', block },
          disclosure: null,
          balance: null,
          how: null,
          cut: false,
          pageType: 'best_of',
        },
        pending: false,
        limited: false,
        paused: false,
      });
      getContentDraft.mockResolvedValue({
        ...claimed,
        pageType: 'best_of',
        pageTypeSource: 'user',
        bodyHtml: `<h1>Pipeline forecasting</h1><img src="https://cdn.ledgerly.example/hero.png" alt="A forecast"><p></p><p>${block}</p>`,
      });
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      await act(async () => button('Mark ready')!.click());
      const dialog = document.querySelector('[role="dialog"]')!;
      await act(async () =>
        [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Add line')!.click(),
      );
      const { state } = (
        container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }
      ).editor;
      const texts: string[] = [];
      state.doc.forEach((node) => texts.push(node.textContent));
      // Past the image and the empty paragraph: under the answer, which stays first.
      const line = 'Disclosure: the product this page recommends is offered by Ledgerly.';
      expect(texts.indexOf(line)).toBe(texts.indexOf(block) + 1);
      // Counted before the page is read again: Quality's suggestion goes.
      await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
      await act(async () =>
        [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Close')?.click(),
      );
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      expect(panel()!.textContent).not.toContain('without a disclosure');
    });

    it('shows a visual proof spot beside its passage, and Add image puts the image after it (CE-049)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const block = `${said} It is easy to set up for any team.`;
      readDraftPage.mockResolvedValue({
        spots: [
          {
            passage: 'the fastest forecasting app',
            block,
            image: 'A screenshot of a real forecast run, timed',
            alt: 'A forecast run finishing in 4 seconds',
          },
        ],
        proofs: [],
        regulated: null,
        pending: false,
        limited: false,
        paused: false,
      });
      getContentDraft.mockResolvedValue(claimed);
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const spot = container.querySelector<HTMLElement>('.ProseMirror [data-proof-spot]')!;
      expect(spot.textContent).toContain('A screenshot of a real forecast run, timed');
      expect(spot.textContent).toContain('For: “the fastest forecasting app”');
      await act(async () =>
        spot.querySelector<HTMLButtonElement>('button[aria-label^="Add image for"]')!.click(),
      );
      const src = document.querySelector<HTMLInputElement>('#proof-image-src')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          src,
          'https://cdn.acme.com/forecast-run.png',
        );
        src.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () =>
        [...document.querySelectorAll('button')]
          .find((b) => b.textContent === 'Add image' && !b.closest('[data-proof-spot]'))!
          .click(),
      );
      const image = container.querySelector<HTMLImageElement>(
        '.ProseMirror img[src="https://cdn.acme.com/forecast-run.png"]',
      )!;
      expect(image.alt).toBe('A forecast run finishing in 4 seconds');
      expect(image.previousElementSibling?.textContent).toContain(said);
      // Filled: the spot goes; Undo takes the image out and brings it back.
      expect(container.querySelector('.ProseMirror [data-proof-spot]')).toBeNull();
      const { editor: pm } = container.querySelector('.ProseMirror') as HTMLElement & {
        editor: Editor;
      };
      await act(async () => void pm.commands.undo());
      expect(container.querySelector('.ProseMirror img')).toBeNull();
      expect(container.querySelector('.ProseMirror [data-proof-spot]')).not.toBeNull();
    });

    it("confirms the page's own image from Quality, and counts it as visual proof (CE-049, part d)", async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'admin' },
      });
      getDraftInputs.mockResolvedValue({ experience: '', data: [], getcitoData: [], quotes: [] });
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml: `<h1>Pipeline forecasting</h1><p>${said} It is easy to set up for any team.</p><img src="https://cdn.acme.com/run.png" alt="A forecast run">`,
        }),
      );
      window.innerWidth = 1440;
      await renderPage();
      // The image's page is saved as the editor writes it; the page's read
      // (here off) comes a few seconds after that save.
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const row = () =>
        [...panel()!.querySelectorAll('[aria-label="Your to-dos"] li')].find((li) =>
          li.textContent?.startsWith('Show your own image'),
        )!;
      expect(row().textContent).toContain("Is the page's image your own");
      await act(async () =>
        [...row().querySelectorAll('button')].find((b) => b.textContent === 'Confirm')!.click(),
      );
      const box = document.querySelector<HTMLButtonElement>('[role="dialog"] [role="checkbox"]')!;
      await act(async () => box.click());
      expect(confirmOwnImage).toHaveBeenCalledWith('d1', 'https://cdn.acme.com/run.png');
      expect(box.getAttribute('aria-checked')).toBe('true');
      expect(row().textContent).toContain('The page shows your own image');
    });

    it('takes a confirm back when the draft keeps 50 already (CE-049, part d)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'admin' },
      });
      confirmOwnImage.mockResolvedValue('full');
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml: `<h1>Pipeline forecasting</h1><p>${said} It is easy to set up for any team.</p><img src="https://cdn.acme.com/run.png" alt="A forecast run">`,
        }),
      );
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const row = [...panel()!.querySelectorAll('[aria-label="Your to-dos"] li')].find((li) =>
        li.textContent?.startsWith('Show your own image'),
      )!;
      await act(async () =>
        [...row.querySelectorAll('button')].find((b) => b.textContent === 'Confirm')!.click(),
      );
      const box = document.querySelector<HTMLButtonElement>('[role="dialog"] [role="checkbox"]')!;
      await act(async () => box.click());
      expect(toast.error).toHaveBeenCalledWith('This page keeps 50 confirmed images already.');
      expect(box.getAttribute('aria-checked')).toBe('false');
    });

    it('asks a page that advises on health for a qualified reviewer, and names them (CE-049, part e)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentAuthors.mockResolvedValue({
        authors: [
          {
            id: 'a1',
            name: 'Dr. Ada Lovelace',
            title: 'MD, Cardiologist',
            bio: null,
            photoUrl: null,
            sameAs: [],
            userId: null,
            createdBy: null,
            defaultFor: [],
            pages: null,
          },
        ],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'admin' },
      });
      readDraftPage.mockResolvedValue({
        spots: [],
        proofs: [],
        regulated: 'health',
        pending: false,
        limited: false,
        paused: false,
      });
      getContentDraft.mockResolvedValue(claimed);
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const reviewerButton = () =>
        [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
          /^(Add reviewer|Reviewed by)/.test(b.textContent ?? ''),
        )!;
      expect(reviewerButton().textContent).toBe('Add reviewer');
      await act(async () => reviewerButton().click());
      const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((i) =>
        i.textContent?.startsWith('Dr. Ada Lovelace'),
      )!;
      await act(async () => item.click());
      expect(setContentDraftReviewer).toHaveBeenCalledWith('d1', 'a1');
      expect(reviewerButton().textContent).toBe('Reviewed by Dr. Ada Lovelace');
      // In the Page info strip, outside the page.
      expect(container.querySelector('[data-page-info]')!.textContent).toContain(
        'Reviewed by Dr. Ada Lovelace, MD, Cardiologist',
      );
      // A save that fails puts back the reviewer saved, and says so.
      vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        setContentDraftReviewer.mockRejectedValueOnce(new Error('offline'));
        await act(async () => reviewerButton().click());
        const none = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
          (i) => i.textContent === 'No reviewer',
        )!;
        await act(async () => none.click());
        expect(toast.error).toHaveBeenCalledWith("Couldn't set the reviewer. Try again.");
        expect(reviewerButton().textContent).toBe('Reviewed by Dr. Ada Lovelace');
      } finally {
        vi.mocked(console.error).mockRestore();
      }
    });

    it('holds the score for the visual proof when the claims land first, and scores without the own images when they can’t be read (review, #1475)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        getContentAuthors.mockResolvedValue({
          authors: [],
          brands: [{ id: 'b1', name: 'Acme' }],
          me: { id: 'u1', role: 'admin' },
        });
        getDraftInputs.mockResolvedValue({
          experience: '',
          data: [],
          getcitoData: [],
          quotes: [],
        });
        // The own images' call fails (the network, a deploy).
        getOwnImages.mockRejectedValue(new Error('offline'));
        let pageIn: (value: unknown) => void = () => {};
        readDraftPage.mockReturnValue(new Promise((resolve) => (pageIn = resolve)));
        getContentDraft.mockResolvedValue(
          draft({
            bodyHtml: `<h1>Pipeline forecasting</h1><p>${said} It is easy to set up for any team.</p><img src="https://cdn.acme.com/run.png" alt="A forecast run">`,
          }),
        );
        window.innerWidth = 1440;
        await renderPage();
        await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
        await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
        // The claims are in; the page's read isn't: no score on Trust and Readability alone.
        expect(checkDraftClaims).toHaveBeenCalled();
        expect(readDraftPage).toHaveBeenCalled();
        const chip = () =>
          [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
            b.textContent?.startsWith('Quality'),
          );
        expect(chip()?.textContent).toBe('Quality · reading…');
        await act(async () =>
          pageIn({
            spots: [],
            proofs: [],
            regulated: null,
            pending: false,
            limited: false,
            paused: false,
          }),
        );
        // In once, with the confirms made so far (none): it scores.
        expect(chip()?.textContent).toMatch(/^Quality \d+ · (Strong|Can improve|Needs work)$/);
        expect(console.error).toHaveBeenCalledWith(
          'Failed to read the own images:',
          expect.any(Error),
        );
      } finally {
        vi.mocked(console.error).mockRestore();
        vi.useRealTimers();
      }
    });

    it('holds what the page read found while an edit to it is read again (review, #1479)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'admin' },
      });
      const HOW = 'We tested each forecasting app with twelve sales teams for a month.';
      const answer = (block: string) => ({
        spots: [],
        proofs: [],
        regulated: null,
        checks: {
          answerFirst: null,
          recommends: null,
          disclosure: null,
          balance: null,
          how: { quote: 'We tested each forecasting app', block },
          cut: false,
          pageType: 'guide',
        },
        pending: false,
        limited: false,
        paused: false,
      });
      let again: (value: unknown) => void = () => {};
      readDraftPage
        .mockResolvedValueOnce(answer(HOW))
        .mockReturnValueOnce(new Promise((resolve) => (again = resolve)));
      saveContentDraft.mockResolvedValue({
        ok: true,
        updatedAt: '2026-10-20T10:01:00Z',
        bodyHash: 'h1',
      });
      getContentDraft.mockResolvedValue({
        ...claimed,
        pageType: 'guide',
        pageTypeSource: 'user',
        bodyHtml: `${claimed.bodyHtml}<p>${HOW}</p>`,
      });
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const eeatNow = () => panel()!.textContent!.match(/Who stands behind the page(\d+)/)?.[1];
      const found = eeatNow();
      expect(found).toBeDefined();
      // A typo fixed in the paragraph that says how the page was made.
      const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
        .editor;
      let end = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === HOW) end = pos + node.nodeSize - 1;
      });
      await act(async () => {
        editor.commands.insertContentAt(end - 1, ' straight');
      });
      // Read on the page as it is now, not saved yet; then saved and not
      // asked about; then asked: it holds.
      await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
      expect(saveContentDraft).not.toHaveBeenCalled();
      expect(eeatNow()).toBe(found);
      await act(async () => void (await vi.advanceTimersByTimeAsync(1_500)));
      expect(saveContentDraft).toHaveBeenCalled();
      expect(eeatNow()).toBe(found);
      await act(
        async () =>
          void (await vi.advanceTimersByTimeAsync(PROOF_READ_EVERY_MS + PROOF_READ_SLACK_MS)),
      );
      expect(readDraftPage).toHaveBeenCalledTimes(2);
      expect(eeatNow()).toBe(found);
      await act(async () => again(answer(HOW.replace('month.', 'month straight.'))));
      expect(eeatNow()).toBe(found);
    });

    it('takes the claim’s sentence out on Remove', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      checkDraftClaims.mockResolvedValue({
        blocks: [
          {
            text: `${said} It is easy to set up for any team.`,
            claims: [{ text: 'the fastest forecasting app', kind: 'superlative' }],
          },
        ],
        pending: 0,
        limited: false,
      });
      getContentDraft.mockResolvedValue(claimed);
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const row = await openQuality();
      const remove = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!;
      await act(async () => remove.click());
      const page = container.querySelector('.ProseMirror')!.textContent!;
      expect(page).not.toContain(said);
      expect(page).toContain('It is easy to set up for any team.');
    });

    it('takes a list item Remove empties out with its sentence', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      checkDraftClaims.mockResolvedValue({
        blocks: [
          { text: said, claims: [{ text: 'the fastest forecasting app', kind: 'superlative' }] },
        ],
        pending: 0,
        limited: false,
      });
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml:
            `<h1>Pipeline forecasting</h1><ul><li><p>${said}</p></li><li><p>Easy to set up.</p></li></ul>` +
            '<p>Try it free.</p>',
        }),
      );
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const row = await openQuality();
      const remove = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!;
      await act(async () => remove.click());
      const items = [...container.querySelectorAll('.ProseMirror li')].map((li) => li.textContent);
      expect(items).toEqual(['Easy to set up.']);
    });

    // A figure the rules read, with no source.
    const figured = draft({
      bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams cut 40% of their busywork with it.</p>',
    });

    it('underlines a figure with no source with phase 2, the model having read no claim', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentDraft.mockResolvedValue(figured);
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      expect(redMarks()).toHaveLength(1);
      expect(redMarks()[0].textContent).toBe('Teams cut 40% of their busywork with it.');
    });

    it("asks nothing, underlines nothing and offers no Add source before Quality's second phase", async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      getContentDraft.mockResolvedValue(figured);
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => void (await vi.advanceTimersByTimeAsync(40_000)));
      expect(checkDraftClaims).not.toHaveBeenCalled();
      expect(redMarks()).toHaveLength(0);
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const row = [...panel()!.querySelectorAll('li')].find((li) =>
        li.textContent?.includes('figure has no source'),
      )!;
      expect(row).toBeDefined();
      const labels = [...row.querySelectorAll('button')].map((b) => b.textContent);
      expect(labels).toEqual(['Show']);
    });
  });

  describe('Brand facts (Quality CE-047)', () => {
    afterEach(() => {
      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
    });
    beforeEach(() => {
      getDraftSources.mockResolvedValue({
        data: {
          prompts: [],
          fanouts: [],
          citedPages: [],
          gscQueries: [],
          brandDomains: ['acme.com'],
          competitorDomains: [],
        },
        choices: [],
      });
    });
    const fact = (over: Record<string, unknown>) => ({
      id: 'f1',
      kind: 'price',
      value: { plan: 'Pro', amount: 49, currency: 'USD', period: 'month', billed: null, per: null },
      quote: '$49 per month',
      sourceUrl: 'https://acme.com/pricing',
      sourceKind: 'pricing',
      status: 'approved',
      reviewedAt: null,
      firstSeenAt: '2026-10-24T00:00:00Z',
      gone: false,
      replaces: null,
      ...over,
    });

    it('names a price the page gives that differs, and asks to approve the facts read', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      getBrandFacts.mockResolvedValue({
        facts: [
          fact({}),
          fact({ id: 'f2', kind: 'trial', value: { days: 14 }, status: 'pending' }),
        ],
        pages: [],
        checkedAt: null,
        recheckAt: null,
        paused: false,
        noDomain: false,
      });
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml:
            '<h1>Pricing</h1><p>The Pro plan costs $59 per month.</p>' +
            // A sourced figure: Trust is scored, so Quality's chip is there.
            '<p>Teams cut 40% of their busywork (<a href="https://research.example/r">report</a>).</p>',
        }),
      );
      window.innerWidth = 1440;
      await renderPage();
      expect(getBrandFacts).toHaveBeenCalledWith(draft().brandId);
      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      expect(panel()!.textContent).toContain(
        'Price differs from brand facts · Page $59 · pricing page $49',
      );
      const todo = [...panel()!.querySelectorAll('li')].find((li) =>
        li.textContent?.includes('Approve 1 brand fact'),
      )!;
      expect(todo.querySelector('a')!.getAttribute('href')).toBe(
        `/dashboard/brands/${draft().brandId}/settings?tab=facts`,
      );
    });

    it('reads no brand facts before Quality’s second phase', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      getContentDraft.mockResolvedValue(draft({}));
      window.innerWidth = 1440;
      await renderPage();
      expect(getBrandFacts).not.toHaveBeenCalled();
    });
  });

  describe('Sources by kind (Quality CE-046)', () => {
    afterEach(() => {
      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
    });
    const reddit = 'https://www.reddit.com/r/coffee/1';
    const sourced = draft({
      bodyHtml:
        '<h1>Pour-over coffee</h1>' +
        `<p>People swear by it on <a href="${reddit}">a thread</a>.</p>` +
        '<p>Brew at 94 °C, as <a href="https://www.reuters.com/x">Reuters</a> reported.</p>',
    });
    const weakMarks = () => container.querySelectorAll('.ProseMirror .decoration-wavy');

    it('underlines a weak source in the draft, and keeps it on Keep', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      getDraftSources.mockResolvedValue({
        data: {
          prompts: [],
          fanouts: [],
          citedPages: [],
          gscQueries: [],
          brandDomains: ['acme.com'],
          competitorDomains: [],
        },
        choices: [],
      });
      keepDraftSource.mockResolvedValue([reddit]);
      getContentDraft.mockResolvedValue(sourced);
      window.innerWidth = 1440;
      await renderPage();
      expect(weakMarks()).toHaveLength(1);
      expect(weakMarks()[0].textContent).toBe('a thread');
      expect(weakMarks()[0].getAttribute('title')).toContain('A weak source');

      const chip = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('Quality'),
      )!;
      await act(async () => chip.click());
      const row = [...panel()!.querySelectorAll('li')].find((li) =>
        li.textContent?.includes('weak:'),
      )!;
      const keep = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Keep')!;
      await act(async () => keep.click());
      expect(keepDraftSource).toHaveBeenCalledWith('d1', reddit);
      expect(weakMarks()).toHaveLength(0);
      expect(panel()!.textContent).not.toContain('weak:');
    });

    it('marks every link to it as the page changes', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      getDraftSources.mockResolvedValue({
        data: {
          prompts: [],
          fanouts: [],
          citedPages: [],
          gscQueries: [],
          brandDomains: ['acme.com'],
          competitorDomains: [],
        },
        choices: [],
      });
      getContentDraft.mockResolvedValue(sourced);
      await renderPage();
      expect(weakMarks()).toHaveLength(1);
      // The page replaced (as a restore or the HTML view does): both links to it are marked.
      await act(async () => button('Edit as HTML')!.click());
      const source = container.querySelector('textarea')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          source,
          `<h1>Pour-over coffee</h1><p>One <a href="${reddit}">thread</a>.</p>` +
            `<p>And <a href="${reddit}">the same thread</a>.</p>`,
        );
        source.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => button('Back to visual')!.click());
      expect([...weakMarks()].map((mark) => mark.textContent)).toEqual([
        'thread',
        'the same thread',
      ]);
    });

    it('reads no source’s kind before phase 2', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      getDraftSources.mockResolvedValue({
        data: {
          prompts: [],
          fanouts: [],
          citedPages: [],
          gscQueries: [],
          brandDomains: ['acme.com'],
          competitorDomains: [],
        },
        choices: [],
      });
      getContentDraft.mockResolvedValue(sourced);
      await renderPage();
      expect(weakMarks()).toHaveLength(0);
    });
  });

  describe('Author (CE-038)', () => {
    const ada = {
      id: 'a1',
      name: 'Ada Lovelace',
      title: 'Head of Content',
      bio: null,
      photoUrl: null,
      sameAs: [],
      userId: null,
      createdBy: null,
      defaultFor: ['b1'],
      pages: 1,
    };
    beforeEach(() => {
      getContentAuthors.mockResolvedValue({
        authors: [ada],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'analyst' },
      });
    });
    afterEach(() => {
      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
    });
    const byButton = () =>
      [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.textContent?.startsWith('By '),
      );
    const strip = () => container.querySelector<HTMLElement>('[data-page-info]');

    it("shows no author until Quality's first phase is live", async () => {
      getContentDraft.mockResolvedValue(draft({ authorId: 'a1' }));
      await renderPage();
      expect(getContentAuthors).not.toHaveBeenCalled();
      expect(byButton()).toBeUndefined();
      expect(strip()).toBeNull();
    });

    it('names the author in the header and a Page info strip outside the page', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      getContentDraft.mockResolvedValue(draft({ authorId: 'a1' }));
      await renderPage();
      expect(byButton()!.textContent).toBe('By Ada Lovelace');
      expect(strip()!.textContent).toBe(
        'ALBy Ada Lovelace · Head of Content, Acme · Updated Oct 20, 2026Page info · shown by your CMS, not part of the content',
      );
      expect(strip()!.previousElementSibling?.tagName).toBe('H1');

      // Copy HTML (as export, save and the HTML view) reads the page: no strip.
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const copyPage = [...container.querySelectorAll<HTMLButtonElement>('header button')].find(
        (b) => b.getAttribute('aria-label') === 'Copy HTML',
      )!;
      await act(async () => copyPage.click());
      expect(writeText).toHaveBeenLastCalledWith(
        '<h1>Pipeline forecasting</h1>\n<p>Teams trust it.</p>',
      );
    });

    it("scores E-E-A-T from the author, and Quality's Pick author opens the menu", async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      getContentDraft.mockResolvedValue(draft({ authorId: null }));
      window.innerWidth = 1440;
      await renderPage();
      await act(async () =>
        [...container.querySelectorAll<HTMLButtonElement>('header button')]
          .find((b) => b.textContent?.startsWith('Quality'))!
          .click(),
      );
      const scores = panel()!.querySelector('[aria-label="Quality scores"]')!;
      expect(scores.textContent).toContain('Who stands behind the page0Needs work');
      expect(scores.textContent).toContain('Sources, links and dated factsNot scored yet');

      const pick = [...panel()!.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === 'Pick author',
      )!;
      await act(async () => pick.click());
      expect(document.querySelectorAll('[role="menuitemradio"]').length).toBe(2);
    });

    it('sets the organization byline, and goes back when that fails', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      getContentDraft.mockResolvedValue(draft({ authorId: 'a1' }));
      await renderPage();
      await act(async () => byButton()!.click());
      const team = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (item) => item.textContent?.startsWith('Acme Team'),
      )!;
      await act(async () => team.click());
      expect(setContentDraftAuthor).toHaveBeenCalledWith('d1', null);
      // Page metadata: the page itself isn't saved for it.
      expect(saveContentDraft).not.toHaveBeenCalled();
      expect(byButton()!.textContent).toBe('By Acme Team');
      expect(strip()!.textContent).toContain('By Acme Team · Updated');

      setContentDraftAuthor.mockRejectedValue(new Error('invalid'));
      await act(async () => byButton()!.click());
      const back = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (item) => item.textContent?.startsWith('Ada Lovelace'),
      )!;
      await act(async () => back.click());
      expect(byButton()!.textContent).toBe('By Acme Team');
    });
  });

  describe('Your to-dos: the next-step nudge (CE-040)', () => {
    const ada = {
      id: 'a1',
      name: 'Ada Lovelace',
      title: null,
      bio: null,
      photoUrl: null,
      sameAs: [],
      userId: null,
      createdBy: null,
      defaultFor: [],
      pages: null,
    };
    beforeEach(() => {
      sessionStorage.clear();
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      // The agent's steps taken (every rule passed, the page short of its
      // Length as it is): Next is on the person's step, which the nudge
      // shows beside (editor UX review 2026-11-03: never beside the agent's).
      const all = activeRules(ruleSet('feature_page'), { overrides: {} }).map((r) => r.key);
      const pass = { rules: all, length: 'short', batch: null };
      localStorage.setItem(
        'aeo:next-step-third-try:d1',
        JSON.stringify({ attempt: null, passes: { length: pass, fixRules: pass } }),
      );
      getContentAuthors.mockResolvedValue({
        authors: [ada],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'analyst' },
      });
    });
    afterEach(() => {
      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
    });
    const nudge = () => container.querySelector('[aria-label="Your next step"]');
    const inDialog = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (b) => b.textContent === name,
      )!;

    it('names the first to-do once the agent has written the page, and opens the author menu', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        getContentDraft.mockResolvedValue(
          draft({ status: 'draft', agentState: 'writing', agentSince: new Date().toISOString() }),
        );
        await renderPage();
        expect(nudge()).toBeNull();
        getContentDraft.mockResolvedValue(
          draft({ status: 'in_review', author: 'agent', authorId: null }),
        );
        await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
        await act(async () => {});
      } finally {
        vi.useRealTimers();
      }
      expect(nudge()!.textContent).toBe(
        "Next for you: pick the page's author · 1 of 2Pick nowLater",
      );
      await act(async () => button('Pick now')!.click());
      expect(nudge()).toBeNull();
      expect(document.querySelectorAll('[role="menuitemradio"]').length).toBe(2);
    });

    it("lists the agent's placeholders first in Quality, and Show selects the first (CE-044)", async () => {
      getContentDraft.mockResolvedValue(
        draft({
          authorId: 'a1',
          bodyHtml:
            '<h1>Pipeline forecasting</h1><p>Ask [name of a real person] how.</p>' +
            '<p>Then ask [name of a real person] again.</p>',
        }),
      );
      window.innerWidth = 1440;
      await renderPage();
      await act(async () =>
        [...container.querySelectorAll<HTMLButtonElement>('header button')]
          .find((b) => b.textContent?.startsWith('Quality'))!
          .click(),
      );
      const todos = panel()!.querySelector('[aria-label="Your to-dos"]')!;
      const first = todos.querySelector('li')!;
      expect(first.textContent).toContain('Fill 2 placeholders');
      await act(async () => first.querySelector('button')!.click());
      const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
        .editor;
      const { from, to } = editor.state.selection;
      // The first one, selected to type over.
      expect(editor.state.doc.textBetween(from, to)).toBe('[name of a real person]');
      expect(editor.state.doc.textBetween(0, from)).toContain('Ask ');
      expect(editor.state.doc.textBetween(0, from)).not.toContain('Then');
    });

    it('names the placeholders Accept all brought in, once the page is read again', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          authorId: 'a1',
          bodyHtml: '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p>',
        }),
      );
      getContentAuthors.mockResolvedValue({
        authors: [{ ...ada, bio: 'Writes about forecasting.', sameAs: ['https://x.com/ada'] }],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'analyst' },
      });
      getDraftSuggestions.mockResolvedValue([
        {
          id: 'n1',
          batchId: 'b2',
          actionId: null,
          actionNo: null,
          kind: 'replace',
          blockText: 'We delve into how teams forecast.',
          beforeText: 'delve into',
          afterText: 'asked [name of a real person] about',
          reason: 'remove an AI trace (rule)',
          ruleKeys: ['aiTraces'],
          status: 'open',
        },
      ]);
      await renderPage();
      await act(async () =>
        [...container.querySelectorAll<HTMLButtonElement>('button')]
          .find((b) => b.textContent === 'Accept all')!
          .click(),
      );
      await act(async () => {});
      // Not before the page is read again.
      expect(nudge()).toBeNull();
      await act(async () => new Promise((resolve) => setTimeout(resolve, 600)));
      expect(nudge()!.textContent).toBe('Next for you: fill 1 placeholder · 1 of 1Show nowLater');
    });

    it('stays away when the agent was stopped from the wait screen', async () => {
      getContentDraft.mockResolvedValue(
        draft({ status: 'draft', agentState: 'writing', agentSince: new Date().toISOString() }),
      );
      // A Start on a live page runs as a Fix (contentWriter.js startWritingRun).
      readAgentRun.mockResolvedValue({
        id: 'r1',
        kind: 'fix',
        steps: [{ key: 'write_changes', count: null }],
        step: 0,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        stoppedAt: null,
        outcome: null,
      });
      await renderPage();
      await act(async () => {});
      getContentDraft.mockResolvedValue(draft({ authorId: null }));
      await act(async () => button('Stop')!.click());
      await act(async () => {});
      expect(container.querySelector('.ProseMirror')).not.toBeNull();
      expect(nudge()).toBeNull();
    });

    it('names it once Run Agent’s batch is decided, not beside Review (editor UX review 2026-11-03)', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          authorId: null,
          pageType: 'blog_post',
          bodyHtml: '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p>',
        }),
      );
      getDraftSuggestions.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'n1',
          batchId: 'b2',
          actionId: null,
          actionNo: null,
          kind: 'replace',
          blockText: 'We delve into how teams forecast.',
          beforeText: 'delve into',
          afterText: 'look at',
          reason: 'remove an AI trace (rule)',
          ruleKeys: ['aiTraces'],
          status: 'open',
        },
      ]);
      fixDraftRules.mockResolvedValue({ count: 1 });
      window.innerWidth = 1024;
      await renderPage();
      await act(async () =>
        container.querySelector<HTMLButtonElement>('header button[aria-label^="Rules "]')!.click(),
      );
      await act(async () =>
        [...panel()!.querySelectorAll<HTMLButtonElement>('button')]
          .find((b) => b.textContent === 'Fix open rules')!
          .click(),
      );
      await act(async () => {});
      expect(fixDraftRules).toHaveBeenCalled();
      // Its batch waits: Next's step is to review it, and the nudge doesn't name another.
      expect(
        container.querySelector('header button[aria-label^="Next ·"]')!.getAttribute('aria-label'),
      ).toBe('Next · Review 1 suggestion');
      expect(nudge()).toBeNull();
      // Decided: the person's step, and the nudge with it.
      const card = container.querySelector('[role="region"][aria-label="Agent suggestions"]')!;
      await act(async () =>
        [...card.querySelectorAll('button')].find((b) => b.textContent === 'Accept all')!.click(),
      );
      await act(async () => new Promise((resolve) => setTimeout(resolve, 700)));
      expect(nudge()!.textContent).toContain("Next for you: pick the page's author · 1 of 2");
    });

    it("doesn't show when Accept all can't be saved", async () => {
      getContentDraft.mockResolvedValue(
        draft({
          authorId: null,
          bodyHtml: '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p>',
        }),
      );
      getDraftSuggestions.mockResolvedValue([
        {
          id: 'n1',
          batchId: 'b2',
          actionId: null,
          actionNo: null,
          kind: 'replace',
          blockText: 'We delve into how teams forecast.',
          beforeText: 'delve into',
          afterText: 'look at',
          reason: 'remove an AI trace (rule)',
          ruleKeys: ['aiTraces'],
          status: 'open',
        },
      ]);
      decideDraftSuggestions.mockRejectedValue(new Error('offline'));
      await renderPage();
      await act(async () =>
        [...container.querySelectorAll<HTMLButtonElement>('button')]
          .find((b) => b.textContent === 'Accept all')!
          .click(),
      );
      await act(async () => {});
      expect(toast.error).toHaveBeenCalled();
      expect(nudge()).toBeNull();
    });

    it("doesn't show on opening a draft, nor after Accept all with nothing left to do", async () => {
      getContentDraft.mockResolvedValue(
        draft({
          authorId: 'a1',
          bodyHtml: '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p>',
        }),
      );
      getContentAuthors.mockResolvedValue({
        authors: [{ ...ada, bio: 'Writes about forecasting.', sameAs: ['https://x.com/ada'] }],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'analyst' },
      });
      getDraftSuggestions.mockResolvedValue([
        {
          id: 'n1',
          batchId: 'b2',
          actionId: null,
          actionNo: null,
          kind: 'replace',
          blockText: 'We delve into how teams forecast.',
          beforeText: 'delve into',
          afterText: 'look at',
          reason: 'remove an AI trace (rule)',
          ruleKeys: ['aiTraces'],
          status: 'open',
        },
      ]);
      await renderPage();
      expect(nudge()).toBeNull();
      const accept = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === 'Accept all',
      )!;
      await act(async () => accept.click());
      await act(async () => {});
      expect(decideDraftSuggestions).toHaveBeenCalledWith(['n1'], 'accepted');
      expect(nudge()).toBeNull();
    });

    it('names it after Accept all, and behind Before you publish on Mark ready; Later hides it', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          authorId: 'a1',
          bodyHtml: '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p>',
        }),
      );
      getDraftSuggestions.mockResolvedValue([
        {
          id: 'n1',
          batchId: 'b2',
          actionId: null,
          actionNo: null,
          kind: 'replace',
          blockText: 'We delve into how teams forecast.',
          beforeText: 'delve into',
          afterText: 'look at',
          reason: 'remove an AI trace (rule)',
          ruleKeys: ['aiTraces'],
          status: 'open',
        },
      ]);
      markContentDraftReady.mockResolvedValue({ status: 'ready', tasksDone: 0 });
      await renderPage();
      const accept = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === 'Accept all',
      )!;
      await act(async () => accept.click());
      await act(async () => {});
      // Once the page is read again after the accept (CE-044).
      await act(async () => new Promise((resolve) => setTimeout(resolve, 600)));
      expect(nudge()!.textContent).toContain(
        "Next for you: complete Ada Lovelace's profile · 1 of 1",
      );
      await act(async () => button('Later')!.click());
      expect(nudge()).toBeNull();

      // Later holds for the session: Mark ready opens Before you publish, with no nudge.
      await act(async () => button('Mark ready')!.click());
      expect(nudge()).toBeNull();
      await act(async () => inDialog('Mark ready').click());
      expect(markContentDraftReady).toHaveBeenCalledWith('d1');
    });

    it('names it on Mark ready with a to-do open', async () => {
      getContentDraft.mockResolvedValue(draft({ authorId: null }));
      markContentDraftReady.mockResolvedValue({ status: 'ready', tasksDone: 0 });
      await renderPage();
      await act(async () => button('Mark ready')!.click());
      expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
        'Before you publish',
      );
      expect(nudge()!.textContent).toContain("Next for you: pick the page's author");
      await act(async () => inDialog('Mark ready').click());
      expect(markContentDraftReady).toHaveBeenCalledWith('d1');
    });
  });

  describe('Before you publish (CE-041)', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      markContentDraftReady.mockResolvedValue({ status: 'ready', tasksDone: 0 });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'analyst' },
      });
      getDraftSources.mockResolvedValue({
        data: {
          prompts: [],
          fanouts: [],
          citedPages: [],
          gscQueries: [],
          brandDomains: ['acme.example.com'],
          competitorDomains: [],
        },
        choices: [],
      });
    });
    afterEach(() => {
      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
    });
    const dialogText = () => document.querySelector('[role="dialog"]')?.textContent ?? null;
    const inDialog = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (b) => b.textContent === name,
      );

    it('opens on Mark ready with what the CMS does and the JSON-LD, then marks it ready', async () => {
      getContentDraft.mockResolvedValue(draft({ authorId: null, pageType: 'blog_post' }));
      await renderPage();
      await act(async () => button('Mark ready')!.click());
      expect(markContentDraftReady).not.toHaveBeenCalled();
      expect(dialogText()).toContain('No author yet');
      expect(dialogText()).toContain('"@type": "Article"');
      expect(dialogText()).toContain('"headline": "Pipeline forecasting"');
      // No figure or link to read: Trust isn't scored, so nothing warns.
      expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
      await act(async () => inDialog('Mark ready')!.click());
      expect(markContentDraftReady).toHaveBeenCalledWith('d1');
      expect(dialogText()).toBeNull();
    });

    it('warns under Trust 60, and logs Mark ready anyway with the Trust and the check it named', async () => {
      getContentDraft.mockResolvedValue(
        draft({ bodyHtml: '<h1>Pipeline forecasting</h1><p>Deals close $2.5 million faster.</p>' }),
      );
      await renderPage();
      await act(async () => button('Mark ready')!.click());
      expect(document.querySelector('[role="dialog"] [role="alert"]')!.textContent).toContain(
        'Trust is 0, under 60: AI answers may lean on this page less. 1 sentence with a figure has no source. Fixing it first could raise Trust to about 100 (an estimate). You can still mark it ready.',
      );
      await act(async () => inDialog('Mark ready anyway')!.click());
      expect(markContentDraftReady).toHaveBeenCalledWith('d1', {
        trust: 0,
        reason: 'claimsSourced',
        count: 1,
      });
    });

    it('goes to Quality on Fix first, without marking it ready', async () => {
      getContentDraft.mockResolvedValue(
        draft({ bodyHtml: '<h1>Pipeline forecasting</h1><p>Deals close $2.5 million faster.</p>' }),
      );
      window.innerWidth = 1440;
      await renderPage();
      await act(async () => button('Mark ready')!.click());
      const scrolled = vi.fn();
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrolled;
      try {
        await act(async () => inDialog('Fix first')!.click());
      } finally {
        Element.prototype.scrollIntoView = original;
      }
      expect(dialogText()).toBeNull();
      expect(markContentDraftReady).not.toHaveBeenCalled();
      expect(selectedSegment()).toMatch(/^Quality/);
      // The passage the warning names first.
      expect(scrolled).toHaveBeenCalled();
    });

    it("names the shopping links to remove from the page as published, a product grid's too (shopping path)", async () => {
      const { htmlBlockElement } = await import('@/lib/content/htmlAllowlist');
      const { productBlockHtml } = await import('@/lib/content/productBlock');
      const product = (n: number, title: string, state: string) => ({
        key: `shop.example/products/${n}`,
        title,
        state,
        inPath: true,
      });
      const check = (trail: string) => ({
        categories: ['shop.example/collections/boots'],
        products: [
          product(1, 'Summit', 'ok'),
          product(2, 'Trail', trail),
          product(3, 'Ridge', 'ok'),
        ],
        site: 'https://shop.example/blog/boots',
      });
      getShoppingCheck.mockResolvedValue(check('ok'));
      try {
        getContentDraft.mockResolvedValue(
          draft({
            siteType: 'ecommerce',
            pageType: 'buying_guide',
            bodyHtml:
              '<h1>Hiking boots</h1>' +
              '<h2>Our <a href="/collections/boots">boots</a></h2>' +
              htmlBlockElement(
                productBlockHtml([
                  {
                    title: 'Summit',
                    url: 'https://shop.example/products/1',
                    image: null,
                    price: null,
                  },
                  {
                    title: 'Trail',
                    url: 'https://shop.example/products/2',
                    image: null,
                    price: null,
                  },
                ]),
              ),
          }),
        );
        await renderPage();
        const reads = getShoppingCheck.mock.calls.length;
        // Read fresh when it opens: Trail sold out since.
        let land!: (value: unknown) => void;
        getShoppingCheck.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              land = resolve;
            }),
        );
        await act(async () => button('Mark ready')!.click());
        expect(getShoppingCheck.mock.calls.length).toBe(reads + 1);
        expect(getShoppingCheck).toHaveBeenLastCalledWith('d1');
        expect(dialogText()).toContain("Reading your catalog for the linked products' stock…");
        expect(dialogText()).not.toContain('Trail');
        await act(async () => land(check('sold_out')));
        expect(dialogText()).not.toContain('Reading your catalog');
        expect(dialogText()).toContain('1 product link to remove or replace');
        expect(dialogText()).toContain(
          'Trail (not in stock). Remove or replace these links on the page',
        );
        expect(dialogText()).not.toContain('No link to the category page');
      } finally {
        getShoppingCheck.mockReset().mockResolvedValue(null);
      }
    });

    it('marks it ready at once while Quality is off', async () => {
      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
      getContentDraft.mockResolvedValue(draft());
      await renderPage();
      await act(async () => button('Mark ready')!.click());
      expect(dialogText()).toBeNull();
      expect(markContentDraftReady).toHaveBeenCalledWith('d1');
    });
  });

  describe('Send to CMS (#1331)', () => {
    beforeEach(() => {
      readDraftCms.mockReset().mockResolvedValue({ fields: {}, publishedUrl: null, last: null });
      sendPagesToCms.mockReset().mockResolvedValue({
        ok: true,
        deliveries: [{ id: 'x1', draftId: 'd1', status: 'sent' }],
      });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'admin' },
      });
    });
    afterEach(() => {
      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
    });
    const dialog = () => document.querySelector('[role="dialog"]');
    const inDialog = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (b) => b.textContent === name,
      )!;

    it('sends the page to the brand’s webhook from the header', async () => {
      getContentDraft.mockResolvedValue(draft());
      await renderPage();
      await act(async () => button('Send to CMS')!.click());
      expect(dialog()!.textContent).toContain('Send to CMS');
      expect(document.querySelector<HTMLInputElement>('#cms-slug')!.value).toBe(
        'pipeline-forecasting',
      );
      await act(async () => inDialog('Send').click());
      expect(sendPagesToCms).toHaveBeenCalledWith(
        'b1',
        [
          expect.objectContaining({
            draftId: 'd1',
            title: 'Pipeline forecasting',
            slug: 'pipeline-forecasting',
            html: '<p>Teams trust it.</p>',
            // Authors come with Quality (CE-038): while it is off, none goes.
            author: null,
          }),
        ],
        'webhook',
      );
      expect(dialog()).toBeNull();
    });

    it('names the team in the page’s language in the CMS author field, as Export does', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      brandState.brands = [{ id: 'b1', language: 'tr' } as never, { id: 'b2' }];
      try {
        getContentDraft.mockResolvedValue(draft({ pageType: 'blog_post' }));
        await renderPage();
        await act(async () => button('Send to CMS')!.click());
        await act(async () => inDialog('Continue to send').click());
        await act(async () => inDialog('Send').click());
        expect(sendPagesToCms).toHaveBeenCalledWith(
          'b1',
          [expect.objectContaining({ draftId: 'd1', author: 'Acme Ekibi' })],
          'webhook',
        );
      } finally {
        brandState.brands = [{ id: 'b1' }, { id: 'b2' }];
      }
    });

    it('sends no author for one the site names, nor the team’s byline line (00271)', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme', bylineInContent: true }],
        me: { id: 'u1', role: 'admin' },
      });
      getContentDraft.mockResolvedValue(
        draft({ pageType: 'blog_post', authorConfirmed: { real: true, profile: false } }),
      );
      // Trust reads once the brand's domains are in: until then Before you publish asks.
      getDraftSources.mockResolvedValue({
        data: {
          prompts: [],
          fanouts: [],
          citedPages: [],
          gscQueries: [],
          brandDomains: ['acme.com'],
          competitorDomains: [],
        },
        choices: [],
      });
      await renderPage();
      await act(async () => button('Send to CMS')!.click());
      // Nothing for Before you publish to ask about: straight to the Send dialog.
      expect(dialog()!.textContent).toContain('Meta description');
      await act(async () => inDialog('Send').click());
      // The CMS keeps its own author.
      expect(sendPagesToCms).toHaveBeenCalledWith(
        'b1',
        [expect.objectContaining({ draftId: 'd1', author: null })],
        'webhook',
      );
      // The page goes with the Article schema GetCito adds, naming no author (00448).
      const [, [sent]] = sendPagesToCms.mock.calls.at(-1)!;
      const [body, script] = sent.html.split('\n<script type="application/ld+json">');
      expect(body).toBe('<p>Teams trust it.</p>');
      const schema = JSON.parse(script.replace('</script>', ''));
      expect(schema['@type']).toBe('Article');
      expect(schema).not.toHaveProperty('author');
    });

    it('says in the header where the page went, once sent', async () => {
      getContentDraft.mockResolvedValue(draft());
      await renderPage();
      expect(container.textContent).not.toContain('Sent to your CMS');
      await act(async () => button('Send to CMS')!.click());
      await act(async () => {});
      await act(async () => inDialog('Send').click());
      expect(container.textContent).toContain('Sent to your CMS');
    });

    it('says in the header that a send failed, while the dialog says why', async () => {
      sendPagesToCms.mockResolvedValueOnce({
        ok: true,
        deliveries: [{ id: 'x1', draftId: 'd1', status: 'failed', http_status: 500, error: null }],
      });
      getContentDraft.mockResolvedValue(draft());
      await renderPage();
      await act(async () => button('Send to CMS')!.click());
      await act(async () => {});
      await act(async () => inDialog('Send').click());
      expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain(
        "The webhook answered 500 and didn't take the page.",
      );
      expect(container.textContent).toContain('Send failed');
      await act(async () => inDialog('Cancel').click());
      expect(dialog()).toBeNull();
      expect(container.textContent).toContain('Send failed');
    });

    it('says in the header, as the page opens, that it is in Webflow as a draft', async () => {
      readDraftCms.mockResolvedValue({
        fields: {},
        publishedUrl: null,
        last: { status: 'sent', target: 'webflow', at: '2026-10-27T09:00:00Z', error: null },
      });
      getContentDraft.mockResolvedValue(draft());
      await renderPage();
      expect(container.textContent).toContain('In Webflow · draft');
    });

    it('opens Before you publish first while Quality is on', async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      getContentDraft.mockResolvedValue(draft({ pageType: 'blog_post' }));
      await renderPage();
      // The header's read, as the page opened: the dialog's own comes after.
      readDraftCms.mockClear();
      await act(async () => button('Send to CMS')!.click());
      expect(dialog()!.textContent).toContain('Before you publish');
      expect(readDraftCms).not.toHaveBeenCalled();
      await act(async () => inDialog('Continue to send').click());
      expect(dialog()!.textContent).toContain('Meta description');
      expect(readDraftCms).toHaveBeenCalledWith('d1');
      // Closed, so no open dialog is left for the tests after.
      await act(async () => inDialog('Cancel').click());
      expect(dialog()).toBeNull();
    });

    const editAsHtml = async (html: string) => {
      await act(async () => button('Edit as HTML')!.click());
      const source = container.querySelector('textarea')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          source,
          html,
        );
        source.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => button('Back to visual')!.click());
    };

    it('saves what is waiting before it sends, as Mark ready does', async () => {
      getContentDraft.mockResolvedValue(draft());
      await renderPage();
      readDraftCms.mockClear();
      await editAsHtml('<h1>Pipeline forecasting</h1><p>Edited.</p>');
      expect(saveContentDraft).not.toHaveBeenCalled();
      await act(async () => button('Send to CMS')!.click());
      await act(async () => {});
      expect(saveContentDraft).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({ bodyHtml: '<h1>Pipeline forecasting</h1><p>Edited.</p>' }),
      );
      expect(saveContentDraft.mock.invocationCallOrder[0]).toBeLessThan(
        readDraftCms.mock.invocationCallOrder[0],
      );
      expect(document.querySelector<HTMLTextAreaElement>('#cms-meta-description')!.value).toBe(
        'Edited.',
      );
      await act(async () => inDialog('Cancel').click());
      expect(dialog()).toBeNull();
    });

    it('sends no page it can’t save', async () => {
      // A teammate or the agent changed the page meanwhile: this tab's version can't go.
      saveContentDraft.mockResolvedValue({ ok: false, reason: 'conflict' });
      getContentDraft.mockResolvedValue(draft());
      await renderPage();
      readDraftCms.mockClear();
      await editAsHtml('<h1>Pipeline forecasting</h1><p>Edited.</p>');
      await act(async () => button('Send to CMS')!.click());
      await act(async () => {});
      expect(toast.error).toHaveBeenCalledWith(
        "The page has changes that aren't saved, so it wasn't sent.",
      );
      expect(dialog()).toBeNull();
      expect(readDraftCms).not.toHaveBeenCalled();
    });

    it('waits for HTML edited in the HTML view to be applied', async () => {
      getContentDraft.mockResolvedValue(draft());
      await renderPage();
      await act(async () => button('Edit as HTML')!.click());
      const source = container.querySelector('textarea')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          source,
          '<h1>Pipeline forecasting</h1><p>Not applied.</p>',
        );
        source.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => button('Send to CMS')!.click());
      expect(toast.error).toHaveBeenCalledWith(
        "Apply or discard your HTML changes first: they aren't in the page yet.",
      );
      expect(dialog()).toBeNull();
      expect(saveContentDraft).not.toHaveBeenCalled();
    });

    it('takes one click while it saves', async () => {
      let saved: (value: unknown) => void = () => {};
      saveContentDraft.mockReturnValue(new Promise((resolve) => (saved = resolve)));
      getContentDraft.mockResolvedValue(draft());
      await renderPage();
      await editAsHtml('<h1>Pipeline forecasting</h1><p>Edited.</p>');
      await act(async () => button('Send to CMS')!.click());
      expect(button('Send to CMS')!.disabled).toBe(true);
      await act(async () => button('Send to CMS')!.click());
      expect(saveContentDraft).toHaveBeenCalledTimes(1);
      await act(async () => saved({ ok: true, updatedAt: '2026-10-20T10:01:00Z', bodyHash: 'h1' }));
      await act(async () => {});
      expect(dialog()!.textContent).toContain('Send to CMS');
      await act(async () => inDialog('Cancel').click());
    });

    it('keeps the focus on the placeholder Fill now selects in the HTML view, not on the header’s button', async () => {
      const { htmlBlockElement } = await import('@/lib/content/htmlAllowlist');
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml:
            '<h1>Pipeline forecasting</h1><p>Teams trust it.</p>' +
            htmlBlockElement('<div class="cta">Call [phone number]</div>'),
        }),
      );
      await renderPage();
      // Opened from the header's button, where a closing dialog gives the focus back.
      button('Send to CMS')!.focus();
      await act(async () => button('Send to CMS')!.click());
      await act(async () => {});
      await act(async () => inDialog('Fill now').click());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(dialog()).toBeNull();
      const area = [...container.querySelectorAll('textarea')].find((a) =>
        a.value.includes('[phone number]'),
      )!;
      expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe('[phone number]');
      expect(document.activeElement).toBe(area);
    });

    it('is for admins and managers only', async () => {
      getContentDraft.mockResolvedValue(draft());
      await renderPage('analyst');
      expect(button('Send to CMS')).toBeUndefined();
      await act(async () => root.unmount());
      root = createRoot(container);
      await renderPage('manager');
      expect(button('Send to CMS')).toBeDefined();
    });
  });

  describe('Export (CE-057)', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'analyst' },
      });
    });
    afterEach(() => {
      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
    });
    const dialog = () => document.querySelector('[role="dialog"]');
    const inDialog = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (b) => b.textContent === name,
      )!;

    it('opens Export on its options, Before you publish a Review away', async () => {
      getContentDraft.mockResolvedValue(draft({ pageType: 'blog_post' }));
      await renderPage();
      await act(async () => button('Export')!.click());
      // Export's options at once, with what Before you publish warns about.
      expect(dialog()!.textContent).toContain('Content · ready to paste');
      expect(dialog()!.textContent).toContain('Before you publish: no author yet.Review');
      await act(async () => inDialog('Review').click());
      // Before you publish (§7): what the CMS does, and Ready to paste; back to Export.
      expect(dialog()!.textContent).toContain(
        'Ready for your CMS · doneNo placeholders, all images have alt text, all links work.',
      );
      expect(markContentDraftReady).not.toHaveBeenCalled();
      await act(async () => inDialog('Continue to export').click());
      expect(dialog()!.textContent).toContain('Content · ready to paste');
      expect(dialog()!.textContent).toContain('Meta titlePipeline forecasting');
      expect(dialog()!.textContent).toContain('AuthorAcme Team → your CMS author field');
      expect(inDialog('Download Word').disabled).toBe(false);
    });

    it('leaves the author to the CMS for one the site names, with no warning (00271)', async () => {
      getContentDraft.mockResolvedValue(
        draft({ pageType: 'blog_post', authorConfirmed: { real: true, profile: false } }),
      );
      await renderPage();
      await act(async () => button('Export')!.click());
      expect(dialog()!.textContent).toContain('Content · ready to paste');
      expect(dialog()!.textContent).not.toContain('no author yet');
      expect(dialog()!.textContent).toContain("AuthorYour site's own: your CMS keeps it");
    });

    it('names the team in the page’s language in the CMS author field', async () => {
      brandState.brands = [{ id: 'b1', language: 'tr' } as never, { id: 'b2' }];
      try {
        getContentDraft.mockResolvedValue(draft({ pageType: 'blog_post' }));
        await renderPage();
        await act(async () => button('Export')!.click());
        expect(dialog()!.textContent).toContain('AuthorAcme Ekibi → your CMS author field');
      } finally {
        brandState.brands = [{ id: 'b1' }, { id: 'b2' }];
      }
    });

    it('reads Ready to paste as the links are read, a refused read as unread', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        let answer: (value: unknown) => void = () => {};
        checkDraftLinks.mockReturnValue(new Promise((resolve) => (answer = resolve)));
        getContentDraft.mockResolvedValue(
          draft({
            bodyHtml:
              '<h1>Pipeline forecasting</h1><p>See <a href="https://research.example/r">the report</a>.</p>',
          }),
        );
        await renderPage();
        await act(async () => button('Export')!.click());
        await act(async () => inDialog('Review').click());
        expect(dialog()!.textContent).toContain(
          'Ready for your CMS · check itNo placeholders, all images have alt text; 1 link is still being read.',
        );
        await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
        await act(async () =>
          answer({
            links: [
              {
                href: 'https://research.example/r',
                status: 'unknown',
                httpStatus: 403,
                date: null,
              },
            ],
            skipped: [],
          }),
        );
        expect(dialog()!.textContent).toContain(
          "Ready for your CMS · check itNo placeholders, all images have alt text; 1 link wasn't read: check it.",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('names no next step on Export, with a to-do open', async () => {
      getContentDraft.mockResolvedValue(draft({ authorId: null }));
      await renderPage();
      await act(async () => button('Export')!.click());
      expect(dialog()!.textContent).toContain('Content · ready to paste');
      expect(container.querySelector('[aria-label="Your next step"]')).toBeNull();
    });

    it("counts a title that is the page's H1 once, and Fill now goes to it", async () => {
      getContentDraft.mockResolvedValue(
        draft({
          title: 'How [name of a real person] forecasts',
          bodyHtml: '<h1>How [name of a real person] forecasts</h1><p>Teams trust it.</p>',
        }),
      );
      await renderPage();
      await act(async () => button('Export')!.click());
      await act(async () => inDialog('Review').click());
      expect(dialog()!.textContent).toContain(
        'Fix before you paste · missing1 placeholder still open',
      );
      await act(async () => inDialog('Fill now').click());
      expect(dialog()).toBeNull();
      const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
        .editor;
      const { from, to } = editor.state.selection;
      expect(editor.state.doc.textBetween(from, to)).toBe('[name of a real person]');
    });

    it("reads a FAQPage's JSON-LD by its strings: Ready to paste is done", async () => {
      const faq = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'How long does it take?',
            acceptedAnswer: { '@type': 'Answer', text: 'About a week.' },
          },
        ],
        sameAs: ['https://x.example/acme'],
      };
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml: `<h1>Pipeline forecasting</h1><p>Teams trust it.</p><script type="application/ld+json">${JSON.stringify(faq)}</script>`,
        }),
      );
      await renderPage();
      const ready =
        'Ready for your CMS · doneNo placeholders, all images have alt text, all links work.';
      await act(async () => button('Export')!.click());
      expect(dialog()!.querySelector('[role="alert"]')).toBeNull();
      expect(inDialog('Download Word').disabled).toBe(false);
      await act(async () => inDialog('Cancel').click());
      await act(async () => button('Mark ready')!.click());
      expect(dialog()!.textContent).toContain(ready);
    });

    it('fills in the HTML view where the count reads, past code and markup', async () => {
      getContentDraft.mockResolvedValue(draft());
      await renderPage();
      await act(async () => button('Edit as HTML')!.click());
      const source = container.querySelector('textarea')!;
      const html =
        '<!-- html-block -->\n<style>.cta a[href] { color: red }</style>\n<!-- /html-block -->\n' +
        '<h1 title="Pipeline">Pipeline forecasting [2026 Update]</h1>\n<p>Ask [name of a real person] how.</p>';
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!;
      await act(async () => {
        setValue.call(source, html);
        source.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => button('Export')!.click());
      await act(async () => inDialog('Review').click());
      expect(dialog()!.textContent).toContain('1 placeholder still open');
      await act(async () => inDialog('Fill now').click());
      expect(dialog()).toBeNull();
      expect(source.value.slice(source.selectionStart, source.selectionEnd)).toBe(
        '[name of a real person]',
      );
    });

    it('sends Copy HTML to Export while a placeholder is open, and Fill now goes to it', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      getContentDraft.mockResolvedValue(
        draft({ bodyHtml: '<h1>Pipeline forecasting</h1><p>Ask [name of a real person] how.</p>' }),
      );
      await renderPage();
      await act(async () => button('Copy HTML')!.click());
      expect(writeText).not.toHaveBeenCalled();
      expect(dialog()!.textContent).toContain('1 placeholder is still open');
      expect(dialog()!.querySelector('[role="radio"][aria-checked="true"]')!.textContent).toBe(
        'HTML',
      );
      expect(inDialog('Copy HTML').disabled).toBe(true);
      // Review and back: still on HTML.
      await act(async () => inDialog('Review').click());
      await act(async () => inDialog('Continue to export').click());
      expect(dialog()!.querySelector('[role="radio"][aria-checked="true"]')!.textContent).toBe(
        'HTML',
      );

      await act(async () => inDialog('Fill now').click());
      expect(dialog()).toBeNull();
      const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
        .editor;
      const { from, to } = editor.state.selection;
      expect(editor.state.doc.textBetween(from, to)).toBe('[name of a real person]');
    });

    it('keeps the focus on the placeholder Export’s Fill now selects in the HTML view, not on the header’s button', async () => {
      const { htmlBlockElement } = await import('@/lib/content/htmlAllowlist');
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml:
            '<h1>Pipeline forecasting</h1><p>Teams trust it.</p>' +
            htmlBlockElement('<div class="cta">Call [phone number]</div>'),
        }),
      );
      await renderPage();
      // Opened from the header's button, where a closing dialog gives the focus back.
      button('Export')!.focus();
      await act(async () => button('Export')!.click());
      await act(async () => inDialog('Fill now').click());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(dialog()).toBeNull();
      const area = [...container.querySelectorAll('textarea')].find((a) =>
        a.value.includes('[phone number]'),
      )!;
      expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe('[phone number]');
      expect(document.activeElement).toBe(area);
    });

    it('selects a placeholder only an HTML block holds in the HTML view, and says where it is', async () => {
      const { htmlBlockElement } = await import('@/lib/content/htmlAllowlist');
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml:
            '<h1>Pipeline forecasting</h1><p>Teams trust it.</p>' +
            htmlBlockElement('<div class="cta">Call [phone number]</div>'),
        }),
      );
      await renderPage();
      // The toolbar counts it, though the page doesn't show it.
      expect(container.textContent).toContain('Your input needed: 1');
      expect(button('Show in HTML')).toBeTruthy();
      await act(async () => button('Export')!.click());
      expect(dialog()!.textContent).toContain('1 placeholder is still open');
      await act(async () => inDialog('Review').click());
      expect(dialog()!.textContent).toContain('1 placeholder still open');
      await act(async () => inDialog('Continue to export').click());
      expect(dialog()!.textContent).toContain('1 placeholder is still open');
      await act(async () => inDialog('Fill now').click());
      expect(toast).toHaveBeenCalledWith(
        "This placeholder is in an image's alt text, the JSON-LD or an HTML block. It's selected in the HTML view (</>): type over it, then apply.",
      );
      const area = [...container.querySelectorAll('textarea')].find((a) =>
        a.value.includes('[phone number]'),
      )!;
      expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe('[phone number]');
    });

    it('opens the HTML view at the placeholder the page hides from Show in HTML, past the five it shows', async () => {
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml:
            '<h1>Pipeline forecasting</h1>' +
            '<p>Ask [competitor] and [name of a real person].</p>' +
            '<p><img src="https://cdn.example.com/a.jpg" alt="[photo of the founder]"></p>' +
            '<p>Costs [price], since [year], at [city].</p>',
        }),
      );
      await renderPage();
      expect(container.textContent).toContain('Your input needed: 6');
      await act(async () => button('Show in HTML')!.click());
      const area = [...container.querySelectorAll('textarea')].find((a) =>
        a.value.includes('[photo of the founder]'),
      )!;
      expect(area).toBeTruthy();
      expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe(
        '[photo of the founder]',
      );
      const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
        .editor;
      expect(editor.state.selection.empty).toBe(true);
    });

    it("counts a code block's placeholder once in the toolbar", async () => {
      getContentDraft.mockResolvedValue(
        draft({
          bodyHtml: '<h1>Pipeline forecasting</h1><pre><code>token = "[api key]"</code></pre>',
        }),
      );
      await renderPage();
      expect(container.textContent).toContain('Your input needed: 1');
      expect(button('Show in HTML')).toBeFalsy();
    });

    it('puts the byline under the H1 for a brand that adds it to content, and says so', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme', bylineInContent: true }],
        me: { id: 'u1', role: 'analyst' },
      });
      getContentDraft.mockResolvedValue(draft());
      await renderPage();
      expect(container.textContent).toContain(
        'Page info · exports put the "By …" line under the H1',
      );
      await act(async () => button('Copy HTML')!.click());
      expect(writeText).toHaveBeenCalledWith(
        '<h1>Pipeline forecasting</h1>\n<p>By Acme Team</p>\n<p>Teams trust it.</p>',
      );
    });

    it("writes the byline in the brand's language", async () => {
      brandState.brands = [{ id: 'b1', language: 'tr' } as never, { id: 'b2' }];
      try {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        getContentAuthors.mockResolvedValue({
          authors: [],
          brands: [{ id: 'b1', name: 'Acme', bylineInContent: true }],
          me: { id: 'u1', role: 'analyst' },
        });
        getContentDraft.mockResolvedValue(draft());
        await renderPage();
        await act(async () => button('Copy HTML')!.click());
        expect(writeText).toHaveBeenCalledWith(
          '<h1>Pipeline forecasting</h1>\n<p>Yazar: Acme Ekibi</p>\n<p>Teams trust it.</p>',
        );
      } finally {
        brandState.brands = [{ id: 'b1' }, { id: 'b2' }];
      }
    });

    it('copies at once with no placeholder, and keeps the menu while Quality is off', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      getContentDraft.mockResolvedValue(draft());
      await renderPage();
      await act(async () => button('Copy HTML')!.click());
      expect(writeText).toHaveBeenCalled();
      expect(dialog()).toBeNull();

      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
      await act(async () => root.unmount());
      root = createRoot(container);
      await renderPage();
      await act(async () => button('Export')!.click());
      expect(dialog()).toBeNull();
    });
  });

  describe('Next step basket', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'analyst' },
      });
    });
    afterEach(() => {
      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
    });
    const basket = () => document.querySelector('[data-slot="dialog-content"]');
    const inBasket = (name: string) =>
      [...(basket()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === name);
    const nextButton = () =>
      [...container.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
        b.getAttribute('aria-label')?.startsWith('Next · '),
      );

    it('opens by itself on a new page, plans it, and folds after', async () => {
      getContentDraft.mockResolvedValue(
        draft({ method: 'create', bodyHtml: '<h1>Pipeline forecasting</h1><p></p>' }),
      );
      getDraftSources.mockResolvedValue({
        data: {
          prompts: [],
          // Something to build the brief from (with none, the step asks for sources).
          fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
          citedPages: [],
          gscQueries: [],
          brandDomains: [],
          competitorDomains: [],
        },
        choices: [],
      });
      rebuildDraftBrief.mockResolvedValue({
        brief: {
          goal: 'Win forecasting searches',
          audience: 'Sales leaders',
          outline: [],
          keywords: [],
          origin: 'rebuild',
          builtAt: '2026-10-21T10:00:00Z',
          builtFrom: { prompts: 0, fanouts: 0, pages: 0, queries: 0 },
        },
      });
      window.innerWidth = 1440;
      await renderPage();
      expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Plan the page');
      expect(basket()!.textContent).toContain(
        'No brief yet. I build one from your prompts, fan-outs and cited pages.',
      );
      // A window over the page holds the focus (a modal): the person is never left typing behind it.
      await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(basket()!.contains(document.activeElement)).toBe(true);

      await act(async () => inBasket('Build brief')!.click());
      await act(async () => {});
      expect(rebuildDraftBrief).toHaveBeenCalledTimes(1);
      expect(selectedSegment()).toBe('Brief');
      // Planned: the first draft is next, and the basket has folded.
      expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Write the first draft');
      expect(basket()).toBeNull();
    });

    it('skips a step on this draft until its state changes, and stays shut on a page with words', async () => {
      getContentDraft.mockResolvedValue(draft({ method: 'create' }));
      await renderPage();
      expect(basket()).toBeNull();
      expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Plan the page');
      await act(async () => nextButton()!.click());
      await act(async () => inBasket('Skip this step')!.click());
      expect(nextButton()!.getAttribute('aria-label')).not.toBe('Next · Plan the page');
      expect(JSON.parse(localStorage.getItem('aeo:next-step-skips:d1')!)).toEqual({
        plan: 'false',
      });

      // Opened again, the skip holds.
      await act(async () => root.unmount());
      root = createRoot(container);
      await renderPage();
      expect(nextButton()!.getAttribute('aria-label')).not.toBe('Next · Plan the page');
    });

    it('drops a stale skip once the reads are in, in phase 2 the brand facts too', async () => {
      const skips = () => JSON.parse(localStorage.getItem('aeo:next-step-skips:d1')!);
      getContentAuthors.mockResolvedValue({
        authors: [],
        brands: [{ id: 'b1', name: 'Acme' }],
        me: { id: 'u1', role: 'admin' },
      });
      getContentDraft.mockResolvedValue(draft({ method: 'create' }));
      try {
        // Phase 1 reads no brand facts: nothing to wait for.
        process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
        localStorage.setItem('aeo:next-step-skips:d1', JSON.stringify({ plan: 'true' }));
        await renderPage();
        expect(skips()).toEqual({});

        // Phase 2: they move Trust, which a proof skip was made at.
        process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
        localStorage.setItem('aeo:next-step-skips:d1', JSON.stringify({ plan: 'true' }));
        let factsIn!: (read: unknown) => void;
        getBrandFacts.mockReturnValue(new Promise((resolve) => (factsIn = resolve)));
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        await act(async () => root.unmount());
        root = createRoot(container);
        await renderPage();
        // The page's read for proof is in, a few seconds after it opens.
        await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
        expect(skips()).toEqual({ plan: 'true' });
        await act(async () =>
          factsIn({
            facts: [],
            pages: [],
            checkedAt: null,
            recheckAt: null,
            paused: false,
            noDomain: false,
          }),
        );
        expect(skips()).toEqual({});
      } finally {
        vi.useRealTimers();
        delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
      }
    });

    it("stays open on Skip, and leaves an empty page to the person once they'll write it", async () => {
      getContentDraft.mockResolvedValue(
        draft({ method: 'create', bodyHtml: '<h1>Pipeline forecasting</h1><p></p>' }),
      );
      await renderPage();
      expect(basket()).not.toBeNull();
      await act(async () => inBasket('Skip this step')!.click());
      expect(basket()).not.toBeNull();
      expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Write the first draft');

      await act(async () => inBasket("I'll write it")!.click());
      // The basket finishes closing (and the editor takes the caret) on the next frame.
      await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
      expect(basket()).toBeNull();
      // The caret goes to the end of the page, to write there.
      const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
        .editor;
      expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
      // No agent work on an empty page the person writes: only their own step.
      await act(async () => nextButton()!.click());
      expect(basket()!.textContent).toContain(
        'The page is empty: write it, and the next step follows from what you write.',
      );
      expect(inBasket('Write with Agent')).toBeUndefined();
      expect(inBasket('Skip this step')).toBeUndefined();
    });

    it('opens as a window in the page’s middle, closing on Escape with focus back on Next (the user, 2026-11-03)', async () => {
      getContentDraft.mockResolvedValue(draft({ method: 'create' }));
      await renderPage();
      await act(async () => nextButton()!.click());
      expect(basket()).not.toBeNull();
      // Every step on the left, the one to take on the right.
      expect(basket()!.querySelector('aside ol[aria-label="All steps"]')).not.toBeNull();
      expect(basket()!.querySelector('section')!.textContent).toContain('Plan the page');
      await act(async () => {
        (document.activeElement ?? document.body).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
      expect(basket()).toBeNull();
      expect(document.activeElement).toBe(nextButton());
    });

    it('keeps a skip while the sources load again, as the fan-out rules read them', async () => {
      const sources = {
        data: {
          prompts: [],
          fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
          citedPages: [],
          gscQueries: [],
          brandDomains: [],
          competitorDomains: [],
        },
        choices: [],
      };
      getDraftSources.mockResolvedValue(sources);
      getDraftBrief.mockResolvedValue({
        brief: {
          goal: 'Win forecasting searches',
          audience: 'Sales leaders',
          outline: [],
          keywords: [],
          origin: 'rebuild',
          builtAt: '2026-10-21T10:00:00Z',
          builtFrom: { prompts: 0, fanouts: 1, pages: 0, queries: 0 },
        },
      });
      getContentDraft.mockResolvedValue(
        draft({
          method: 'create',
          pageType: 'blog_post',
          rules: {
            set: null,
            source: 'default',
            overrides: { length: { on: false } },
            textRules: [],
          },
        }),
      );
      await renderPage();
      expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Fix open rules');
      await act(async () => nextButton()!.click());
      await act(async () => inBasket('Skip this step')!.click());
      const skips = () => JSON.parse(localStorage.getItem('aeo:next-step-skips:d1')!);
      const skippedAt = skips().fixRules;
      expect(skippedAt).toContain('fanoutH2');

      // Opened again, the sources come last: until then the fan-out rule reads
      // as "no fan-outs", and the skip mustn't be dropped for it.
      let answer: (value: unknown) => void = () => {};
      getDraftSources.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      await act(async () => root.unmount());
      root = createRoot(container);
      await renderPage();
      expect(skips().fixRules).toBe(skippedAt);
      await act(async () => answer(sources));
      expect(skips().fixRules).toBe(skippedAt);
      expect(nextButton()!.getAttribute('aria-label')).not.toBe('Next · Fix open rules');
    });

    /** A page whose next step is Fix open rules, the agent's run left under way. */
    function fixUnderWay() {
      getDraftSources.mockResolvedValue({
        data: {
          prompts: [],
          fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
          citedPages: [],
          gscQueries: [],
          brandDomains: [],
          competitorDomains: [],
        },
        choices: [],
      });
      getDraftBrief.mockResolvedValue({
        brief: {
          goal: 'Win forecasting searches',
          audience: 'Sales leaders',
          outline: [],
          keywords: [],
          origin: 'rebuild',
          builtAt: '2026-10-21T10:00:00Z',
          builtFrom: { prompts: 0, fanouts: 1, pages: 0, queries: 0 },
        },
      });
      getContentDraft.mockResolvedValue(
        draft({
          method: 'create',
          pageType: 'blog_post',
          rules: {
            set: null,
            source: 'default',
            overrides: { length: { on: false } },
            textRules: [],
          },
        }),
      );
      fixDraftRules.mockReturnValue(new Promise(() => {}));
    }
    const runFix = async () => {
      await act(async () => nextButton()!.click());
      await act(async () => inBasket('Fix open rules')!.click());
      await act(async () => {});
    };
    const pill = () => container.querySelector<HTMLElement>('header [data-slot="status-pill"]');
    const trayCalls = (fetch: ReturnType<typeof vi.fn>) =>
      fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/chat/runs/tray'));

    it('shows no "1 running" beside the agent card while Fix open rules works: the card says it (editor UX review 2026-11-03)', async () => {
      const fetch = vi.fn(async () => new Response('{}'));
      vi.stubGlobal('fetch', fetch);
      try {
        fixUnderWay();
        await renderPage();
        // Chat off: no page pill, and no runs tray or its read.
        expect(pill()).toBeNull();
        expect(container.querySelector('[data-action="runs.toggleTray"]')).toBeNull();
        await runFix();
        expect(basket()).toBeNull();
        expect(button('1 running')).toBeUndefined();
        expect(
          container.querySelector('[role="region"][aria-label="Agent suggestions"]')!.textContent,
        ).toContain('Content Agent is working');
        // Next still shows the run's steps and Stop.
        await act(async () => nextButton()!.click());
        expect(basket()!.textContent).toContain('Content Agent is working');
        expect(trayCalls(fetch)).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('with the new Chat on, shows the page’s pill and the runs tray in place of "1 running"', async () => {
      const fetch = vi.fn(
        async () => new Response(JSON.stringify({ ok: true, runs: [], running: 0, needsYou: 0 })),
      );
      vi.stubGlobal('fetch', fetch);
      try {
        fixUnderWay();
        await renderPage('admin', { chatOn: true });
        // In review: the agent wrote it, and the person's OK is next.
        expect(pill()!.dataset.state).toBe('needsYou');
        expect(container.querySelector('header [data-action="runs.toggleTray"]')).not.toBeNull();
        expect(trayCalls(fetch).map(([url]) => url)).toContain('/api/chat/runs/tray?brand=b1');
        const readsBefore = trayCalls(fetch).length;
        await runFix();
        expect(pill()!.dataset.state).toBe('working');
        // The tray reads again as Fix starts: its run shows without waiting for the next poll.
        expect(trayCalls(fetch).length).toBeGreaterThan(readsBefore);
        expect(button('1 running')).toBeUndefined();
        // Fix is the server's now: the page can be left.
        expect(container.textContent).toContain("You can leave this page. I'll keep going.");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    describe('once the agent took Fix open rules (editor test 2026-10-26)', () => {
      beforeEach(() => {
        getDraftSources.mockResolvedValue({
          data: {
            prompts: [],
            fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
            citedPages: [],
            gscQueries: [],
            brandDomains: [],
            competitorDomains: [],
          },
          choices: [],
        });
        getDraftBrief.mockResolvedValue({
          brief: {
            goal: 'Win forecasting searches',
            audience: 'Sales leaders',
            outline: [],
            keywords: [],
            origin: 'rebuild',
            builtAt: '2026-10-21T10:00:00Z',
            builtFrom: { prompts: 0, fanouts: 1, pages: 0, queries: 0 },
          },
        });
        getContentDraft.mockResolvedValue(
          draft({
            method: 'create',
            pageType: 'blog_post',
            rules: {
              set: null,
              source: 'default',
              overrides: { length: { on: false } },
              textRules: [],
            },
          }),
        );
      });
      // Where Next goes from Fix open rules on this page: step 4.
      const MOVED_ON = 'Next · Add proof and author';
      // A pass waits for the rules' read of the page (PAGE_READ_DELAY_MS and a beat).
      const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 700)));
      const stored = () => JSON.parse(localStorage.getItem('aeo:next-step-third-try:d1') ?? 'null');
      const LONG = {
        method: 'create' as const,
        pageType: 'blog_post',
        bodyHtml: `<h1>Pipeline forecasting</h1>${'<p>Teams trust the forecast because it reads the pipeline every day.</p>'.repeat(30)}`,
        rules: {
          set: null,
          source: 'default' as const,
          overrides: { length: { value: '400' } },
          textRules: [],
        },
      };
      const runFix = async () => {
        await renderPage();
        expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Fix open rules');
        await act(async () => nextButton()!.click());
        await act(async () => inBasket('Fix open rules')!.click());
        await act(async () => {});
      };

      it('moves on once its changes are decided, with the rule still open', async () => {
        getDraftSuggestions.mockResolvedValueOnce([]).mockResolvedValue([
          {
            id: 'n9',
            batchId: 'b9',
            actionId: null,
            actionNo: null,
            kind: 'replace' as const,
            blockText: 'Teams trust it.',
            beforeText: 'trust',
            afterText: 'rely on',
            reason: 'answer the AI search (rule)',
            ruleKeys: ['fanoutH2'],
            status: 'open' as const,
          },
        ]);
        fixDraftRules.mockResolvedValue({ count: 1 });
        await runFix();
        // Its change waits for a decision: the step is to review it (editor UX review 2026-11-03).
        expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Review 1 suggestion');
        const card = container.querySelector('[role="region"][aria-label="Agent suggestions"]')!;
        await act(async () =>
          [...card.querySelectorAll('button')].find((b) => b.textContent === 'Reject all')!.click(),
        );
        await settle();
        // Rejected, the fan-out rule is still open, and Next moves on.
        expect(nextButton()!.getAttribute('aria-label')).toBe(MOVED_ON);
        // The path says it was passed, not done.
        await act(async () => nextButton()!.click());
        expect(basket()!.textContent).toContain(
          'Fix open rulesdone by Content Agent, the rest is in Rules',
        );
        // Passed with what the page read then: the rule left open, and its batch.
        expect(JSON.parse(localStorage.getItem('aeo:next-step-third-try:d1')!)).toEqual({
          attempt: null,
          passes: {
            fixRules: { rules: expect.arrayContaining(['fanoutH2']), length: '', batch: 'b9' },
          },
        });
      });

      it("stays passed when the agent's own later batch opens a rule, and not when the person's edits do (editor test 2026-11-03)", async () => {
        // Fix open rules taken with batch b9, every rule then closed.
        const passed = (batch: string) =>
          localStorage.setItem(
            'aeo:next-step-third-try:d1',
            JSON.stringify({
              attempt: null,
              passes: { fixRules: { rules: [], length: '', batch } },
            }),
          );
        const handOff = (batchId: string) => [
          {
            id: 'h1',
            batchId,
            actionId: null,
            actionNo: null,
            kind: 'replace' as const,
            blockText: 'Teams trust it.',
            beforeText: 'trust',
            afterText: 'rely on',
            reason: 'a Quality check (hand-off)',
            ruleKeys: [],
            status: 'accepted' as const,
          },
        ];
        // A hand-off since (b10), decided, left rules open: its own, so Next holds.
        passed('b9');
        getDraftSuggestions.mockResolvedValue(handOff('b10'));
        await renderPage();
        await settle();
        expect(nextButton()!.getAttribute('aria-label')).toBe(MOVED_ON);
        // Read again with the page as it reads now, and its batch.
        expect(stored().passes.fixRules).toEqual({
          rules: expect.arrayContaining(['fanoutH2']),
          length: '',
          batch: 'b10',
        });
        // No batch since: the rules open now are none the agent saw, so it's the agent's again.
        await act(async () => root.unmount());
        root = createRoot(container);
        passed('b10');
        await renderPage();
        await settle();
        expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Fix open rules');
        expect(stored()).toBeNull();
      });

      it('isn’t passed by a Fix of some of its rules only (#1550 review)', async () => {
        getContentDraft.mockResolvedValue(
          draft({
            method: 'create',
            pageType: 'blog_post',
            bodyHtml: '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p>',
            rules: {
              set: null,
              source: 'default',
              overrides: { length: { on: false } },
              textRules: [],
            },
          }),
        );
        getDraftSuggestions.mockResolvedValue([]);
        // It finds nothing to change: a run of the whole step would pass it.
        fixDraftRules.mockResolvedValue({ count: 0 });
        await renderPage();
        expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Fix open rules');
        // The Rules tab's Fix on Remove AI traces alone isn't the step.
        await act(async () =>
          container
            .querySelector<HTMLButtonElement>('header button[aria-label^="Rules "]')!
            .click(),
        );
        const fixTraces = [
          ...container.querySelectorAll<HTMLButtonElement>('aside li button'),
        ].find((b) => b.textContent === 'Fix');
        expect(fixTraces).toBeDefined();
        await act(async () => fixTraces!.click());
        await act(async () => {});
        expect(fixDraftRules.mock.calls[0][2].rules.map((r: { key: string }) => r.key)).toEqual([
          'aiTraces',
        ]);
        // No attempt is kept for it, and once the page reads it, Next stays (#1556 review).
        expect(stored()).toBeNull();
        await settle();
        expect(stored()).toBeNull();
        expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Fix open rules');
      });

      it('on the Length step, isn’t passed by a Fix, and is by a rewrite once decided', async () => {
        getContentDraft.mockResolvedValue(draft(LONG));
        getDraftSuggestions.mockResolvedValue([]);
        fixDraftRules.mockResolvedValue({ count: 0 });
        await renderPage();
        expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Shorten to your Length');
        // The step's other button, Fix open rules: it takes Fix open rules, not the Length.
        await act(async () => nextButton()!.click());
        await act(async () => inBasket('Fix open rules')!.click());
        await settle();
        expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Shorten to your Length');
        expect(stored().passes).toEqual({ fixRules: expect.any(Object) });

        // A rewrite begun on it, then the waiting page; its page decided.
        localStorage.setItem(
          'aeo:next-step-third-try:d1',
          JSON.stringify({
            attempt: { step: 'length', kind: 'rewrite', at: new Date().toISOString(), batch: null },
            passes: {},
          }),
        );
        getDraftSuggestions.mockResolvedValue([
          {
            id: 'p9',
            batchId: 'b9',
            actionId: null,
            actionNo: null,
            kind: 'page' as const,
            blockText: 'Pipeline forecasting',
            beforeText: '',
            beforeHtml: LONG.bodyHtml,
            afterText: LONG.bodyHtml,
            reason: 'rewrote the page to the rules',
            ruleKeys: ['length'],
            status: 'rejected' as const,
          },
        ]);
        await act(async () => root.unmount());
        root = createRoot(container);
        await renderPage();
        await settle();
        expect(nextButton()!.getAttribute('aria-label')).not.toBe('Next · Shorten to your Length');
        expect(stored().passes).toEqual({ length: expect.any(Object) });
      });

      it.each([
        ['rewrite', 'stopped', { outcome: 'stopped' }],
        ['rewrite', 'failed', { outcome: 'failed' }],
        // A Stop writes stopped_at before the outcome.
        ['rewrite', 'stopped, its outcome not yet written', { outcome: null }],
        // A tab closed mid-run (#1556 review).
        ['fix', 'stopped', { outcome: 'stopped' }],
        ['fix', 'failed', { outcome: 'failed' }],
      ] as const)(
        'drops a %s attempt whose run was %s while the page was closed',
        async (kind, _, ended) => {
          const attempt = {
            step: kind === 'rewrite' ? 'length' : 'fixRules',
            kind,
            at: new Date(Date.now() - 60_000).toISOString(),
            batch: null,
          };
          localStorage.setItem(
            'aeo:next-step-third-try:d1',
            JSON.stringify({ attempt, passes: {} }),
          );
          readAgentRun.mockResolvedValue({
            id: 'r1',
            kind,
            steps: [],
            step: 0,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            stoppedAt: ended.outcome === 'failed' ? null : new Date().toISOString(),
            ...ended,
          });
          // A batch from something else, decided: it mustn't pass the step.
          getDraftSuggestions.mockResolvedValue([
            {
              id: 'n7',
              batchId: 'b7',
              actionId: null,
              actionNo: null,
              kind: 'replace' as const,
              blockText: 'Teams trust it.',
              beforeText: 'trust',
              afterText: 'rely on',
              reason: 'a Quality check (hand-off)',
              ruleKeys: [],
              status: 'rejected' as const,
            },
          ]);
          await renderPage();
          await settle();
          expect(readAgentRun).toHaveBeenCalledWith('d1', [kind]);
          expect(
            JSON.parse(localStorage.getItem('aeo:next-step-third-try:d1') ?? 'null'),
          ).toBeNull();
          expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Fix open rules');
        },
      );

      const doneRun = (writes: number) => ({
        id: 'r1',
        kind: 'fix',
        steps: [
          { key: 'read', count: null },
          { key: 'rules', count: 1 },
          { key: 'write', count: writes },
        ],
        step: 3,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        stoppedAt: null,
        outcome: 'done',
      });

      it('passes a Fix that found nothing while the page was closed (#1556 review)', async () => {
        localStorage.setItem(
          'aeo:next-step-third-try:d1',
          JSON.stringify({
            attempt: {
              step: 'fixRules',
              kind: 'fix',
              at: new Date(Date.now() - 60_000).toISOString(),
              batch: null,
            },
            passes: {},
          }),
        );
        // It left no batch: its row says it wrote nothing.
        readAgentRun.mockResolvedValue(doneRun(0));
        getDraftSuggestions.mockResolvedValue([]);
        await renderPage();
        await settle();
        expect(nextButton()!.getAttribute('aria-label')).toBe(MOVED_ON);
        expect(stored()).toEqual({ attempt: null, passes: { fixRules: expect.any(Object) } });
      });

      it('keeps a Fix begun while the read of an earlier run is still out (#1556 review)', async () => {
        localStorage.setItem(
          'aeo:next-step-third-try:d1',
          JSON.stringify({
            attempt: {
              step: 'fixRules',
              kind: 'fix',
              at: new Date(Date.now() - 60_000).toISOString(),
              batch: null,
            },
            passes: {},
          }),
        );
        // The open-time read of the earlier run, alone: it lands after the new Fix.
        let readRun!: (run: unknown) => void;
        readAgentRun.mockImplementation((_id: string, kinds?: string[]) =>
          kinds?.length === 1 && kinds[0] === 'fix'
            ? new Promise((resolve) => (readRun = resolve))
            : Promise.resolve(null),
        );
        getDraftSuggestions.mockResolvedValue([]);
        fixDraftRules.mockResolvedValue({ count: 0 });
        await runFix();
        // The earlier run failed: only its own attempt would go.
        await act(async () => readRun({ ...doneRun(0), outcome: 'failed' }));
        await settle();
        expect(nextButton()!.getAttribute('aria-label')).toBe(MOVED_ON);
        expect(stored()).toEqual({ attempt: null, passes: { fixRules: expect.any(Object) } });
      });

      it('doesn’t put back an attempt found failed when a Fix begun meanwhile doesn’t run (#1556 review)', async () => {
        localStorage.setItem(
          'aeo:next-step-third-try:d1',
          JSON.stringify({
            attempt: {
              step: 'fixRules',
              kind: 'fix',
              at: new Date(Date.now() - 60_000).toISOString(),
              batch: null,
            },
            passes: {},
          }),
        );
        let readRun!: (run: unknown) => void;
        readAgentRun.mockImplementation((_id: string, kinds?: string[]) =>
          kinds?.length === 1 && kinds[0] === 'fix'
            ? new Promise((resolve) => (readRun = resolve))
            : Promise.resolve(null),
        );
        getDraftSuggestions.mockResolvedValue([]);
        let ran!: (result: unknown) => void;
        fixDraftRules.mockReturnValue(new Promise((resolve) => (ran = resolve)));
        await runFix();
        // The earlier run failed; then the new one fails too: neither is an attempt.
        await act(async () => readRun({ ...doneRun(0), outcome: 'failed' }));
        await act(async () => ran({ error: 'failed' }));
        await act(async () => {});
        expect(stored()).toBeNull();
      });

      it('waits for the read of the rewrite shown now, not one before it (#1556 review)', async () => {
        localStorage.setItem(
          'aeo:next-step-third-try:d1',
          JSON.stringify({
            attempt: { step: 'length', kind: 'rewrite', at: new Date().toISOString(), batch: null },
            passes: {},
          }),
        );
        // Its page decided: once read, the step passes.
        getDraftSuggestions.mockResolvedValue([
          {
            id: 'p9',
            batchId: 'b9',
            actionId: null,
            actionNo: null,
            kind: 'page' as const,
            blockText: 'Pipeline forecasting',
            beforeText: '',
            beforeHtml: draft().bodyHtml,
            afterText: draft().bodyHtml,
            reason: 'rewrote the page to the rules',
            ruleKeys: [],
            status: 'rejected' as const,
          },
        ]);
        // Read before the rewrite showed, then again for it: that read is out.
        let lastRead!: (last: null) => void;
        getLastPageRewrite.mockImplementation(async (..._args: unknown[]) =>
          getLastPageRewrite.mock.calls.length === 1
            ? null
            : new Promise((resolve) => (lastRead = resolve)),
        );
        await renderPage();
        await settle();
        expect(getLastPageRewrite).toHaveBeenCalledTimes(2);
        expect(stored().passes).toEqual({});
        await act(async () => lastRead(null));
        await settle();
        expect(stored()).toEqual({ attempt: null, passes: { length: expect.any(Object) } });
      });

      it('passes the step though a Quality read failed: it waits only for what it compares (#1556 review)', async () => {
        // No authors: E-E-A-T, and the to-dos with it, never read.
        getContentAuthors.mockRejectedValue(new Error('offline'));
        getDraftSuggestions.mockResolvedValue([]);
        fixDraftRules.mockResolvedValue({ count: 0 });
        await runFix();
        await settle();
        expect(stored()).toEqual({ attempt: null, passes: { fixRules: expect.any(Object) } });
      });

      it('waits for the last rewrite’s read, which the Length’s state reads (#1556 review)', async () => {
        let lastRead!: (last: null) => void;
        getLastPageRewrite.mockReturnValue(new Promise((resolve) => (lastRead = resolve)));
        getDraftSuggestions.mockResolvedValue([]);
        fixDraftRules.mockResolvedValue({ count: 0 });
        await runFix();
        await settle();
        expect(stored()).toMatchObject({ attempt: { step: 'fixRules', ended: true } });
        expect(stored().passes).toEqual({});
        await act(async () => lastRead(null));
        await settle();
        expect(stored()).toEqual({ attempt: null, passes: { fixRules: expect.any(Object) } });
      });

      it('clears the steps passed when a rewrite’s page is accepted, as Start does (#1556 review)', async () => {
        getDraftSuggestions.mockResolvedValue([]);
        fixDraftRules.mockResolvedValue({ count: 0 });
        await runFix();
        await settle();
        expect(stored().passes).toEqual({ fixRules: expect.any(Object) });
        // A rewrite begun since, its page waiting.
        localStorage.setItem(
          'aeo:next-step-third-try:d1',
          JSON.stringify({
            ...stored(),
            attempt: { step: 'length', kind: 'rewrite', at: new Date().toISOString(), batch: null },
          }),
        );
        const body = draft().bodyHtml;
        getDraftSuggestions.mockResolvedValue([
          {
            id: 'p9',
            batchId: 'b9',
            actionId: null,
            actionNo: null,
            kind: 'page' as const,
            blockText: 'Pipeline forecasting',
            beforeText: '',
            beforeHtml: body,
            afterText: body.replace('Teams trust it.', 'Teams rely on it.'),
            reason: 'rewrote the page to the rules',
            ruleKeys: [],
            status: 'open' as const,
          },
        ]);
        await act(async () => root.unmount());
        root = createRoot(container);
        await renderPage();
        await act(async () => {});
        expect(stored().passes).toEqual({ fixRules: expect.any(Object) });
        const bar = container.querySelector('[role="region"][aria-label="Rewritten page"]')!;
        await act(async () =>
          [...bar.querySelectorAll('button')].find((b) => b.textContent === 'Accept')!.click(),
        );
        await act(async () => {});
        expect(decideDraftSuggestions).toHaveBeenCalledWith(['p9'], 'accepted');
        // A page written again: what was passed on the page before is gone;
        // the rewrite's own attempt stays, to pass its step.
        expect(stored().passes).toEqual({});
        expect(stored().attempt).toMatchObject({ step: 'length', kind: 'rewrite' });
      });

      it('drops a rewrite’s attempt when the page opens on that rewrite having failed', async () => {
        localStorage.setItem(
          'aeo:next-step-third-try:d1',
          JSON.stringify({
            attempt: { step: 'length', kind: 'rewrite', at: new Date().toISOString(), batch: null },
            passes: {},
          }),
        );
        getContentDraft.mockResolvedValue(
          draft({ ...LONG, agentState: 'failed', agentRun: 'rewrite' }),
        );
        await renderPage();
        await act(async () => {});
        expect(stored()).toBeNull();
      });

      it('brings the step back once a rule opens that the agent never saw', async () => {
        getDraftSuggestions.mockResolvedValue([]);
        fixDraftRules.mockResolvedValue({ count: 0 });
        await runFix();
        await settle();
        expect(nextButton()!.getAttribute('aria-label')).toBe(MOVED_ON);
        // As if fanoutH2 had opened since the step was taken.
        const key = 'aeo:next-step-third-try:d1';
        const stored = JSON.parse(localStorage.getItem(key)!);
        stored.passes.fixRules.rules = stored.passes.fixRules.rules.filter(
          (rule: string) => rule !== 'fanoutH2',
        );
        localStorage.setItem(key, JSON.stringify(stored));
        await act(async () => root.unmount());
        root = createRoot(container);
        await renderPage();
        expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Fix open rules');
        // The pass that no longer holds is dropped, as a stale skip is.
        await settle();
        expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toBeNull();
      });

      it('takes the step when the answer was lost and its run says it found nothing', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        getDraftSuggestions.mockResolvedValue([]);
        fixDraftRules.mockResolvedValue({ error: 'unconfirmed' });
        // The run there was before it is none; once it was asked, its row says it found nothing.
        const run = {
          id: 'r9',
          kind: 'fix',
          steps: [
            { key: 'read', count: null },
            { key: 'rules', count: 1 },
            { key: 'write', count: 0 },
          ],
          step: 3,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          stoppedAt: null,
          outcome: 'done',
        };
        readAgentRun.mockImplementation(async () => (fixDraftRules.mock.calls.length ? run : null));
        try {
          await renderPage();
          await act(async () => nextButton()!.click());
          await act(async () => inBasket('Fix open rules')!.click());
          await act(async () => void (await vi.advanceTimersByTimeAsync(6_000)));
          await act(async () => void (await vi.advanceTimersByTimeAsync(1_000)));
          expect(nextButton()!.getAttribute('aria-label')).toBe(MOVED_ON);
        } finally {
          vi.useRealTimers();
        }
      });

      it('is the restored page’s again after a restore', async () => {
        getDraftSuggestions.mockResolvedValue([]);
        fixDraftRules.mockResolvedValue({ count: 0 });
        await runFix();
        await settle();
        expect(nextButton()!.getAttribute('aria-label')).toBe(MOVED_ON);
        getDraftVersions.mockResolvedValue([
          { id: 'v1', origin: 'import', title: 'Old title', createdAt: '2026-10-12T09:42:00Z' },
        ]);
        restoreDraftVersion.mockResolvedValue({
          title: 'Old title',
          bodyHtml: '<h1>Old title</h1><p>As it was.</p>',
          updatedAt: '2026-10-21T10:00:00Z',
          restored: true,
        });
        const trigger = button('History')!;
        await act(async () => {
          trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
          trigger.click();
        });
        await act(async () => {});
        const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
        await act(async () => items[items.length - 1].click());
        await act(async () => {});
        expect(restoreDraftVersion).toHaveBeenCalled();
        expect(stored()).toBeNull();
        expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Fix open rules');
      });

      it('moves on when it found nothing to change', async () => {
        getDraftSuggestions.mockResolvedValue([]);
        fixDraftRules.mockResolvedValue({ count: 0 });
        await runFix();
        await settle();
        expect(nextButton()!.getAttribute('aria-label')).toBe(MOVED_ON);
        // Opened again, it holds.
        await act(async () => root.unmount());
        root = createRoot(container);
        await renderPage();
        expect(nextButton()!.getAttribute('aria-label')).toBe(MOVED_ON);
      });

      it('stays when the run failed, or never ran', async () => {
        getDraftSuggestions.mockResolvedValue([]);
        fixDraftRules.mockResolvedValue({ error: 'failed' });
        await runFix();
        expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Fix open rules');
        expect(localStorage.getItem('aeo:next-step-third-try:d1')).toBeNull();
        // Nothing was tried: Rules stays red, the agent's to fix.
        expect(localStorage.getItem('aeo:agent-tried-rules:d1')).toBeNull();
      });

      it('shows the rules it tried and couldn’t close amber in Rules, red until then (editor test 2026-11-03)', async () => {
        getDraftSuggestions.mockResolvedValue([]);
        const rulesBadge = () =>
          [...container.querySelectorAll<HTMLElement>('aside [data-segment="rules"] span')].find(
            (s) => /open/.test(s.textContent ?? ''),
          )!;
        await renderPage();
        await act(async () =>
          container
            .querySelector<HTMLButtonElement>('header button[aria-label^="Rules "]')!
            .click(),
        );
        // Open, the agent's still: amber outline, never red (red is for what blocks).
        expect(rulesBadge().className).toContain('border-amber-200');
        expect(rulesBadge().className).not.toContain('red');
        // It finds nothing to change: every rule it was sent is tried.
        fixDraftRules.mockResolvedValue({ count: 0 });
        await act(async () => nextButton()!.click());
        await act(async () => inBasket('Fix open rules')!.click());
        await settle();
        const sent = fixDraftRules.mock.calls[0][2].rules.map((r: { key: string }) => r.key);
        expect(JSON.parse(localStorage.getItem('aeo:agent-tried-rules:d1')!).tried).toEqual(
          [...sent].sort(),
        );
        expect(rulesBadge().className).toContain('bg-amber-50');
        expect(container.querySelector('aside')!.textContent).toContain(
          "Content Agent tried this and couldn't fix it",
        );
      });

      it('stays when the changes it shows are another tab’s, decided here', async () => {
        getDraftSuggestions.mockResolvedValueOnce([]).mockResolvedValue([
          {
            id: 'n8',
            batchId: 'b8',
            actionId: null,
            actionNo: null,
            kind: 'replace' as const,
            blockText: 'Teams trust it.',
            beforeText: 'trust',
            afterText: 'rely on',
            reason: 'answer the AI search (rule)',
            ruleKeys: ['fanoutH2'],
            status: 'open' as const,
          },
        ]);
        // Another tab's run left changes to decide first: this one never ran.
        fixDraftRules.mockResolvedValue({ error: 'open_suggestions' });
        await runFix();
        const card = container.querySelector('[role="region"][aria-label="Agent suggestions"]')!;
        await act(async () =>
          [...card.querySelectorAll('button')].find((b) => b.textContent === 'Reject all')!.click(),
        );
        await act(async () => {});
        expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Fix open rules');
      });

      it('stays when the run is stopped', async () => {
        getDraftSuggestions.mockResolvedValue([]);
        fixDraftRules.mockResolvedValue({ error: 'stopped' });
        await runFix();
        expect(nextButton()!.getAttribute('aria-label')).toBe('Next · Fix open rules');
      });
    });

    it('stays out of the header while Quality is off', async () => {
      delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
      getContentDraft.mockResolvedValue(
        draft({ bodyHtml: '<h1>Pipeline forecasting</h1><p></p>' }),
      );
      await renderPage();
      expect(nextButton()).toBeUndefined();
      expect(basket()).toBeNull();
    });
  });

  describe('Run Agent: fix open rules', () => {
    const traced = draft({
      pageType: 'blog_post',
      bodyHtml: '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p>',
    });
    const agentSuggestion = {
      id: 'n1',
      batchId: 'b2',
      actionId: null,
      actionNo: null,
      kind: 'replace' as const,
      blockText: 'We delve into how teams forecast.',
      beforeText: 'delve into',
      afterText: 'look at',
      reason: 'remove an AI trace (rule)',
      ruleKeys: ['aiTraces'],
      status: 'open' as const,
    };
    /** Opens the Rules tab from the header's chip. */
    async function openRules() {
      window.innerWidth = 1024;
      await renderPage();
      const chip = container.querySelector<HTMLButtonElement>(
        'header button[aria-label^="Rules "]',
      )!;
      await act(async () => chip.click());
    }
    const panelButton = (label: string) =>
      [...panel()!.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === label,
      )!;

    it('says when a change would break a rule the page meets now, on it and on the card', async () => {
      getContentDraft.mockResolvedValue(traced);
      // Its new words make the page's one sentence run past 150 characters.
      getDraftSuggestions.mockResolvedValue([
        { ...agentSuggestion, afterText: `look ${'very '.repeat(35)}closely at` },
      ]);
      await renderPage();
      await act(async () => {});
      expect(container.querySelector('.ProseMirror')!.textContent).toContain(
        'Would break Max sentence length',
      );
      expect(
        container.querySelector('[role="region"][aria-label="Agent suggestions"]')!.textContent,
      ).toContain('would break Max sentence length');
    });

    it('tells a Fix run how far past its Length the page is when it doesn’t send the Length (#1552 review)', async () => {
      getContentDraft.mockResolvedValue({
        ...traced,
        rules: { set: null, source: null, overrides: { length: { value: '20' } }, textRules: [] },
      });
      getDraftSuggestions.mockResolvedValue([]);
      fixDraftRules.mockResolvedValue({ count: 0 });
      await openRules();
      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});
      const sent = fixDraftRules.mock.calls[0][2];
      // Far past its 20 characters, the Length is held from Fix: the hint says how far off the page is.
      expect(sent.rules.map((r: { key: string }) => r.key)).not.toContain('length');
      expect(sent.overLength).toEqual({ count: expect.any(Number), max: 24 });
    });

    it('says the month’s AI usage is used up before anything else, and runs nothing', async () => {
      aiUsage.usage = usageAt(100);
      getContentDraft.mockResolvedValue(traced);
      // An open suggestion would hold Run Agent too: the used-up month comes first.
      getDraftSuggestions.mockResolvedValue([agentSuggestion]);
      await openRules();
      expect(panel()!.textContent).toContain(
        "This month's AI usage is used up. It resets on Nov 20.",
      );
      await act(async () => panelButton('Fix open rules').click());
      expect(fixDraftRules).not.toHaveBeenCalled();
    });

    it('reads the AI usage again once a run ends, for the header meter', async () => {
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValue([]);
      let answer: (value: { count: number }) => void = () => {};
      fixDraftRules.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      await openRules();
      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});
      expect(aiUsage.refresh).not.toHaveBeenCalled();
      await act(async () => answer({ count: 0 }));
      await act(async () => {});
      expect(aiUsage.refresh).toHaveBeenCalledTimes(1);
    });

    it('shows the agent card working while the agent runs, then its batch', async () => {
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValueOnce([]).mockResolvedValueOnce([agentSuggestion]);
      let answer: (value: { count: number }) => void = () => {};
      fixDraftRules.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      await openRules();

      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});
      const card = () =>
        container.querySelector('[role="region"][aria-label="Agent suggestions"]')!;
      expect(card().getAttribute('aria-busy')).toBe('true');
      // No run read yet: no steps, and nothing for Stop to stop.
      expect(card().textContent).toBe('Content Agent is working');
      // The card alone says it works: nothing drafting in the page (editor UX review 2026-11-03).
      expect(container.querySelector('.ProseMirror [data-agent-drafting]')).toBeNull();

      await act(async () => answer({ count: 1 }));
      await act(async () => {});
      expect(card().getAttribute('aria-busy')).toBe('false');
      expect(card().textContent).toContain('Content Agent has 1 suggestion for you');
    });

    it('shows the run’s steps while it works, and Stop leaves the page as it was', async () => {
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValue([]);
      let answer: (value: { error: 'stopped' }) => void = () => {};
      fixDraftRules.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      readAgentRun.mockResolvedValue({
        id: 'r1',
        kind: 'fix',
        steps: [
          { key: 'read_rules', count: 4 },
          { key: 'gather_sources', count: 0 },
          { key: 'write_changes', count: null },
          { key: 'check_sources', count: null },
        ],
        step: 2,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        stoppedAt: null,
        outcome: null,
      });
      await openRules();
      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});
      const card = container.querySelector('[role="region"][aria-label="Agent suggestions"]')!;
      // Its steps, short names for the work; none about data it has none of.
      expect([...card.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
        'Reading 4 rules',
        'Writing changes',
        'Checking sources',
      ]);
      expect(card.querySelector('[aria-current="step"]')!.textContent).toBe('Writing changes');

      const stop = [...card.querySelectorAll('button')].find((b) => b.textContent === 'Stop')!;
      await act(async () => stop.click());
      expect(stopAgentRun).toHaveBeenCalledWith('d1', 'b1', 'r1');
      expect(stop.disabled).toBe(true);
      await act(async () => answer({ error: 'stopped' }));
      await act(async () => {});
      expect(toast).toHaveBeenCalledWith('Stopped · nothing was changed');
      expect(toast.error).not.toHaveBeenCalled();
      expect(container.querySelector('[role="region"][aria-label="Agent suggestions"]')).toBeNull();
    });

    const fixRun = {
      id: 'r1',
      kind: 'fix' as const,
      steps: [{ key: 'write_changes' as const, count: null }],
      step: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      stoppedAt: null,
      outcome: null,
    };
    const agentStop = () =>
      [
        ...container
          .querySelector('[role="region"][aria-label="Agent suggestions"]')!
          .querySelectorAll('button'),
      ].find((b) => b.textContent === 'Stop')!;

    it('says stopped when the answer is lost after Stop, and waits for no batch', async () => {
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValue([]);
      let answer: (value: { error: 'unconfirmed' }) => void = () => {};
      fixDraftRules.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      readAgentRun.mockResolvedValue(fixRun);
      await openRules();
      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});
      const reads = getDraftSuggestions.mock.calls.length;
      await act(async () => agentStop().click());
      await act(async () => answer({ error: 'unconfirmed' }));
      await act(async () => {});
      expect(toast).toHaveBeenCalledWith('Stopped · nothing was changed');
      expect(toast.error).not.toHaveBeenCalled();
      expect(getDraftSuggestions.mock.calls.length).toBe(reads);
    });

    it('lets Stop be pressed again when the run had already ended', async () => {
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValue([]);
      let answer: (value: { count: number }) => void = () => {};
      fixDraftRules.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      readAgentRun.mockResolvedValue(fixRun);
      stopAgentRun.mockResolvedValue({ stopped: false });
      await openRules();
      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});
      await act(async () => agentStop().click());
      expect(agentStop().disabled).toBe(false);
      expect(toast).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      await act(async () => answer({ count: 0 }));
    });

    it('shows no steps of another kind’s run, still open when Fix starts', async () => {
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValue([]);
      let answer: (value: { count: number }) => void = () => {};
      fixDraftRules.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      // A rewrite the server hasn't closed yet: not this run.
      readAgentRun.mockResolvedValue({
        ...fixRun,
        kind: 'rewrite',
        steps: [{ key: 'read_rules', count: 14 }],
      });
      await openRules();
      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});
      const card = container.querySelector('[role="region"][aria-label="Agent suggestions"]')!;
      expect(card.textContent).toBe('Content Agent is working');
      // The agent's dots on Run Agent too: no spinning ring anywhere.
      expect(container.querySelector('.animate-spin')).toBeNull();
      await act(async () => answer({ count: 0 }));
    });

    it('stops the brief from the card; a later Fix’s lost answer still waits for its batch', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        getDraftSources.mockResolvedValue({
          data: {
            prompts: [],
            fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
            citedPages: [],
            gscQueries: [],
            brandDomains: [],
            competitorDomains: [],
          },
          choices: [],
        });
        getContentDraft.mockResolvedValue(traced);
        getDraftSuggestions.mockResolvedValue([]);
        let rebuilt: (value: { error: 'stopped' }) => void = () => {};
        rebuildDraftBrief.mockReturnValue(new Promise((resolve) => (rebuilt = resolve)));
        readAgentRun.mockResolvedValue({
          ...fixRun,
          kind: 'brief',
          steps: [
            { key: 'gather_sources', count: 1 },
            { key: 'write_outline', count: null },
            { key: 'match_fanouts', count: null },
          ],
          step: 1,
        });
        await openRules();
        await pickTab('Sources');
        await act(async () => button('Rebuild with selection')!.click());
        await act(async () => {});
        const card = () =>
          container.querySelector('[role="region"][aria-label="Agent suggestions"]')!;
        expect([...card().querySelectorAll('li')].map((li) => li.textContent)).toEqual([
          'Gathering 1 source',
          'Writing the outline',
          'Matching fan-outs',
        ]);
        // The agent's dots on the button, not a spinning ring.
        expect(container.querySelector('.animate-spin')).toBeNull();

        await act(async () => agentStop().click());
        expect(stopAgentRun).toHaveBeenCalledWith('d1', 'b1', 'r1');
        await act(async () => rebuilt({ error: 'stopped' }));
        expect(toast).toHaveBeenCalledTimes(1);
        expect(toast).toHaveBeenCalledWith('Stopped · nothing was changed');

        // Fix next, its answer lost on the way: no Stop was pressed for it.
        readAgentRun.mockResolvedValue(null);
        fixDraftRules.mockResolvedValue({ error: 'unconfirmed' });
        await pickTab('Rules');
        await act(async () => panelButton('Fix open rules').click());
        await act(async () => {});
        expect(toast).toHaveBeenCalledTimes(1);
        getDraftSuggestions.mockResolvedValue([agentSuggestion]);
        await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
        await act(async () => {});
        expect(toast.success).toHaveBeenCalledWith(
          'Content Agent suggested 1 change · review them in the page',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the brief’s buttons from starting it while Fix runs', async () => {
      getDraftSources.mockResolvedValue({
        data: {
          prompts: [],
          fanouts: [],
          citedPages: [
            {
              url: 'https://a.example/x',
              title: null,
              domain: 'a.example',
              citations: 3,
              answers: 2,
            },
            {
              url: 'https://b.example/y',
              title: null,
              domain: 'b.example',
              citations: 1,
              answers: 1,
            },
          ],
          gscQueries: [],
          brandDomains: [],
          competitorDomains: [],
        },
        choices: [],
      });
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValue([]);
      let answer: (value: { count: number }) => void = () => {};
      fixDraftRules.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      await openRules();
      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});
      await pickTab('Sources');
      expect(button('Rebuild with selection')!.disabled).toBe(true);
      expect(panel()!.textContent).toContain(
        'Content Agent is already working on this page. Wait for it to finish.',
      );
      await act(async () => answer({ count: 0 }));
      // Free of the run, it's held only for want of a prompt, fan-out or query to build from.
      expect(panel()!.textContent).not.toContain('Content Agent is already working on this page.');
      expect(button('Rebuild with selection')!.disabled).toBe(true);
      expect(panel()!.textContent).toContain(
        'Keep at least one prompt, fan-out or Search Console query to build from.',
      );
    });

    it('shows no steps of a run that has ended', async () => {
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValue([]);
      let answer: (value: { count: number }) => void = () => {};
      fixDraftRules.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      // The draft's last run, before this one is written.
      readAgentRun.mockResolvedValue({
        ...fixRun,
        finishedAt: new Date().toISOString(),
        outcome: 'done',
      });
      await openRules();
      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});
      const card = container.querySelector('[role="region"][aria-label="Agent suggestions"]')!;
      expect(card.textContent).toBe('Content Agent is working');
      expect(card.querySelector('li')).toBeNull();
      await act(async () => answer({ count: 0 }));
    });

    it('sends the open rules and leaves the agent’s batch for review', async () => {
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValueOnce([]).mockResolvedValueOnce([agentSuggestion]);
      fixDraftRules.mockResolvedValue({ count: 1 });
      await openRules();

      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});

      const [id, brandId, request] = fixDraftRules.mock.calls[0];
      expect([id, brandId]).toEqual(['d1', 'b1']);
      expect(request.rules).toContainEqual({
        key: 'aiTraces',
        name: 'Remove AI traces (humanize)',
        detail: 'now: 1 found · phrases found: delve',
      });
      expect(request.rules.every((r: { key: string }) => r.key !== 'sentence')).toBe(true);
      // The length as a target band, so the agent knows how far off the page is.
      expect(request.rules).toContainEqual(
        expect.objectContaining({
          key: 'length',
          detail: expect.stringMatching(/now: \d+ characters, under [\d,]+–[\d,]+$/),
        }),
      );
      expect(request).toMatchObject({ textRules: [], locked: [] });
      expect(
        container.querySelector('[role="region"][aria-label="Agent suggestions"]')!.textContent,
      ).toContain('Content Agent has 1 suggestion for you');
      expect(toast.success).toHaveBeenCalledWith(
        'Content Agent suggested 1 change · review them in the page',
      );
    });

    it('names the fan-outs the page doesn’t use yet, so the agent writes those', async () => {
      getContentDraft.mockResolvedValue(traced);
      getDraftSources.mockResolvedValue({
        data: {
          prompts: [],
          fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
          citedPages: [],
          gscQueries: [],
          brandDomains: [],
          competitorDomains: [],
        },
        choices: [],
      });
      fixDraftRules.mockResolvedValue({ count: 0 });
      await openRules();

      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});

      expect(fixDraftRules.mock.calls[0][2].rules).toContainEqual(
        expect.objectContaining({
          key: 'fanoutH2',
          detail: expect.stringContaining(
            'fan-outs to use, in their words: "pipeline forecasting"',
          ),
        }),
      );
    });

    it('sends the sources the Sources tab keeps, numbered by the server (CE-033)', async () => {
      getDraftSources.mockResolvedValue({
        data: {
          prompts: [],
          fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
          citedPages: [],
          gscQueries: [],
          brandDomains: [],
          competitorDomains: [],
        },
        choices: [],
      });
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValue([]);
      fixDraftRules.mockResolvedValue({ count: 0 });
      await openRules();
      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});
      expect(fixDraftRules.mock.calls[0][2].sources).toMatchObject({
        promptIds: [],
        fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'] }],
        pages: [],
        queries: [],
      });
    });

    it('shows what a suggestion was written from, and opens it in Sources', async () => {
      getDraftSources.mockResolvedValue({
        data: {
          prompts: [],
          fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
          citedPages: [],
          gscQueries: [],
          brandDomains: [],
          competitorDomains: [],
        },
        choices: [],
      });
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValue([
        {
          ...agentSuggestion,
          afterText: 'look at pipeline forecasting',
          sources: [{ kind: 'fanout', ref: 'pipeline forecasting', label: 'pipeline forecasting' }],
          sourceMarks: [{ start: 8, end: 28, source: 0 }],
        },
      ]);
      await openRules();

      const card = container.querySelector<HTMLElement>('[data-suggestion="n1"]')!;
      // Its words, the source's number after the ones it supports, then "Based on".
      expect(card.querySelector('ins')!.textContent).toBe('look at pipeline forecasting1');
      const mark = card.querySelector<HTMLButtonElement>('ins sup button')!;
      expect(mark.getAttribute('aria-label')).toBe('Source 1: pipeline forecasting');
      expect(card.textContent).toContain('Based on1Fan-out ·pipeline forecasting');
      const chip = [...card.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes('Fan-out'),
      )!;
      // The Sources tab's details, on hover.
      expect(chip.title).toBe('pipeline forecasting · Microsoft Copilot · searched 2×');
      // The card says how many of the person's sources it was built from.
      expect(
        container.querySelector('[role="region"][aria-label="Agent suggestions"]')!.textContent,
      ).toContain('built from 1 of your sources · See sources');

      const scrolled = vi.fn();
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrolled;
      try {
        await act(async () => chip.click());
        expect(selectedTab()).toBe('Sources');
        const row = panel()!.querySelector<HTMLElement>(
          '[data-source="fanout:pipeline forecasting"]',
        )!;
        // Scrolled to, and marked for a moment.
        expect(scrolled).toHaveBeenCalled();
        expect(row.className).toContain('ring-2');
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });

    it("shows the person's own input it was written from, and opens it in Brief (CE-048)", async () => {
      process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '2';
      try {
        getDraftInputs.mockResolvedValue({
          experience: '',
          data: [{ name: 'Survey', rows: [['Teams'], ['1,250']] }],
          getcitoData: [],
          quotes: [],
        });
        getContentDraft.mockResolvedValue(traced);
        getDraftSuggestions.mockResolvedValue([
          {
            ...agentSuggestion,
            afterText: '1,250 teams forecast weekly',
            sources: [{ kind: 'input', ref: 'data:1', label: 'Survey' }],
            sourceMarks: [{ start: 0, end: 5, source: 0 }],
          },
        ]);
        await openRules();
        const card = container.querySelector<HTMLElement>('[data-suggestion="n1"]')!;
        expect(card.querySelector('ins')!.textContent).toBe('1,2501 teams forecast weekly');
        expect(card.textContent).toContain('Based on1Your input ·Survey');
        const chip = [...card.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
          b.textContent?.includes('Your input'),
        )!;
        await act(async () => chip.click());
        expect(selectedSegment()).toBe('Brief');
        expect(panel()!.textContent).toContain('Survey · 2 rows');
      } finally {
        delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
      }
    });

    it('marks an insert’s words by its text, found again in the card as drawn', async () => {
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValue([
        {
          ...agentSuggestion,
          kind: 'insert' as const,
          beforeText: '',
          afterText: '<h3>FAQ</h3>\n<p>Use pipeline forecasting weekly.</p>',
          // Offsets into "FAQ\nUse pipeline forecasting weekly." (the server's text).
          sources: [{ kind: 'fanout', ref: 'pipeline forecasting', label: 'pipeline forecasting' }],
          sourceMarks: [{ start: 8, end: 28, source: 0 }],
        },
      ]);
      await openRules();
      const card = container.querySelector<HTMLElement>('[data-suggestion="n1"]')!;
      expect(card.querySelector('p')!.textContent).toBe('Use pipeline forecasting1 weekly.');
    });

    it('scrolls to a source in a Sources tab opened before, now hidden behind Rules', async () => {
      getDraftSources.mockResolvedValue({
        data: {
          prompts: [],
          fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
          citedPages: [],
          gscQueries: [],
          brandDomains: [],
          competitorDomains: [],
        },
        choices: [],
      });
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValue([
        {
          ...agentSuggestion,
          afterText: 'look at pipeline forecasting',
          sources: [{ kind: 'fanout', ref: 'pipeline forecasting', label: 'pipeline forecasting' }],
          // Its mark ends inside the link on its words: both stay.
          afterLinks: [{ start: 8, end: 28, href: 'https://acme.example/forecasting' }],
          sourceMarks: [{ start: 8, end: 16, source: 0 }],
        },
      ]);
      await openRules();
      const ins = container.querySelector<HTMLElement>('[data-suggestion="n1"] ins')!;
      expect(ins.textContent).toBe('look at pipeline1 forecasting');
      expect(
        [...ins.querySelectorAll<HTMLElement>('span[title]')].map((span) => span.textContent),
      ).toEqual(['pipeline', ' forecasting']);

      await pickTab('Sources');
      await pickTab('Rules');
      const scrolled = vi.fn();
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrolled;
      try {
        const mark = container.querySelector<HTMLButtonElement>(
          '[data-suggestion="n1"] sup button',
        )!;
        await act(async () => mark.click());
        expect(selectedTab()).toBe('Sources');
        expect(scrolled).toHaveBeenCalledTimes(1);
        // Asked once: switching tabs again doesn't scroll again.
        await pickTab('Rules');
        await pickTab('Sources');
        expect(scrolled).toHaveBeenCalledTimes(1);
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });

    it('puts an insert’s number after the words it marks, not the same words before them', async () => {
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValue([
        {
          ...agentSuggestion,
          kind: 'insert' as const,
          beforeText: '',
          afterText: '<p>In 2026 teams plan; by 2026, most do.</p>',
          sources: [{ kind: 'fanout', ref: 'plans 2026', label: 'plans 2026' }],
          sourceMarks: [{ start: 23, end: 27, source: 0 }],
        },
      ]);
      await openRules();
      const card = container.querySelector<HTMLElement>('[data-suggestion="n1"]')!;
      expect(card.querySelector('p')!.textContent).toBe('In 2026 teams plan; by 20261, most do.');
    });

    it('says when Stop couldn’t reach the agent, and drafts from the kept data', async () => {
      getDraftSources.mockResolvedValue({
        data: {
          prompts: [],
          fanouts: [{ query: 'pipeline forecasting', platforms: ['copilot-web'], searched: 2 }],
          citedPages: [
            {
              url: 'https://a.example/x',
              title: null,
              domain: 'a.example',
              citations: 3,
              answers: 2,
            },
          ],
          gscQueries: [],
          brandDomains: [],
          competitorDomains: [],
        },
        choices: [],
      });
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValue([]);
      let answer: (value: { count: number }) => void = () => {};
      fixDraftRules.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      readAgentRun.mockResolvedValue({
        id: 'r1',
        kind: 'fix',
        steps: [{ key: 'write_changes', count: null }],
        step: 0,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        stoppedAt: null,
        outcome: null,
      });
      stopAgentRun.mockResolvedValue({ error: 'failed' });
      await openRules();
      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});
      const card = container.querySelector('[role="region"][aria-label="Agent suggestions"]')!;
      const stop = [...card.querySelectorAll('button')].find((b) => b.textContent === 'Stop')!;
      await act(async () => stop.click());
      expect(toast.error).toHaveBeenCalledWith("Couldn't stop the agent. It may still finish.");
      // It can be pressed again.
      expect(stop.disabled).toBe(false);
      await act(async () => answer({ count: 0 }));
    });

    it('says a full batch is the most one run makes, to run it again (C)', async () => {
      getContentDraft.mockResolvedValue(traced);
      const full = Array.from({ length: 8 }, (_, i) => ({
        ...agentSuggestion,
        id: `n${i}`,
        status: 'rejected' as const,
      }));
      getDraftSuggestions.mockResolvedValueOnce([]).mockResolvedValueOnce(full);
      fixDraftRules.mockResolvedValue({ count: 8 });
      await openRules();

      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});

      expect(toast.success).toHaveBeenCalledWith(
        'Content Agent suggested 8 changes, the most one run makes · review them, then run it again for the rules still open',
      );
      // Decided, with rules still open: the bar says to run it again.
      expect(
        container.querySelector('[role="region"][aria-label="Agent suggestions"]')!.textContent,
      ).toMatch(
        /^All suggestions reviewed0 accepted · \d+\/\d+ rules · \d+ still open · a run makes at most 8 changes: run it again for the rest/,
      );
    });

    // A timeout on the way back is not the agent failing: it may still finish.
    it('shows the agent’s batch when it lands after the answer didn’t come back', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        getContentDraft.mockResolvedValue(traced);
        getDraftSuggestions
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([agentSuggestion]);
        fixDraftRules.mockRejectedValue(new Error('An unexpected response was received'));
        await openRules();

        await act(async () => panelButton('Fix open rules').click());
        await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
        expect(toast.error).not.toHaveBeenCalled();
        await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
        await act(async () => {});

        expect(getDraftSuggestions).toHaveBeenCalledTimes(3);
        expect(
          container.querySelector('[role="region"][aria-label="Agent suggestions"]')!.textContent,
        ).toContain('Content Agent has 1 suggestion for you');
        expect(toast.success).toHaveBeenCalledWith(
          'Content Agent suggested 1 change · review them in the page',
        );
        expect(toast.error).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    describe('when its answer is lost on the way', () => {
      const ended = (over: Record<string, unknown>) => ({
        id: 'r9',
        kind: 'fix',
        steps: [
          { key: 'read_rules', count: 3 },
          { key: 'gather_sources', count: 0 },
          { key: 'write_changes', count: 0 },
        ],
        step: 3,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        stoppedAt: null,
        outcome: 'done',
        ...over,
      });
      /** Fix's runs as read: `earlier` before it was asked, `then` after. */
      const runs = (earlier: unknown, then: unknown) => {
        let read = 0;
        readAgentRun.mockImplementation(async (_id: string, kinds?: string[]) =>
          kinds ? (read++ === 0 ? earlier : then) : null,
        );
      };
      async function run() {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        getContentDraft.mockResolvedValue(traced);
        getDraftSuggestions.mockResolvedValue([]);
        fixDraftRules.mockResolvedValue({ error: 'unconfirmed' });
        await openRules();
        await act(async () => panelButton('Fix open rules').click());
        await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
        await act(async () => {});
      }
      afterEach(() => vi.useRealTimers());

      it('says it found nothing when its run ended with none, and why, not that it couldn’t run', async () => {
        // Done with nothing left, every change in a quoted passage (editor test 2026-10-25).
        runs(
          null,
          ended({
            steps: [
              { key: 'read_rules', count: 3 },
              { key: 'gather_sources', count: 0 },
              { key: 'write_changes', count: 0, why: 'locked' },
            ],
          }),
        );
        await run();
        expect(toast).toHaveBeenCalledWith(
          "Content Agent's changes were all in passages AI answers quote, which it keeps. Unlock the ones you're fine to change (Edit anyway), or change them yourself.",
        );
        expect(toast.error).not.toHaveBeenCalled();
      });

      it('says it stopped, or failed, as its row says, without waiting out the minute and a half', async () => {
        runs(null, ended({ outcome: 'stopped' }));
        await run();
        expect(toast).toHaveBeenCalledWith('Stopped · nothing was changed');
        expect(toast.error).not.toHaveBeenCalled();
        vi.useRealTimers();
        act(() => root.unmount());
        root = createRoot(container);
        toast.mockClear();
        runs(null, ended({ outcome: 'failed' }));
        await run();
        expect(toast.error).toHaveBeenCalledWith("Content Agent couldn't run. Try again.");
      });

      it('never reads the run there was before it was asked as this one', async () => {
        const earlier = ended({ id: 'r8', outcome: 'stopped' });
        runs(earlier, earlier);
        await run();
        expect(toast).not.toHaveBeenCalledWith('Stopped · nothing was changed');
        await act(async () => void (await vi.advanceTimersByTimeAsync(85_000)));
        await act(async () => {});
        expect(toast.error).toHaveBeenCalledWith("Content Agent couldn't run. Try again.");
      });
    });

    it('says what to do when every change it had was in a quoted passage', async () => {
      getContentDraft.mockResolvedValue(traced);
      fixDraftRules.mockResolvedValue({ count: 0, why: 'locked' });
      await openRules();
      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});
      expect(toast).toHaveBeenCalledWith(
        "Content Agent's changes were all in passages AI answers quote, which it keeps. Unlock the ones you're fine to change (Edit anyway), or change them yourself.",
      );
    });

    it('says the agent couldn’t run when no batch lands in time', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        getContentDraft.mockResolvedValue(traced);
        getDraftSuggestions.mockResolvedValue([]);
        fixDraftRules.mockResolvedValue({ error: 'unconfirmed' });
        await openRules();

        await act(async () => panelButton('Fix open rules').click());
        await act(async () => void (await vi.advanceTimersByTimeAsync(85_000)));
        expect(toast.error).not.toHaveBeenCalled();
        await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
        await act(async () => {});
        expect(toast.error).toHaveBeenCalledWith("Content Agent couldn't run. Try again.");
      } finally {
        vi.useRealTimers();
      }
    });

    it('leaves a second H1 out of what the agent is asked, saying how to fix it', async () => {
      getContentDraft.mockResolvedValue(
        draft({ bodyHtml: '<h1>Pipeline forecasting</h1><p>Teams trust it.</p><h1>Again</h1>' }),
      );
      await openRules();
      expect(panel()!.textContent).toContain('One H1 per page');
      // Always on: the editor keeps it, so it has no switch.
      expect(panel()!.querySelector('[aria-label="One H1 per page: on or off"]')).toBeNull();
      expect(panel()!.querySelector('[aria-label="Length: on or off"]')).not.toBeNull();

      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});
      const asked = fixDraftRules.mock.calls[0][2].rules.map((r: { key: string }) => r.key);
      expect(asked).not.toContain('oneH1');
      expect(asked.length).toBeGreaterThan(0);
    });

    it('fixes only the AI traces from their rule', async () => {
      getContentDraft.mockResolvedValue(traced);
      await openRules();

      await act(async () => panelButton('Fix').click());
      await act(async () => {});

      expect(fixDraftRules.mock.calls[0][2].rules.map((r: { key: string }) => r.key)).toEqual([
        'aiTraces',
      ]);
      expect(toast).toHaveBeenCalledWith(
        'Content Agent found nothing it could change without new facts.',
      );
    });

    it('says when the AI usage is spent', async () => {
      getContentDraft.mockResolvedValue(traced);
      fixDraftRules.mockResolvedValue({ error: 'ai_budget' });
      await openRules();

      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});
      expect(toast.error).toHaveBeenCalledWith(
        "This month's AI usage is spent. Upgrade for more, or try again once it resets.",
      );
    });

    it('waits until the open suggestions are decided', async () => {
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValue([agentSuggestion]);
      await openRules();

      const fix = panelButton('Fix open rules');
      expect(fix.disabled).toBe(true);
      // Why, under the card: never only on hover.
      expect(panel()!.querySelector('[role="status"]')!.textContent).toBe(
        'Review the open suggestion first, then run the agent.',
      );
    });

    it('waits until the passages AI quotes are read, so they go to the agent locked', async () => {
      getContentDraft.mockResolvedValue({
        ...traced,
        sourceUrl: 'https://acme.example/forecasting',
      });
      let read: (cited: CitedPassage[]) => void = () => {};
      getCitedPassages.mockReturnValue(new Promise((resolve) => (read = resolve)));
      await openRules();

      const fix = () => panelButton('Fix open rules');
      expect(fix().disabled).toBe(true);
      expect(panel()!.querySelector('[role="status"]')!.textContent).toBe(
        'Reading which passages AI quotes, so the agent leaves them as they are…',
      );
      await act(async () => read([]));
      expect(fix().disabled).toBe(false);
      expect(panel()!.textContent).not.toContain('Reading which passages AI quotes');
    });

    it('shows the open suggestions another tab left, when the agent is refused for them', async () => {
      getContentDraft.mockResolvedValue(traced);
      getDraftSuggestions.mockResolvedValueOnce([]).mockResolvedValueOnce([agentSuggestion]);
      fixDraftRules.mockResolvedValue({ error: 'open_suggestions' });
      await openRules();

      await act(async () => panelButton('Fix open rules').click());
      await act(async () => {});
      expect(toast.error).toHaveBeenCalledWith(
        "This page has open suggestions, maybe from another tab. They're shown now: accept or reject them first.",
      );
      expect(
        container.querySelector('[role="region"][aria-label="Agent suggestions"]')!.textContent,
      ).toContain('Content Agent has 1 suggestion for you');
    });
  });

  describe('Run Agent: rewrite the whole page', () => {
    const long = draft({
      pageType: 'blog_post',
      bodyHtml: '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p>',
    });
    const rewritten = {
      id: 'p1',
      batchId: 'b3',
      actionId: null,
      actionNo: null,
      kind: 'page' as const,
      blockText: 'Pipeline forecasting',
      beforeText: '',
      beforeHtml: '<h1>Pipeline forecasting</h1><p>We delve into how teams forecast.</p>',
      afterText: '<h1>Pipeline forecasting</h1><p>Teams forecast from their pipeline.</p>',
      reason: 'cut to the Length and answered the heading first',
      ruleKeys: ['length', 'aiTraces'],
      status: 'open' as const,
    };
    async function openRules() {
      window.innerWidth = 1024;
      await renderPage();
      const chip = container.querySelector<HTMLButtonElement>(
        'header button[aria-label^="Rules "]',
      )!;
      await act(async () => chip.click());
    }
    const button = (scope: ParentNode, label: string) =>
      [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === label,
      )!;
    const bar = () =>
      container.querySelector('[role="region"][aria-label="Rewritten page"]') as HTMLElement | null;
    const page = () => container.querySelector('.ProseMirror')!.textContent;

    it('reads what the last rewrite came to as the toolbar counts it, shown or decided since', async () => {
      // Still longer than the rewrite came to (it wasn't taken): another won't get further.
      getContentDraft.mockResolvedValue(
        draft({
          pageType: 'blog_post',
          bodyHtml: `<h1>Pipeline forecasting</h1><p>${'Teams forecast from the pipeline. '.repeat(40).trim()}</p>`,
          rules: {
            set: null,
            source: null,
            overrides: { length: { value: '100' } },
            textRules: [],
          },
        }),
      );
      // Decided since (a later Fix batch shows): the API counted it a little
      // over; its page reads 1,200 as the editor counts it (4 + 1,196).
      getLastPageRewrite.mockResolvedValue({
        chars: 1250,
        target: 100,
        kept: 0,
        html: `<h1>Plan</h1><p>${'x'.repeat(1196)}</p>`,
      });
      await openRules();
      const text = panel()!.textContent;
      expect(text).toContain('The last rewrite came to 1,200');
      expect(text).not.toContain('1,250');
    });

    it('sends the rules in effect, how the page reads against each, and the page waits', async () => {
      getContentDraft.mockResolvedValue(long);
      await openRules();
      // What the last rewrite came to is read once, for Length's reach.
      expect(getLastPageRewrite).toHaveBeenCalledWith('d1');

      // ▾ › Rewrite the whole page: the button says so, then runs it.
      await act(async () =>
        panel()!.querySelector<HTMLElement>('[aria-label="More ways to run the agent"]')!.click(),
      );
      const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (el) => el.textContent?.startsWith('Rewrite the whole page'),
      )!;
      await act(async () => item.click());
      await act(async () => button(panel()!, 'Rewrite page').click());
      await act(async () => {});

      const [id, brandId, request] = startPageRewrite.mock.calls[0];
      expect([id, brandId]).toEqual(['d1', 'b1']);
      // An open rule says how the page reads now; locked passages come from the page.
      expect(request.rules).toContainEqual(
        expect.objectContaining({
          key: 'aiTraces',
          detail: expect.stringContaining('now: 1 found'),
        }),
      );
      expect(request.locked).toEqual([]);
      expect(fixDraftRules).not.toHaveBeenCalled();
      // The page waits for it, with the rewrite's own steps.
      expect(container.textContent).toContain('Rewriting the page');
      expect(container.querySelector('.ProseMirror')).toBeNull();
    });

    it('shows the rewrite to compare, puts it in place on Accept, and puts the page back on Undo', async () => {
      getContentDraft.mockResolvedValue(long);
      getDraftSuggestions.mockResolvedValue([rewritten]);
      await renderPage();
      await act(async () => {});

      expect(bar()!.textContent).toContain('Content Agent rewrote the page to its rules');
      // What the last rewrite came to is read on opening, and again for the one now shown.
      expect(getLastPageRewrite).toHaveBeenCalledTimes(2);
      // A whole page is never a card in the page.
      expect(container.querySelector('[data-suggestion]')).toBeNull();
      await act(async () => button(bar()!, 'Compare').click());
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.textContent).toContain('Teams forecast from their pipeline.');
      expect(dialog.textContent).toContain('We delve into how teams forecast.');

      await act(async () => button(dialog, 'Accept').click());
      await act(async () => {});
      expect(keepAgentBeforeVersion).toHaveBeenCalledWith('d1');
      expect(decideDraftSuggestions).toHaveBeenCalledWith(['p1'], 'accepted');
      expect(page()).toContain('Teams forecast from their pipeline.');
      expect(bar()!.textContent).toContain('Rewrite accepted');

      await act(async () => button(bar()!, 'Undo').click());
      await act(async () => {});
      expect(decideDraftSuggestions).toHaveBeenLastCalledWith(['p1'], 'open');
      expect(page()).toContain('We delve into how teams forecast.');
    });

    it('reads the page by its words: stored line breaks and lists are no change', async () => {
      getContentDraft.mockResolvedValue(long);
      getDraftSuggestions.mockResolvedValue([
        {
          ...rewritten,
          beforeHtml: '<h1>Pipeline forecasting</h1>\n<p>We delve into how teams forecast.</p>\n',
          afterText:
            '<h1>Pipeline forecasting</h1>\n<ul>\n<li>Teams forecast</li>\n<li>from their pipeline</li>\n</ul>',
        },
      ]);
      await renderPage();
      await act(async () => {});

      await act(async () => button(bar()!, 'Accept').click());
      await act(async () => {});
      expect(decideDraftSuggestions).toHaveBeenCalledWith(['p1'], 'accepted');
      await act(async () => button(bar()!, 'Undo').click());
      await act(async () => {});
      expect(decideDraftSuggestions).toHaveBeenLastCalledWith(['p1'], 'open');
      expect(page()).toContain('We delve into how teams forecast.');
    });

    it('doesn’t undo a rewrite edited since it went in', async () => {
      getContentDraft.mockResolvedValue(long);
      getDraftSuggestions.mockResolvedValue([{ ...rewritten, status: 'accepted' as const }]);
      await renderPage();
      await act(async () => {});
      // The page as accepted, then a word of the person's own.
      const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor })
        .editor;
      await act(async () => {
        editor.commands.setContent(rewritten.afterText);
        editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' Mine.');
      });

      await act(async () => button(bar()!, 'Undo').click());
      expect(toast).toHaveBeenCalledWith(
        'The page changed after the rewrite was put in. To go back, open History.',
      );
      expect(decideDraftSuggestions).not.toHaveBeenCalled();
    });

    it('rewrites again from Try again after a rewrite failed, on any device', async () => {
      // The draft says which run failed (agent_run), not this browser's storage.
      getContentDraft.mockResolvedValue({ ...long, agentState: 'failed', agentRun: 'rewrite' });
      await renderPage();
      await act(async () => {});

      expect(container.textContent).toContain(
        "The Content Agent couldn't rewrite this page. Edit it yourself, or try again.",
      );
      await act(async () => button(container, 'Try again').click());
      await act(async () => {});
      expect(startPageRewrite).toHaveBeenCalled();
      expect(startAgentWriting).not.toHaveBeenCalled();
    });

    it('doesn’t put a rewrite over a page that changed since the agent read it', async () => {
      getContentDraft.mockResolvedValue(long);
      getDraftSuggestions.mockResolvedValue([
        { ...rewritten, beforeHtml: '<h1>Pipeline forecasting</h1><p>An older page.</p>' },
      ]);
      await renderPage();
      await act(async () => {});

      await act(async () => button(bar()!, 'Accept').click());
      expect(toast).toHaveBeenCalledWith(
        'The page changed after the agent read it. Reject this rewrite and run it again on the page as it is now.',
      );
      expect(decideDraftSuggestions).not.toHaveBeenCalled();
      expect(page()).toContain('We delve into how teams forecast.');
    });
  });

  it('starts a draft from the workspace’s My rules, and saves a draft’s set as them', async () => {
    getMyRuleSets.mockResolvedValue({
      blog_post: {
        overrides: { sentence: { on: false } },
        textRules: [{ id: 'm1', text: 'Mention free shipping', on: true }],
      },
    });
    getContentDraft.mockResolvedValue(draft({ pageType: 'blog_post' }));
    window.innerWidth = 1440;
    await renderPage();

    await pickTab('Rules');
    expect(getMyRuleSets).toHaveBeenCalledWith('b1');
    expect(panel()!.textContent).toContain('My rules · Blog post');
    expect(panel()!.textContent).toContain('Your text rules');
    expect(
      panel()!
        .querySelector('[role="switch"][aria-label="Max sentence length: on or off"]')!
        .getAttribute('aria-checked'),
    ).toBe('false');
    // Nothing is saved on the draft until something changes.
    expect(saveDraftRules).not.toHaveBeenCalled();

    const save = [...panel()!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save as my rules',
    )!;
    await act(async () => save.click());
    expect(saveMyRuleSet).toHaveBeenCalledWith('b1', 'blog_post', {
      overrides: { sentence: { on: false } },
      textRules: [{ id: 'm1', text: 'Mention free shipping', on: true }],
    });
    expect(saveDraftRules).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ source: 'mine', overrides: { sentence: { on: false } } }),
    );
    expect(toast).toHaveBeenCalledWith('Saved as My rules for Blog post');
  });

  it('starts open on a wide window, and remembers it closed', async () => {
    getContentDraft.mockResolvedValue(draft({ method: 'create' }));
    window.innerWidth = 1440;
    await renderPage();
    await pickTab('Live page');
    // A new page: nothing to measure yet.
    expect(panel()!.textContent).toContain('This draft is a new page, not live yet');
    expect(getContentImpact).not.toHaveBeenCalled();

    await act(async () => button('Hide side panel')!.click());
    expect(panel()).toBeNull();
    expect(localStorage.getItem('aeo:content-editor-panel')).toBe('0');

    act(() => root.unmount());
    root = createRoot(container);
    await renderPage();
    expect(panel()).toBeNull();
  });
});

describe('the editor on a read-only workspace (plan not active)', () => {
  const openUpgrade = vi.fn();
  async function renderLocked(isLocked = true) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <RoleProvider role="admin">
            <UpgradeDialogContext.Provider
              value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
            >
              <ContentEditorPage />
            </UpgradeDialogContext.Provider>
          </RoleProvider>
        </NextIntlClientProvider>,
      );
    });
    await act(async () => {});
  }
  const editorOf = () =>
    (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;

  beforeEach(() => openUpgrade.mockReset());

  it('opens the page read-only and saves nothing; the toolbar opens the upgrade dialog', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      getContentDraft.mockResolvedValue(draft());
      await renderLocked();
      expect(container.querySelector('.ProseMirror')!.getAttribute('contenteditable')).toBe(
        'false',
      );
      expect(editorOf().isEditable).toBe(false);
      // A change that reaches the page all the same (a command) waits for no save.
      await act(async () => void editorOf().commands.insertContentAt(2, 'x'));
      await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
      expect(saveContentDraft).not.toHaveBeenCalled();
      expect(container.querySelector('header')!.textContent).toContain('Saved');

      const html = editorOf().getHTML();
      await act(async () => button('Bold')!.click());
      expect(openUpgrade).toHaveBeenLastCalledWith('Editing the page needs a plan');
      expect(editorOf().getHTML()).toBe(html);
      // The HTML view still shows the source, which can't be edited.
      await act(async () => button('Edit as HTML')!.click());
      expect(container.querySelector('textarea')!.readOnly).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the upgrade dialog from Mark ready, Send to CMS, History and the title', async () => {
    getContentDraft.mockResolvedValue(draft());
    getDraftVersions.mockResolvedValue([
      { id: 'v1', origin: 'import', title: 'Old title', createdAt: '2026-10-12T09:42:00Z' },
    ]);
    await renderLocked();
    await act(async () => button('Mark ready')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Marking a page ready needs a plan');
    await act(async () => button('Send to CMS')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Sending to your CMS needs a plan');
    await act(async () => container.querySelector<HTMLButtonElement>('header h1 button')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Editing the page needs a plan');

    const trigger = button('History')!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger.click();
    });
    await act(async () => {});
    const versions = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    await act(async () => versions[0].click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Restoring a version needs a plan');

    expect(openUpgrade).toHaveBeenCalledTimes(4);
    expect(markContentDraftReady).not.toHaveBeenCalled();
    expect(restoreDraftVersion).not.toHaveBeenCalled();
    expect(saveContentDraft).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('runs no agent and decides no suggestion', async () => {
    getContentDraft.mockResolvedValue(
      draft({
        status: 'draft',
        agentState: 'failed',
        bodyHtml: '<h1>Pipeline forecasting</h1><p>Our forecasting is very accurate.</p>',
      }),
    );
    getDraftSuggestions.mockResolvedValue([
      {
        id: 's1',
        batchId: 'b1',
        actionId: 'a1',
        actionNo: 214,
        kind: 'replace',
        blockText: 'Our forecasting is very accurate.',
        beforeText: 'Our forecasting is very accurate.',
        afterText: 'Accuracy is shown per team, each week.',
        reason: 'answer fan-out',
        ruleKeys: [],
        status: 'open',
      },
    ]);
    await renderLocked();
    await act(async () => button('Try again')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Running the Content Agent needs a plan');
    const bar = container.querySelector('[role="region"][aria-label="Agent suggestions"]')!;
    await act(async () =>
      [...bar.querySelectorAll('button')].find((b) => b.textContent === 'Accept all')!.click(),
    );
    expect(openUpgrade).toHaveBeenLastCalledWith('Reviewing suggestions needs a plan');
    expect(startAgentWriting).not.toHaveBeenCalled();
    expect(decideDraftSuggestions).not.toHaveBeenCalled();
    expect(keepAgentBeforeVersion).not.toHaveBeenCalled();
  });

  it('changes no rule', async () => {
    getContentDraft.mockResolvedValue(draft());
    await renderLocked();
    // The header's rules chip opens the panel on Rules: reading them stays open.
    await act(async () =>
      container.querySelector<HTMLButtonElement>('header button[aria-label^="Rules "]')!.click(),
    );
    const sentence = container.querySelector<HTMLElement>(
      'aside [role="switch"][aria-label="Max sentence length: on or off"]',
    )!;
    await act(async () => sentence.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Changing rules needs a plan');
    expect(saveDraftRules).not.toHaveBeenCalled();
  });

  it('is written and saved as before on an active plan', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      getContentDraft.mockResolvedValue(draft());
      await renderLocked(false);
      expect(editorOf().isEditable).toBe(true);
      await act(async () => void editorOf().commands.insertContentAt(2, 'x'));
      await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
      expect(saveContentDraft).toHaveBeenCalledTimes(1);
      expect(openUpgrade).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
