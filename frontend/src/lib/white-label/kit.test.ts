import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLANS, getMinimumPlanForFeature, hasFeature } from '@/config/plans';
import {
  GETCITO_REPORT_FOOTER,
  LOGO_MAX_BYTES,
  REPORT_ACCENT,
  clientLogoFolder,
  contrastRatio,
  isLogoPathIn,
  kitInUse,
  kitLogoFolder,
  kitTextSchema,
  logoBytesOk,
  logoProblem,
  logoTypeOf,
  fileWord,
  normalizeHex,
  readableOn,
  reportFileName,
  reportLook,
  svgLooksUnsafe,
  whiteLabelOffered,
  withFileWord,
  type ReportBranding,
} from './kit';

const ORG = '11111111-1111-4111-8111-111111111111';
const BRAND = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';

describe('the plans', () => {
  it('give white label to Growth, Enterprise and a self-host, and not to Starter', () => {
    expect(hasFeature(PLANS.starter, 'white_label')).toBe(false);
    expect(hasFeature(PLANS.growth, 'white_label')).toBe(true);
    expect(hasFeature(PLANS.enterprise, 'white_label')).toBe(true);
    expect(hasFeature(PLANS.self_hosted, 'white_label')).toBe(true);
    expect(getMinimumPlanForFeature('white_label')).toBe('growth');
  });

  it('offer it on the cloud and on a self-host', () => {
    expect(whiteLabelOffered({ isCloud: true })).toBe(true);
    expect(whiteLabelOffered({ isCloud: false })).toBe(true);
  });
});

describe('kitInUse', () => {
  it('uses a kit with a company name or a logo, on a plan with white label', () => {
    expect(kitInUse({ companyName: 'Acme Agency', logoPath: null }, true)).toBe(true);
    expect(kitInUse({ companyName: null, logoPath: `${ORG}/kit/${ID}.png` }, true)).toBe(true);
  });

  it('keeps GetCito’s look without a kit, with only a color or a footer, or once the plan drops', () => {
    expect(kitInUse(null, true)).toBe(false);
    expect(kitInUse({ companyName: null, logoPath: null }, true)).toBe(false);
    expect(kitInUse({ companyName: 'Acme Agency', logoPath: null }, false)).toBe(false);
  });
});

describe('logos', () => {
  it('takes PNG, JPG and SVG up to 1 MB', () => {
    expect(logoProblem({ type: 'image/png', size: 2_000 })).toBeNull();
    expect(logoProblem({ type: 'image/svg+xml', size: LOGO_MAX_BYTES })).toBeNull();
    expect(logoProblem({ type: 'image/webp', size: 2_000 })).toBe('type');
    expect(logoProblem({ type: 'image/jpeg', size: LOGO_MAX_BYTES + 1 })).toBe('size');
    expect(logoProblem({ type: 'image/jpeg', size: 0 })).toBe('size');
  });

  it('keeps a workspace’s logo and a brand’s client logo in their own folders', () => {
    expect(isLogoPathIn(`${ORG}/kit/${ID}.svg`, kitLogoFolder(ORG))).toBe(true);
    expect(isLogoPathIn(`${ORG}/brands/${BRAND}/${ID}.jpg`, clientLogoFolder(ORG, BRAND))).toBe(
      true,
    );
    // Another workspace's folder, a name the app didn't make, or a folder below it.
    expect(isLogoPathIn(`${BRAND}/kit/${ID}.png`, kitLogoFolder(ORG))).toBe(false);
    expect(isLogoPathIn(`${ORG}/kit/logo.png`, kitLogoFolder(ORG))).toBe(false);
    expect(isLogoPathIn(`${ORG}/kit/x/${ID}.png`, kitLogoFolder(ORG))).toBe(false);
    expect(isLogoPathIn(`${ORG}/kit/${ID}.html`, kitLogoFolder(ORG))).toBe(false);
  });

  it('reads a saved logo’s type from its name', () => {
    expect(logoTypeOf(`${ORG}/kit/${ID}.svg`)).toBe('image/svg+xml');
    expect(logoTypeOf(`${ORG}/kit/${ID}.jpg`)).toBe('image/jpeg');
    expect(logoTypeOf(`${ORG}/kit/${ID}.gif`)).toBeNull();
  });

  it('checks an upload is what its type says', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(logoBytesOk(png, 'image/png')).toBe(true);
    expect(logoBytesOk(jpeg, 'image/jpeg')).toBe(true);
    expect(logoBytesOk(svg, 'image/svg+xml')).toBe(true);
    expect(logoBytesOk(jpeg, 'image/png')).toBe(false);
    expect(logoBytesOk(new TextEncoder().encode('<html></html>'), 'image/svg+xml')).toBe(false);
  });

  it('refuses an SVG that could run something', () => {
    for (const svg of [
      '<svg><script>alert(1)</script></svg>',
      '<svg onload="alert(1)"></svg>',
      '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
      '<svg><foreignObject><div/></foreignObject></svg>',
    ]) {
      expect(svgLooksUnsafe(svg), svg).toBe(true);
      expect(logoBytesOk(new TextEncoder().encode(svg), 'image/svg+xml'), svg).toBe(false);
    }
    expect(svgLooksUnsafe('<svg viewBox="0 0 10 10"><path d="M0 0h10"/></svg>')).toBe(false);
  });
});

