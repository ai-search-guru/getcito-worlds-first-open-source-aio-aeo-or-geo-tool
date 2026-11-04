import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { DEFAULT_MENTIONS_FILTERS } from '@/lib/mentionsFilters';
import type { MentionsPerception } from '@/lib/mentionsPerception';
import { BrandShapeCard } from './_BrandShape';
import { MentionsPerceptionTab } from './_perception';
import { CoMentionsCard, GapNote, HeatmapCard, TermsCard } from './_PerceptionCards';

const getMentionsPerception = vi.fn();
vi.mock('@/lib/actions/mentions', () => ({
  getMentionsPerception: (...args: unknown[]) => getMentionsPerception(...args),
}));
// The radar is loaded on demand and measured; these tests read what it is given.
vi.mock('next/dynamic', () => ({
  default: () =>
    function Radar({ series }: { series: { name: string; color: string }[] }) {
      return <div data-testid="radar">{series.map((s) => `${s.name} ${s.color}`).join(', ')}</div>;
    },
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const entity = (entity: string, name: string, mentions: number) => ({
  entity,
  name,
  isBrand: entity === 'brand',
  mentions,
  previousMentions: 0,
});

const values = (brand: number, profound: number, peec: number, otterly: number) => [
  { entity: 'brand', answers: brand },
  { entity: 'p', answers: profound },
  { entity: 'e', answers: peec },
  { entity: 'o', answers: otterly },
];

// Profound owns "enterprise", which AI uses for GetCito in 10% of its mentions.
const perception: MentionsPerception = {
  window: { from: '2026-09-17T09:00:00Z', to: '2026-10-17T09:00:00Z', days: 30 },
  entities: [
    entity('brand', 'GetCito', 50),
    entity('p', 'Profound', 80),
    entity('e', 'Peec AI', 40),
    entity('o', 'Otterly AI', 20),
    entity('s', 'Scrunch', 0),
  ],
  brandTerms: [
    { term: 'visibility tracking', answers: 20, previousAnswers: 10 },
    { term: 'api', answers: 10, previousAnswers: 10 },
    { term: 'pricing', answers: 5, previousAnswers: 0 },
  ],
  attributes: [
    { term: 'enterprise', values: values(5, 48, 4, 0) },
    { term: 'visibility tracking', values: values(20, 16, 8, 2) },
    { term: 'open source', values: values(0, 0, 12, 1) },
  ],
  coMentions: [
    { competitorId: 'p', name: 'Profound', coMentions: 30, previousCoMentions: 20 },
    { competitorId: 'e', name: 'Peec AI', coMentions: 0, previousCoMentions: 5 },
    { competitorId: 'o', name: 'Otterly AI', coMentions: 12, previousCoMentions: 12 },
  ],
};

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

const cells = (row: Element) => [...row.querySelectorAll('th, td')].map((c) => c.textContent);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  getMentionsPerception.mockReset();
  vi.useRealTimers();
});

describe('TermsCard', () => {
  it("lists the brand's terms with their responses, share and change", () => {
    render(<TermsCard perception={perception} brand="GetCito" />);
    expect(container.textContent).toContain('What AI associates with GetCito');
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.map(cells)).toEqual([
      ['visibility tracking', '', '20 responses', '+100%'],
      ['api', '', '10 responses', '±0'],
      // Nothing before to compare with.
      ['pricing', '', '5 responses', '—'],
    ]);
    expect(rows[0].querySelectorAll('td')[2].getAttribute('title')).toBe(
      '40% of responses naming GetCito',
    );
  });

  it('says when there are no terms yet', () => {
    render(<TermsCard perception={{ ...perception, brandTerms: [] }} brand="GetCito" />);
    expect(container.textContent).toContain('No terms yet.');
  });
});

describe('HeatmapCard', () => {
  it("shows each attribute's share of each brand's mentions, shaded by share", () => {
    render(<HeatmapCard perception={perception} />);
    const rows = [...container.querySelectorAll('tr')];
    expect(rows.map(cells)).toEqual([
      ['Attribute', 'You', 'Profound', 'Peec AI', 'Otterly AI', 'Scrunch'],
      ['enterprise', '10%', '60%', '10%', '0%', '—'],
      ['visibility tracking', '40%', '20%', '20%', '10%', '—'],
      ['open source', '0%', '0%', '30%', '5%', '—'],
    ]);
    const [, , profound, , otterly] = [...rows[1].querySelectorAll('td')] as HTMLElement[];
    expect(profound.style.backgroundColor).toBe('rgba(120, 113, 108, 0.4)');
    expect(otterly.style.backgroundColor).toBe('');
  });
});

