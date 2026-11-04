import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { AuditSignal } from '@/lib/actions/audits';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const { AuthoritySources } = await import('./AuthoritySources');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Outbound authority links in the report (customer priorities item 6): what
 * counted, what didn't, and what counts.
 */

const signal = (evidence: Record<string, unknown>): AuditSignal => ({
  key: 'outbound-authority-links',
  category: 'authority',
  status: 'fail',
  score: 0,
  evidence,
  label: 'Outbound authority links',
  what: null,
  why: null,
  howToFix: null,
  impactTier: 'medium',
});

let container: HTMLDivElement;
let root: Root;

function render(evidence: Record<string, unknown>) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AuthoritySources signal={signal(evidence)} />
      </NextIntlClientProvider>,
    );
  });
}

const lines = () => [...container.querySelectorAll('p')].map((p) => p.textContent);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AuthoritySources', () => {
  it('names the sites that counted, what each is, and the others the page links to', () => {
    render({
      authorityHosts: ['saglik.gov.tr', 'unesco.org'],
      count: 2,
      authorityKinds: { 'saglik.gov.tr': 'official', 'unesco.org': 'international' },
      otherHosts: ['instagram.com', 'facebook.com'],
    });
    expect(lines()).toEqual([
      'Found: saglik.gov.trunesco.org',
      "The page also links to instagram.com, facebook.com, which don't count.",
      'What counts',
    ]);
    const chips = [...container.querySelectorAll('span[title]')].map((s) =>
      s.getAttribute('title'),
    );
    expect(chips).toEqual(['Official site', 'International body']);
    expect(container.querySelectorAll('li')).toHaveLength(5);
    expect(container.textContent).toContain('.gov.tr, .edu.tr, .ac.uk');
  });

  it('says one more makes it pass, and none of the two when none counted', () => {
    render({
      authorityHosts: ['arxiv.org'],
      count: 1,
      authorityKinds: { 'arxiv.org': 'research' },
    });
    expect(lines()[0]).toBe('Found: arxiv.org One more makes it pass.');
    // An audit from before: only the sites that counted, none here.
    render({ authorityHosts: [], count: 0 });
    expect(lines()[0]).toBe('Found: none of the 2 a page needs.');
    expect(container.textContent).not.toContain("don't count");
  });

  it('lists the brand’s trusted sources the audit counted, with the way to Settings (00449)', () => {
    render({
      authorityHosts: ['sca.coffee'],
      count: 1,
      authorityKinds: { 'sca.coffee': 'trusted' },
      trustedSources: ['sca.coffee', 'ncausa.org'],
    });
    expect(container.querySelector('span[title]')!.getAttribute('title')).toBe(
      'Your trusted source',
    );
    const last = [...container.querySelectorAll('li')].at(-1)!;
    expect(last.textContent).toBe('Your trusted sources: sca.coffeencausa.orgEdit in Settings');
    expect(last.querySelector('a')!.getAttribute('href')).toBe('/dashboard/settings/content');
    // None yet, or an audit from before: the way to add them.
    render({ authorityHosts: [], count: 0 });
    expect([...container.querySelectorAll('li')].at(-1)!.textContent).toBe(
      'Your trusted sources: Add them in Settings',
    );
  });
});
