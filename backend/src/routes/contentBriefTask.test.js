import { describe, expect, it, vi } from 'vitest';

/**
 * A brief for an opportunity sent from an Action Center task (AC-004) is
 * told what the task says: where, why, the steps and the check that closes it.
 */

vi.mock('../config/supabase.js', () => ({ default: { from: () => ({}) } }));
vi.mock('../lib/promptClusters.js', () => ({ loadClusters: vi.fn() }));
vi.mock('../lib/action-center/fromOpportunity.js', () => ({
  OPPORTUNITY_ACTION_KIND: 'content_opportunity',
  sendToActionCenter: vi.fn(),
}));
vi.mock('../lib/aiProvider.js', () => ({ resolveModel: vi.fn() }));
vi.mock('../lib/logger.js', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  return { default: logger, logger };
});

const { briefTaskContext } = await import('./content.js');

describe('briefTaskContext', () => {
  it("gives the brief the task's target, reasons, steps and check", () => {
    expect(
      briefTaskContext({
        fromAction: {
          actionId: 'a1',
          task: {
            where: 'acme.example/pricing',
            why: 'Cited #2 until Oct 12.',
            how: ['Add a table.', 'Update the title.'],
            doneWhen: 'Cited again within 14 days.',
          },
        },
      }),
    ).toBe(
      [
        '',
        'From an Action Center task:',
        '- Where: acme.example/pricing',
        '- Why: Cited #2 until Oct 12.',
        '- Steps: 1) Add a table. 2) Update the title.',
        '- Done when: Cited again within 14 days.',
        '',
      ].join('\n'),
    );
  });

  it('says nothing for an opportunity no task sent', () => {
    expect(briefTaskContext({ promptText: 'x' })).toBe('');
    expect(briefTaskContext(undefined)).toBe('');
  });
});
