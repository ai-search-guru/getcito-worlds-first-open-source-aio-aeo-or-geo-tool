import { afterEach, describe, expect, it } from 'vitest';
import {
  BAND_BAR_CLASSES,
  BAND_CLASSES,
  BAND_TEXT_CLASSES,
  qualityAverage,
  qualityBand,
  qualityPhase,
} from './quality';

/** The Quality scores' bands, the header chip's average, and the phase flag (Quality spec §2). */
describe('quality', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE;
  });

  it('bands a score: 80+ Strong, 60–79 Can improve, under 60 Needs work', () => {
    expect(qualityBand(80)).toBe('strong');
    expect(qualityBand(79)).toBe('improve');
    expect(qualityBand(60)).toBe('improve');
    expect(qualityBand(59)).toBe('needsWork');
  });

  it('colours the bands green, neutral and amber: red is only for what blocks', () => {
    for (const classes of [BAND_CLASSES, BAND_BAR_CLASSES, BAND_TEXT_CLASSES]) {
      expect(classes.strong).toContain('emerald');
      expect(classes.improve).not.toMatch(/emerald|amber|red|destructive/);
      expect(classes.needsWork).toContain('amber');
      expect(Object.values(classes).join(' ')).not.toMatch(/red|destructive/);
    }
  });

  it('averages only the scores that could be read', () => {
    expect(qualityAverage([78, null, 60])).toBe(69);
    expect(qualityAverage([null])).toBeNull();
  });

  it('reads the live phase from the flag, none when unset or odd', () => {
    expect(qualityPhase()).toBe(0);
    process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '1';
    expect(qualityPhase()).toBe(1);
    process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = '7';
    expect(qualityPhase()).toBe(3);
    process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE = 'yes';
    expect(qualityPhase()).toBe(0);
  });
});
