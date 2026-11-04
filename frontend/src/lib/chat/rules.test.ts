import { describe, expect, it } from 'vitest';
import { PERSONA_RULES, SAFETY_RULES } from './rules';

/** Chat's system rules (CHAT-05), the safety ones (owner decision 2026-11-03). */

describe('SAFETY_RULES', () => {
  it("are in the writer's persona rules, which Chat's agents and schedules run on too", () => {
    for (const rule of SAFETY_RULES) expect(PERSONA_RULES).toContain(rule);
  });

  it('forbid what puts a life at risk, profanity and insults, and promised results', () => {
    const rules = SAFETY_RULES.join('\n');
    expect(rules).toContain('doses, harmful health claims');
    expect(rules).toContain('local emergency services');
    expect(rules).toContain('No profanity and no insults');
    expect(rules).toContain('even when the person swears');
    expect(rules).toContain('Never promise results or earnings');
    expect(rules).toContain('an estimate or a scenario, not a guarantee');
  });
});
