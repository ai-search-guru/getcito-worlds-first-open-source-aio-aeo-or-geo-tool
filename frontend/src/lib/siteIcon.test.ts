import { describe, expect, it } from 'vitest';
import { getSiteIconUrl } from './siteIcon';

describe('getSiteIconUrl', () => {
  it('renders real sites locally without sharing their domain', () => {
    const url = getSiteIconUrl('https://acme.com/pricing', 64);
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url)).toContain('>A</text>');
    expect(decodeURIComponent(url)).toContain('width="64"');
    expect(url).not.toContain('acme.com');
  });

  it("gives the demo brand's made-up sites the logos the app ships", () => {
    expect(getSiteIconUrl('brewline.example')).toBe('/demo/logos/brewline.svg');
    expect(getSiteIconUrl('https://www.northboundroasters.example/blog')).toBe(
      '/demo/logos/northboundroasters.svg',
    );
  });

  it('gives any other .example site a letter mark, never a request out', () => {
    const url = getSiteIconUrl('quietcorner.example');
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url)).toContain('>Q</text>');
  });

  it('does not embed markup supplied as a domain or invalid image dimensions', () => {
    const image = decodeURIComponent(getSiteIconUrl('<script>alert(1)</script>', NaN));
    expect(image).not.toContain('<script>');
    expect(image).toContain('>?</text>');
    expect(image).toContain('width="128"');
  });
});
