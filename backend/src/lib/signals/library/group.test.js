import { describe, expect, it, vi } from 'vitest';

/**
 * A group signal names its first 50 targets and, past that, lists every
 * target's id (AC-009), so the action it starts counts the whole group.
 */

vi.mock('../../../config/supabase.js', () => ({ default: {} }));

const { group } = await import('./detect.js');

const toTarget = (row) => ({ id: row.id, label: row.text });
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, text: `Prompt ${i}` }));

describe('group', () => {
  it('names 50 and lists every id past that', () => {
    const signal = group('k', 'prompts', rows(80), toTarget, ['ai_results']);
    expect(signal.currentValue).toBe(80);
    expect(signal.payload.targets).toHaveLength(50);
    expect(signal.payload.targetIds).toHaveLength(80);
    expect(signal.payload.targetIds[79]).toBe('p79');
  });

  it('lists no ids when it names them all', () => {
    const signal = group('k', 'prompts', rows(3), toTarget, ['ai_results']);
    expect(signal.payload.targets).toHaveLength(3);
    expect(signal.payload).not.toHaveProperty('targetIds');
  });
});
