/**
 * What the "Find what sets your winning pages apart" task found (learning
 * C4): the brand's winning pages (G14's landing pages, or G10's pages its
 * rising prompts' answers cite), compared through Site Audit's checks with
 * its other audited pages; the checks that set the winners apart, and the
 * other pages missing the most of them. The task's output, as the API's
 * action-center/winningPages.js writes it.
 */

/** The task whose output this is. */
export const WINNING_TASK_KEY = 'analyze_winning_pages';

export interface WinningPage {
  url: string;
  /** Its checks came from its Site Audit, or it was read for the task. */
  source: 'audit' | 'read';
  words: number | null;
  /** Site Audit check keys it passes. */
  passes: string[];
}

export interface WinningPattern {
  key: string;
  /** The check's name, as Site Audit's rubric gives it. */
  label: string;
  /** Winning pages passing it, of those it decides. */
  winners: number;
  ofWinners: number;
  /** The brand's other pages passing it, of those it decides. */
  others: number;
  ofOthers: number;
}

export interface WinningFindings {
  winningPages: WinningPage[];
  /** The brand's other audited pages compared. */
  others: number;
  patterns: WinningPattern[];
  /** Other pages missing the most of the patterns, by check key. */
  missingPages: { url: string; missing: string[] }[];
  /** Winning pages that couldn't be read. */
  unreadable: number;
  /** Why nothing was compared, when nothing was: the task is left to a person. */
  reason: 'no_winner' | 'too_few_audited' | 'winner_unreadable' | null;
}

const REASONS = ['no_winner', 'too_few_audited', 'winner_unreadable'] as const;

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [];
const webUrl = (value: unknown): value is string =>
  typeof value === 'string' && /^https?:\/\//i.test(value);

/** The task's output read defensively; null when it isn't this task's. */
export function parseWinningFindings(output: unknown): WinningFindings | null {
  if (!output || typeof output !== 'object') return null;
  const o = output as Record<string, unknown>;
  if (!Array.isArray(o.winningPages) || !Array.isArray(o.patterns)) return null;
  return {
    winningPages: o.winningPages.flatMap((value) => {
      const p = (value ?? {}) as Record<string, unknown>;
      return webUrl(p.url)
        ? [
            {
              url: p.url,
              source: p.source === 'read' ? ('read' as const) : ('audit' as const),
              words: typeof p.words === 'number' && Number.isFinite(p.words) ? p.words : null,
              passes: strings(p.passes),
            },
          ]
        : [];
    }),
    others: count(o.others),
    patterns: o.patterns.flatMap((value) => {
      const g = (value ?? {}) as Record<string, unknown>;
      return typeof g.key === 'string' && g.key && count(g.ofWinners) > 0 && count(g.ofOthers) > 0
        ? [
            {
              key: g.key,
              label: typeof g.label === 'string' && g.label ? g.label : g.key,
              winners: count(g.winners),
              ofWinners: count(g.ofWinners),
              others: count(g.others),
              ofOthers: count(g.ofOthers),
            },
          ]
        : [];
    }),
    missingPages: (Array.isArray(o.missingPages) ? o.missingPages : []).flatMap((value) => {
      const p = (value ?? {}) as Record<string, unknown>;
      const missing = strings(p.missing);
      return webUrl(p.url) && missing.length > 0 ? [{ url: p.url, missing }] : [];
    }),
    unreadable: count(o.unreadable),
    reason: (REASONS as readonly unknown[]).includes(o.reason)
      ? (o.reason as WinningFindings['reason'])
      : null,
  };
}
