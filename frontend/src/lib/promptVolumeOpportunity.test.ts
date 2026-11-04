import { describe, expect, it } from 'vitest';
import { opportunityLevel } from './promptVolumeOpportunity';

describe('opportunityLevel', () => {
  it('leaves a prompt under 1,500 AI searches a month off the list', () => {
    expect(opportunityLevel(0)).toBeNull();
    expect(opportunityLevel(1499)).toBeNull();
  });

  it('calls 1,500 to 2,999 Medium and 3,000 or more High', () => {
    expect(opportunityLevel(1500)).toBe('medium');
    expect(opportunityLevel(2999)).toBe('medium');
    expect(opportunityLevel(3000)).toBe('high');
    expect(opportunityLevel(3645)).toBe('high');
  });

  it('gives a low-confidence estimate no level on its own', () => {
    expect(opportunityLevel(5000, 'low')).toBeNull();
    expect(opportunityLevel(5000, 'medium')).toBe('high');
    expect(opportunityLevel(1500, 'high')).toBe('medium');
  });
});
