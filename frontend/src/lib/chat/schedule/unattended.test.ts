import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

const { withAssumptions } = await import('./unattended');

/**
 * A scheduled job's answer lists what it assumed for nobody watching at its
 * top (CHAT-12 item 12): the ones the model left out are put first, once;
 * the ones it listed itself, in any case, aren't repeated. (The question's
 * own answer is engine.test.ts's: question cards.)
 */

describe('the assumptions at the top of the answer', () => {
  it('puts the ones the model left out first, in one line', () => {
    expect(withAssumptions('Here is the report.', ['/pricing', 'Last 30 days'])).toBe(
      'Assumed for this scheduled run: /pricing; Last 30 days\n\nHere is the report.',
    );
  });

  it('leaves the ones the model already listed, whatever their case and spacing', () => {
    const text = 'Assumptions: used  LAST 30 days.\n\nHere is the report.';
    expect(withAssumptions(text, ['Last 30 days'])).toBe(text);
    expect(withAssumptions(text, ['Last 30 days', '/pricing'])).toBe(
      `Assumed for this scheduled run: /pricing\n\n${text}`,
    );
  });

  it('changes nothing with no assumptions, and lists each once', () => {
    expect(withAssumptions('Done.', undefined)).toBe('Done.');
    expect(withAssumptions('Done.', [])).toBe('Done.');
    expect(withAssumptions('', ['/pricing', '/pricing'])).toBe(
      'Assumed for this scheduled run: /pricing',
    );
  });
});
