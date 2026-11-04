import { describe, expect, it } from 'vitest';
import { closestPhrase, opportunityVolumeForMcp, questionVolume } from './questionVolume';

// A content opportunity's volume is its question's (2026-11-01). The row is
// the dev database's: a 9-word question estimated at 3,038 a month from its
// head terms, against 585 for its closest measured phrase (5.2×).

const NOW = new Date('2026-11-01T00:00:00Z');
const QUESTION = 'What are the best coffee subscription services in 2026?';
const row = {
  estAiVolume: 3038,
  googleVolumes: {
    'coffee subscription': 22200,
    'best coffee subscription': 8100,
    'coffee subscription services': 5400,
    'best coffee subscription 2026': 1300,
  },
  aiVolumeMultiplier: 0.45,
  keywords: [
    'best coffee subscription',
    'coffee subscription',
    'coffee subscription services',
    'best coffee subscription 2026',
  ],
  fetchedAt: '2026-10-20T00:00:00Z',
};

describe('questionVolume', () => {
  it("is the question's own prompt estimate, from head terms, with the closest measured phrase", () => {
    const read = questionVolume(QUESTION, row, NOW)!;
    expect(read.estimate).toMatchObject({ value: 3038, basis: 'keywords' });
    expect(read.fromHeadTerms).toBe(true);
    expect(read.closest?.phrase).toBe('best coffee subscription 2026');
    // That keyword's own Google volume × the AI share: 1,300 × 0.45.
    expect(read.closest?.estimate).toMatchObject({ value: 585, basis: 'keyword' });
  });

  it('names no head terms or phrase for a short question, and nothing without a volume', () => {
    const short = questionVolume('Best coffee subscription?', row, NOW)!;
    expect(short.fromHeadTerms).toBe(false);
    expect(short.closest).toBeNull();
    expect(questionVolume(QUESTION, { ...row, estAiVolume: 0 }, NOW)).toBeNull();
  });
});

describe('closestPhrase', () => {
  it('prefers the keyword sharing most of its words, then the more specific one', () => {
    expect(closestPhrase(QUESTION, row.googleVolumes)).toEqual({
      phrase: 'best coffee subscription 2026',
      googleVolume: 1300,
    });
    // Words the question lacks count against a keyword, so these two tie and
    // the less searched wins; one without data never does.
    expect(
      closestPhrase('Which espresso grinder suits a small cafe best?', {
        'espresso grinder': 9000,
        'commercial espresso grinder for cafe': 400,
        'espresso grinder small cafe': 0,
        'coffee beans': 50000,
      }),
    ).toEqual({ phrase: 'commercial espresso grinder for cafe', googleVolume: 400 });
    expect(closestPhrase('Something else entirely', row.googleVolumes)).toBeNull();
  });
});

describe('opportunityVolumeForMcp', () => {
  it('gives the range, confidence, source and that it is one of N prompts', () => {
    const volume = opportunityVolumeForMcp(questionVolume(QUESTION, row, NOW), 3);
    expect(volume).toMatchObject({
      question: QUESTION,
      est_ai_volume: 3038,
      volume_type: 'estimate',
      of_prompts: 3,
      from_head_terms: true,
      closest_phrase: { phrase: 'best coffee subscription 2026', est_ai_volume: 585 },
      fetched_at: '2026-10-20T00:00:00Z',
    });
    expect(volume?.source).toContain('DataForSEO');
    expect(volume?.source).toContain('45%');
    expect(volume!.est_ai_volume_low).toBeLessThan(3038);
    expect(opportunityVolumeForMcp(null, 3)).toBeNull();
  });
});
