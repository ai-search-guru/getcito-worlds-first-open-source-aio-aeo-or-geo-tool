import { dayRangeBounds, viewerTimeZone } from '@/lib/timeZone';

export const REGIONS = [
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'TR', label: 'Türkiye' },
  { code: 'JP', label: 'Japan' },
  { code: 'BR', label: 'Brazil' },
  { code: 'IN', label: 'India' },
  { code: 'AU', label: 'Australia' },
  { code: 'CA', label: 'Canada' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'IT', label: 'Italy' },
  { code: 'ES', label: 'Spain' },
  { code: 'KR', label: 'South Korea' },
  { code: 'SE', label: 'Sweden' },
  { code: 'MX', label: 'Mexico' },
  { code: 'SG', label: 'Singapore' },
  { code: 'AE', label: 'United Arab Emirates' },
] as const;

export type RegionCode = (typeof REGIONS)[number]['code'];

/**
 * Countries a prompt can be tracked in (PROMPT-015c): the brand regions
 * above, then more markets every tracking engine answers from (the AI
 * engines' provider covers about 195 countries). A brand's own region stays
 * the shorter list: volumes and audits are read for it.
 */
export const TRACKING_COUNTRIES: readonly { code: string; label: string }[] = [
  ...REGIONS,
  { code: 'AR', label: 'Argentina' },
  { code: 'AT', label: 'Austria' },
  { code: 'BE', label: 'Belgium' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'CL', label: 'Chile' },
  { code: 'CO', label: 'Colombia' },
  { code: 'CZ', label: 'Czechia' },
  { code: 'DK', label: 'Denmark' },
  { code: 'EG', label: 'Egypt' },
  { code: 'FI', label: 'Finland' },
  { code: 'GR', label: 'Greece' },
  { code: 'HU', label: 'Hungary' },
  { code: 'ID', label: 'Indonesia' },
  { code: 'IE', label: 'Ireland' },
  { code: 'IL', label: 'Israel' },
  { code: 'KE', label: 'Kenya' },
  { code: 'KW', label: 'Kuwait' },
  { code: 'MA', label: 'Morocco' },
  { code: 'MY', label: 'Malaysia' },
  { code: 'NG', label: 'Nigeria' },
  { code: 'NO', label: 'Norway' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'PE', label: 'Peru' },
  { code: 'PH', label: 'Philippines' },
  { code: 'PK', label: 'Pakistan' },
  { code: 'PL', label: 'Poland' },
  { code: 'PT', label: 'Portugal' },
  { code: 'QA', label: 'Qatar' },
  { code: 'RO', label: 'Romania' },
  { code: 'SA', label: 'Saudi Arabia' },
  { code: 'TH', label: 'Thailand' },
  { code: 'TW', label: 'Taiwan' },
  { code: 'UA', label: 'Ukraine' },
  { code: 'VN', label: 'Vietnam' },
  { code: 'ZA', label: 'South Africa' },
];

/** `items` for a Select over REGIONS — without it the trigger shows the raw code. */
export const REGION_ITEMS = REGIONS.map((r) => ({ value: r.code, label: r.label }));

/**
 * US states for optional state-level geo-targeting (#554). Static on purpose:
 * the UI must not depend on the scraping provider's states endpoint. Codes are
 * USPS two-letter abbreviations, which is what the provider expects alongside
 * `country: 'US'`.
 */
