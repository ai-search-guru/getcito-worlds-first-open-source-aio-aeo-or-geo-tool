/**
 * Shared 7-value search-intent taxonomy — display labels + badge colors.
 *
 * Used by the Insights "intent" column (Prompt Volumes) and the Query Fan-out
 * intent column so the two never drift. The values mirror the full enum in
 * `backend/src/lib/intentExtraction.js` (`intentKeywordSchema.intent`),
 * including `'other'`, so a classified intent always renders a styled label.
 */
export const INTENT_LABELS: Record<string, string> = {
  comparison: 'Comparison',
  'how-to': 'How-to',
  'what-is': 'What is',
  'best-top': 'Best / Top',
  'vs-review': 'vs. / Review',
  recommendation: 'Recommendation',
  'problem-solving': 'Problem Solving',
  other: 'Other',
};

export const INTENT_COLORS: Record<string, string> = {
  comparison: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  'how-to': 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  'what-is': 'border-purple-400/30 bg-purple-400/10 text-purple-600 dark:text-purple-400',
  'best-top': 'border-blue-400/30 bg-blue-400/10 text-blue-600 dark:text-blue-400',
  'vs-review': 'border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  recommendation: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  'problem-solving': 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  other: 'border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-400',
};
