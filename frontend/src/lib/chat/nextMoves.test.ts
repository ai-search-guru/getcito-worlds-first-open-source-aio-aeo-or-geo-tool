import { describe, expect, it } from 'vitest';
import {
  clientMove,
  ghostOf,
  nextMovesInput,
  pickNextMoves,
  validMoves,
  type NextMoveInput,
} from './nextMoves';

/**
 * Next moves (CHAT-07 §C): read moves only for a role that reads, or a
 * read-only workspace; one per kind and per prompt; three at most; never
 * an id; the ghost only for a first move that continues this run.
 */

const move = (over: Partial<NextMoveInput> = {}): NextMoveInput => ({
  label: 'Do the same for /features',
  prompt: 'Do the same for /features',
  kind: 'continue',
  class: 'write',
  continues_this_run: true,
  ...over,
});
const MOVES: NextMoveInput[] = [
  move(),
  move({
    label: 'Compare with Perplexity',
    prompt: 'Compare these citations with Perplexity',
    kind: 'deepen',
    class: 'read',
    continues_this_run: false,
  }),
  move({
    label: 'Schedule this every Monday',
    prompt: 'Schedule this every Monday',
    kind: 'repeat',
    class: 'write',
    continues_this_run: false,
  }),
  move({
    label: 'Refresh /pricing',
    prompt: 'Refresh /pricing',
    kind: 'act',
    class: 'read',
    continues_this_run: true,
  }),
];
const ADMIN = { role: 'admin' as const, writable: true };

describe('pickNextMoves', () => {
  it('keeps the model’s order, three at most, with their ghost marks', () => {
    expect(pickNextMoves(MOVES, ADMIN)).toEqual([
      {
        label: 'Do the same for /features',
        prompt: 'Do the same for /features',
        class: 'write',
        ghostOk: true,
      },
      {
        label: 'Compare with Perplexity',
        prompt: 'Compare these citations with Perplexity',
        class: 'read',
        ghostOk: false,
      },
      {
        label: 'Schedule this every Monday',
        prompt: 'Schedule this every Monday',
        class: 'write',
        ghostOk: false,
      },
    ]);
  });

  it('gives an Analyst, an Agency partner and a read-only workspace read moves only', () => {
    for (const who of [
      { role: 'analyst' as const, writable: true },
      { role: 'agency_partner' as const, writable: true },
      { role: 'admin' as const, writable: false },
    ]) {
      expect(pickNextMoves(MOVES, who).map((m) => [m.prompt, m.class])).toEqual([
        ['Compare these citations with Perplexity', 'read'],
        ['Refresh /pricing', 'read'],
      ]);
    }
    expect(
      pickNextMoves([move({ class: 'execute' })], { role: 'manager', writable: true }),
    ).toEqual([expect.objectContaining({ class: 'execute' })]);
  });

  it('keeps one move per kind and per prompt, and masks ids', () => {
    const id = '0b6f6e2a-3c1d-4f7e-9a2b-5c8d7e6f1a2b';
    expect(
      pickNextMoves(
        [
          move({ label: `Open task ${id}`, prompt: `Open task ${id}` }),
          move({ prompt: 'Something else' }),
          move({ kind: 'deepen', prompt: `open task ${id.toUpperCase()}` }),
        ],
        ADMIN,
      ).map((m) => m.label),
    ).toEqual(['Open task …']);
  });
});

describe('the browser’s moves', () => {
  it('carries the ghost mark, never the class, and ghosts only a first move that continues', () => {
    const picked = pickNextMoves(MOVES, ADMIN).map(clientMove);
    expect(picked[0]).toEqual({
      label: 'Do the same for /features',
      prompt: 'Do the same for /features',
      ghost: true,
    });
    expect(picked[1]).not.toHaveProperty('ghost');
    expect(JSON.stringify(picked)).not.toContain('class');
    expect(ghostOf(picked)).toBe('Do the same for /features');
    expect(ghostOf(picked.slice(1))).toBeUndefined();
    expect(ghostOf([])).toBeUndefined();
  });
});

describe('nextMovesInput and validMoves', () => {
  it('takes the call whole, up to 6 moves, and drops each move that doesn’t fit on its own', () => {
    const bad = [
      move({ prompt: 'x'.repeat(81) }),
      { ...move(), kind: 'wander' },
      { ...move(), class: 'delete' },
      { label: '', prompt: 'Empty label', kind: 'continue', class: 'read' },
    ];
    const call = { moves: [...bad, move({ kind: 'deepen', class: 'read' })] };
    expect(nextMovesInput.safeParse(call).success).toBe(true);
    expect(validMoves(nextMovesInput.parse(call).moves)).toEqual([
      move({ kind: 'deepen', class: 'read' }),
    ]);
    expect(nextMovesInput.safeParse({ moves: Array(7).fill(move()) }).success).toBe(false);
  });

  it('drops a move that carries a link to an outside address, in its label or its prompt', () => {
    const linked = [
      move({ prompt: 'Audit https://example.com/?q=1' }),
      move({ prompt: 'Open www.example.com' }),
      move({ label: 'See [the guide](https://example.com)' }),
      move({ label: 'Email mailto:someone@example.com' }),
      move({ prompt: 'Read HTTP://EXAMPLE.COM' }),
    ];
    expect(validMoves(linked)).toEqual([]);
    // A page of the workspace, or a site named by its domain, is no link.
    const kept = [move(), move({ prompt: 'Compare our /pricing with example.com' })];
    expect(validMoves(kept)).toEqual(kept);
  });
});