export const US_STATES = [
  { code: 'AL', label: 'Alabama' },
  { code: 'AK', label: 'Alaska' },
  { code: 'AZ', label: 'Arizona' },
  { code: 'AR', label: 'Arkansas' },
  { code: 'CA', label: 'California' },
  { code: 'CO', label: 'Colorado' },
  { code: 'CT', label: 'Connecticut' },
  { code: 'DE', label: 'Delaware' },
  { code: 'DC', label: 'District of Columbia' },
  { code: 'FL', label: 'Florida' },
  { code: 'GA', label: 'Georgia' },
  { code: 'HI', label: 'Hawaii' },
  { code: 'ID', label: 'Idaho' },
  { code: 'IL', label: 'Illinois' },
  { code: 'IN', label: 'Indiana' },
  { code: 'IA', label: 'Iowa' },
  { code: 'KS', label: 'Kansas' },
  { code: 'KY', label: 'Kentucky' },
  { code: 'LA', label: 'Louisiana' },
  { code: 'ME', label: 'Maine' },
  { code: 'MD', label: 'Maryland' },
  { code: 'MA', label: 'Massachusetts' },
  { code: 'MI', label: 'Michigan' },
  { code: 'MN', label: 'Minnesota' },
  { code: 'MS', label: 'Mississippi' },
  { code: 'MO', label: 'Missouri' },
  { code: 'MT', label: 'Montana' },
  { code: 'NE', label: 'Nebraska' },
  { code: 'NV', label: 'Nevada' },
  { code: 'NH', label: 'New Hampshire' },
  { code: 'NJ', label: 'New Jersey' },
  { code: 'NM', label: 'New Mexico' },
  { code: 'NY', label: 'New York' },
  { code: 'NC', label: 'North Carolina' },
  { code: 'ND', label: 'North Dakota' },
  { code: 'OH', label: 'Ohio' },
  { code: 'OK', label: 'Oklahoma' },
  { code: 'OR', label: 'Oregon' },
  { code: 'PA', label: 'Pennsylvania' },
  { code: 'RI', label: 'Rhode Island' },
  { code: 'SC', label: 'South Carolina' },
  { code: 'SD', label: 'South Dakota' },
  { code: 'TN', label: 'Tennessee' },
  { code: 'TX', label: 'Texas' },
  { code: 'UT', label: 'Utah' },
  { code: 'VT', label: 'Vermont' },
  { code: 'VA', label: 'Virginia' },
  { code: 'WA', label: 'Washington' },
  { code: 'WV', label: 'West Virginia' },
  { code: 'WI', label: 'Wisconsin' },
  { code: 'WY', label: 'Wyoming' },
] as const;

export type UsStateCode = (typeof US_STATES)[number]['code'];

export const US_STATE_ITEMS = US_STATES.map((s) => ({ value: s.code, label: s.label }));

