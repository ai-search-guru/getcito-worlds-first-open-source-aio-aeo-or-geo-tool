import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoadingDots } from './loading-dots';

/**
 * The dots say nothing to a screen reader unless they have a label, stay
 * visible with reduced motion, and take a 16 px icon's place.
 */

describe('LoadingDots', () => {
  it('is hidden from screen readers and stays visible without motion', () => {
    const html = renderToStaticMarkup(<LoadingDots />);
    const root = new DOMParser().parseFromString(html, 'text/html').body.firstElementChild!;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    const dots = [...root.children];
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      expect(dot.className).toContain('motion-reduce:animate-none');
      expect(dot.className).toContain('motion-reduce:opacity-60');
    }
  });

  it('is as wide as the icon it stands in for beside a label', () => {
    const html = renderToStaticMarkup(<LoadingDots />);
    const root = new DOMParser().parseFromString(html, 'text/html').body.firstElementChild!;
    expect(root.className).toContain('w-4');
    expect(root.className).toContain('justify-center');
  });

  it('says its label as a status, the dots still hidden', () => {
    const html = renderToStaticMarkup(<LoadingDots label="Sending..." className="mr-1" />);
    const root = new DOMParser().parseFromString(html, 'text/html').body.firstElementChild!;
    expect(root.getAttribute('role')).toBe('status');
    expect(root.className).toContain('mr-1');
    expect(root.querySelector('[aria-hidden="true"]')!.children).toHaveLength(3);
    expect(root.querySelector('.sr-only')!.textContent).toBe('Sending...');
    expect(root.textContent).toBe('Sending...');
  });
});
