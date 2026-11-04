import { describe, expect, it } from 'vitest';
import type { Signal } from './map';
import { NO_WHERE } from './where';
import {
  groupLead,
  groupSignals,
  groupStatus,
  groupWhere,
  promptTextKey,
  signalGroupKey,
} from './group';

const signal = (over: Partial<Signal>): Signal => ({
  id: 's1',
  category: 'citation',
  kind: 'lost_citations',
  impact: 'high',
  status: 'new',
  source: ['ai_results'],
  detectedAt: '2026-10-08T10:53:00+00:00',
  lastDetectedAt: '2026-10-08T10:53:00+00:00',
  resolvedAt: null,
  previousValue: null,
  currentValue: null,
  changeValue: null,
  payload: {},
  kpiKeys: [],
  actionId: null,
  where: NO_WHERE,
  ...over,
});

const TEXT =
  'Which tools track AI search visibility and answer engine optimization performance over time?';
const lost = (id: string, over: Partial<Signal> = {}) =>
  signal({ id, payload: { promptId: `p-${id}`, promptText: TEXT }, ...over });

describe('promptTextKey', () => {
  it('ignores case, spacing and the closing punctuation', () => {
    expect(promptTextKey(TEXT)).toBe(promptTextKey(`  ${TEXT.toLowerCase().replace('?', '')} `));
    expect(promptTextKey('Best  AI\nrank tracker?!')).toBe('best ai rank tracker');
    expect(promptTextKey('Best AI rank tracker')).not.toBe(promptTextKey('Best AEO rank tracker'));
  });
});

describe('signalGroupKey', () => {
  it('puts copies of one prompt text, of one kind, from one pass together', () => {
    const a = lost('a');
    expect(signalGroupKey(lost('b', { detectedAt: '2026-10-08T10:53:00.000Z' }))).toBe(
      signalGroupKey(a),
    );
    expect(signalGroupKey(lost('c', { detectedAt: '2026-10-09T10:53:00Z' }))).not.toBe(
      signalGroupKey(a),
    );
    expect(signalGroupKey(lost('d', { kind: 'prompt_gain' }))).not.toBe(signalGroupKey(a));
  });

  it('leaves a signal that is not about a prompt on its own', () => {
    expect(signalGroupKey(signal({ id: 'x', payload: { domain: 'yotpo.com' } }))).toBe('x');
    // A prompt text without the prompt is a first citation's context, not its subject.
    expect(signalGroupKey(signal({ id: 'y', payload: { promptText: TEXT, url: '/a' } }))).toBe('y');
  });
});

describe('groupSignals', () => {
  it('keeps the list order and gathers each group under its first signal', () => {
    const groups = groupSignals([
      lost('a'),
      signal({ id: 'x' }),
      lost('b', { payload: { promptId: 'p-b', promptText: TEXT.toLowerCase() } }),
    ]);
    expect(groups.map((g) => g.signals.map((s) => s.id))).toEqual([['a', 'b'], ['x']]);
  });
});

describe('groupStatus and groupWhere', () => {
  it('shows a group as open while any copy is', () => {
    expect(groupStatus([lost('a', { status: 'resolved' }), lost('b')])).toBe('new');
    expect(
      groupStatus([lost('a', { status: 'dismissed' }), lost('b', { status: 'resolved' })]),
    ).toBe('resolved');
  });

  it('joins the places of every copy', () => {
    expect(
      groupWhere([
        lost('a', { where: { platforms: ['chatgpt-web'], regions: ['US'], topics: ['AEO'] } }),
        lost('b', { where: { platforms: ['gemini-web'], regions: ['US'], topics: ['GEO'] } }),
      ]),
    ).toEqual({
      platforms: ['chatgpt-web', 'gemini-web'],
      regions: ['US'],
      topics: ['AEO', 'GEO'],
    });
  });
});

describe('groupLead', () => {
  it("titles a group from every copy's lost-on platforms, not the first copy's", () => {
    const copies = [
      lost('a', { payload: { promptId: 'p-a', promptText: TEXT, platforms: ['chatgpt-web'] } }),
      lost('b', { payload: { promptId: 'p-b', promptText: TEXT, platforms: ['gemini-web'] } }),
    ];
    expect(groupLead(copies).payload.platforms).toEqual(['chatgpt-web', 'gemini-web']);
    expect(groupLead(copies).id).toBe('a');
    // Copies recorded before the evidence are left as they are.
    expect(groupLead([lost('c')])).toEqual(lost('c'));
    // One copy without recorded platforms: the group names none.
    expect(groupLead([copies[0], lost('d')]).payload).not.toHaveProperty('platforms');
  });
});
