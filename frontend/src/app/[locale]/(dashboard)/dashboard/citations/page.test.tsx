import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { CitationDomainRow, CitationsOverview } from '@/lib/actions/citations';
import type { SourceCategory } from '@/lib/citations/classify';

/**
 * The Citations page's Unique Domains KPI (follow-up to #1218): it counts the
 * cited domains within the selected source scope, as the Domains tab and the
 * unique URLs under it do (#745).
 */

const { getCitationsOverview, getBrandFilterOptions } = vi.hoisted(() => ({
  getCitationsOverview: vi.fn(),
  getBrandFilterOptions: vi.fn(),
}));
vi.mock('@/lib/actions/citations', () => ({
  getCitationsOverview,
  getCitationGaps: vi.fn(async () => null),
  brandHasCitations: vi.fn(async () => true),
}));
vi.mock('@/lib/actions/topic', () => ({ getTopics: vi.fn(async () => []) }));
vi.mock('@/lib/actions/tracking', () => ({
  getBrandPrompts: vi.fn(async () => []),
  getBrandFilterOptions,
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: () => ({ getActiveBrand: () => ({ id: 'b1', name: 'Acme', slug: 'acme' }) }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));
vi.mock('@/components/citations/AddCompetitorButton', () => ({
  AddCompetitorButton: () => null,
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { default: CitationsPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const row = (domain: string, category: SourceCategory): CitationDomainRow => ({
  domain,
  category,
  models: ['gpt-5'],
  totalCitations: 8,
  avgCitationsPerResult: 2,
  resultsCiting: 4,
  usagePct: 40,
  articleTypes: [],
});

// Five cited domains, two of them the brand's; the server counts the URLs
// within the scope it was asked for.
const overview = (urls: number): CitationsOverview => ({
  rows: [
    row('acme.example', 'you'),
    row('blog.acme.example', 'you'),
    row('rival.example', 'competitor'),
    row('reddit.com', 'forum'),
    row('techcrunch.com', 'editorial'),
  ],
  urlRows: [],
  totals: { domains: 5, urls, citations: 40, results: 10, avgCitationsPerResult: 4 },
  sourceTypeBreakdown: [],
  availableRegions: [],
});

let container: HTMLDivElement;
let root: Root;

async function render(scope: string, query = '') {
  window.history.replaceState(null, '', `/dashboard/citations?scope=${scope}${query}`);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <CitationsPage />
      </NextIntlClientProvider>,
    );
  });
}

function card(title: string): string {
  const cards = [...container.querySelectorAll('[data-slot="card"]')];
  const found = cards.find((c) => c.textContent?.startsWith(title));
  if (!found) throw new Error(`No card "${title}" in: ${container.textContent}`);
  return found.textContent ?? '';
}

beforeEach(() => {
  getCitationsOverview.mockReset();
  getBrandFilterOptions.mockReset().mockResolvedValue({
    regions: [],
    models: ['chatgpt-web', 'gpt-5-chat-latest', 'perplexity-web'],
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
});

describe('CitationsPage: Unique Domains', () => {
  it('counts the domains in the selected scope, beside its URLs', async () => {
    getCitationsOverview.mockResolvedValue(overview(7));
    await render('own');
    expect(getCitationsOverview).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ sourceScope: 'own' }),
    );
    // Brand: the brand's two domains, not all five.
    expect(card('Unique Domains')).toBe('Unique Domains27 unique URLs');
  });

  it('counts every domain on All', async () => {
    getCitationsOverview.mockResolvedValue(overview(31));
    await render('all');
    expect(card('Unique Domains')).toBe('Unique Domains531 unique URLs');
  });

  it('counts the third-party domains on Third party', async () => {
    getCitationsOverview.mockResolvedValue(overview(12));
    await render('third_party');
    expect(card('Unique Domains')).toBe('Unique Domains212 unique URLs');
  });
});

describe('CitationsPage: a platform from an address', () => {
  it('reads one model of a family as the family, as the dropdown sets it', async () => {
    getCitationsOverview.mockResolvedValue(overview(7));
    await render('all', '&platform=chatgpt-web');
    await act(async () => {});
    expect(getBrandFilterOptions).toHaveBeenCalledExactlyOnceWith('b1');
    // Only the family is read: no load with the one model first.
    expect(getCitationsOverview.mock.calls.map(([, filters]) => filters.platforms)).toEqual([
      ['chatgpt-web,gpt-5-chat-latest'],
    ]);
    expect(new URL(window.location.href).searchParams.get('platform')).toBe(
      'chatgpt-web,gpt-5-chat-latest',
    );
    // The dropdown names it, though no row of this window came from it.
    expect(container.textContent).toContain('ChatGPT');
  });

  it('keeps a family, and a model with no family, asking the brand’s models only for one model', async () => {
    getCitationsOverview.mockResolvedValue(overview(7));
    await render('all', '&platform=chatgpt-web%2Cgpt-5-chat-latest');
    expect(getBrandFilterOptions).not.toHaveBeenCalled();
    expect(getCitationsOverview).toHaveBeenLastCalledWith(
      'b1',
      expect.objectContaining({ platforms: ['chatgpt-web,gpt-5-chat-latest'] }),
    );

    act(() => root.unmount());
    root = createRoot(container);
    getCitationsOverview.mockClear();
    await render('all', '&platform=perplexity-web');
    await act(async () => {});
    expect(getCitationsOverview.mock.calls.map(([, filters]) => filters.platforms)).toEqual([
      ['perplexity-web'],
    ]);
  });
});
