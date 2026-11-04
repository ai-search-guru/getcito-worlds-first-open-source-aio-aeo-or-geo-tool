import { describe, expect, it } from 'vitest';
import { collectTargets, targetPayload } from './_helpers.js';
import f01 from './f01FixLowScores.js';
import g02 from './g02ConvertMentions.js';

/**
 * An action counts the whole group its signals found and keeps that list
 * (AC-009): a group signal names its first 50 targets and lists every id.
 */

const byKind = (...signals) => new Map(signals.map((s, i) => [`kind${i}`, [s]]));
const prompt = (i) => ({ id: `p${i}`, label: `Prompt ${i}` });

describe('collectTargets', () => {
  it('counts a group past the 50 it names, the named ones first', () => {
    const big = {
      payload: {
        targets: Array.from({ length: 50 }, (_, i) => prompt(i)),
        targetIds: Array.from({ length: 80 }, (_, i) => `p${i}`),
      },
    };
    const small = { payload: { targets: [prompt(100)] } };
    const targets = collectTargets(byKind(big, small));
    expect(targets).toHaveLength(81);
    // Every named one before the ones known only by id.
    expect(targets.slice(0, 51).every((t) => t.label)).toBe(true);
    expect(targets[51]).toEqual({ id: 'p50' });
  });

  it('reads Site Audit’s low pages by their address', () => {
    const audit = {
      payload: { urls: [{ url: 'https://a.example/x', score: 31 }, 'https://a.example/y'] },
    };
    expect(collectTargets(byKind(audit))).toEqual([
      { id: 'https://a.example/x', label: 'https://a.example/x' },
      { id: 'https://a.example/y', label: 'https://a.example/y' },
    ]);
  });
});

describe('targetPayload', () => {
  it('keeps every key once there are more targets than it names', () => {
    const big = {
      payload: {
        targets: Array.from({ length: 50 }, (_, i) => prompt(i)),
        targetIds: Array.from({ length: 80 }, (_, i) => `p${i}`),
      },
    };
    const payload = targetPayload(byKind(big), 'prompts');
    expect(payload.targetCount).toBe(80);
    expect(payload.targets).toHaveLength(50);
    expect(payload.targetIds).toHaveLength(80);
  });

  it('counts no more than the action keeps, however many the signals add up to', () => {
    const big = (from) => ({
      payload: {
        targets: [prompt(from)],
        targetIds: Array.from({ length: 1000 }, (_, i) => `p${from + i}`),
      },
    });
    const payload = targetPayload(byKind(big(0), big(1000)), 'prompts');
    expect(payload.targetCount).toBe(1000);
    expect(payload.targetIds).toHaveLength(1000);
  });

  it('lists the keys when a name shown isn’t one the action keeps as it is', () => {
    const payload = targetPayload(
      byKind({ payload: { targets: [{ id: 'p1 ', label: 'Prompt 1' }, prompt(2)] } }),
      'prompts',
    );
    expect(payload).toMatchObject({ targetCount: 2, targetIds: ['p1', 'p2'] });
  });

  it('names them all and lists no ids when it can', () => {
    const payload = targetPayload(
      byKind({ payload: { targets: [prompt(1), prompt(2)] } }),
      'prompts',
    );
    expect(payload).toMatchObject({ targetCount: 2, targets: [prompt(1), prompt(2)] });
    expect(payload).not.toHaveProperty('targetIds');
  });
});

describe('f01 (low audit scores)', () => {
  it('counts the pages the action keeps, not the signal’s raw number', () => {
    const audit = {
      current_value: 3,
      payload: {
        urls: [
          { url: 'https://a.example/x', score: 31 },
          { url: 'https://a.example/x', score: 31 },
        ],
      },
    };
    const payload = f01.payload(new Map([['audit_low_score', [audit]]]));
    expect(payload).toMatchObject({ targetCount: 1, pageCount: 1 });
  });
});

describe('g02 (uncited mentions)', () => {
  it('counts the uncited prompts the signal lists, and keeps them', () => {
    const mentions = { current_value: 3, payload: { promptIds: ['a', 'b', 'c'] } };
    const payload = g02.payload(new Map([['uncited_mentions', [mentions]]]));
    expect(payload).toMatchObject({ targetCount: 3, targetIds: ['a', 'b', 'c'], promptCount: 3 });
    // A prompt listed twice is kept, and counted, once.
    const twice = { current_value: 3, payload: { promptIds: ['a', 'b', 'a'] } };
    expect(g02.payload(new Map([['uncited_mentions', [twice]]]))).toMatchObject({
      targetCount: 2,
      targetIds: ['a', 'b'],
    });
  });
});
