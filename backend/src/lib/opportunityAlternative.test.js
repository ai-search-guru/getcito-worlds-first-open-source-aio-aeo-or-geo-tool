import { describe, expect, it, vi } from 'vitest';

// The generator imports the supabase admin client, whose config exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain.
vi.mock('../config/supabase.js', () => ({ default: {} }));

const { alternativeInstruction } = await import('./opportunityGenerator.js');

// CONTENT-006: "Another angle" asks the model for a second take on a need
// that already has an opportunity.

describe('alternativeInstruction', () => {
  it('names the original and asks for a different kind of content', () => {
    const text = alternativeInstruction({
      title: 'Comparison guide: top 5 coffee subscriptions',
      description: 'A structured comparison page with FAQ schema.',
      decision: 'create',
    });
    expect(text).toContain('"Comparison guide: top 5 coffee subscriptions"');
    expect(text).toContain('(A structured comparison page with FAQ schema.)');
    expect(text).toContain('decided as "create"');
    expect(text).toMatch(/differs clearly in content type, format, audience or decision/);
    expect(text).toMatch(/Don't repeat its title or approach/);
  });

  it('leaves out what the original lacks', () => {
    expect(alternativeInstruction({ title: 'Office coffee FAQ' })).toBe(
      'This cluster already has the opportunity "Office coffee FAQ". The user wants a different angle on the same need: write one opportunity that differs clearly in content type, format, audience or decision. Don\'t repeat its title or approach.',
    );
  });
});
