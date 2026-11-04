import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import {
  DEFAULT_MENTIONS_FILTERS,
  type MentionsFilters,
  type MentionsTab,
} from '@/lib/mentionsFilters';
import { DEFAULT_MENTIONS_TABLE, type MentionRow, type MentionsList } from '@/lib/mentionsList';
import type { MentionTotals, MentionsOverview } from '@/lib/mentionsOverview';
import type { Competitor, Topic } from '@/types';
import { MentionsHeaderActions } from './_HeaderActions';
import { useMentionsExport } from './_useMentionsExport';

const getMentionsOverview = vi.fn();
const exportMentions = vi.fn();
// No white label kit: downloads keep GetCito's names (exportName.test.ts has a kit's).
vi.mock('@/lib/actions/whiteLabel', () => ({
  getExportBranding: async () => ({ ok: true, branding: null }),
}));
vi.mock('@/lib/actions/mentions', () => ({
  getMentionsOverview: (...args: unknown[]) => getMentionsOverview(...args),
  exportMentions: (...args: unknown[]) => exportMentions(...args),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));
vi.mock('sonner', () => ({ toast }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const totals = (over: Partial<MentionTotals>): MentionTotals => ({
  answers: 0,
  mentions: 0,
  occurrences: 0,
  positive: 0,
  negative: 0,
  positionSum: 0,
  positionCount: 0,
  prompts: 0,
  promptsWithMentions: 0,
  lastAnswerAt: null,
  ...over,
});

const overview: MentionsOverview = {
  window: {
    from: '2026-09-17T09:00:00Z',
    to: '2026-10-17T09:00:00Z',
    days: 30,
    source: 'days',
    dayFrom: '2026-09-18',
    dayTo: '2026-10-17',
  },
  current: totals({
    answers: 400,
    mentions: 100,
    occurrences: 130,
    positive: 48,
    negative: 14,
    prompts: 20,
    promptsWithMentions: 15,
  }),
  previous: totals({
    answers: 400,
    mentions: 80,
    occurrences: 100,
    positive: 40,
    negative: 8,
    prompts: 20,
  }),
  platforms: [],
  daily: [],
  competitors: [
    { competitorId: 'c1', name: 'Crema Club', mentions: 90, coMentions: 41, previousMentions: 0 },
  ],
};

const row = (id: string): MentionRow => ({
  id,
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
  brandsNamed: 2,
  coMentioned: [{ competitorId: 'c1', name: 'Crema Club', position: 1 }],
  excerpt: 'Crema Club is first; Acme Coffee is pricier.',
  groupKey: null,
  groupCount: null,
});

const list = (over: Partial<MentionsList> = {}): MentionsList => ({
  total: 2,
  prompts: 1,
  rows: [row('r1'), row('r2')],
  brandTerms: ['Acme Coffee'],
  ...over,
});

const topics = [{ id: 't1', name: 'Beans' }] as Topic[];
const competitors = [{ id: 'c1', name: 'Crema Club' }] as Competitor[];

function Harness({ tab, filters }: { tab: MentionsTab; filters: MentionsFilters }) {
  const exporter = useMentionsExport({
    brandId: 'b1',
    brand: 'Acme Coffee',
    slug: 'acme-coffee',
    filters,
    topics,
    competitors,
  });
  return <MentionsHeaderActions tab={tab} exporter={exporter} />;
}

let container: HTMLDivElement;
let root: Root;
let saved: { name: string; blob: Blob }[];
const writeText = vi.fn();

function render(tab: MentionsTab = 'overview', filters = DEFAULT_MENTIONS_FILTERS) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Harness tab={tab} filters={filters} />
      </NextIntlClientProvider>,
    );
  });
}

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label) as
    HTMLButtonElement | undefined;

async function click(label: string) {
  await act(async () => {
    button(label)!.click();
  });
}

// The saved file's text, after checking it opens with UTF-8's byte order mark (for Excel).
async function savedText() {
  const bytes = await new Promise<Uint8Array>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(saved[0].blob);
  });
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return new TextDecoder().decode(bytes);
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  saved = [];
  let blob: Blob | null = null;
  URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), 'blob:mentions'));
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, blob: blob! });
  });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  window.history.replaceState(null, '', '/dashboard/mentions');
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  getMentionsOverview.mockReset();
  exportMentions.mockReset();
  writeText.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
  vi.restoreAllMocks();
});