describe('colors', () => {
  it('keeps a color as #rrggbb in lower case', () => {
    expect(normalizeHex('#1D4ED8')).toBe('#1d4ed8');
    expect(normalizeHex('1d4ed8')).toBe('#1d4ed8');
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('blue')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
  });

  it('reads WCAG’s contrast ratio', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('leaves a dark enough color as it is, and darkens a light one until text reads on white', () => {
    expect(readableOn('#1d4ed8')).toBe('#1d4ed8');
    for (const light of ['#ffff00', '#facc15', '#a3e635', '#ffffff']) {
      const readable = readableOn(light);
      expect(contrastRatio(readable, '#ffffff'), light).toBeGreaterThanOrEqual(4.5);
      expect(readable, light).not.toBe(light);
    }
  });
});

describe('kitTextSchema', () => {
  afterEach(() => vi.restoreAllMocks());

  it('trims, keeps empty as none, and normalizes the color', () => {
    expect(
      kitTextSchema.parse({ companyName: '  Acme Agency ', footerText: '', accentColor: '#ABC' }),
    ).toEqual({ companyName: 'Acme Agency', footerText: null, accentColor: '#aabbcc' });
    expect(kitTextSchema.parse({ companyName: null, footerText: null, accentColor: null })).toEqual(
      { companyName: null, footerText: null, accentColor: null },
    );
  });

  it('refuses a name or footer too long, a line break, or a color it can’t read', () => {
    const ok = { companyName: 'Acme', footerText: 'acme.com', accentColor: '#000000' };
    expect(kitTextSchema.safeParse({ ...ok, companyName: 'x'.repeat(101) }).success).toBe(false);
    expect(kitTextSchema.safeParse({ ...ok, footerText: 'x'.repeat(201) }).success).toBe(false);
    expect(kitTextSchema.safeParse({ ...ok, footerText: 'one\ntwo' }).success).toBe(false);
    expect(kitTextSchema.safeParse({ ...ok, accentColor: 'red' }).success).toBe(false);
    expect(kitTextSchema.safeParse(ok).success).toBe(true);
  });
});

describe('reportLook', () => {
  const kit: ReportBranding = {
    companyName: 'Acme Agency',
    accentColor: '#ffff00',
    footerText: 'acme.com',
    logo: null,
    clientLogo: null,
  };

  it('is GetCito’s own without a kit, as before', () => {
    expect(reportLook(null)).toEqual({
      branded: false,
      accent: REPORT_ACCENT,
      textAccent: REPORT_ACCENT,
      author: 'GetCito',
      footer: GETCITO_REPORT_FOOTER,
    });
  });

  it('takes the kit’s color, darkened for text, its footer and its company as the author', () => {
    const look = reportLook(kit);
    expect(look).toMatchObject({
      branded: true,
      accent: '#ffff00',
      author: 'Acme Agency',
      footer: 'acme.com',
    });
    expect(contrastRatio(look.textAccent, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the report’s accent without a color, and names no author or footer it lacks', () => {
    expect(reportLook({ ...kit, accentColor: null, companyName: null, footerText: null })).toEqual({
      branded: true,
      accent: REPORT_ACCENT,
      textAccent: REPORT_ACCENT,
      author: undefined,
      footer: null,
    });
  });
});

describe('file names', () => {
  it('start with GetCito’s word without a kit, the company’s with one, and none with only a logo', () => {
    expect(fileWord(null)).toBe('getcito');
    expect(fileWord({ companyName: 'Acme Ajans Şirketi' })).toBe('acme-ajans-sirketi');
    expect(fileWord({ companyName: null })).toBeNull();
    expect(fileWord({ companyName: '***' })).toBeNull();
    expect(fileWord({ companyName: 'x'.repeat(60) })).toHaveLength(40);
    expect(withFileWord('acme', 'prompts.csv')).toBe('acme_prompts.csv');
    expect(withFileWord('acme', 'ai-traffic.xlsx', '-')).toBe('acme-ai-traffic.xlsx');
    expect(withFileWord(null, 'prompts.csv')).toBe('prompts.csv');
  });

  it('name a report’s PDF as before without a kit, and after the agency with one', () => {
    expect(reportFileName(null, 'Northwind Coffee', '2026-10-31T00:00:00Z')).toBe(
      'getcito_northwind-coffee_report_2026-10-31.pdf',
    );
    expect(reportFileName({ companyName: 'Acme Agency' }, 'Northwind', '2026-10-31')).toBe(
      'acme-agency_northwind_report_2026-10-31.pdf',
    );
    expect(reportFileName({ companyName: null }, 'Northwind', '2026-10-31')).toBe(
      'northwind_report_2026-10-31.pdf',
    );
  });
});
