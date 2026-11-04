import { z } from 'zod';
import { PLANS, hasFeature } from '@/config/plans';
import { slugify } from '@/lib/slug';

/**
 * White label (00429): an agency's own logo, main color, company name and
 * report footer on what it sends its clients, and each brand's client logo
 * for the report cover. The rules every surface reads: what may go up, what
 * a kit holds, when it is used, and its color kept readable.
 */

/** The private bucket the logos go to (00429). */
export const WHITE_LABEL_BUCKET = 'white-label-logos';
/** The bucket's own limit: 1 MB a logo. */
export const LOGO_MAX_BYTES = 1024 * 1024;
/** The types the bucket takes, with the extension each is saved under. */
export const LOGO_TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
};
/** The file picker's filter. */
export const LOGO_ACCEPT = Object.keys(LOGO_TYPES).join(',');
export const COMPANY_NAME_MAX = 100;
export const FOOTER_MAX = 200;

/** The extension a type is saved under, or null for one the bucket doesn't take. */
export const logoExtension = (type: string): string | null =>
  Object.hasOwn(LOGO_TYPES, type) ? LOGO_TYPES[type] : null;

/** The type a saved logo's name says it is, or null. */
export function logoTypeOf(path: string): string | null {
  const ext = /\.([a-z]+)$/.exec(path)?.[1];
  return Object.keys(LOGO_TYPES).find((type) => LOGO_TYPES[type] === ext) ?? null;
}

export type LogoProblem = 'type' | 'size';

/** Why a file can't go up, before it is sent, or null. */
export function logoProblem(file: { type: string; size: number }): LogoProblem | null {
  if (!logoExtension(file.type)) return 'type';
  if (file.size <= 0 || file.size > LOGO_MAX_BYTES) return 'size';
  return null;
}

/** A workspace's logo goes under its own folder: {organization}/kit/. */
export const kitLogoFolder = (organizationId: string) => `${organizationId}/kit/`;
/** A brand's client logo: {organization}/brands/{brand}/. */
export const clientLogoFolder = (organizationId: string, brandId: string) =>
  `${organizationId}/brands/${brandId}/`;

const LOGO_NAME = /^[0-9a-f-]{36}\.(png|jpg|svg)$/;

/** Whether `path` is a logo the app named in `folder`: a new id and a type's extension. */
export function isLogoPathIn(path: string, folder: string): boolean {
  return path.startsWith(folder) && LOGO_NAME.test(path.slice(folder.length));
}

/** An SVG that could run something or reach out when opened on its own. */
export function svgLooksUnsafe(svg: string): boolean {
  return /<script\b|<foreignObject\b|<iframe\b|<embed\b|<object\b|\son[a-z]+\s*=|javascript:/i.test(
    svg,
  );
}

/**
 * Whether an uploaded logo's bytes are what its type says: a PNG's or a
 * JPEG's signature, or an SVG that runs nothing.
 */
export function logoBytesOk(bytes: Uint8Array, type: string): boolean {
  const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  if (type === 'image/png') return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (type === 'image/jpeg') return starts(0xff, 0xd8, 0xff);
  if (type === 'image/svg+xml') {
    const text = new TextDecoder().decode(bytes);
    return /<svg\b/i.test(text) && !svgLooksUnsafe(text);
  }
  return false;
}

