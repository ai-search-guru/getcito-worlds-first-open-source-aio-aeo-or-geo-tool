import { describe, expect, it } from 'vitest';
import { GB, gbLabel, storageFits, storageLimitBytes, storageTone } from './files';

/** What a workspace's Files may keep (CHAT-06 items 26–29, STORAGE-COSTS.md). */

describe('storageLimitBytes', () => {
  it('gives each plan its GB, the free trial 1 GB, and adds storage packs', () => {
    expect(storageLimitBytes({ isTrial: false, maxStorageGb: 5 }, 0)).toBe(5 * GB);
    expect(storageLimitBytes({ isTrial: false, maxStorageGb: 25 }, 0)).toBe(25 * GB);
    expect(storageLimitBytes({ isTrial: true, maxStorageGb: 25 }, 0)).toBe(1 * GB);
    expect(storageLimitBytes({ isTrial: false, maxStorageGb: 25 }, 25 * GB)).toBe(50 * GB);
  });

  it('has no cap where the plan has none (self-host)', () => {
    expect(storageLimitBytes({ isTrial: false, maxStorageGb: -1 }, 25 * GB)).toBeNull();
  });
});

describe('storageTone and storageFits', () => {
  const storage = (usedGb: number, limitGb: number | null) => ({
    usedBytes: usedGb * GB,
    limitBytes: limitGb === null ? null : limitGb * GB,
    fileCount: 1,
  });

  it('turns to the warning color from 80% and is full at the limit', () => {
    expect(storageTone(storage(1, 25))).toBe('ok');
    expect(storageTone(storage(20, 25))).toBe('warning');
    expect(storageTone(storage(25, 25))).toBe('full');
    expect(storageTone(storage(900, null))).toBe('ok');
  });

  it('files nothing that would go past the limit', () => {
    expect(storageFits(storage(4, 5), GB)).toBe(true);
    expect(storageFits(storage(4.5, 5), GB)).toBe(false);
    expect(storageFits(storage(900, null), GB)).toBe(true);
  });
});

describe('gbLabel', () => {
  it('shows GB with one decimal, never less than 0.1 for something', () => {
    expect(gbLabel(0)).toBe('0');
    expect(gbLabel(1024)).toBe('0.1');
    expect(gbLabel(1.24 * GB)).toBe('1.2');
    expect(gbLabel(25 * GB)).toBe('25');
  });
});
