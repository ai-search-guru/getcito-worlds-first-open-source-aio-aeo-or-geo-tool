import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { SiteType } from '@/lib/content/pageTypes';
import { NewContentDialog, type DialogPreset } from './NewContentDialog';

const getContentStartOptions = vi.fn();
const createContentDraft = vi.fn();
const getContentOverlap = vi.fn();
const importContentPage = vi.fn();
const sendContentDraftToActionCenter = vi.fn();
const startAgentWriting = vi.fn();
vi.mock('@/lib/actions/contentDrafts', () => ({
  sendContentDraftToActionCenter: (...args: unknown[]) => sendContentDraftToActionCenter(...args),
  startAgentWriting: (...args: unknown[]) => startAgentWriting(...args),
  importContentPage: (...args: unknown[]) => importContentPage(...args),
  getContentStartOptions: (...args: unknown[]) => getContentStartOptions(...args),
  createContentDraft: (...args: unknown[]) => createContentDraft(...args),
  getContentOverlap: (...args: unknown[]) => getContentOverlap(...args),
}));
// What the agent is given is agentWrite.test.ts's; here, that Start hands it over.
const listBrandMembers = vi.fn();
vi.mock('@/lib/actions/team', () => ({
  listBrandMembers: (...args: unknown[]) => listBrandMembers(...args),
}));
const assignAction = vi.fn();
vi.mock('@/lib/actions/actionCenter', () => ({
  assignAction: (...args: unknown[]) => assignAction(...args),
}));
// Team's assignee picker as a native select: Base UI's popup doesn't open in jsdom.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string | null;
    onValueChange: (value: string | null) => void;
    children: React.ReactNode;
  }) => (
    <select data-select value={value ?? ''} onChange={(e) => onValueChange(e.target.value || null)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
const MEMBERS = [
  {
    userId: 'u1',
    email: 'me@northwind.example',
    fullName: 'Mia Chen',
    avatarUrl: null,
    role: 'admin',
    createdAt: '2026-01-01',
    isCurrentUser: true,
  },
  {
    userId: 'u2',
    email: 'ada@northwind.example',
    fullName: 'Ada Lovelace',
    avatarUrl: null,
    role: 'member',
    createdAt: '2026-01-02',
    isCurrentUser: false,
  },
];
const agentWriteRequest = vi.fn();
const describeRule = vi.fn();
vi.mock('@/lib/content/agentWrite', () => ({
  agentWriteRequest: (...args: unknown[]) => agentWriteRequest(...args),
  useRuleDescriber: () => describeRule,
}));
const push = vi.fn();
const onSent = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }));
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
);
vi.mock('sonner', () => ({ toast }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom's files can't be read as text, as browsers' can.
if (!('text' in Blob.prototype)) {
  Object.assign(Blob.prototype, {
    text(this: Blob) {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsText(this);
      });
    },
  });
}

const OPTIONS = {
  opportunities: [
    {
      id: 'o1',
      title: 'Northwind vs HubSpot',
      decision: 'create',
      pageTitle: null,
      assetType: null,
    },
    {
      id: 'o2',
      title: 'Create a page for realtors',
      decision: 'create',
      pageTitle: 'CRM for real estate teams',
      assetType: null,
    },
  ],
  prompts: [{ id: 'p1', text: 'best crm for realtors', seen: false }],
  promptsSeen: 0,
  topics: [{ id: 't1', name: 'Real estate', promptCount: 3 }],
};

let container: HTMLDivElement;
let root: Root;
const onOpenChange = vi.fn();

async function render(siteType: SiteType = 'b2b', preset: DialogPreset | null = null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NewContentDialog
          open
          onOpenChange={onOpenChange}
          brandId="b1"
          siteType={siteType}
          onSent={onSent}
          preset={preset}
        />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name,
  );
const radio = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) =>
    r.textContent?.startsWith(name),
  )!;
const click = async (el: Element | undefined) => {
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    (el as HTMLElement).click();
  });
};
const tab = (name: string) =>
  [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name);