describe('CoMentionsCard', () => {
  it('lists the competitors named beside the brand, leaving out the ones never named', () => {
    render(<CoMentionsCard perception={perception} />);
    expect([...container.querySelectorAll('tbody tr')].map(cells)).toEqual([
      ['Profound', '', '30 responses', '+50%'],
      ['Otterly AI', '', '12 responses', '±0'],
    ]);
  });

  it('says when no competitor is named beside the brand', () => {
    render(<CoMentionsCard perception={{ ...perception, coMentions: [] }} />);
    expect(container.textContent).toContain('No competitor is named in the same responses');
  });
});

describe('GapNote', () => {
  it("names the brand's place, or says AI never uses the term for it", () => {
    const gap = {
      term: 'enterprise',
      competitor: 'Profound',
      competitorShare: 60,
      brandShare: 10,
      brandRank: 2,
    };
    render(<GapNote gap={gap} brand="GetCito" />);
    expect(container.textContent).toBe(
      'Biggest gap: “enterprise”: Profound in 60% of the responses naming it; GetCito in 10% (#2).',
    );

    render(<GapNote gap={{ ...gap, brandShare: 0, brandRank: null }} brand="GetCito" />);
    expect(container.textContent).toBe(
      "Biggest gap: “enterprise”: Profound in 60% of the responses naming it; AI doesn't use it for GetCito.",
    );
  });
});

describe('BrandShapeCard', () => {
  it('draws the brand and its top three competitors, with the biggest gap beneath', () => {
    render(<BrandShapeCard perception={perception} brand="GetCito" />);
    expect(container.querySelector('[data-testid="radar"]')?.textContent).toBe(
      // Your brand in ink, as the rest of the page; no violet.
      'GetCito var(--primary), Profound #f97316, Peec AI #0d9488, Otterly AI #ef4444',
    );
    expect(container.querySelector('figcaption')?.textContent).toBe(
      'GetCitoProfoundPeec AIOtterly AI',
    );
    expect(container.textContent).toContain(
      'Biggest gap: “enterprise”: Profound in 60% of the responses naming it; GetCito in 10% (#2).',
    );
  });

  it('takes the gap among the brands drawn, not a fifth one off the radar', () => {
    render(
      <BrandShapeCard
        perception={{
          ...perception,
          entities: [...perception.entities.slice(0, 4), entity('s', 'Scrunch', 40)],
          attributes: [
            ...perception.attributes,
            { term: 'agencies', values: [{ entity: 's', answers: 36 }] },
          ],
        }}
        brand="GetCito"
      />,
    );
    expect(container.textContent).toContain('Biggest gap: “enterprise”: Profound');
  });

  it('says so when there are too few attributes for a shape', () => {
    render(
      <BrandShapeCard
        perception={{ ...perception, attributes: perception.attributes.slice(0, 2) }}
        brand="GetCito"
      />,
    );
    expect(container.querySelector('[data-testid="radar"]')).toBeNull();
    expect(container.textContent).toContain('The shape needs at least three attributes');
  });
});

