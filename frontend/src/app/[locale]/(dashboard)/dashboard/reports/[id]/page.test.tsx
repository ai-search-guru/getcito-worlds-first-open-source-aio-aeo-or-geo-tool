import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { Report } from '@/lib/actions/reports';
import type { ReportBranding } from '@/lib/white-label/kit';

/**
 * A report's page with a white label kit (00429): the kit's cover above the
 * report, and the PDF drawn and named with it; without one, as before. A kit
 * that couldn't be read makes no PDF in GetCito's look.
 */

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'r1' }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));
vi.mock('@/components/ai-usage/AiUsageMeter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const getReport = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/reports', () => ({ getReport }));
const getReportBranding = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/whiteLabel', () => ({ getReportBranding }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('./_ReportPdf', () => ({ ReportPdfDocument: () => null }));
/** The props of each document handed to the renderer. */
const drawn = vi.hoisted(() => [] as unknown[]);
vi.mock('@react-pdf/renderer', () => ({
  pdf: (document: { props: unknown }) => {
    drawn.push(document.props);
    return { toBlob: async () => new Blob(['%PDF']) };
  },
}));
// jsdom draws no canvas: the logos here are PNGs, handed over as they are.
vi.mock('@/lib/white-label/pdfImage', () => ({ pdfImage: async (url: string | null) => url }));

const { default: ReportDetailPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const report: Report = {
  id: 'r1',
  brandId: '22222222-2222-4222-8222-222222222222',
  title: 'October report',
  template: 'monthly',
  dateFrom: '2026-10-01',
  dateTo: '2026-10-31T00:00:00Z',
  createdAt: '2026-10-31T09:00:00Z',
  payload: { brandName: 'Northwind', summaryText: 'Visibility rose.' } as Report['payload'],
};

const kit: ReportBranding = {
  companyName: 'Acme Agency',
  accentColor: '#1d4ed8',
  footerText: 'acme.com',
  logo: 'data:image/png;base64,AAAA',
  clientLogo: 'data:image/png;base64,BBBB',
};

let container: HTMLDivElement;
let root: Root;
let downloaded: string[];

beforeEach(() => {
  vi.clearAllMocks();
  getReport.mockResolvedValue(report);
  getReportBranding.mockResolvedValue({ ok: true, branding: null });
  downloaded = [];
  drawn.length = 0;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloaded.push(this.download);
  });
  URL.createObjectURL = vi.fn(() => 'blob:report');
  URL.revokeObjectURL = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ReportDetailPage />
      </NextIntlClientProvider>,
    );
  });
}

async function download() {
  const button = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Download PDF'),
  )!;
  await act(async () => button.click());
}

describe('ReportDetailPage with white label', () => {
  it('stays as before without a kit: no cover, GetCito’s file name', async () => {
    await render();
    expect(getReportBranding).toHaveBeenCalledWith(report.brandId);
    expect(container.textContent).not.toContain('Prepared for');
    await download();
    expect(drawn[0]).toEqual({ report, branding: null });
    expect(downloaded).toEqual(['getcito_northwind_report_2026-10-31.pdf']);
  });

  it('shows the kit’s cover, and draws and names the PDF with it', async () => {
    getReportBranding.mockResolvedValue({ ok: true, branding: kit });
    await render();
    expect(container.textContent).toContain('Prepared for Northwind');
    expect([...container.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([
      kit.logo,
      kit.clientLogo,
    ]);
    await download();
    expect(drawn[0]).toEqual({ report, branding: kit });
    expect(downloaded).toEqual(['acme-agency_northwind_report_2026-10-31.pdf']);
  });

  it('makes no PDF while the kit can’t be read, and says so', async () => {
    getReportBranding.mockResolvedValue({ ok: false, failure: 'failed' });
    await render();
    await download();
    expect(getReportBranding).toHaveBeenCalledTimes(2);
    expect(drawn).toEqual([]);
    expect(downloaded).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't load your white label kit, so the PDF wasn't made. Try again.",
    );
  });

  it('reads the kit again on download when the first read failed', async () => {
    getReportBranding
      .mockResolvedValueOnce({ ok: false, failure: 'failed' })
      .mockResolvedValueOnce({ ok: true, branding: kit });
    await render();
    await download();
    expect(downloaded).toEqual(['acme-agency_northwind_report_2026-10-31.pdf']);
  });
});
