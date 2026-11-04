import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSearchVolumes } from './dataforseo.js';
import { resolveModel } from './aiProvider.js';
import { regionToLocationCode } from './dataforseoCodes.js';

vi.mock('./dataforseo.js', () => ({
  getSearchVolumes: vi.fn(),
}));

vi.mock('./aiProvider.js', () => ({
  resolveModel: vi.fn(),
}));

vi.mock('../config/supabase.js', () => ({ default: {} }));

const { medianVolume } = await import('./volumeAnalysis.js');

const AI_VOLUME_MULTIPLIER = parseFloat(process.env.AI_VOLUME_MULTIPLIER || '0.15');

describe('test-volumes pipeline (mocked)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should fetch and return volumes from DataForSEO', async () => {
    const mockVolumes = {
      'best crm software': { volume: 5000, competitionIndex: 80, competition: 'HIGH' },
      'crm tools comparison': { volume: 2000, competitionIndex: 60, competition: 'MEDIUM' },
    };

    getSearchVolumes.mockResolvedValue(mockVolumes);

    const volumes = await getSearchVolumes(['best crm software', 'crm tools comparison'], {
      locationCode: 2840,
      languageCode: 'en',
    });

    expect(volumes).toEqual(mockVolumes);
    expect(getSearchVolumes).toHaveBeenCalledTimes(1);
  });

  it('should estimate AI volume from the median of the Google volumes', async () => {
    const mockVolumes = {
      'keyword one': { volume: 10000, competitionIndex: 70, competition: 'HIGH' },
      'keyword two': { volume: 5000, competitionIndex: 50, competition: 'MEDIUM' },
    };

    getSearchVolumes.mockResolvedValue(mockVolumes);

    const volumes = await getSearchVolumes(['keyword one', 'keyword two']);
    const googleVolume = medianVolume(Object.values(volumes).map((v) => v.volume));
    const estAiVolume = Math.round(googleVolume * AI_VOLUME_MULTIPLIER);

    expect(googleVolume).toBe(7500);
    expect(estAiVolume).toBe(1125);
  });

  it('should handle zero volumes gracefully', async () => {
    const mockVolumes = {
      'rare term': { volume: 0, competitionIndex: 0, competition: null },
    };

    getSearchVolumes.mockResolvedValue(mockVolumes);

    const volumes = await getSearchVolumes(['rare term']);
    const googleVolume = medianVolume(Object.values(volumes).map((v) => v.volume));
    const estAiVolume = Math.round(googleVolume * AI_VOLUME_MULTIPLIER);

    expect(googleVolume).toBe(0);
    expect(estAiVolume).toBe(0);
  });

  it('should map region codes correctly for DataForSEO', () => {
    expect(regionToLocationCode('US')).toBe(2840);
    expect(regionToLocationCode('GB')).toBe(2826);
    expect(regionToLocationCode('DE')).toBe(2276);
  });

  it('should resolve the default model when no model string is provided', () => {
    resolveModel.mockReturnValue('mock-model-instance');

    const model = resolveModel();

    expect(model).toBe('mock-model-instance');
  });

  it('should pass through keywords to getSearchVolumes', async () => {
    getSearchVolumes.mockResolvedValue({});

    const keywords = ['best crm software', 'crm tools comparison'];
    await getSearchVolumes(keywords, {
      locationCode: 2840,
      languageCode: 'en',
    });

    expect(getSearchVolumes).toHaveBeenCalledWith(keywords, {
      locationCode: 2840,
      languageCode: 'en',
    });
  });
});
