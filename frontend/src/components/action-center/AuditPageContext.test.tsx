import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { AuditPageContext } from './AuditPageContext';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(payload: Record<string, unknown>) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AuditPageContext payload={payload} />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AuditPageContext', () => {
  it('links the report it was sent from, and names the page and the checks it failed', async () => {
    await render({
      source: 'audit_page',
      auditId: 'a1',
      url: 'https://acme.example/blog/espresso',
      checks: [
        { key: 'faq-schema', label: 'FAQ schema' },
        { key: 'json-ld-validity', label: 'JSON-LD validity' },
      ],
    });
    const link = container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/dashboard/audit/a1');
    expect(link.textContent).toContain('Open the report');
    expect(container.textContent).toContain('Site Audit report');
    expect(container.textContent).toContain('/blog/espresso');
    expect(container.textContent).toContain('The 2 checks it failed when sent');
    const items = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['FAQ schema', 'JSON-LD validity']);
  });

  it('names a check without a label by its key', async () => {
    await render({ auditId: 'a1', checks: [{ key: 'faq-schema' }] });
    expect(container.textContent).toContain('The check it failed when sent');
    expect(container.querySelector('li')?.textContent).toBe('faq-schema');
  });

  it('reads a payload of the wrong shape without breaking', async () => {
    await render({ auditId: 5, url: null, checks: 'none' });
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).not.toContain('Page');
    expect(container.textContent).not.toContain('failed when sent');
  });
});
