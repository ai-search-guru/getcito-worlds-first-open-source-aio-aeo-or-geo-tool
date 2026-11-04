/**
 * What the "Analyze competitor content" task found (learning C1): the pages
 * AI answers cited for the action's prompts where the brand isn't named, read
 * overnight and run through Site Audit's checks, the brand's own page beside
 * them, and the checks most of theirs pass that the brand's doesn't. The
 * task's output, as the API's action-center/competitorPages.js writes it.
 */

/** The task whose output this is. */
export const COMPETITOR_TASK_KEY = 'analyze_competitor_content';

export interface CitedPageRead {
  url: string;
  domain: string | null;
  /** Answers that cited it, of those read. */
  cited: number;
  words: number | null;
  /** Site Audit check keys it passes. */
  passes: string[];
}

export interface CompetitorGap {
  key: string;
  /** The check's name, as Site Audit's rubric gives it. */
  label: string;
  /** Competitor pages passing it, of those read. */
  competitors: number;
  of: number;
}

export interface CompetitorFindings {
  competitorPages: CitedPageRead[];
  yourPage: CitedPageRead | null;
  /** Whether the brand's page was read, wasn't cited, or couldn't be read. */
  yourPageStatus: 'read' | 'not_cited' | 'unreadable';
  gaps: CompetitorGap[];
  /** False when too few of their pages were read to compare (at least two). */
  compared: boolean;
  /** Pages that couldn't be read. */
  unreadable: number;
  /** Why nothing was compared, when nothing was: the task is left to a person. */
  reason: 'no_prompts' | 'none_cited' | 'unreadable' | null;
}

const REASONS = ['no_prompts', 'none_cited', 'unreadable'] as const;

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [];

function pageOf(value: unknown): CitedPageRead | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (typeof p.url !== 'string' || !/^https?:\/\//i.test(p.url)) return null;
  return {
    url: p.url,
    domain: typeof p.domain === 'string' ? p.domain : null,
    cited: count(p.cited),
    words: typeof p.words === 'number' && Number.isFinite(p.words) ? p.words : null,
    passes: strings(p.passes),
  };
}

/** The task's output read defensively; null when it isn't this task's. */
export function parseCompetitorFindings(output: unknown): CompetitorFindings | null {
  if (!output || typeof output !== 'object') return null;
  const o = output as Record<string, unknown>;
  if (!Array.isArray(o.competitorPages) || !Array.isArray(o.gaps)) return null;
  const yourPage = pageOf(o.yourPage);
  return {
    competitorPages: o.competitorPages.map(pageOf).filter((p): p is CitedPageRead => p !== null),
    yourPage,
    yourPageStatus: yourPage
      ? 'read'
      : o.yourPageStatus === 'unreadable'
        ? 'unreadable'
        : 'not_cited',
    gaps: o.gaps.flatMap((value) => {
      const g = (value ?? {}) as Record<string, unknown>;
      return typeof g.key === 'string' && g.key && count(g.of) > 0
        ? [
            {
              key: g.key,
              label: typeof g.label === 'string' && g.label ? g.label : g.key,
              competitors: count(g.competitors),
              of: count(g.of),
            },
          ]
        : [];
    }),
    compared: o.compared !== false,
    unreadable: count(o.unreadable),
    reason: (REASONS as readonly unknown[]).includes(o.reason)
      ? (o.reason as CompetitorFindings['reason'])
      : null,
  };
}
