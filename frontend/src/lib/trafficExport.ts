/**
 * The AI Traffic page as files (AT-015, spec §3.9): the whole page as an
 * Excel workbook, one sheet per section plus a Filters sheet, or as a zip of
 * one CSV per section; and each table on its own.
 *
 * Pure: the route reads the data and calls these. Numbers stay numbers, so a
 * spreadsheet can sum them; a % change the page wouldn't show (below 30
 * visits, or no previous period) is left empty with the reason beside it.
 */

import type { Sheet } from 'write-excel-file/node';
import type {
  TrafficConversions,
  TrafficBots,
  TrafficBrokenLinks,
  TrafficGooglePages,
  TrafficLog,
  TrafficUntrackedQueries,
  TrafficPages,
  TrafficSources,
  TrafficSummary,
  TrafficTrendPoint,
} from '@/lib/actions/traffic';
import { csvLine } from '@/lib/csv';
import { withFileWord } from '@/lib/white-label/kit';
import { getPlatformName, platformTableRows } from '@/lib/trafficPlatforms';
import { pageStatuses } from '@/lib/trafficPages';
import { conversionRate } from '@/lib/trafficConversions';
import { ctrPct, impressionsRise } from '@/lib/trafficGooglePages';
import { botName } from '@/lib/aiBotNames';
import { visitChange } from '@/lib/trafficChange';
import { googleSourceStatus, snippetStateOf, type GoogleSourceStatus } from '@/lib/trafficSources';

/** Every section, in the page's order. */
export const TRAFFIC_EXPORT_SECTIONS = [
  'kpis',
  'trend',
  'platforms',
  'pages',
  'convertingPages',
  'buyerAnswers',
  'pageStatus',
  'brokenLinks',
  'googlePages',
  'googleQueries',
  'bots',
  'botPages',
  'uncrawledPages',
  'visits',
] as const;

export type TrafficExportSection = (typeof TRAFFIC_EXPORT_SECTIONS)[number];

/** The tables that carry their own Excel / CSV buttons, as in the mockup. */
export const TRAFFIC_TABLE_SECTIONS = [
  'platforms',
  'pages',
  'convertingPages',
  'buyerAnswers',
  'pageStatus',
  'brokenLinks',
  'googlePages',
  'googleQueries',
  'bots',
  'botPages',
  'visits',
] as const;

/** Beyond this many visits an export would take too long to build on request. */
export const TRAFFIC_EXPORT_MAX_ROWS = 100_000;

/** A label from en.json's traffic.export namespace. */
export type ExportLabel = (key: string, values?: Record<string, string | number>) => string;

export interface TrafficExportData {
  brandName: string;
  /** The page's words for the range, e.g. "last 7 days". */
  rangeLabel: string;
  /** First and last day (YYYY-MM-DD); no first day for all time. */
  from: string | null;
  to: string;
  platform: string | null;
  search: string | null;
  exportedAt: Date;
  summary?: TrafficSummary;
  trend?: TrafficTrendPoint[];
  visits?: TrafficLog[];
  /** Every page of the Pages section, with the lists it is on (AT-006). */
  pageStatus?: TrafficPages | null;
  /** Broken AI links, every page, with its suggested redirect (AT-012). */
  brokenLinks?: TrafficBrokenLinks | null;
  /** Where AI visitors convert, every row (AT-014). */
  conversions?: TrafficConversions | null;
  /** Is AI taking Google clicks?, every page (AT-008). */
  googlePages?: TrafficGooglePages | null;
  /** Google queries you don't track yet, every one the server checked (AT-009). */
  googleQueries?: TrafficUntrackedQueries | null;
  /** AI bots reading the site, every page (AT-011). */
  bots?: TrafficBots | null;
  sources?: TrafficSources | null;
  /**
   * Sections whose read failed while the rest exported: their sheets say so
   * rather than reading as empty (gkhngyk on #1244).
   */
  unread?: UnreadSection[];
}

/** The reads an export leaves out when they fail, so the rest still exports. */
export type UnreadSection = 'googleQueries' | 'bots';