describe('MentionsPerceptionTab', () => {
  it('reads the perception once the filters settle and shows it', async () => {
    vi.useFakeTimers();
    getMentionsPerception.mockResolvedValue(perception);
    render(
      <MentionsPerceptionTab brandId="b1" brand="GetCito" filters={DEFAULT_MENTIONS_FILTERS} />,
    );
    expect(getMentionsPerception).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(getMentionsPerception).toHaveBeenCalledTimes(1);
    expect(getMentionsPerception.mock.calls[0][0]).toBe('b1');
    expect(container.textContent).toContain('What AI associates with GetCito');
    expect(container.textContent).toContain('Frequently mentioned with');
    expect(container.textContent).toContain('by rule (no LLM)');
  });

  it('says a read failed, and shows the skeleton again once a newer one is on its way', async () => {
    vi.useFakeTimers();
    // Failed twice: once, and once more on the tab's own retry.
    getMentionsPerception
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'));
    render(
      <MentionsPerceptionTab brandId="b1" brand="GetCito" filters={DEFAULT_MENTIONS_FILTERS} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(container.textContent).toBe("Couldn't load the perception figures.Try again");

    render(
      <MentionsPerceptionTab
        brandId="b1"
        brand="GetCito"
        filters={{ ...DEFAULT_MENTIONS_FILTERS, range: '7d' }}
      />,
    );
    expect(container.textContent).toBe('');
    expect(container.querySelector('[aria-hidden]')).not.toBeNull();
  });

  it('tries a failed read once more before saying it failed (a cold read past the limit)', async () => {
    vi.useFakeTimers();
    getMentionsPerception
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(perception);
    render(
      <MentionsPerceptionTab brandId="b1" brand="GetCito" filters={DEFAULT_MENTIONS_FILTERS} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(getMentionsPerception).toHaveBeenCalledTimes(2);
    expect(getMentionsPerception.mock.calls[1]).toEqual(getMentionsPerception.mock.calls[0]);
    expect(container.textContent).toContain('What AI associates with GetCito');
    expect(container.textContent).not.toContain("Couldn't load");
  });

  it('says it is still reading when a read takes a while', async () => {
    vi.useFakeTimers();
    let answer: (value: typeof perception) => void = () => {};
    getMentionsPerception.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    render(
      <MentionsPerceptionTab brandId="b1" brand="GetCito" filters={DEFAULT_MENTIONS_FILTERS} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    // In the page from the start, empty, so a screen reader announces the words.
    expect(container.querySelector('[role="status"]')!.textContent).toBe('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(container.querySelector('[role="status"]')!.textContent).toBe(
      "Still reading this period's figures. It can take a few seconds.",
    );
    await act(async () => answer(perception));
    expect(container.querySelector('[role="status"]')!.textContent).toBe('');
    expect(container.textContent).toContain('What AI associates with GetCito');

    // New filters: the last figures stay, dimmed, and a slow read says so.
    getMentionsPerception.mockReturnValueOnce(new Promise(() => {}));
    render(
      <MentionsPerceptionTab
        brandId="b1"
        brand="GetCito"
        filters={{ ...DEFAULT_MENTIONS_FILTERS, range: '90d' }}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(container.querySelector('section[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')!.textContent).toContain('Still reading');
  });

  it('says a read is slow only once it is, back on filters whose last read was', async () => {
    vi.useFakeTimers();
    let answer: (value: typeof perception) => void = () => {};
    getMentionsPerception
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      .mockResolvedValueOnce(perception)
      .mockReturnValueOnce(new Promise(() => {}));
    // Dates in the past read the same window each time (a preset moves with now).
    const june = {
      ...DEFAULT_MENTIONS_FILTERS,
      range: 'custom' as const,
      from: '2026-06-01',
      to: '2026-06-30',
    };
    const tab = (filters: typeof DEFAULT_MENTIONS_FILTERS) =>
      render(<MentionsPerceptionTab brandId="b1" brand="GetCito" filters={filters} />);
    const status = () => container.querySelector('[role="status"]')!.textContent;

    tab(june);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(status()).toContain('Still reading');
    await act(async () => answer(perception));
    tab({ ...DEFAULT_MENTIONS_FILTERS, range: '7d' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    // Back on June: the figures shown are 7 days', dimmed, and not slow yet.
    tab({ ...june });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(getMentionsPerception.mock.calls[2]).toEqual(getMentionsPerception.mock.calls[0]);
    expect(container.querySelector('section[aria-busy="true"]')).not.toBeNull();
    expect(status()).toBe('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(status()).toContain('Still reading');
  });

  it('reads the same filters again on Try again, with the skeleton meanwhile', async () => {
    vi.useFakeTimers();
    getMentionsPerception
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(perception);
    render(
      <MentionsPerceptionTab brandId="b1" brand="GetCito" filters={DEFAULT_MENTIONS_FILTERS} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    const retry = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Try again',
    )!;
    await act(async () => retry.click());
    expect(container.querySelector('[aria-hidden]')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(getMentionsPerception).toHaveBeenCalledTimes(3);
    expect(getMentionsPerception.mock.calls[2]).toEqual(getMentionsPerception.mock.calls[0]);
    expect(container.textContent).toContain('What AI associates with GetCito');
  });

  it('asks for dates on a custom range without any', () => {
    render(
      <MentionsPerceptionTab
        brandId="b1"
        brand="GetCito"
        filters={{ ...DEFAULT_MENTIONS_FILTERS, range: 'custom' }}
      />,
    );
    expect(container.textContent).toBe('Choose a start or end date to see the perception figures.');
    expect(getMentionsPerception).not.toHaveBeenCalled();
  });

  it('says when the brand was never named, or the figures are unavailable', async () => {
    vi.useFakeTimers();
    getMentionsPerception.mockResolvedValueOnce({
      ...perception,
      entities: [entity('brand', 'GetCito', 0), ...perception.entities.slice(1)],
    });
    render(
      <MentionsPerceptionTab brandId="b1" brand="GetCito" filters={DEFAULT_MENTIONS_FILTERS} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(container.textContent).toBe(
      "AI didn't name GetCito in the tracked responses of this period.",
    );

    getMentionsPerception.mockResolvedValueOnce(null);
    render(<MentionsPerceptionTab brandId="b2" brand="Other" filters={DEFAULT_MENTIONS_FILTERS} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(container.textContent).toContain("Perception isn't available yet.");
  });
});
