import { describe, expect, it, vi } from 'vitest';

/** The engines' countries, as the API last read them (PROMPT-015e). */

const rows = [
  { country: 'KE', model: 'aimode' },
  { country: 'KE', model: 'chatgpt' },
  { country: 'US', model: 'aimode' },
  { country: 'US', model: 'copilot' },
];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    const q = {
      select: () => q,
      order: () => q,
      range: async () => ({ data: rows, error: null }),
    };
    return { from: () => q };
  }),
}));

const { getTrackingCountries } = await import('./trackingCountries');

describe('getTrackingCountries', () => {
  it('lists each country with the engines that answer from it', async () => {
    expect(await getTrackingCountries()).toEqual([
      { code: 'KE', models: ['aimode', 'chatgpt'] },
      { code: 'US', models: ['aimode', 'copilot'] },
    ]);
  });
});
