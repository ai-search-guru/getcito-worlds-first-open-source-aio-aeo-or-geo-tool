import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Report } from '@/lib/actions/reports';
import type { ReportBranding } from '@/lib/white-label/kit';

/**
 * The report's PDF with and without a white label kit (00429): GetCito's
 * name, footer and indigo without one; the agency's name, footer, color,
 * logo and "Prepared for" with one. The renderer's parts are drawn as plain
 * elements here, so the document reads as a page would.
 */

type Props = { children?: ReactNode; style?: unknown };
const styleOf = (style: unknown) =>
  JSON.stringify(Array.isArray(style) ? Object.assign({}, ...style.flat()) : (style ?? {}));
vi.mock('@react-pdf/renderer', () => ({
  Document: ({ children, ...props }: Props & { author?: string; creator?: string }) => (
    <div data-author={props.author ?? ''} data-creator={props.creator ?? ''}>
      {children}
    </div>
  ),
  Page: ({ children }: Props) => <div>{children}</div>,
  View: ({ children, style }: Props) => <div data-style={styleOf(style)}>{children}</div>,
  Text: ({
    children,
    style,
    render,
  }: Props & { render?: (p: { pageNumber: number; totalPages: number }) => string }) => (
    <span data-style={styleOf(style)}>
      {render ? render({ pageNumber: 1, totalPages: 1 }) : children}
    </span>
  ),
  // eslint-disable-next-line @next/next/no-img-element -- a stand-in for the PDF's image
  Image: ({ src }: { src: string }) => <img src={src} alt="" />,
  Svg: () => null,
  Path: () => null,
  Polyline: () => null,
  Line: () => null,
  StyleSheet: { create: <T,>(styles: T) => styles },
  Font: { register: () => {}, registerHyphenationCallback: () => {} },
}));

const { ReportPdfDocument } = await import('./_ReportPdf');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const report: Report = {
  id: 'r1',
  brandId: 'b1',
  title: 'October report',
  template: 'monthly',
  dateFrom: '2026-10-01',
  dateTo: '2026-10-31',
  createdAt: '2026-10-31T09:00:00Z',
  payload: {
    brandName: 'Northwind',
    summaryText: 'Visibility rose.',
    shareOfVoice: {
      overallSov: 40,
      overallSovChange: null,
      byPlatform: [{ provider: 'ChatGPT', sov: 40 }],
    },
  } as Report['payload'],
};

const kit: ReportBranding = {
  companyName: 'Acme Agency',
  accentColor: '#ffff00',
  footerText: 'Prepared by Acme Agency · acme.com',
  logo: 'data:image/png;base64,AAAA',
  clientLogo: 'data:image/jpeg;base64,BBBB',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function draw(branding: ReportBranding | null) {
  await act(async () => root.render(<ReportPdfDocument report={report} branding={branding} />));
  return container;
}

describe('ReportPdfDocument', () => {
  it('stays GetCito’s without a kit', async () => {
    const pdf = await draw(null);
    const doc = pdf.firstElementChild!;
    expect(doc.getAttribute('data-author')).toBe('GetCito');
    expect(doc.getAttribute('data-creator')).toBe('GetCito');
    expect(pdf.textContent).toContain('Generated with GetCito · www.getcito.com');
    expect(pdf.textContent).not.toContain('Prepared for');
    expect(pdf.querySelector('img')).toBeNull();
    expect(pdf.innerHTML).toContain('#003934');
  });

  it('carries the agency’s name, footer, logos and color with a kit, and no GetCito', async () => {
    const pdf = await draw(kit);
    const doc = pdf.firstElementChild!;
    expect(doc.getAttribute('data-author')).toBe('Acme Agency');
    expect(doc.getAttribute('data-creator')).toBe('Acme Agency');
    expect(pdf.textContent).toContain('Prepared for Northwind');
    expect(pdf.textContent).toContain('Prepared by Acme Agency · acme.com');
    expect(pdf.textContent).not.toMatch(/getcito/i);
    expect([...pdf.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      kit.logo,
      kit.clientLogo,
    ]);
    // The rule and bars keep the kit's color; GetCito's indigo is gone.
    expect(pdf.innerHTML).toContain('#ffff00');
    expect(pdf.innerHTML).not.toContain('#003934');
  });

  it('names the company where there is no logo, and leaves the footer empty without one', async () => {
    const pdf = await draw({ ...kit, logo: null, clientLogo: null, footerText: null });
    expect(pdf.textContent).toContain('Acme Agency');
    expect(pdf.textContent).not.toMatch(/getcito/i);
    expect(pdf.querySelector('img')).toBeNull();
  });

  it('names no author for a kit with only a logo', async () => {
    const pdf = await draw({ ...kit, companyName: null });
    expect(pdf.firstElementChild!.getAttribute('data-author')).toBe('');
    expect(pdf.textContent).not.toMatch(/getcito/i);
  });
});
