import { describe, expect, it } from 'vitest';
import { AI_ADOPTION_RATE } from '@/lib/volumeEstimate';
import { AI_PLATFORM_SHARES, AIO_SEARCH_SHARE } from './_platformShares';

/**
 * The Prompt Volumes chart's split: AI Overviews' share comes from the share
 * of Google searches that show one, the same 45% AI adoption rate the total
 * is estimated with, and the other engines split the rest by their weights.
 */

const share = (name: string) => AI_PLATFORM_SHARES.find((p) => p.name === name)!.share;

/** Google searches a day and the other engines' AI-answered queries, as the module has them. */
const GOOGLE_DAILY = 16.4e9;
const OTHERS_DAILY = 3.795e9;

describe('AI_PLATFORM_SHARES', () => {
  it('rests on the 45% AI adoption rate the total is estimated with', () => {
    expect(AIO_SEARCH_SHARE).toBe(AI_ADOPTION_RATE);
    expect(AIO_SEARCH_SHARE).toBe(0.45);
    // 45% × 16.4B = 7.38B of 11.175B a day.
    expect(share('Google AI Overviews')).toBeCloseTo(0.6604, 4);
    expect(share('ChatGPT')).toBeCloseTo(0.2304, 4);
    expect(share('Grok')).toBeCloseTo(0.0043, 4);
  });

  it('keeps the other engines’ queries a day as they were set at 35%', () => {
    const total = GOOGLE_DAILY * AIO_SEARCH_SHARE + OTHERS_DAILY;
    const was = GOOGLE_DAILY * 0.35 + OTHERS_DAILY;
    // ChatGPT was 27% of the queries at 35%: the same ~2.57B a day now.
    expect(share('ChatGPT') * total).toBeCloseTo(0.27 * was, -6);
    expect(
      AI_PLATFORM_SHARES.filter((p) => p.name !== 'Google AI Overviews').reduce(
        (sum, p) => sum + p.share * total,
        0,
      ),
    ).toBeCloseTo(OTHERS_DAILY, -3);
  });

  it('adds up to every AI-answered query', () => {
    expect(AI_PLATFORM_SHARES.reduce((sum, p) => sum + p.share, 0)).toBeCloseTo(1, 10);
    expect(AI_PLATFORM_SHARES).toHaveLength(8);
  });
});