describe('MentionsHeaderActions', () => {
  it('copies the Overview as text, with the filters and the n values', async () => {
    getMentionsOverview.mockResolvedValue(overview);
    render();
    await click('Copy summary');
    expect(getMentionsOverview).toHaveBeenCalledWith('b1', expect.objectContaining({}));
    expect(writeText.mock.calls[0][0]).toBe(
      [
        'Mentions & Sentiment · Acme Coffee',
        'All platforms · All countries · All topics',
        'Net sentiment is +34 (↓ 6 vs the previous 30 days). AI usually names Acme Coffee next to Crema Club.',
        // Total mentions counts every time a response names the brand, as the card does.
        'Total mentions: 130 (+30%)',
        'Mention rate: 25.0% of 400 tracked responses',
        'Prompts with mentions: 15 of 20 tracked prompts',
        'Net sentiment: +34 · 48% positive, 38% neutral, 14% negative (n=100)',
        'Built from aggregates with a fixed template, no LLM call · Sep 18 – Oct 17 · ' +
          '400 tracked responses · 130 mentions',
      ].join('\n'),
    );
    expect(toast.success).toHaveBeenCalledWith('Summary copied');
  });

  it('takes the Total mentions change on the prompts both windows answered, as its card does', async () => {
    // A prompt added this window brings 30 more mentions: on the same prompts, +10%.
    getMentionsOverview.mockResolvedValue({
      ...overview,
      same: {
        prompts: 18,
        newPrompts: 2,
        droppedPrompts: 0,
        current: totals({ answers: 360, mentions: 80, occurrences: 110 }),
        previous: totals({ answers: 360, mentions: 76, occurrences: 100 }),
      },
    });
    render();
    await click('Copy summary');
    expect(writeText.mock.calls[0][0]).toContain('Total mentions: 130 (+10%)');
  });

  it('names the filters in use, and marks a low sample instead of a split', async () => {
    getMentionsOverview.mockResolvedValue({
      ...overview,
      current: totals({
        answers: 12,
        mentions: 3,
        occurrences: 4,
        positive: 2,
        prompts: 2,
        promptsWithMentions: 1,
      }),
      previous: totals({}),
      competitors: [],
    });
    render('overview', {
      ...DEFAULT_MENTIONS_FILTERS,
      platform: 'gemini-web',
      region: 'DE',
      topic: 't1',
      q: 'espresso',
    });
    await click('Copy summary');
    const lines = (writeText.mock.calls[0][0] as string).split('\n');
    expect(lines[1]).toBe('Gemini · Germany · Beans · Search: “espresso”');
    expect(lines.slice(3, 7)).toEqual([
      'Total mentions: 4',
      'Mention rate: 25.0% · Low sample · 12 responses',
      'Prompts with mentions: 1 of 2 tracked prompts',
      'Net sentiment: +67 · Low sample · 3 responses',
    ]);
  });

  it('says so when the summary could not be read, or the browser refused the clipboard', async () => {
    getMentionsOverview.mockResolvedValue(null);
    render();
    await click('Copy summary');
    expect(writeText).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Couldn't copy the summary. Try again in a moment.");

    getMentionsOverview.mockResolvedValue(overview);
    writeText.mockRejectedValueOnce(
      new DOMException('Write permission denied.', 'NotAllowedError'),
    );
    await click('Copy summary');
    expect(toast.error).toHaveBeenLastCalledWith(
      "Your browser didn't allow copying here. Allow clipboard access for this site and try again.",
    );
  });

  it('exports every mention under the filters, below what the file holds', async () => {
    getMentionsOverview.mockResolvedValue(overview);
    exportMentions.mockResolvedValue(list());
    render();
    await click('Export CSV');
    expect(exportMentions).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({}),
      DEFAULT_MENTIONS_TABLE,
    );
    expect(saved[0].name).toMatch(/^getcito_acme-coffee_mentions_\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = (await savedText()).split('\n');
    expect(lines.slice(0, 11)).toEqual([
      'Mentions & Sentiment,Acme Coffee',
      'Period,"2026-09-18 – 2026-10-17 (30 days, UTC)"',
      'Platform,All platforms',
      'Country,All countries',
      'Topic,All topics',
      'Tracked responses (n),400',
      'Total mentions (n),130',
      'Responses naming the brand (n),2',
      'Prompts with mentions (n),1',
      'Responses in this file (n),2',
      expect.stringMatching(/^Exported \(UTC\),\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
    ]);
    expect(lines[11]).toBe('');
    expect(lines[12]).toMatch(/^date_utc,prompt,topic,platform/);
    expect(lines).toHaveLength(15);
  });

  it("takes the table's filters from the Mentions tab, and notes a file cut at the cap", async () => {
    window.history.replaceState(
      null,
      '',
      '/dashboard/mentions?tab=mentions&sentiment=negative&with=c1',
    );
    getMentionsOverview.mockResolvedValue(overview);
    exportMentions.mockResolvedValue(list({ total: 12_345 }));
    render('mentions');
    await click('Export CSV');
    expect(exportMentions.mock.calls[0][2]).toEqual({
      ...DEFAULT_MENTIONS_TABLE,
      sentiment: 'negative',
      competitor: 'c1',
    });
    const text = await savedText();
    expect(text).toContain('Sentiment,Negative\nCo-mentioned,Crema Club\n');
    expect(text).toContain(
      'Note,"Only the first 2 of 12,345 responses, in the table\'s order. Narrow the filters to export the rest."',
    );
    expect(toast.warning).toHaveBeenCalledWith(
      'The file holds 2 of 12,345 responses. Narrow the filters to export the rest.',
    );
  });

  it('says when there is nothing to export, or the export failed', async () => {
    getMentionsOverview.mockResolvedValue(overview);
    exportMentions.mockResolvedValueOnce(list({ total: 0, prompts: 0, rows: [] }));
    render();
    await click('Export CSV');
    expect(saved).toHaveLength(0);
    expect(toast.info).toHaveBeenCalledWith('No mentions to export for these filters.');

    exportMentions.mockRejectedValueOnce(new Error('statement timeout'));
    await click('Export CSV');
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't export the mentions. Try again in a moment.",
    );
  });

  it('waits for dates on a custom range, and links Reports', () => {
    render('overview', { ...DEFAULT_MENTIONS_FILTERS, range: 'custom' });
    expect(button('Copy summary')!.disabled).toBe(true);
    expect(button('Export CSV')!.disabled).toBe(true);
    expect(button('Export CSV')!.parentElement!.title).toBe('Choose a start or end date first.');
    expect(container.querySelector('a[href="/dashboard/reports"]')?.textContent).toBe('Reports');
  });
});
