/**
 * Best-effort article type classification based on URL path + title keywords.
 *
 * Returns `null` when no rule matches. This is a cheap heuristic intended to
 * fill the "Popular Article Types" column until a proper AI enrichment
 * pipeline is in place; the result is typically correct for ~60-70% of
 * listicles, comparisons, and reviews from mainstream publishers.
 */

export type ArticleType = 'Topic Guide' | 'How-to Guide' | 'Review' | 'Ranked List' | 'Comparison';

export const ARTICLE_TYPE_LABELS: Record<ArticleType, string> = {
  'Topic Guide': 'Topic Guide',
  'How-to Guide': 'How-to Guide',
  Review: 'Review',
  'Ranked List': 'Ranked List',
  Comparison: 'Comparison',
};

interface Rule {
  type: ArticleType;
  patterns: RegExp[];
}

// Order matters. First match wins — more specific rules (comparison,
// how-to) come before broader ones (topic guide).
const RULES: Rule[] = [
  {
    type: 'Comparison',
    patterns: [
      /[-_/]vs[-_/]/i,
      /\bvs\.?\b/i,
      /[-_/]compared[-_/]/i,
      /\bcompared\b/i,
      /[-_/]comparison[-_/]/i,
      /[-_/]head-to-head[-_/]/i,
    ],
  },
  {
    type: 'How-to Guide',
    patterns: [
      /[-_/]how-to[-_/]/i,
      /^how-to-/i,
      /[-_/]how-do-i[-_/]/i,
      /[-_/]tutorial[-_/]/i,
      /[-_/]step-by-step[-_/]/i,
    ],
  },
  {
    type: 'Review',
    patterns: [
      /[-_/]review[-_/]/i,
      /[-_/]reviewed[-_/]/i,
      /[-_/]reviews[-_/]/i,
      /-review(?:-|\.|$)/i,
    ],
  },
  {
    type: 'Ranked List',
    patterns: [
      /[-_/]best-/i,
      /^best-/i,
      /[-_/]top-\d+/i,
      /[-_/]top\d+/i,
      /[-_/]ranking[-_/]/i,
      /[-_/]rankings[-_/]/i,
      /[-_/]ranked[-_/]/i,
    ],
  },
  {
    type: 'Topic Guide',
    patterns: [
      /[-_/]guide[-_/]/i,
      /[-_/]guide-to[-_/]/i,
      /[-_/]complete-guide[-_/]/i,
      /[-_/]ultimate-guide[-_/]/i,
      /[-_/]beginners-guide[-_/]/i,
      /[-_/]explained[-_/]/i,
      /[-_/]what-is[-_/]/i,
    ],
  },
];

/**
 * Classify a citation by URL + optional title. Returns null if no rule
 * matches.
 */
export function classifyArticleType(url: string, title?: string): ArticleType | null {
  const corpus = `${url ?? ''} ${title ?? ''}`;
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(corpus))) {
      return rule.type;
    }
  }
  return null;
}
