import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';

/**
 * AT-015: the page's Export menu and each table's Excel / CSV buttons fetch
 * the file the server built, save it under the server's name, and show a
 * refusal as a toast instead of leaving the page.
 */

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { TableExport, attachmentName, useTrafficExport } = await import('./_export');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const clicked: { href: string; download: string }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  clicked.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  URL.createObjectURL = vi.fn(() => 'blob:export');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ href: this.href, download: this.download });
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Harness() {
  const exporter = useTrafficExport({
    brandId: 'b1',
    dateWindow: { dateFrom: '2026-10-11T09:00:00.000Z' },
    rangeLabel: 'last 7 days',
    platform: 'gemini.google.com',
    search: '',
  });
  return <TableExport exporter={exporter} section="visits" />;
}

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Harness />
      </NextIntlClientProvider>,
    );
  });
}

const buttons = () => [...container.querySelectorAll('button')];

describe('table export', () => {
  it("asks for the table with the page's range and the list's filters, and saves it", async () => {
    fetchMock.mockResolvedValue(
      new Response('﻿Time (UTC)', {
        status: 200,
        headers: {
          'Content-Disposition':
            'attachment; filename="getcito-ai-traffic-acme-visits-2026-10-11_2026-10-18.csv"',
        },
      }),
    );
    await render();
    expect(buttons().map((b) => b.textContent)).toEqual(['Excel', 'CSV']);

    await act(async () => buttons()[1].click());

    const url = new URL(fetchMock.mock.calls[0][0] as string, 'http://localhost');
    expect(url.pathname).toBe('/api/traffic/export');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      brandId: 'b1',
      format: 'csv',
      rangeLabel: 'last 7 days',
      from: '2026-10-11T09:00:00.000Z',
      platform: 'gemini.google.com',
      section: 'visits',
    });
    expect(clicked).toEqual([
      {
        href: 'blob:export',
        download: 'getcito-ai-traffic-acme-visits-2026-10-11_2026-10-18.csv',
      },
    ]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says the range is too large to export, and saves nothing', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'too_large' }, { status: 413 }));
    await render();
    await act(async () => buttons()[0].click());

    expect(toast.error).toHaveBeenCalledWith(
      'This range has more than 100,000 visits, too many to export at once. Choose a shorter range.',
    );
    expect(clicked).toEqual([]);
  });

  it('says the export failed when the server or the network does', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await render();
    await act(async () => buttons()[0].click());
    expect(toast.error).toHaveBeenCalledWith('The export failed. Please try again.');
  });
});

describe('attachmentName', () => {
  it("reads the server's file name", () => {
    expect(attachmentName('attachment; filename="a-b.xlsx"')).toBe('a-b.xlsx');
    expect(attachmentName(null)).toBeNull();
  });
});
