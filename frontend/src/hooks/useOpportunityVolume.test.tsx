import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentOpportunity, OpportunityBasket } from '@/types';
import type { QuestionVolume } from '@/lib/content/questionVolume';
import { guessedVolumeEstimate } from '@/lib/volumeEstimate';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const getOpportunityBasket = vi.fn<(id: string) => Promise<OpportunityBasket>>();
const getQuestionVolume =
  vi.fn<(brandId: string, promptId: string) => Promise<QuestionVolume | null>>();
vi.mock('@/lib/actions/content', () => ({
  getOpportunityBasket: (id: string) => getOpportunityBasket(id),
  getQuestionVolume: (brandId: string, promptId: string) => getQuestionVolume(brandId, promptId),
}));

const { useOpportunityVolume } = await import('./useOpportunityVolume');

type Read = ReturnType<typeof useOpportunityVolume>;

function Probe({ opportunity, seen }: { opportunity: ContentOpportunity; seen: Read[] }) {
  seen.push(useOpportunityVolume(opportunity));
  return null;
}

let root: Root;

async function render(opportunity: ContentOpportunity): Promise<Read[]> {
  const seen: Read[] = [];
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe opportunity={opportunity} seen={seen} />));
  return seen;
}

const opportunity = (over: Partial<ContentOpportunity> = {}): ContentOpportunity => ({
  id: 'o1',
  brandId: 'b1',
  clusterId: 'c1',
  promptId: 'p1',
  title: 'Espresso grinders',
  description: '',
  type: 'owned',
  impact: 'high',
  opportunityScore: 70,
  status: 'new',
  // The sum the score weighs, and its question's own volume.
  sourceData: { estAiVolume: 112500, questionVolume: 1000, prompts: ['a', 'b', 'c'] },
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

const basket = (ids: string[]): OpportunityBasket => ({
  clusters: [
    {
      id: 'c1',
      label: 'Grinders',
      need: '',
      topicName: null,
      prompts: ids.map((id) => ({ id, text: id })),
    },
  ],
  queries: [],
});

const question = (value: number): QuestionVolume => ({
  question: 'Which espresso grinder should I buy for a small cafe?',
  estimate: guessedVolumeEstimate(value, '2026-10-01T00:00:00Z'),
  fromHeadTerms: true,
  closest: null,
});

beforeEach(() => {
  getOpportunityBasket.mockReset();
  getQuestionVolume.mockReset();
});

afterEach(() => act(() => root.unmount()));

/** A content opportunity's AI volume: its question's, one of its prompts (2026-11-01). */
describe('useOpportunityVolume', () => {
  it("reads its question's volume, not its prompts' sum, and hands the basket on", async () => {
    getOpportunityBasket.mockResolvedValue(basket(['p1', 'p2']));
    getQuestionVolume.mockResolvedValue(question(3038));
    const seen = await render(opportunity());

    expect(seen[0].volume).toBeUndefined();
    const last = seen.at(-1)!;
    expect(getQuestionVolume).toHaveBeenCalledWith('b1', 'p1');
    expect(last.volume).toMatchObject({ value: 3038 });
    expect(last.volume).not.toHaveProperty('count');
    expect(last.question?.fromHeadTerms).toBe(true);
    // One of the cluster's prompts, once its basket is in.
    expect(last.prompts).toBe(2);
    expect(last.basket?.clusters[0].prompts).toHaveLength(2);
    expect(getOpportunityBasket).toHaveBeenCalledTimes(1);
  });

  it('reads one prompt without a basket', async () => {
    getQuestionVolume.mockResolvedValue(question(400));
    const last = (
      await render(opportunity({ clusterId: null, promptId: 'p9', sourceData: {} }))
    ).at(-1)!;

    expect(getOpportunityBasket).not.toHaveBeenCalled();
    expect(last.volume).toMatchObject({ value: 400 });
    expect(last.prompts).toBe(1);
  });

  it("falls back to its question's volume kept on it, undated, when the read fails", async () => {
    getOpportunityBasket.mockResolvedValue(basket(['p1']));
    getQuestionVolume.mockRejectedValue(new Error('down'));
    const last = (await render(opportunity())).at(-1)!;

    expect(last.volume).toMatchObject({
      basis: 'snapshot',
      value: 1000,
      low: 500,
      high: 2000,
      confidence: 'low',
      asOf: null,
    });
    expect(last.question).toBeNull();
  });

  it("never shows a group's older sum as its volume", async () => {
    getOpportunityBasket.mockResolvedValue(basket(['p1']));
    getQuestionVolume.mockResolvedValue(null);
    const last = (await render(opportunity({ sourceData: { estAiVolume: 145000 } }))).at(-1)!;

    expect(last.volume).toBeNull();
  });

  it('shows the kept volume when it has no question to read, and counts the prompts it kept', async () => {
    getOpportunityBasket.mockRejectedValue(new Error('down'));
    const last = (await render(opportunity({ promptId: undefined }))).at(-1)!;

    expect(last.basketFailed).toBe(true);
    expect(getQuestionVolume).not.toHaveBeenCalled();
    expect(last.volume).toMatchObject({ basis: 'snapshot', value: 1000 });
    expect(last.prompts).toBe(3);
  });
});
