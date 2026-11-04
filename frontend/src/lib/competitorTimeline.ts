/**
 * A competitor's pages over time (learning C3), as the Competitors page shows
 * it: the competitor's and the brand's answers mentioning them, week by week,
 * beside the dated events the API keeps (competitor_page_events, 00376) —
 * the day a competitor page was first cited in the brand's answers, and the
 * days a weekly re-read found it changed, with the Site Audit checks it
 * gained and lost.
 */

/** Weeks the chart shows, the current one last. */
export const TIMELINE_WEEKS = 12;
/** The competitor's line: the Insights trend's first competitor color. */
export const COMPETITOR_COLOR = '#1e3a8a';

export interface TimelineWeek {
  /** The week's Monday, YYYY-MM-DD (UTC). */
  week: string;
  /** Answers that mentioned the brand, and the competitor. */
  brand: number;
  competitor: number;
}

export interface TimelineCheck {
  key: string;
  label: string;
}

export interface CompetitorPageEvent {
  kind: 'first_cited' | 'changed';
  /** When it happened (ISO). */
  at: string;
  url: string;
  domain: string;
  /** first_cited: the answers that cited it when it was first read. */
  answers: number | null;
  /** changed: the Site Audit checks it gained and lost. */
  gained: TimelineCheck[];
  lost: TimelineCheck[];
}

export interface CompetitorTimeline {
  weeks: TimelineWeek[];
  events: CompetitorPageEvent[];
}

const DAY_MS = 86_400_000;

/** The Monday of a day's week, YYYY-MM-DD (UTC). */
export function weekStart(day: string): string {
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  const fromMonday = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - fromMonday * DAY_MS).toISOString().slice(0, 10);
}

/** The first day the chart reads: the Monday `weeks - 1` weeks before this one's. */
export function timelineSince(now: Date, weeks = TIMELINE_WEEKS): string {
  const monday = weekStart(now.toISOString());
  return new Date(Date.parse(`${monday}T00:00:00Z`) - (weeks - 1) * 7 * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The daily rollups' mentioning answers summed per week: every week of the
 * chart, a week with none at 0.
 */
export function weeklyMentions(
  brandRows: readonly { day: string; mention_answers: number | null }[],
  competitorRows: readonly { day: string; mention_answers: number | null }[],
  now: Date,
  weeks = TIMELINE_WEEKS,
): TimelineWeek[] {
  const first = Date.parse(`${timelineSince(now, weeks)}T00:00:00Z`);
  const out = Array.from({ length: weeks }, (_, i) => ({
    week: new Date(first + i * 7 * DAY_MS).toISOString().slice(0, 10),
    brand: 0,
    competitor: 0,
  }));
  const byWeek = new Map(out.map((w) => [w.week, w]));
  for (const row of brandRows) {
    const week = byWeek.get(weekStart(row.day));
    if (week) week.brand += Number(row.mention_answers ?? 0);
  }
  for (const row of competitorRows) {
    const week = byWeek.get(weekStart(row.day));
    if (week) week.competitor += Number(row.mention_answers ?? 0);
  }
  return out;
}

const checks = (value: unknown): TimelineCheck[] =>
  Array.isArray(value)
    ? value.flatMap((c) => {
        const check = (c ?? {}) as Record<string, unknown>;
        return typeof check.key === 'string' && check.key
          ? [
              {
                key: check.key,
                label: typeof check.label === 'string' && check.label ? check.label : check.key,
              },
            ]
          : [];
      })
    : [];

/** The events as stored, read defensively, newest first. */
export function parseTimelineEvents(
  rows: readonly Record<string, unknown>[],
): CompetitorPageEvent[] {
  return rows
    .flatMap((row) => {
      const kind: CompetitorPageEvent['kind'] | null =
        row.kind === 'first_cited' || row.kind === 'changed' ? row.kind : null;
      const at = typeof row.at === 'string' && !Number.isNaN(Date.parse(row.at)) ? row.at : null;
      const url = typeof row.url === 'string' && /^https?:\/\//i.test(row.url) ? row.url : null;
      if (!kind || !at || !url) return [];
      const detail = (row.detail ?? {}) as Record<string, unknown>;
      return [
        {
          kind,
          at,
          url,
          domain: typeof row.domain === 'string' ? row.domain : '',
          answers:
            typeof detail.answers === 'number' && Number.isFinite(detail.answers)
              ? detail.answers
              : null,
          gained: checks(detail.gained),
          lost: checks(detail.lost),
        },
      ];
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** The weeks of the chart with events in them, and how many of each kind. */
export function eventWeeks(
  events: readonly CompetitorPageEvent[],
  weeks: readonly TimelineWeek[],
): { week: string; firstCited: number; changed: number }[] {
  const shown = new Set(weeks.map((w) => w.week));
  const counts = new Map<string, { week: string; firstCited: number; changed: number }>();
  for (const event of events) {
    const week = weekStart(event.at);
    if (!shown.has(week)) continue;
    const count = counts.get(week) ?? { week, firstCited: 0, changed: 0 };
    if (event.kind === 'first_cited') count.firstCited += 1;
    else count.changed += 1;
    counts.set(week, count);
  }
  return [...counts.values()].sort((a, b) => a.week.localeCompare(b.week));
}