/** A sheet that is only a note. */
function noteTable(label: ExportLabel, key: string, values?: Record<string, number>): ExportTable {
  return { headers: [label('columns.note')], rows: [[label(key, values)]] };
}

type Cell = string | number | null;

export interface ExportTable {
  headers: string[];
  rows: Cell[][];
}

/** A change the page would show, as a number, or why there is none. */
function change(current: number, previous: number, comparable: boolean, label: ExportLabel) {
  const c = visitChange(current, previous, { comparable });
  if (c.kind === 'pct') return { pct: c.pct, note: '' };
  if (c.kind === 'low') return { pct: null, note: label('notes.lowSample') };
  if (c.kind === 'new') return { pct: null, note: label('notes.new') };
  return { pct: null, note: comparable ? '' : label('notes.noPreviousPeriod') };
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** "2026-10-17 09:30" in UTC: sorts and reads the same everywhere. */
function utcMinute(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

function kpis(data: TrafficExportData, label: ExportLabel): ExportTable {
  const s = data.summary;
  if (!s) return { headers: [], rows: [] };
  const top = s.platformBreakdown[0];
  const delta = change(s.totalVisits, s.totalVisitsPrev, s.hasPreviousPeriod, label);
  return {
    headers: [label('columns.metric'), label('columns.value'), label('columns.note')],
    rows: [
      [label('metrics.visits'), s.totalVisits, null],
      [label('metrics.pageviews'), s.totalPageviews, null],
      ...(s.hasPreviousPeriod
        ? ([[label('metrics.previousVisits'), s.totalVisitsPrev, null]] as Cell[][])
        : []),
      [label('metrics.change'), delta.pct, delta.note || null],
      [label('metrics.topPlatform'), top ? getPlatformName(top.platform) : null, null],
      [label('metrics.topPlatformVisits'), top ? top.visits : null, null],
      [label('metrics.platforms'), s.platformBreakdown.length, null],
    ],
  };
}

function trend(data: TrafficExportData, label: ExportLabel): ExportTable {
  const points = data.trend ?? [];
  const platforms = [...new Set(points.flatMap((p) => Object.keys(p).filter((k) => k !== 'date')))];
  // The 24-hour range trends by hour (AT-017): "2026-10-17 13:00", UTC.
  const hourly = points.some((p) => p.date.includes('T'));
  return {
    headers: [
      hourly ? label('columns.hour') : label('columns.day'),
      ...platforms.map(getPlatformName),
    ],
    rows: points.map((p) => [
      hourly ? utcMinute(p.date) : p.date,
      ...platforms.map((k) => Number(p[k]) || 0),
    ]),
  };
}

function platforms(data: TrafficExportData, label: ExportLabel): ExportTable {
  const s = data.summary;
  const total = s?.totalVisits ?? 0;
  return {
    headers: [
      label('columns.platform'),
      label('columns.visits'),
      label('columns.previousVisits'),
      label('columns.change'),
      label('columns.share'),
      // From Google Analytics, as the table shows them (AT-005).
      label('columns.engaged'),
      label('columns.keyEvents'),
      label('columns.note'),
    ],
    // A surface's row (ChatGPT Shopping, #1283) under its platform's, as the
    // table shows it, says it's part of that platform's visits: summing the
    // column would count them twice.
    rows: platformTableRows(s?.platformBreakdown ?? []).map((row) => {
      const delta = change(row.visits, row.visitsPrev, s!.hasPreviousPeriod, label);
      const ga = row.analytics;
      const platform = getPlatformName(row.platform);
      const notes = [
        row.surface ? label('notes.partOfPlatform', { platform }) : '',
        delta.note,
      ].filter(Boolean);
      return [
        row.surface ? label(`surfaceNames.${row.surface}`, { platform }) : platform,
        row.visits,
        s!.hasPreviousPeriod ? row.visitsPrev : null,
        delta.pct,
        total > 0 ? Math.round((row.visits / total) * 1000) / 10 : null,
        ga && ga.sessions > 0 ? Math.round((ga.engagedSessions / ga.sessions) * 1000) / 10 : null,
        ga ? ga.keyEvents : null,
        notes.join('; ') || null,
      ];
    }),
  };
}

function pages(data: TrafficExportData, label: ExportLabel): ExportTable {
  const s = data.summary;
  return {
    headers: [
      label('columns.page'),
      label('columns.visits'),
      label('columns.previousVisits'),
      label('columns.change'),
      // How often tracked AI answers cite the page (AT-006).
      label('columns.citations'),
      label('columns.note'),
    ],
    rows: (s?.topPages ?? []).map((row) => {
      const delta = change(row.visits, row.visitsPrev, s!.hasPreviousPeriod, label);
      return [
        row.url,
        row.visits,
        s!.hasPreviousPeriod ? row.visitsPrev : null,
        delta.pct,
        row.citations,
        delta.note || null,
      ];
    }),
  };
}

/**
 * The Pages section (AT-006): every page, with the work lists it is on in a
 * Status column, so a spreadsheet can filter each tab (spec §3.9).
 */
function pageStatus(data: TrafficExportData, label: ExportLabel): ExportTable {
  const rows = data.pageStatus?.rows ?? [];
  // Never an empty sheet: say why there are no rows (spec §3.8b).
  if (rows.length === 0)
    return { headers: [label('columns.note')], rows: [[label('notes.noPages')]] };
  return {
    headers: [
      label('columns.page'),
      label('columns.aiVisits'),
      label('columns.aiKeyEvents'),
      label('columns.citations'),
      label('columns.topPlatforms'),
      label('columns.targetingPrompts'),
      label('columns.sessions'),
      label('columns.rank'),
      label('columns.inSitemap'),
      label('columns.status'),
    ],
    rows: rows.map((row) => [
      row.page,
      row.aiVisits,
      row.aiKeyEvents,
      row.citations,
      row.aiPlatforms.map(getPlatformName).join(', ') || null,
      row.targetingPrompts,
      row.sessions,
      row.valueRank,
      row.inSitemap ? label('yes') : label('no'),
      pageStatuses(row)
        .map((status) => label(`pageStatuses.${status}`))
        .join('; ') || null,
    ]),
  };
}

/**
 * Broken AI links (AT-012) as a redirect list: each missing page and the
 * working page to send it to, ready for a 301 rule, with why that page and
 * what AI visitors got.
 */
function brokenLinks(data: TrafficExportData, label: ExportLabel): ExportTable {
  const rows = data.brokenLinks?.rows ?? [];
  if (rows.length === 0) {
    return { headers: [label('columns.note')], rows: [[label('notes.noBrokenLinks')]] };
  }
  return {
    headers: [
      label('columns.redirectFrom'),
      label('columns.redirectTo'),
      label('columns.redirectType'),
      label('columns.redirectReason'),
      label('columns.aiVisits'),
      label('columns.topPlatforms'),
      label('columns.citations'),
      label('columns.lastVisit'),
      label('columns.landingStatus'),
    ],
    rows: rows.map((row) => [
      row.page,
      row.target,
      row.target ? 301 : null,
      row.targetReason ? label(`redirectReasons.${row.targetReason}`) : null,
      row.visits,
      row.platforms.map(getPlatformName).join(', ') || null,
      row.citations,
      utcMinute(row.lastVisit),
      label(`brokenStatuses.${row.status}`),
    ]),
  };
}

/** A row's rate as a number, or why the page shows none (§5.4). */
function rateCells(
  figures: { aiVisits: number; keyEvents: number; keyEventSessions: number },
  label: ExportLabel,
): { pct: number | null; note: string | null } {
  const rate = conversionRate(figures);
  if (rate.kind === 'rate') return { pct: rate.pct, note: null };
  return { pct: null, note: rate.kind === 'low' ? label('notes.conversionLowSample') : null };
}

/**
 * Where AI visitors convert (AT-014): its two tables, every row, with a row
 * saying when a thin range read the last 30 days, as the page says.
 */
function conversionsTable(
  data: TrafficExportData,
  label: ExportLabel,
  build: (c: TrafficConversions) => ExportTable,
): ExportTable {
  const c = data.conversions;
  const table = c ? build(c) : null;
  if (!c || !table || table.rows.length === 0) {
    return { headers: [label('columns.note')], rows: [[label('notes.noConversions')]] };
  }
  if (!c.widened) return table;
  const filler = table.headers.slice(1).map(() => null);
  return { ...table, rows: [...table.rows, [label('notes.lastThirtyDays'), ...filler]] };
}

function convertingPages(data: TrafficExportData, label: ExportLabel): ExportTable {
  return conversionsTable(data, label, (c) => ({
    headers: [
      label('columns.page'),
      label('columns.aiVisits'),
      label('columns.keyEvents'),
      label('columns.revenue'),
      label('columns.conversionRate'),
      label('columns.bestPlatform'),
      label('columns.note'),
    ],
    rows: c.pages.map((row) => {
      const rate = rateCells(row, label);
      return [
        row.page,
        row.aiVisits,
        row.keyEvents,
        c.hasRevenue ? row.revenue : null,
        rate.pct,
        row.bestPlatform ? getPlatformName(row.bestPlatform) : null,
        rate.note,
      ];
    }),
  }));
}

function buyerAnswers(data: TrafficExportData, label: ExportLabel): ExportTable {
  return conversionsTable(data, label, (c) => ({
    headers: [
      label('columns.platform'),
      label('columns.topic'),
      label('columns.citedPages'),
      label('columns.aiVisits'),
      label('columns.keyEvents'),
      label('columns.revenue'),
      label('columns.conversionRate'),
      label('columns.note'),
    ],
    rows: c.answers.map((row) => {
      const rate = rateCells(row, label);
      return [
        getPlatformName(row.platform),
        row.topic,
        row.pages,
        row.aiVisits,
        row.keyEvents,
        c.hasRevenue ? row.revenue : null,
        rate.pct,
        rate.note,
      ];
    }),
  }));
}

/**
 * Is AI taking Google clicks? (AT-008): every page that qualifies, with both
 * periods' figures and the days compared, since they end on Google's latest
 * reported day rather than the range's last.
 */
function googlePages(data: TrafficExportData, label: ExportLabel): ExportTable {
  const g = data.googlePages;
  const note = (key: string) => ({ headers: [label('columns.note')], rows: [[label(key)]] });
  if (!g || !g.lastDay) return note('notes.noGooglePages');
  if (!g.since) return note('notes.noPreviousPeriod');
  if (g.incomplete) return note('notes.googleHistoryShort');
  if (g.rows.length === 0) return note('notes.noGoogleClicksLost');
  const days = `${g.since} – ${g.until}`;
  const prevDays = `${g.prevSince} – ${g.prevUntil}`;
  return {
    headers: [
      label('columns.page'),
      label('columns.url'),
      label('columns.impressions'),
      label('columns.previousImpressions'),
      label('columns.change'),
      label('columns.ctr'),
      label('columns.previousCtr'),
      label('columns.clicks'),
      label('columns.previousClicks'),
      label('columns.days'),
      label('columns.previousDays'),
    ],
    rows: g.rows.map((row) => [
      row.page,
      row.url,
      row.impressions,
      row.prevImpressions,
      impressionsRise(row),
      ctrPct(row.clicks, row.impressions),
      ctrPct(row.prevClicks, row.prevImpressions),
      row.clicks,
      row.prevClicks,
      days,
      prevDays,
    ]),
  };
}

/** Google queries you don't track yet (AT-009): every one, with the days read. */
function googleQueries(data: TrafficExportData, label: ExportLabel): ExportTable {
  const q = data.googleQueries;
  const note = (key: string) => ({ headers: [label('columns.note')], rows: [[label(key)]] });
  if (data.unread?.includes('googleQueries')) return note('notes.readFailed');
  if (!q || !q.lastDay) return note('notes.noGoogleQueries');
  if (q.rows.length === 0) return note('notes.noUntrackedQueries');
  const days = q.since ? `${q.since} – ${q.until}` : `${label('filters.start')} – ${q.until}`;
  const table: ExportTable = {
    headers: [
      label('columns.query'),
      label('columns.clicks'),
      label('columns.impressions'),
      label('columns.days'),
    ],
    rows: q.rows.map((row) => [row.query, row.clicks, row.impressions, days]),
  };
  if (!q.capped) return table;
  return { ...table, rows: [...table.rows, [label('notes.queriesCapped'), null, null, null]] };
}

/**
 * AI bots reading the site (AT-011), as the By bot type card lists them:
 * each type with its bots, hits, pages and last request.
 */
function bots(data: TrafficExportData, label: ExportLabel): ExportTable {
  const rows = data.bots?.types ?? [];
  if (data.unread?.includes('bots')) return noteTable(label, 'notes.readFailed');
  if (rows.length === 0) return noteTable(label, 'notes.noBots');
  return {
    headers: [
      label('columns.botType'),
      label('columns.bots'),
      label('columns.hits'),
      label('columns.pagesRead'),
      label('columns.lastSeen'),
    ],
    rows: rows.map((row) => [
      label(`botTypes.${row.type}`),
      row.bots.map(botName).join(', '),
      row.hits,
      row.pages,
      row.lastSeen ? utcMinute(row.lastSeen) : null,
    ]),
  };
}

/**
 * The cited pages no AI search bot read in the last 30 days (AT-011), as the
 * report lists them: the most cited first, then how many more there are.
 */
function uncrawledPages(data: TrafficExportData, label: ExportLabel): ExportTable {
  const report = data.bots;
  if (data.unread?.includes('bots')) return noteTable(label, 'notes.readFailed');
  if (!report) return noteTable(label, 'notes.noBots');
  if (report.uncrawledCount === null || report.uncrawled === null) {
    // Paused, as the report says it (its data isn't whole), or still under 30 days.
    return noteTable(
      label,
      report.alertState === 'stale' ? 'notes.uncrawledStale' : 'notes.uncrawledWaiting',
    );
  }
  if (report.uncrawledCount === 0) return noteTable(label, 'notes.noUncrawled');
  const rows: Cell[][] = report.uncrawled.map((row) => [row.page, row.citations]);
  const more = report.uncrawledCount - report.uncrawled.length;
  if (more > 0) rows.push([label('notes.uncrawledMore', { count: more }), null]);
  return { headers: [label('columns.page'), label('columns.citations')], rows };
}

/** The pages AI bots read (AT-011), with when each type last read them. */
function botPages(data: TrafficExportData, label: ExportLabel): ExportTable {
  const rows = data.bots?.pages ?? [];
  if (data.unread?.includes('bots')) return noteTable(label, 'notes.readFailed');
  if (rows.length === 0) return noteTable(label, 'notes.noBots');
  const at = (iso: string | null) => (iso ? utcMinute(iso) : null);
  return {
    headers: [
      label('columns.page'),
      label('columns.hits'),
      label('columns.trainingLast'),
      label('columns.searchLast'),
      label('columns.userLast'),
    ],
    rows: rows.map((row) => [
      row.page,
      row.hits,
      at(row.trainingLast),
      at(row.searchLast),
      at(row.userLast),
    ]),
  };
}

function visits(data: TrafficExportData, label: ExportLabel): ExportTable {
  return {
    headers: [
      label('columns.time'),
      label('columns.platform'),
      label('columns.page'),
      label('columns.url'),
      label('columns.referrer'),
      label('columns.country'),
      label('columns.pageviews'),
    ],
    rows: (data.visits ?? []).map((v) => [
      utcMinute(v.createdAt),
      getPlatformName(v.sourcePlatform ?? 'unknown'),
      pathOf(v.url),
      v.url,
      v.referrer,
      v.country,
      v.pageviews,
    ]),
  };
}

/** One section as a table: its headers and its rows. */
export function trafficTable(
  section: TrafficExportSection,
  data: TrafficExportData,
  label: ExportLabel,
): ExportTable {
  switch (section) {
    case 'kpis':
      return kpis(data, label);
    case 'trend':
      return trend(data, label);
    case 'platforms':
      return platforms(data, label);
    case 'pages':
      return pages(data, label);
    case 'convertingPages':
      return convertingPages(data, label);
    case 'buyerAnswers':
      return buyerAnswers(data, label);
    case 'pageStatus':
      return pageStatus(data, label);
    case 'brokenLinks':
      return brokenLinks(data, label);
    case 'googlePages':
      return googlePages(data, label);
    case 'googleQueries':
      return googleQueries(data, label);
    case 'bots':
      return bots(data, label);
    case 'botPages':
      return botPages(data, label);
    case 'uncrawledPages':
      return uncrawledPages(data, label);
    case 'visits':
      return visits(data, label);
  }
}

/** The snippet's state as the export's sources rows name it. */
const SNIPPET_STATE_LABEL = {
  active: 'active',
  installed_quiet: 'installedQuiet',
  not_detected: 'notDetected',
} as const;

/** What the export was made from: the range, the filters, the sources and when. */
export function filtersTable(data: TrafficExportData, label: ExportLabel): ExportTable {
  const sourceState = (status: GoogleSourceStatus) => label(`sourceStates.${status}`);
  const sources = data.sources;
  return {
    headers: [label('columns.setting'), label('columns.value')],
    rows: [
      [label('filters.brand'), data.brandName],
      [label('filters.range'), data.rangeLabel],
      [label('filters.from'), data.from ?? label('filters.start')],
      [label('filters.to'), data.to],
      [
        label('filters.platform'),
        data.platform ? getPlatformName(data.platform) : label('filters.allPlatforms'),
      ],
      [label('filters.search'), data.search || label('filters.none')],
      [
        label('filters.snippet'),
        sources ? label(`sourceStates.${SNIPPET_STATE_LABEL[snippetStateOf(sources)]}`) : null,
      ],
      [label('filters.ga'), sources ? sourceState(googleSourceStatus(sources.ga)) : null],
      [label('filters.gsc'), sources ? sourceState(googleSourceStatus(sources.gsc)) : null],
      [label('filters.exportedAt'), `${utcMinute(data.exportedAt.toISOString())} UTC`],
    ],
  };
}

const bold = (value: string) => ({ value, fontWeight: 'bold' as const });

function sheetOf(name: string, table: ExportTable): Sheet<Buffer> {
  return {
    sheet: name,
    stickyRowsCount: 1,
    columns: table.headers.map((_, i) => ({ width: i === 0 ? 44 : 18 })),
    data: [table.headers.map(bold), ...table.rows],
  };
}

/**
 * The workbook: the sections asked for, one sheet each, and — for the whole
 * page — the Filters sheet first, so whoever opens the file sees what it is.
 */
export function trafficWorkbook(
  data: TrafficExportData,
  sections: readonly TrafficExportSection[],
  label: ExportLabel,
  { withFilters }: { withFilters: boolean },
): Sheet<Buffer>[] {
  return [
    ...(withFilters ? [sheetOf(label('sheets.filters'), filtersTable(data, label))] : []),
    ...sections.map((section) =>
      sheetOf(label(`sheets.${section}`), trafficTable(section, data, label)),
    ),
  ];
}

/** Excel opens a UTF-8 CSV as UTF-8 only when it starts with a byte order mark. */
export const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

export function tableCsv(table: ExportTable): string {
  return BYTE_ORDER_MARK + [csvLine(table.headers), ...table.rows.map(csvLine)].join('\n');
}

/** "acme-coffee" from a brand name or a sheet name: safe in a file name. */
export function fileSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'brand'
  );
}

/**
 * getcito-ai-traffic-{brand}-{from}_{to}.{ext} (spec §3.9); a single table
 * adds its name. All time has no first day. A white label kit's word takes
 * GetCito's place (00429), or none.
 */
export function trafficExportFileName({
  brand,
  from,
  to,
  ext,
  table,
  word = 'getcito',
}: {
  brand: string;
  from: string | null;
  to: string;
  ext: 'xlsx' | 'zip' | 'csv';
  /** The table's sheet name, for a single table. */
  table?: string;
  /** The word the name starts with (fileWord). */
  word?: string | null;
}): string {
  const range = from ? `${from}_${to}` : `all-time_${to}`;
  const parts = [
    withFileWord(word, 'ai-traffic', '-'),
    fileSlug(brand),
    table && fileSlug(table),
    range,
  ];
  return `${parts.filter(Boolean).join('-')}.${ext}`;
}
