import { describe, expect, it, vi } from 'vitest';

/**
 * The audits family writes, with each technical finding, what every failed
 * check found on each page (AC-001): the check, its label as the audit names
 * it, and the check's own evidence.
 */

const tables = {
  site_audits: [
    { id: 'a2', url: 'https://acme.example/pricing', final_url: null, completed_at: '2026-10-10' },
    // An older audit of the same page: the newer one decides.
    { id: 'a1', url: 'https://acme.example/pricing', final_url: null, completed_at: '2026-09-01' },
  ],
  audit_signal_results: [
    {
      audit_id: 'a2',
      signal_key: 'ai-bot-access',
      evidence: { aiBotsMentioned: ['gptbot'], blocked: true, blockedBots: ['gptbot'] },
    },
    { audit_id: 'a2', signal_key: 'freshness', evidence: { ageDays: 412, newest: '2025-08-30' } },
  ],
};

function builder(table) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    in: () => chain,
    order: () => chain,
    range: async () => ({ data: tables[table] ?? [], error: null }),
  };
  return chain;
}

vi.mock('../../../config/supabase.js', () => ({
  default: { from: (table) => builder(table), rpc: vi.fn() },
}));
vi.mock('../../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { LIBRARY_FAMILIES } = await import('./detect.js');

describe('the audits family', () => {
  it("records each failed check's label and evidence on its page", async () => {
    const audits = LIBRARY_FAMILIES.find((f) => f.name === 'audits');
    const found = await audits.run({ brandId: 'b1', now: new Date('2026-10-15T00:00:00Z') });
    const byKind = Object.fromEntries(found.map((f) => [f.kind, f.payload.targets]));
    expect(byKind.crawler_blocked).toEqual([
      {
        id: 'https://acme.example/pricing',
        label: 'https://acme.example/pricing',
        checks: ['ai-bot-access'],
        issues: [
          {
            check: 'ai-bot-access',
            label: 'AI bot access (robots.txt)',
            evidence: { aiBotsMentioned: ['gptbot'], blocked: true, blockedBots: ['gptbot'] },
          },
        ],
      },
    ]);
    expect(byKind.outdated_content[0].issues).toEqual([
      {
        check: 'freshness',
        label: 'Freshness',
        evidence: { ageDays: 412, newest: '2025-08-30' },
      },
    ]);
  });
});
