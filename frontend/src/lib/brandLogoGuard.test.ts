/**
 * brandLogoGuard.test.ts  (issue #759)
 *
 * Tests shouldUpdateLogoUrl imported from the real source module.
 * If the guard logic changes, these tests break.
 */

import { describe, expect, test } from 'vitest';
import { shouldUpdateLogoUrl } from './brandLogoGuard';
import { getSiteIconUrl } from './siteIcon';

describe('shouldUpdateLogoUrl', () => {
  const domainA = { domain: 'alpha.com', isPrimary: true };
  const domainB = { domain: 'beta.com', isPrimary: false };
  const domainBPrimary = { domain: 'beta.com', isPrimary: true };
  const domainASecondary = { domain: 'alpha.com', isPrimary: false };

  test('primary changed + manual logo set → must NOT update logo_url', () => {
    expect(
      shouldUpdateLogoUrl(
        [domainA, domainB],
        [domainASecondary, domainBPrimary],
        'https://cdn.example.com/custom-logo.png',
      ),
    ).toBe(false);
  });

  test('primary changed + no manual logo → SHOULD update logo_url', () => {
    expect(shouldUpdateLogoUrl([domainA, domainB], [domainASecondary, domainBPrimary], null)).toBe(
      true,
    );
  });

  test('primary changed + logo_url is undefined → SHOULD update', () => {
    expect(
      shouldUpdateLogoUrl([domainA, domainB], [domainASecondary, domainBPrimary], undefined),
    ).toBe(true);
  });

  test('primary unchanged + no manual logo → should NOT update', () => {
    expect(shouldUpdateLogoUrl([domainA, domainB], [domainA, domainB], null)).toBe(false);
  });

  test('primary unchanged + manual logo → should NOT update', () => {
    expect(
      shouldUpdateLogoUrl([domainA, domainB], [domainA, domainB], 'https://example.com/logo.svg'),
    ).toBe(false);
  });

  test('primary changed + logoUrl is empty string → SHOULD update', () => {
    expect(shouldUpdateLogoUrl([domainA, domainB], [domainASecondary, domainBPrimary], '')).toBe(
      true,
    );
  });

  test('no previous domains, first domain becomes primary + no logo → SHOULD update', () => {
    expect(shouldUpdateLogoUrl([], [domainA], null)).toBe(true);
  });

  test('old primary removed, new primary promoted + no manual logo → SHOULD update', () => {
    expect(shouldUpdateLogoUrl([domainA, domainB], [domainBPrimary], null)).toBe(true);
  });

  test('old primary removed, new primary promoted + manual logo → must NOT update', () => {
    expect(
      shouldUpdateLogoUrl([domainA, domainB], [domainBPrimary], 'https://cdn.acme.com/logo.png'),
    ).toBe(false);
  });
});

describe('domain save simulation', () => {
  function simulateDomainSave(
    oldDomains: { domain: string; isPrimary: boolean }[],
    newDomains: { domain: string; isPrimary: boolean }[],
    currentLogoUrl: string | null | undefined,
  ): { logoUrlWritten: string | null | 'unchanged' } {
    if (shouldUpdateLogoUrl(oldDomains, newDomains, currentLogoUrl)) {
      const primary = newDomains.find((d) => d.isPrimary);
      return { logoUrlWritten: primary ? getSiteIconUrl(primary.domain) : null };
    }
    return { logoUrlWritten: 'unchanged' };
  }

  test('brand has manual logo, user changes primary domain → logo unchanged', () => {
    const result = simulateDomainSave(
      [{ domain: 'old.com', isPrimary: true }],
      [{ domain: 'new.com', isPrimary: true }],
      'https://brand.com/my-logo.svg',
    );
    expect(result.logoUrlWritten).toBe('unchanged');
  });

  test('brand has null logo, user changes primary domain → new favicon written', () => {
    const result = simulateDomainSave(
      [{ domain: 'old.com', isPrimary: true }],
      [{ domain: 'new.com', isPrimary: true }],
      null,
    );
    expect(result.logoUrlWritten).toBe(getSiteIconUrl('new.com'));
    expect(result.logoUrlWritten).toMatch(/^data:image\/svg\+xml,/);
  });

  test('brand has null logo, primary unchanged → logo not touched', () => {
    const domains = [{ domain: 'same.com', isPrimary: true }];
    expect(simulateDomainSave(domains, domains, null).logoUrlWritten).toBe('unchanged');
  });

  test('brand adds secondary domain without changing primary → logo not touched', () => {
    const result = simulateDomainSave(
      [{ domain: 'main.com', isPrimary: true }],
      [
        { domain: 'main.com', isPrimary: true },
        { domain: 'secondary.com', isPrimary: false },
      ],
      null,
    );
    expect(result.logoUrlWritten).toBe('unchanged');
  });
});