// ─── Colors ──────────────────────────────────────────────────────────────────

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A color as the kit keeps it, #rrggbb in lower case, or null for one it can't read. */
export function normalizeHex(value: string): string | null {
  const hex = HEX.exec(value.trim())?.[1].toLowerCase();
  if (!hex) return null;
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`;
}

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const toHex = (rgb: number[]) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** WCAG's relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG's contrast ratio of two #rrggbb colors, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for body text: what a kit's color must reach on the page to carry text. */
export const MIN_TEXT_CONTRAST = 4.5;

/**
 * The color, darkened toward black only as far as it takes to read on
 * `background` (white paper) at `min`: a light yellow brand color still
 * draws a rule as it is, but the text set in it stays legible.
 */
export function readableOn(hex: string, background = '#ffffff', min = MIN_TEXT_CONTRAST): string {
  let rgb = channels(hex);
  for (let i = 0; i < 40 && contrastRatio(toHex(rgb), background) < min; i += 1) {
    rgb = rgb.map((c) => c * 0.92) as [number, number, number];
  }
  return toHex(rgb);
}

// ─── The kit ─────────────────────────────────────────────────────────────────

/** What a kit holds, as the app reads it: null for a field left empty. */
export interface WhiteLabelKit {
  companyName: string | null;
  accentColor: string | null;
  footerText: string | null;
  logoPath: string | null;
}

/**
 * Whether this install offers white label at all: the cloud's plans do (or
 * lock it), a self-host only once its plan has it, since it has no plan to
 * upgrade to. Where it isn't offered, its settings aren't shown.
 */
export function whiteLabelOffered({ isCloud }: { isCloud: boolean }): boolean {
  return isCloud || hasFeature(PLANS.self_hosted, 'white_label');
}

/**
 * Whether a workspace's kit is used: its plan has white label and the kit
 * names a company or has a logo. Otherwise everything keeps GetCito's look.
 */
export function kitInUse(
  kit: Pick<WhiteLabelKit, 'companyName' | 'logoPath'> | null,
  planHasWhiteLabel: boolean,
): boolean {
  return planHasWhiteLabel && Boolean(kit && (kit.companyName || kit.logoPath));
}

/** One line of text, trimmed; empty is no value. */
const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !/\p{Cc}/u.test(value))
    .nullable()
    .transform((value) => value || null);

/** The kit's words and color, as Settings › White label saves them. */
export const kitTextSchema = z.object({
  companyName: line(COMPANY_NAME_MAX),
  footerText: line(FOOTER_MAX),
  accentColor: z
    .string()
    .regex(HEX)
    .nullable()
    .transform((value) => (value ? normalizeHex(value) : null)),
});

export type KitTextInput = z.input<typeof kitTextSchema>;

// ─── Reports and exports ─────────────────────────────────────────────────────

/** A report's own accent without a kit: GetCito's dark green. */
export const REPORT_ACCENT = '#003934';
/** A report's footer without a kit. */
export const GETCITO_REPORT_FOOTER = 'Generated with GetCito · www.getcito.com';

/**
 * A kit in use, as a report and its PDF show it; null keeps GetCito's
 * look. The logos are the images themselves (data URLs): the PDF is drawn
 * in the browser, and the bucket stays private.
 */
export interface ReportBranding {
  companyName: string | null;
  accentColor: string | null;
  footerText: string | null;
  logo: string | null;
  clientLogo: string | null;
}

/** What a report looks like: with a kit, or GetCito's own without one. */
export interface ReportLook {
  branded: boolean;
  /** Rules, bars and lines. */
  accent: string;
  /** Text set in the accent, darkened where the kit's color is too light to read. */
  textAccent: string;
  /** The PDF's author and creator; none for a kit with only a logo. */
  author: string | undefined;
  /** The line at the bottom of each page; none for a kit without one. */
  footer: string | null;
}

export function reportLook(branding: ReportBranding | null): ReportLook {
  if (!branding) {
    return {
      branded: false,
      accent: REPORT_ACCENT,
      textAccent: REPORT_ACCENT,
      author: 'GetCito',
      footer: GETCITO_REPORT_FOOTER,
    };
  }
  // No color in the kit: the report's own, as it is.
  const accent = branding.accentColor ?? REPORT_ACCENT;
  return {
    branded: true,
    accent,
    textAccent: branding.accentColor ? readableOn(accent) : REPORT_ACCENT,
    author: branding.companyName ?? undefined,
    footer: branding.footerText,
  };
}

/**
 * The word a downloaded file's name starts with: the company's, as a slug,
 * with a kit in use; GetCito's without one (null); none for a kit with only
 * a logo.
 */
export function fileWord(branding: { companyName: string | null } | null): string | null {
  if (!branding) return 'getcito';
  return (
    slugify(branding.companyName ?? '')
      .slice(0, 40)
      .replace(/-+$/, '') || null
  );
}

/** `rest` after the file word and `separator`, or `rest` alone for none. */
export function withFileWord(word: string | null, rest: string, separator = '_'): string {
  return word ? `${word}${separator}${rest}` : rest;
}

/**
 * A report PDF's name: "acme-agency_northwind_report_2026-10-31.pdf" with a
 * kit, "getcito_northwind_report_…" without one, as before.
 */
export function reportFileName(
  branding: { companyName: string | null } | null,
  brandName: string,
  dateTo: string,
): string {
  const brand =
    brandName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'brand';
  return withFileWord(fileWord(branding), `${brand}_report_${dateTo.slice(0, 10)}.pdf`);
}
