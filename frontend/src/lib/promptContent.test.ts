import { describe, expect, it } from 'vitest';
import { contentStep } from './promptContent';

const summary = (
  answers: number,
  mentionedAnswers: number,
  citedAnswers = 0,
  position: { avg: number; count: number } | null = null,
) => ({
  answers,
  mentionedAnswers,
  citedAnswers,
  mentionPosition: position ? { best: 1, worst: 9, ...position } : null,
});

describe('contentStep', () => {
  it('writes a page when no answer mentions or cites the brand', () => {
    expect(contentStep(summary(4, 0))).toEqual({ kind: 'create', answers: 4 });
    // Cited without being named: there is a page to work on.
    expect(contentStep(summary(4, 0, 1))).toBeNull();
  });

  it('optimizes when the brand is named in under a fifth of five or more answers', () => {
    expect(contentStep(summary(10, 1))).toEqual({
      kind: 'optimize',
      reason: 'rare',
      mentionPct: 10,
      answers: 10,
    });
    // 19.6% reads as 19%, never as the 20% line.
    expect(contentStep(summary(46, 9))).toMatchObject({ reason: 'rare', mentionPct: 19 });
    expect(contentStep(summary(10, 0, 2))).toMatchObject({ reason: 'rare', mentionPct: 0 });
    expect(contentStep(summary(10, 2))).toBeNull();
    // Too few answers to call it rare.
    expect(contentStep(summary(4, 0, 1))).toBeNull();
  });

  it('optimizes when the brand is placed after third on three or more answers', () => {
    expect(contentStep(summary(6, 4, 0, { avg: 3.4, count: 3 }))).toEqual({
      kind: 'optimize',
      reason: 'late',
      position: 3.4,
    });
    expect(contentStep(summary(6, 4, 0, { avg: 3, count: 4 }))).toBeNull();
    expect(contentStep(summary(6, 4, 0, { avg: 5, count: 2 }))).toBeNull();
  });

  it('says nothing without answers', () => {
    expect(contentStep(summary(0, 0))).toBeNull();
  });
});