export const LANGUAGES = [
  { code: 'en', label: 'English (en)' },
  { code: 'de', label: 'German (de)' },
  { code: 'fr', label: 'French (fr)' },
  { code: 'es', label: 'Spanish (es)' },
  { code: 'tr', label: 'Turkish (tr)' },
  { code: 'ja', label: 'Japanese (ja)' },
  { code: 'pt', label: 'Portuguese (pt)' },
  { code: 'hi', label: 'Hindi (hi)' },
  { code: 'ko', label: 'Korean (ko)' },
  { code: 'it', label: 'Italian (it)' },
  { code: 'nl', label: 'Dutch (nl)' },
  { code: 'sv', label: 'Swedish (sv)' },
  { code: 'ar', label: 'Arabic (ar)' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export const LANGUAGE_ITEMS = LANGUAGES.map((l) => ({ value: l.code, label: l.label }));

export const MODEL_GROUPS = [
  {
    provider: 'Claude',
    models: [{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5' }],
  },
] as const;

export const ALL_MODELS = MODEL_GROUPS.flatMap((g) =>
  g.models.map((m) => ({ ...m, provider: g.provider })),
);

export const SCRAPER_GROUPS = [
  {
    provider: 'Cloro',
    scrapers: [
      { id: 'chatgpt-web', label: 'ChatGPT (Web)', platform: 'chatgpt' },
      { id: 'chatgpt-shopping', label: 'ChatGPT Shopping', platform: 'chatgpt-shopping' },
      { id: 'google-aio', label: 'Google AI Overviews', platform: 'google-ai-overviews' },
      { id: 'google-aimode', label: 'Google AI Mode', platform: 'google-ai-mode' },
      { id: 'copilot-web', label: 'Microsoft Copilot', platform: 'copilot' },
      { id: 'grok-web', label: 'Grok', platform: 'grok' },
      { id: 'perplexity-web', label: 'Perplexity', platform: 'perplexity' },
      { id: 'gemini-web', label: 'Google Gemini', platform: 'gemini' },
    ],
  },
] as const;

export const ALL_SCRAPERS = SCRAPER_GROUPS.flatMap((g) =>
  g.scrapers.map((s) => ({ ...s, provider: g.provider })),
);

/**
 * Fallback window for `getPromptsPageData` when a caller passes no range at
 * all. The page always passes one; this only covers direct calls.
 */
export const DEFAULT_PROMPT_RANGE_DAYS = 30;

/**
 * The windows the Prompts page offers, in the shared date-range control's
 * vocabulary (#713).
 *
 * Matches Visibility and Citations except for `all`, which is deliberately
 * absent: the Query Fan-out tab aggregates raw rows in the client and is hard
 * capped at 90 days and 50,000 rows, so an unbounded option would silently
 * mean "90 days" there — the same silent truncation filed as #721. A custom
 * range is clamped to the same 90 days for the same reason, so both tabs
 * always describe the window they actually read.
 */
export const PROMPT_RANGE_PRESETS = ['24h', '7d', '30d', '90d', 'custom'] as const;

export type PromptRangePreset = (typeof PROMPT_RANGE_PRESETS)[number];

/** Matches Visibility and Citations, which both open on 24h. */
export const DEFAULT_PROMPT_RANGE_PRESET: PromptRangePreset = '24h';

/** The furthest back either tab can honestly report. */
export const PROMPT_RANGE_MAX_DAYS = 90;

export function isPromptRangePreset(value: unknown): value is PromptRangePreset {
  return PROMPT_RANGE_PRESETS.includes(value as PromptRangePreset);
}

export interface PromptRange {
  /** ISO lower bound. */
  from: string;
  /** ISO upper bound, or undefined for "up to now". */
  to?: string;
  /** Whole days the window spans — the fan-out path still thinks in days. */
  days: number;
}

/**
 * Resolve a preset (plus the custom inputs) into the bounds both data paths
 * take. A custom range runs from the start of its first day to the end of its
 * last in the viewer's time zone, is clamped to PROMPT_RANGE_MAX_DAYS and
 * never extends into the future, so the two tabs cannot disagree about what
 * they read.
 */
export function resolvePromptRange(
  preset: PromptRangePreset,
  custom?: { from?: string; to?: string },
  timeZone: string = viewerTimeZone(),
): PromptRange {
  const now = Date.now();
  const dayMs = 86_400_000;

  if (preset === 'custom') {
    const bounds = dayRangeBounds(custom?.from, custom?.to, timeZone);
    const parsedTo = bounds.to ? Date.parse(bounds.to) : NaN;
    const parsedFrom = bounds.from ? Date.parse(bounds.from) : NaN;
    const to = Number.isFinite(parsedTo) ? Math.min(parsedTo, now) : now;
    const earliest = to - PROMPT_RANGE_MAX_DAYS * dayMs;
    const from = Number.isFinite(parsedFrom)
      ? Math.min(Math.max(parsedFrom, earliest), to)
      : earliest;
    return {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      days: Math.max(1, Math.ceil((to - from) / dayMs)),
    };
  }

  const days = preset === '24h' ? 1 : Number(preset.slice(0, -1));
  return { from: new Date(now - days * dayMs).toISOString(), days };
}

/** Human label for the resolved window, used in table tooltips and exports. */
export function promptRangeLabel(preset: PromptRangePreset): string {
  if (preset === '24h') return 'last 24 hours';
  if (preset === 'custom') return 'the selected range';
  return `last ${preset.slice(0, -1)} days`;
}
