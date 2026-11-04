import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A download's name and Word author (00429): GetCito's without a kit, the
 * agency's with one, none for a kit with only a logo, and neither when the
 * kit can't be read. The kit is read once, until it changes.
 */

const getExportBranding = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/whiteLabel', () => ({ getExportBranding }));

const names = await import('./exportName');

beforeEach(() => {
  vi.clearAllMocks();
  names.forgetExportBranding();
});

describe('exportFileName', () => {
  it('keeps GetCito’s word without a kit in use', async () => {
    getExportBranding.mockResolvedValue({ ok: true, branding: null });
    expect(await names.exportFileName('acme_prompts_2026-10-31.csv')).toBe(
      'getcito_acme_prompts_2026-10-31.csv',
    );
    expect(await names.exportFileName('ai-traffic.zip', '-')).toBe('getcito-ai-traffic.zip');
    expect(await names.exportAuthor()).toBeUndefined();
  });

  it('starts with the agency’s name, and names it as the author, with a kit', async () => {
    getExportBranding.mockResolvedValue({ ok: true, branding: { companyName: 'Acme Agency' } });
    expect(await names.exportFileName('acme_prompts.csv')).toBe('acme-agency_acme_prompts.csv');
    expect(await names.exportAuthor()).toBe('Acme Agency');
  });

  it('starts with no word for a kit with only a logo', async () => {
    getExportBranding.mockResolvedValue({ ok: true, branding: { companyName: null } });
    expect(await names.exportFileName('acme_prompts.csv')).toBe('acme_prompts.csv');
  });

  it('reads the kit once, and again after it changed', async () => {
    getExportBranding.mockResolvedValue({ ok: true, branding: null });
    await names.exportFileName('a.csv');
    await names.exportFileName('b.csv');
    expect(getExportBranding).toHaveBeenCalledTimes(1);
    names.forgetExportBranding();
    await names.exportFileName('c.csv');
    expect(getExportBranding).toHaveBeenCalledTimes(2);
  });

  it('names neither the agency nor GetCito when the kit can’t be read, and asks again next time', async () => {
    getExportBranding.mockResolvedValueOnce({ ok: false, failure: 'failed' });
    expect(await names.exportFileName('acme_prompts.csv')).toBe('acme_prompts.csv');
    getExportBranding.mockRejectedValueOnce(new Error('offline'));
    expect(await names.exportFileName('acme_prompts.csv')).toBe('acme_prompts.csv');
    getExportBranding.mockResolvedValueOnce({ ok: true, branding: null });
    expect(await names.exportFileName('acme_prompts.csv')).toBe('getcito_acme_prompts.csv');
  });
});
