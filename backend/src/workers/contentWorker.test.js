import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a content job hands the generator: the nightly run passes nothing,
 * "+ New" and "Another angle" are manual, and "Suggest content" from the
 * prompts table (PROMPT-006) asks for its prompt's cluster and is tagged
 * prompt.
 */

const generateContentOpportunities = vi.fn();
const refreshPromptClusters = vi.fn();

vi.mock('../lib/opportunityGenerator.js', () => ({ generateContentOpportunities }));
vi.mock('../lib/promptClusters.js', () => ({ refreshPromptClusters }));
vi.mock('../lib/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }));

const { processContentJob } = await import('./contentWorker.js');

const job = { progress: vi.fn() };
const optsOf = () => generateContentOpportunities.mock.calls[0][1];

beforeEach(() => {
  vi.clearAllMocks();
  generateContentOpportunities.mockResolvedValue({ generated: 1, merged: 0 });
  refreshPromptClusters.mockResolvedValue(undefined);
});

describe('processContentJob', () => {
  it("asks for a prompt's own suggestion, tagged prompt", async () => {
    await processContentJob({
      brandId: 'b1',
      job,
      request: { count: 1, promptId: 'p1', explicit: true, source: 'prompt' },
    });
    expect(optsOf()).toMatchObject({
      count: 1,
      promptId: 'p1',
      explicit: true,
      source: 'prompt',
    });
    // A new prompt is only grouped by the refresh, so it runs first.
    expect(refreshPromptClusters).toHaveBeenCalledWith('b1');
  });

  it("asks for one page's content from AI Traffic, as manual (AT-006 part B3)", async () => {
    await processContentJob({ brandId: 'b1', job, request: { count: 1, pagePath: '/gifts' } });
    expect(optsOf()).toMatchObject({ count: 1, pagePath: '/gifts', source: 'manual' });
    // A page's prompts tracked a moment ago are only grouped by the refresh.
    expect(refreshPromptClusters).toHaveBeenCalledWith('b1');
  });

  it('marks "+ New" as manual, with no special request', async () => {
    await processContentJob({ brandId: 'b1', job, request: { count: 3, promptId: null } });
    expect(optsOf()).toMatchObject({ count: 3, explicit: false, pagePath: null, source: 'manual' });
  });

  it('never lets a request pick its own tag', async () => {
    await processContentJob({ brandId: 'b1', job, request: { count: 1, source: 'system' } });
    expect(optsOf().source).toBe('manual');
  });

  it("doesn't regroup before another angle, which is asked for a known cluster", async () => {
    await processContentJob({
      brandId: 'b1',
      job,
      request: { count: 1, alternativeOf: { id: 'o1', title: 'T', clusterId: 'c1' } },
    });
    expect(refreshPromptClusters).not.toHaveBeenCalled();
  });

  it('leaves the nightly run to the generator defaults', async () => {
    await processContentJob({ brandId: 'b1', job });
    expect(optsOf()).not.toHaveProperty('source');
    expect(optsOf()).not.toHaveProperty('explicit');
  });
});