const checkedType = () =>
  document.querySelector('[aria-labelledby="start-page-type"] [aria-checked="true"]')?.textContent;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getContentStartOptions.mockReset().mockResolvedValue(OPTIONS);
  createContentDraft.mockReset().mockResolvedValue('d9');
  getContentOverlap.mockReset().mockResolvedValue({ totalPrompts: 2, pages: [] });
  importContentPage.mockReset().mockResolvedValue({ error: 'failed' });
  sendContentDraftToActionCenter.mockReset();
  listBrandMembers.mockReset().mockResolvedValue(MEMBERS);
  assignAction.mockReset().mockResolvedValue(undefined);
  startAgentWriting.mockReset();
  agentWriteRequest.mockReset().mockResolvedValue({ sources: 'kept', rules: [] });
  onSent.mockReset();
  onOpenChange.mockReset();
  toast.warning.mockReset();
  push.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('New content', () => {
  it('starts a new page from an opportunity, the page type picked from its title', async () => {
    await render();
    expect(getContentStartOptions).toHaveBeenCalledWith('b1');
    expect(button('Continue')!.disabled).toBe(true);

    await click(button('Pick a content opportunity'));
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === 'Northwind vs HubSpot',
    );
    await click(option);
    await click(button('Continue'));

    expect(document.body.textContent).toContain('Create: Northwind vs HubSpot');
    expect(checkedType()).toBe('Comparison');
    expect(document.body.textContent).toContain('Picked from the title.');

    await click(radio('How-to guide'));
    expect(checkedType()).toBe('How-to guide');
    await click(button('Open editor'));
    expect(createContentDraft).toHaveBeenCalledWith('b1', {
      method: 'create',
      title: 'Northwind vs HubSpot',
      pageType: 'guide',
      // Picked, so it stays; Start's guess would follow the page.
      typePicked: true,
      source: { kind: 'opportunity', id: 'o1' },
      bodyHtml: undefined,
    });
    expect(push).toHaveBeenCalledWith('/dashboard/content/editor/d9');
  });

  it('keeps a long pick and a long title inside the dialog', async () => {
    await render();
    // A single column no wider than the dialog: content can't widen it. No
    // taller than the window either: it scrolls, its buttons kept in view.
    // Held at the top: what lands later grows it downwards.
    const dialog = document.querySelector('[data-slot="dialog-content"]')!;
    expect(dialog.className).toContain('grid-cols-[minmax(0,1fr)]');
    expect(dialog.className).toContain('max-h-[88dvh]');
    expect(dialog.className).toContain('top-[6dvh]');
    expect(dialog.className).toContain('translate-y-0');
    expect(dialog.className).not.toContain('top-1/2');
    expect(dialog.className).toContain('overflow-y-auto');
    expect(document.querySelector('[data-slot="dialog-footer"]')!.className).toContain('sticky');

    await click(button('Pick a content opportunity'));
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === 'Northwind vs HubSpot',
    );
    await click(option);
    // The pick truncates inside the trigger, beside its chevron.
    const value = [...document.querySelectorAll('span.truncate')].find(
      (s) => s.textContent === 'Northwind vs HubSpot',
    );
    expect(value?.closest('[data-slot="combobox-trigger"]')).not.toBeNull();
  });

  it('lists the prompts AI doesn’t name or cite the brand for yet, and says how many are left out', async () => {
    getContentStartOptions.mockResolvedValue({
      ...OPTIONS,
      prompts: [
        { id: 'p1', text: 'best crm for realtors', seen: false },
        { id: 'p2', text: 'crm pricing', seen: true },
        { id: 'p3', text: 'crm for teams', seen: true },
      ],
      promptsSeen: 2,
    });
    await render();
    await click(tab('Prompt'));
    expect(document.body.textContent).toContain(
      "2 prompts where AI already names or cites you in the last 30 days aren't listed: they need no new page.",
    );
    await click(button('Pick a tracked prompt'));
    expect([...document.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual([
      'best crm for realtors',
    ]);
  });

  it('says so when AI already names or cites the brand for every prompt', async () => {
    getContentStartOptions.mockResolvedValue({
      ...OPTIONS,
      prompts: [{ id: 'p2', text: 'crm pricing', seen: true }],
      promptsSeen: 1,
    });
    await render();
    await click(tab('Prompt'));
    await click(button('Pick a tracked prompt'));
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(document.body.textContent).toContain(
      'AI already names or cites you for every tracked prompt in the last 30 days.',
    );
  });

  it('says no prompt matches on a search miss, not that every prompt is seen', async () => {
    getContentStartOptions.mockResolvedValue({
      ...OPTIONS,
      prompts: [
        { id: 'p1', text: 'best crm for realtors', seen: false },
        { id: 'p2', text: 'crm pricing', seen: true },
      ],
      promptsSeen: 1,
    });
    await render();
    await click(tab('Prompt'));
    await click(button('Pick a tracked prompt'));
    const search = document.querySelector<HTMLInputElement>('input[placeholder="Search prompts"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(search, 'zzz no such prompt');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(document.body.textContent).toContain('No tracked prompts.');
    expect(document.body.textContent).not.toContain(
      'AI already names or cites you for every tracked prompt',
    );
  });

  it('names the page by the opportunity’s brief title when it has one', async () => {
    await render();
    await click(button('Pick a content opportunity'));
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === 'Create a page for realtors',
    );
    await click(option);
    await click(button('Continue'));
    expect(document.body.textContent).toContain('Create: CRM for real estate teams');
    expect(checkedType()).toBe('Use case page');
  });

  it('optimizes pasted content, cleaned, and reads its page type from it', async () => {
    await render('ecommerce');
    await click(radio('Optimize content'));
    await click(tab('Paste text'));
    const box = document.querySelector('textarea')!;
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        getData: (type: string) =>
          type === 'text/html'
            ? '<h2 style="color:red">Returns policy</h2><p>30 days.</p><script>x()</script>'
            : '',
      },
    });
    await act(async () => box.dispatchEvent(paste));

    expect(document.body.textContent).toContain('Returns policy');
    expect(document.body.textContent).toContain('1 heading · 23 characters');
    await click(button('Continue'));
    expect(document.body.textContent).toContain('Optimize: Returns policy');
    expect(checkedType()).toBe('Policy');
    expect(document.body.textContent).toContain('Picked from the content.');

    await click(button('Open editor'));
    expect(createContentDraft).toHaveBeenCalledWith('b1', {
      method: 'optimize',
      title: 'Returns policy',
      pageType: 'policy',
      typePicked: false,
      source: { kind: 'content' },
      bodyHtml: '<h2>Returns policy</h2><p>30 days.</p>',
    });
    // Content brought to optimize has no prompts to check.
    expect(getContentOverlap).not.toHaveBeenCalled();
  });

  it('keeps one H1 in a pasted page, its first, the others H2s', async () => {
    await render();
    await click(radio('Optimize content'));
    await click(tab('Paste text'));
    const box = document.querySelector('textarea')!;
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        getData: (type: string) =>
          type === 'text/html'
            ? '<h1>Returns policy</h1><p>30 days.</p><h1>Key points</h1><p>Free.</p>'
            : '',
      },
    });
    await act(async () => box.dispatchEvent(paste));
    await click(button('Continue'));
    await click(button('Open editor'));

    expect(createContentDraft.mock.calls[0][1].bodyHtml).toBe(
      '<h1>Returns policy</h1><p>30 days.</p><h2>Key points</h2><p>Free.</p>',
    );
  });

  it('takes typed plain text as paragraphs, and a blog post when nothing tells the type', async () => {
    await render();
    await click(radio('Optimize content'));
    await click(tab('Paste text'));
    const box = document.querySelector('textarea')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(box, 'Our onboarding checklist\n\nStep one.');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Continue'));
    expect(checkedType()).toBe('Blog post');
    expect(document.body.textContent).not.toContain('Picked from');
    await click(button('Open editor'));
    expect(createContentDraft.mock.calls[0][1]).toMatchObject({
      title: 'Our onboarding checklist',
      bodyHtml: '<p>Our onboarding checklist</p><p>Step one.</p>',
    });
  });

  it('reads an uploaded Markdown file, and refuses a spreadsheet', async () => {
    await render();
    await click(radio('Optimize content'));
    await click(tab('Upload file'));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const upload = async (file: File) => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
      await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    };

    await upload(new File(['a,b'], 'keywords.csv'));
    expect(toast.error).toHaveBeenCalledWith(
      "keywords.csv isn't a file this reads: use Word, Markdown, HTML or text.",
    );
    await upload(new File(['# Pipeline forecasting\n\nTeams trust it.'], 'forecast.md'));
    expect(document.body.textContent).toContain('Pipeline forecasting');
    expect(document.body.textContent).toContain('forecast.md · 1 heading');
    expect(button('Continue')!.disabled).toBe(false);
  });

  it('says so when what to start from can’t be read, and tries again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getContentStartOptions.mockRejectedValueOnce(new Error('down'));
    await render();
    expect(document.body.textContent).toContain("Couldn't load what to start from.");
    await click(button('Try again'));
    expect(getContentStartOptions).toHaveBeenCalledTimes(2);
    expect(button('Pick a content opportunity')).toBeDefined();
  });

  describe('opened from Tracked Prompts', () => {
    const prompt = { kind: 'prompt' as const, id: 'p1', text: 'best crm for realtors' };

    it('goes straight to Start for a new page for the prompt', async () => {
      await render('b2b', { ...prompt, method: 'create' });
      expect(document.body.textContent).toContain('Create: best crm for realtors');
      await click(button('Open editor'));
      expect(createContentDraft.mock.calls[0][1]).toMatchObject({
        method: 'create',
        title: 'best crm for realtors',
        source: { kind: 'prompt', id: 'p1' },
      });
    });

    it('optimizes the page AI cites for the prompt', async () => {
      await render('b2b', {
        ...prompt,
        method: 'optimize',
        page: { url: 'https://northwind.example/blog/crm-guide', title: 'CRM guide' },
      });
      await act(async () => {});
      expect(document.body.textContent).toContain('Optimize: CRM guide');
      expect(document.body.textContent).toContain('The page AI engines cite for this prompt');
      await click(button('Open editor'));
      expect(createContentDraft.mock.calls[0][1]).toMatchObject({
        method: 'optimize',
        title: 'CRM guide',
        source: { kind: 'prompt', id: 'p1' },
        sourceUrl: 'https://northwind.example/blog/crm-guide',
      });
    });

    // A page covering part of the prompts: a new linked page is recommended.
    const partial = {
      totalPrompts: 4,
      pages: [
        {
          url: 'https://northwind.example/blog/crm-guide',
          title: 'CRM guide',
          promptsInCommon: 1,
          citations: 6,
          gscPosition: null,
        },
      ],
    };

    // The person picked Optimize: with no cited page, the Overview's first
    // page to optimize is picked once its read lands (#1320 keeps that pick).
    it('picks the first page to optimize from the Overview when none is cited', async () => {
      getContentOverlap.mockResolvedValue(partial);
      await render('b2b', { ...prompt, method: 'optimize' });
      await act(async () => {});
      expect(document.body.textContent).toContain('Optimize: CRM guide');
      // A pick of the person's own stays.
      await click(radio('Create a new page'));
      expect(document.body.textContent).toContain('Create: best crm for realtors');
    });

    it('stays on a new page when writing one', async () => {
      getContentOverlap.mockResolvedValue(partial);
      await render('b2b', { ...prompt, method: 'create' });
      await act(async () => {});
      expect(document.body.textContent).toContain('Create: best crm for realtors');
    });
  });

  describe('opened from the Content plan (CE-014)', () => {
    it('goes straight to Start for the opportunity', async () => {
      await render('b2b', { kind: 'opportunity', id: 'o2' });
      expect(document.body.textContent).toContain('Create: CRM for real estate teams');
      await click(button('Open editor'));
      expect(createContentDraft.mock.calls[0][1]).toMatchObject({
        method: 'create',
        title: 'CRM for real estate teams',
        source: { kind: 'opportunity', id: 'o2' },
      });
    });

    it('reads the page to optimize', async () => {
      importContentPage.mockResolvedValue({
        page: {
          url: 'https://northwind.example/pricing',
          title: 'Pricing',
          html: '<h1>Pricing</h1>',
        },
      });
      await render('b2b', { kind: 'page', url: 'https://northwind.example/pricing' });
      await act(async () => {});
      expect(importContentPage).toHaveBeenCalledWith('b1', 'https://northwind.example/pricing');
      expect(radio('Optimize content')!.getAttribute('aria-checked')).toBe('true');
      await click(button('Continue'));
      expect(document.body.textContent).toContain('Optimize: Pricing');
    });

    it('starts an opportunity for an existing page on that page, whatever else is cited', async () => {
      getContentOverlap.mockResolvedValue({ totalPrompts: 2, pages: [] });
      await render('b2b', {
        kind: 'opportunity',
        id: 'o2',
        page: { url: 'https://northwind.example/pricing', title: 'Pricing' },
      });
      await act(async () => {});
      expect(document.body.textContent).toContain('Optimize: Pricing');
      // Nothing else cited, and Start still shows the draft optimizes the plan's page.
      expect(document.body.textContent).toContain(
        'None of your pages is cited for these prompts yet',
      );
      expect(radio('Optimize /pricing').getAttribute('aria-checked')).toBe('true');
      await click(button('Open editor'));
      expect(createContentDraft.mock.calls[0][1]).toMatchObject({
        method: 'optimize',
        title: 'Pricing',
        source: { kind: 'opportunity', id: 'o2' },
        sourceUrl: 'https://northwind.example/pricing',
      });
    });

    it("picks the opportunity's page type for a new page, and for its page when that shows none", async () => {
      getContentStartOptions.mockResolvedValue({
        ...OPTIONS,
        opportunities: [
          // An older type, read as this B2B site's: Docs / FAQ, not the title's comparison.
          { ...OPTIONS.opportunities[0], id: 'o3', decision: 'expand', assetType: 'faq_page' },
        ],
      });
      await render('b2b', {
        kind: 'opportunity',
        id: 'o3',
        // Nothing in its address or title says what the page is.
        page: { url: 'https://northwind.example/crm-tips', title: 'CRM tips' },
      });
      await act(async () => {});
      expect(document.body.textContent).toContain('Optimize: CRM tips');
      expect(checkedType()).toBe('Docs / FAQ');
      expect(document.body.textContent).toContain('Picked from the opportunity.');

      await click(radio('Create a new page'));
      expect(checkedType()).toBe('Docs / FAQ');
      await click(button('Open editor'));
      expect(createContentDraft.mock.calls[0][1]).toMatchObject({
        method: 'create',
        pageType: 'docs_faq',
        typePicked: false,
      });
    });

    it("types an existing page by its own address first, then by the opportunity's type", async () => {
      getContentStartOptions.mockResolvedValue({
        ...OPTIONS,
        opportunities: [{ ...OPTIONS.opportunities[0], decision: 'expand', assetType: 'faq_page' }],
      });
      await render('b2b', {
        kind: 'opportunity',
        id: 'o1',
        page: { url: 'https://northwind.example/pricing', title: 'Pricing' },
      });
      await act(async () => {});
      // An older opportunity's "FAQ page" doesn't make /pricing anything but pricing.
      expect(checkedType()).toBe('Pricing');
      expect(document.body.textContent).toContain('Picked from the page.');
    });

    it("guesses from the title when the site doesn't write the opportunity's type", async () => {
      getContentStartOptions.mockResolvedValue({
        ...OPTIONS,
        opportunities: [{ ...OPTIONS.opportunities[0], assetType: 'sizing_guide' }],
      });
      await render('b2b', { kind: 'opportunity', id: 'o1' });
      expect(checkedType()).toBe('Comparison');
      expect(document.body.textContent).toContain('Picked from the title.');
    });

    it('lets a person write a new page instead of the plan’s page when nothing overlaps', async () => {
      getContentOverlap.mockResolvedValue({ totalPrompts: 2, pages: [] });
      await render('b2b', {
        kind: 'opportunity',
        id: 'o2',
        page: { url: 'https://northwind.example/pricing', title: 'Pricing' },
      });
      await act(async () => {});

      await click(radio('Create a new page'));
      expect(document.body.textContent).toContain('Create: CRM for real estate teams');
      expect(radio('Optimize /pricing').getAttribute('aria-checked')).toBe('false');
      await click(button('Open editor'));
      expect(createContentDraft.mock.calls[0][1]).toMatchObject({
        method: 'create',
        title: 'CRM for real estate teams',
      });
    });

    it('offers the plan’s page beside a new page and the page cited most, to come back to', async () => {
      getContentOverlap.mockResolvedValue({
        totalPrompts: 4,
        pages: [
          {
            url: 'https://northwind.example/blog/crm-guide',
            title: 'CRM guide',
            promptsInCommon: 1,
            citations: 6,
            gscPosition: null,
          },
        ],
      });
      await render('b2b', {
        kind: 'opportunity',
        id: 'o2',
        page: { url: 'https://northwind.example/pricing', title: 'Pricing' },
      });
      await act(async () => {});

      const given = radio('Optimize /pricing');
      expect(given.textContent).toContain('The page your Content plan picked');
      expect(given.getAttribute('aria-checked')).toBe('true');
      expect(radio('Create a new page').getAttribute('aria-checked')).toBe('false');

      await click(radio('Optimize /blog/crm-guide instead'));
      expect(radio('Optimize /pricing').getAttribute('aria-checked')).toBe('false');
      await click(radio('Optimize /pricing'));
      expect(radio('Optimize /pricing').getAttribute('aria-checked')).toBe('true');
      await click(button('Open editor'));
      expect(createContentDraft.mock.calls[0][1]).toMatchObject({
        method: 'optimize',
        sourceUrl: 'https://northwind.example/pricing',
      });
    });

    it('offers the plan’s page once when it is also the page cited most', async () => {
      getContentOverlap.mockResolvedValue({
        totalPrompts: 4,
        pages: [
          {
            url: 'https://www.northwind.example/pricing/',
            title: 'Pricing',
            promptsInCommon: 3,
            citations: 6,
            gscPosition: null,
          },
        ],
      });
      await render('b2b', {
        kind: 'opportunity',
        id: 'o2',
        page: { url: 'https://northwind.example/pricing', title: 'Pricing' },
      });
      await act(async () => {});

      // Offered once, as the plan's page.
      expect(radio('Optimize /pricing').textContent).toContain('The page your Content plan picked');
      expect(radio('Optimize /pricing').getAttribute('aria-checked')).toBe('true');
      expect(radio('Optimize /pricing instead')).toBeUndefined();
    });

    it('opens on Team when the plan asks to assign the work', async () => {
      await render('b2b', { kind: 'opportunity', id: 'o2', who: 'team' });
      await act(async () => {});
      const team = [
        ...document.querySelectorAll<HTMLElement>('[aria-labelledby="start-who"] [role="radio"]'),
      ].find((r) => r.textContent?.startsWith('Team'))!;
      expect(team.getAttribute('aria-checked')).toBe('true');
      // The people who can see the dialog's brand (BRAND-ACCESS).
      expect(listBrandMembers).toHaveBeenCalledWith('b1');
    });

    it('leaves an opportunity no longer open to pick', async () => {
      await render('b2b', { kind: 'opportunity', id: 'gone' });
      expect(button('Continue')).toBeDefined();
      expect(document.body.textContent).toContain('Pick a content opportunity');
    });
  });

  describe('Optimize content › Page URL', () => {
    async function importUrl(url: string) {
      await render();
      await click(radio('Optimize content'));
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Page URL"]')!;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      await act(async () => {
        setValue.call(input, url);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await click(button('Import'));
      await act(async () => {});
    }

    it('reads a page of the brand’s, cleaned, and starts from its address', async () => {
      importContentPage.mockResolvedValue({
        page: {
          url: 'https://northwind.example/pricing',
          title: 'Pricing',
          html: '<h1>Pricing</h1><p onclick="x()">Plans</p><script>track()</script>',
        },
      });
      await importUrl('northwind.example/pricing');
      expect(importContentPage).toHaveBeenCalledWith('b1', 'northwind.example/pricing');
      expect(document.body.textContent).toContain('/pricing · 1 heading');

      await click(button('Continue'));
      expect(document.body.textContent).toContain('Optimize: Pricing');
      expect(checkedType()).toBe('Pricing');
      expect(document.body.textContent).toContain('Picked from the page.');
      // Content brought to optimize has no prompts to check.
      expect(getContentOverlap).not.toHaveBeenCalled();

      await click(button('Open editor'));
      expect(createContentDraft).toHaveBeenCalledWith('b1', {
        method: 'optimize',
        title: 'Pricing',
        pageType: 'pricing',
        typePicked: false,
        source: { kind: 'content' },
        bodyHtml: '<h1>Pricing</h1><p>Plans</p>',
        sourceUrl: 'https://northwind.example/pricing',
      });
    });

    it('says why a page couldn’t be read', async () => {
      importContentPage.mockResolvedValue({ error: 'off_site' });
      await importUrl('https://competitor.example/pricing');
      expect(document.querySelector('[role="alert"]')!.textContent).toBe(
        "Use a page on your brand's site. Its domains are in the brand settings.",
      );
      expect(button('Continue')!.disabled).toBe(true);

      importContentPage.mockResolvedValue({ error: 'http_error', status: 404 });
      await click(button('Import'));
      await act(async () => {});
      expect(document.querySelector('[role="alert"]')!.textContent).toBe('The page answered 404.');
    });
  });

  describe('the Overview', () => {
    const GUIDE = {
      url: 'https://acme.example/guides/espresso-machines-for-beginners/',
      title: 'Espresso machines for beginners',
      promptsInCommon: 3,
      citations: 4,
      gscPosition: 3.5,
    };
    /** Starts a new page from the first opportunity and waits for the Overview. */
    async function startFromOpportunity() {
      await render();
      await click(button('Pick a content opportunity'));
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (o) => o.textContent === 'Northwind vs HubSpot',
      );
      await click(option);
      await click(button('Continue'));
      await act(async () => {});
    }
    const overlapOption = (name: string) =>
      [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) =>
        r.textContent?.startsWith(name),
      )!;

    it('says when none of the brand’s pages is cited for the prompts, with nothing to choose', async () => {
      await startFromOpportunity();
      expect(getContentOverlap).toHaveBeenCalledWith('b1', { kind: 'opportunity', id: 'o1' });
      expect(document.body.textContent).toContain('Overview');
      expect(document.body.textContent).toContain(
        'None of your pages is cited for these prompts yet',
      );
      expect(document.body.textContent).not.toContain('Safe to create');
      expect(overlapOption('Create a new page')).toBeUndefined();
    });

    it('keeps Create chosen, and offers the page cited most without recommending it', async () => {
      getContentOverlap.mockResolvedValue({ totalPrompts: 4, pages: [GUIDE] });
      await startFromOpportunity();

      // Information, not a warning: no amber box, no recommendation.
      expect(document.body.textContent).toContain('1 of your pages is cited for these prompts');
      expect(document.body.textContent).toContain('3 of 4');
      expect(document.body.textContent).toContain('#4');
      expect(document.querySelector('[role="dialog"] .text-amber-700')).toBeNull();
      expect(document.body.textContent).not.toContain('Recommended');
      expect(overlapOption('Create a new page').getAttribute('aria-checked')).toBe('true');
      expect(document.body.textContent).toContain('Create: Northwind vs HubSpot');
      const optimize = overlapOption('Optimize /guides/espresso-machines-for-beginners instead');
      expect(optimize.getAttribute('aria-checked')).toBe('false');
      expect(optimize.textContent).toContain(
        'It already answers 3 of 4 prompts, is cited 4× and ranks #4 on Google',
      );

      // Picked, the draft becomes that page's: its title, and the type its address shows.
      await click(optimize);
      expect(document.body.textContent).toContain('Optimize: Espresso machines for beginners');
      expect(checkedType()).toBe('How-to guide');
      expect(document.body.textContent).toContain('Picked from the page.');

      importContentPage.mockResolvedValue({
        page: {
          url: GUIDE.url,
          title: 'Espresso machines for beginners',
          html: '<h1>Espresso machines for beginners</h1><p style="color:red">Start here.</p>',
        },
      });
      await click(button('Open editor'));
      // The page's live text comes in, cleaned like a paste.
      expect(importContentPage).toHaveBeenCalledWith('b1', GUIDE.url);
      expect(createContentDraft).toHaveBeenCalledWith('b1', {
        method: 'optimize',
        title: 'Espresso machines for beginners',
        pageType: 'guide',
        // Read from the page's address, so it follows the page.
        typePicked: false,
        source: { kind: 'opportunity', id: 'o1' },
        bodyHtml: '<h1>Espresso machines for beginners</h1><p>Start here.</p>',
        sourceUrl: GUIDE.url,
      });
    });

    it('starts an existing page with its title when its live text can’t be read', async () => {
      getContentOverlap.mockResolvedValue({ totalPrompts: 4, pages: [GUIDE] });
      await startFromOpportunity();
      await click(overlapOption('Optimize /guides/espresso-machines-for-beginners instead'));
      await click(button('Open editor'));
      expect(toast.warning).toHaveBeenCalledWith(
        "Couldn't read /guides/espresso-machines-for-beginners: the draft starts with its title.",
      );
      expect(createContentDraft.mock.calls[0][1]).toMatchObject({
        method: 'optimize',
        bodyHtml: undefined,
        sourceUrl: GUIDE.url,
      });
    });

    it('goes back to the new page after picking an existing one', async () => {
      getContentOverlap.mockResolvedValue({ totalPrompts: 4, pages: [GUIDE] });
      await startFromOpportunity();
      await click(overlapOption('Optimize /guides/espresso-machines-for-beginners instead'));
      await click(overlapOption('Create a new page'));
      expect(document.body.textContent).toContain('Create: Northwind vs HubSpot');
      expect(checkedType()).toBe('Comparison');
      await click(button('Open editor'));
      expect(createContentDraft.mock.calls[0][1]).toMatchObject({
        method: 'create',
        title: 'Northwind vs HubSpot',
        pageType: 'comparison',
        sourceUrl: undefined,
      });
    });

    it('lets the page start when the read fails, and tries again', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      getContentOverlap.mockRejectedValueOnce(new Error('down'));
      await startFromOpportunity();
      expect(document.body.textContent).toContain(
        "Couldn't read your pages cited for these prompts.",
      );
      expect(button('Open editor')!.disabled).toBe(false);
      await click(button('Try again'));
      await act(async () => {});
      expect(getContentOverlap).toHaveBeenCalledTimes(2);
      expect(document.body.textContent).toContain(
        'None of your pages is cited for these prompts yet',
      );
    });
  });

  describe('who does it', () => {
    async function startNewPage() {
      await render();
      await click(button('Pick a content opportunity'));
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (o) => o.textContent === 'Northwind vs HubSpot',
      );
      await click(option);
      await click(button('Continue'));
      await act(async () => {});
    }
    const whoOption = (name: string) =>
      [
        ...document.querySelectorAll<HTMLElement>('[aria-labelledby="start-who"] [role="radio"]'),
      ].find((r) => r.textContent?.startsWith(name))!;

    it('offers the agent first, and opens the editor for me by default', async () => {
      await startNewPage();
      expect(
        [
          ...document.querySelectorAll<HTMLElement>(
            '[aria-labelledby="start-who"] [role="radio"] .font-medium',
          ),
        ].map((el) => el.textContent),
      ).toEqual(['Agent', 'Me', 'Team']);
      expect(whoOption('Me').getAttribute('aria-checked')).toBe('true');
      expect(whoOption('Agent').textContent).toBe('AgentDrafts, I review');
      expect(button('Open editor')).toBeDefined();
    });

    it('asks who does it before the Overview, which grows as it lands', async () => {
      await startNewPage();
      const who = document.querySelector('[aria-labelledby="start-who"]')!;
      const overview = [...document.querySelectorAll('label')].find(
        (l) => l.textContent === 'Overview',
      )!;
      expect(who.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('hands the draft to the Content Agent, and opens the editor to watch it work', async () => {
      startAgentWriting.mockResolvedValue({ started: true });
      await startNewPage();
      await click(whoOption('Agent'));
      await click(button('Start the agent'));

      expect(agentWriteRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'd9',
          brandId: 'b1',
          method: 'create',
          rules: { set: null, source: null, overrides: {}, textRules: [] },
        }),
        describeRule,
      );
      expect(startAgentWriting).toHaveBeenCalledWith('d9', 'b1', { sources: 'kept', rules: [] });
      expect(onSent).toHaveBeenCalled();
      // At once, no toast to click: the editor shows the agent at work.
      expect(push).toHaveBeenCalledWith('/dashboard/content/editor/d9');
      expect(toast.success).not.toHaveBeenCalled();
      // The dialog stays until the editor opens: no page under it meanwhile.
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it('aims the agent at a pasted page’s own length (F)', async () => {
      startAgentWriting.mockResolvedValue({ started: true });
      await render('ecommerce');
      await click(radio('Optimize content'));
      await click(tab('Paste text'));
      const box = document.querySelector('textarea')!;
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: {
          getData: (type: string) =>
            type === 'text/html'
              ? `<h2>Returns policy</h2><p>${'30 days to return. '.repeat(10)}</p>`
              : '',
        },
      });
      await act(async () => box.dispatchEvent(paste));
      await click(button('Continue'));
      await click(whoOption('Agent'));
      await click(button('Start the agent'));

      // "Returns policy 30 days to return. …": as the draft started, not a new page's 3,000.
      expect(agentWriteRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'optimize',
          rules: { set: null, source: null, overrides: {}, textRules: [], importLength: 204 },
        }),
        describeRule,
      );
    });

    it('keeps the draft for me when the agent can’t start', async () => {
      startAgentWriting.mockResolvedValue({ error: 'ai_budget' });
      await startNewPage();
      await click(whoOption('Agent'));
      await click(button('Start the agent'));
      expect(toast.error.mock.calls[0][0]).toBe(
        "This month's AI usage is spent, so the agent didn't start. The draft is in the Library for you to write.",
      );
      expect(onSent).toHaveBeenCalled();
      // Nothing to watch: the editor isn't opened, the toast offers the draft.
      expect(push).not.toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('says the draft is the person’s to write when the agent is busy with another', async () => {
      startAgentWriting.mockResolvedValue({ error: 'org_writing' });
      await startNewPage();
      await click(whoOption('Agent'));
      await click(button('Start the agent'));
      expect(toast.error.mock.calls[0][0]).toBe(
        "The agent is writing another of your team's drafts, so it didn't start. The draft is in the Library for you to write.",
      );
    });

    it('sends the draft to the Action Center for the team, and keeps it in the Library', async () => {
      sendContentDraftToActionCenter.mockResolvedValue({
        actionId: 'a1',
        actionNo: 214,
        created: true,
      });
      await startNewPage();
      await click(whoOption('Team'));
      await click(button('Send to Action Center'));

      expect(createContentDraft.mock.calls[0][1]).toMatchObject({ method: 'create' });
      expect(sendContentDraftToActionCenter).toHaveBeenCalledWith('b1', 'd9');
      expect(push).not.toHaveBeenCalled();
      expect(onSent).toHaveBeenCalled();
      const [message, options] = toast.success.mock.calls[0];
      expect(message).toBe('Sent to the Action Center');
      expect(options.description).toBe(
        'Action #214: the draft waits in the Library for whoever writes it.',
      );
      options.action.onClick();
      expect(push).toHaveBeenCalledWith('/dashboard/action-center/actions?action=a1');
    });

    it('assigns the task to the teammate picked under Team', async () => {
      sendContentDraftToActionCenter.mockResolvedValue({
        actionId: 'a1',
        actionNo: 214,
        created: true,
      });
      await startNewPage();
      await click(whoOption('Team'));
      await act(async () => {});
      expect(document.body.textContent).toContain('Assign to');
      const picker = document.querySelector<HTMLSelectElement>('select[data-select]')!;
      expect([...picker.options].map((o) => o.textContent)).toEqual([
        '',
        'Mia Chen',
        'Ada Lovelace',
      ]);
      await act(async () => {
        picker.value = 'u2';
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await click(button('Send to Action Center'));

      expect(sendContentDraftToActionCenter).toHaveBeenCalledWith('b1', 'd9');
      expect(assignAction).toHaveBeenCalledWith('b1', 'a1', 'u2');
      expect(toast.success.mock.calls[0][0]).toBe('Sent to the Action Center');
    });

    it('sends the task unassigned when no one is picked', async () => {
      sendContentDraftToActionCenter.mockResolvedValue({
        actionId: 'a1',
        actionNo: 214,
        created: true,
      });
      await startNewPage();
      await click(whoOption('Team'));
      await click(button('Send to Action Center'));
      expect(assignAction).not.toHaveBeenCalled();
    });

    it('says the draft is kept when sending it fails, and opens it on request', async () => {
      sendContentDraftToActionCenter.mockResolvedValue({ error: 'Failed to send' });
      await startNewPage();
      await click(whoOption('Team'));
      await click(button('Send to Action Center'));
      const [message, options] = toast.error.mock.calls[0];
      expect(message).toBe(
        "The draft is in the Library, but it couldn't be sent to the Action Center.",
      );
      expect(onSent).toHaveBeenCalled();
      options.action.onClick();
      expect(push).toHaveBeenCalledWith('/dashboard/content/editor/d9');
    });
  });
});
