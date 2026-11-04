import { describe, expect, it } from 'vitest';
import { brandPagePath } from './brandPath';

describe('brandPagePath', () => {
  it('keeps the brand page, for the other brand', () => {
    expect(brandPagePath('/dashboard/brands/a1/settings', 'b2')).toBe(
      '/dashboard/brands/b2/settings',
    );
    expect(brandPagePath('/dashboard/brands/a1/prompts', 'b2')).toBe(
      '/dashboard/brands/b2/prompts',
    );
    expect(brandPagePath('/dashboard/brands/a1', 'b2')).toBe('/dashboard/brands/b2');
  });

  it('is null off a brand page, the brands list and the new-brand page', () => {
    expect(brandPagePath('/dashboard/brands', 'b2')).toBeNull();
    expect(brandPagePath('/dashboard/brands/new', 'b2')).toBeNull();
    expect(brandPagePath('/dashboard/content/plan', 'b2')).toBeNull();
  });
});
