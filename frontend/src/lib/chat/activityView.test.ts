// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { activityCsv, approvalLabel, type ActivityRow } from './activityView';

/** What the Activity log and its CSV say about a row (CHAT-20 §10a). */

describe('approvalLabel', () => {
  it('says how a row ran', () => {
    const label = (
      kind: ActivityRow['kind'],
      approvalKind: string | null,
      autoVia: string | null = null,
    ) => approvalLabel({ kind, approvalKind, autoVia });
    expect(label('access.denied', null)).toBe('denied');
    expect(label('change', 'ask')).toBe('card');
    expect(label('change', 'click')).toBe('click');
    expect(label('change', 'auto', 'always')).toBe('always');
    expect(label('change', 'auto', 'dont_ask_again')).toBe('dont_ask_again');
    expect(label('change', 'auto', 'full_auto')).toBe('full_auto');
    expect(label('undo', 'run')).toBe('run');
  });

  it('says an agent’s step went live on its own, never that Full auto ran it (AUTONOMOUS-GO-LIVE §6.4)', () => {
    const row = { kind: 'change' as const, approvalKind: 'auto', autoVia: 'go_live' };
    expect(approvalLabel(row)).toBe('go_live');
    const csv = activityCsv(
      [
        {
          id: 'a2',
          at: '2026-11-02T10:00:00Z',
          userId: 'u1',
          person: 'Alex Kim',
          isYou: false,
          surface: 'chat',
          toolKey: 'sendToCms',
          area: 'content',
          class: 'execute',
          mode: 'full_auto',
          denialCode: null,
          summaryKey: null,
          summaryParams: {},
          status: 'done',
          canUndo: false,
          undoneAt: null,
          takeDown: null,
          ...row,
        },
      ],
      () => '',
    );
    expect(csv).toContain('Went live on its own');
  });
});

describe('activityCsv', () => {
  it('writes a line per row in words, a formula kept as text', () => {
    const row: ActivityRow = {
      id: 'a1',
      at: '2026-10-29T10:00:00Z',
      userId: 'u1',
      person: 'Alex Kim',
      isYou: true,
      surface: 'chat',
      kind: 'access.denied',
      toolKey: 'saveDraft',
      area: 'content',
      class: 'write',
      mode: null,
      approvalKind: null,
      autoVia: null,
      denialCode: 'forbidden_role',
      summaryKey: 'accessDenied',
      summaryParams: { tool: '=cmd' },
      status: 'done',
      canUndo: false,
      undoneAt: null,
      takeDown: null,
    };
    const csv = activityCsv([row], (key, params) => `${key}:${params.tool}`);
    expect(csv.split('\n')[1]).toBe(
      '2026-10-29T10:00:00Z,Alex Kim,chat,accessDenied:=cmd,Save drafts in Content,denied,,Not allowed,Done',
    );
    expect(activityCsv([{ ...row, person: '=evil' }], () => '').split('\n')[1]).toMatch(
      /^[^,]+,'=evil,/,
    );
  });
});
