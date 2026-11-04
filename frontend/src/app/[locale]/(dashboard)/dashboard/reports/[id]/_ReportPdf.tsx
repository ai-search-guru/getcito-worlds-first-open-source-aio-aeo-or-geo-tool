/**
 * Vector PDF document for a report (@react-pdf/renderer) — replaces the old
 * html2canvas screenshot approach: selectable text, crisp at any zoom, exact
 * layout control, and no oklch/layout-shift issues. Rendered client-side on
 * demand (see the detail page's download handler); everything draws from the
 * immutable saved payload, mirroring the on-screen section order.
 *
 * Inter is embedded from /public/fonts so Turkish characters (ş, ğ, ı…) in
 * brand names and prompt texts render correctly — the built-in Helvetica
 * only covers WinAnsi.
 *
 * With a white label kit in use (00429) it is the agency's: its logo and
 * "Prepared for" the brand with the client's logo on top, its color, its
 * footer line and its name as the author. Without one, GetCito's as before.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  Svg,
  Path,
  Polyline,
  Line,
  Image,
} from '@react-pdf/renderer';
import type { Report, ReportPromptPerf } from '@/lib/actions/reports';
import { formatDate } from '@/lib/format';
import { reportLook, type ReportBranding } from '@/lib/white-label/kit';

Font.register({
  family: 'Inter',
  fonts: [
    { src: '/fonts/Inter-Regular.ttf', fontWeight: 400 },
    { src: '/fonts/Inter-Bold.ttf', fontWeight: 700 },
  ],
});
// Word-splitting hyphenation looks broken in tables; wrap whole words only.
Font.registerHyphenationCallback((word) => [word]);

const SLATE = '#94a3b8';
const TEXT = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const GREEN = '#059669';
const RED = '#dc2626';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Inter',
    fontSize: 9,
    color: TEXT,
    paddingTop: 40,
    paddingHorizontal: 40,
    paddingBottom: 56,
  },
  title: { fontSize: 16, fontWeight: 700 },
  subtitle: { fontSize: 9, color: MUTED, marginTop: 4 },
  rule: { height: 2, marginTop: 10, marginBottom: 16 },
  coverRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  coverLogo: { height: 28, maxWidth: 160, objectFit: 'contain' },
  coverCompany: { fontSize: 11, fontWeight: 700 },
  preparedFor: { fontSize: 10, marginTop: 4 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: 700, marginBottom: 6 },
  paragraph: { fontSize: 9, lineHeight: 1.5, color: TEXT },
  kpiRow: { flexDirection: 'row', gap: 8 },
  kpiBox: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: BORDER,
    borderRadius: 4,
    padding: 8,
  },
  kpiLabel: { fontSize: 7, color: MUTED, textTransform: 'uppercase', marginBottom: 3 },
  kpiValueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  kpiValue: { fontSize: 14, fontWeight: 700 },
  kpiSub: { fontSize: 7, color: MUTED, marginTop: 2 },
  delta: { fontSize: 8, marginBottom: 1 },
  axisLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  axisLabel: { fontSize: 7, color: MUTED },
  legendRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSwatch: { width: 8, height: 3, borderRadius: 1 },
  legendText: { fontSize: 7, color: MUTED },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  barLabel: { width: 110, fontSize: 8, paddingRight: 6 },
  barTrack: {
    flex: 1,
    height: 5,
    backgroundColor: '#f3f4f6',
    borderRadius: 2.5,
    overflow: 'hidden',
  },
  barFill: { height: 5, borderRadius: 2.5 },
  barValue: { width: 40, fontSize: 8, textAlign: 'right' },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingBottom: 4,
    marginBottom: 2,
  },
  tableHeaderCell: { fontSize: 7, fontWeight: 700, color: MUTED, textTransform: 'uppercase' },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    paddingVertical: 4,
    alignItems: 'center',
  },
  cell: { fontSize: 8 },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
    paddingTop: 6,
  },
  footerText: { fontSize: 7, color: MUTED },
});

function DeltaText({ value, zeroBaseCount }: { value: number | null; zeroBaseCount?: number }) {
  if (zeroBaseCount !== undefined) {
    return <Text style={[styles.delta, { color: GREEN }]}>+{zeroBaseCount} new</Text>;
  }
  if (value === null) return null;
  const up = value >= 0;
  return (
    <Text style={[styles.delta, { color: up ? GREEN : RED }]}>
      {up ? '+' : ''}
      {value}%
    </Text>
  );
}

/** Simple area/line chart drawn with react-pdf SVG primitives. */
function TrendSvg({
  data,
  width,
  height,
  color,
}: {
  data: { date: string; score: number; competitors: number | null }[];
  width: number;
  height: number;
  color: string;
}) {
  const scores = data.flatMap((d) => [d.score, ...(d.competitors !== null ? [d.competitors] : [])]);
  const yMax = Math.max(...scores, 1) * 1.25;
  const x = (i: number) => (i * width) / Math.max(data.length - 1, 1);
  const y = (v: number) => height - (v / yMax) * height;

  const brandPoints = data.map((d, i) => `${x(i)},${y(d.score)}`).join(' ');
  const areaPath = `M0,${height} L${data
    .map((d, i) => `${x(i)},${y(d.score)}`)
    .join(' L')} L${width},${height} Z`;
  const hasCompetitors = data.some((d) => d.competitors !== null);
  const compPoints = hasCompetitors
    ? data.map((d, i) => `${x(i)},${y(d.competitors ?? 0)}`).join(' ')
    : '';

  return (
    <Svg width={width} height={height}>
      {[0.25, 0.5, 0.75].map((f) => (
        <Line
          key={f}
          x1={0}
          y1={height * f}
          x2={width}
          y2={height * f}
          stroke={BORDER}
          strokeWidth={0.5}
        />
      ))}
      <Path d={areaPath} fill={color} fillOpacity={0.12} />
      <Polyline points={brandPoints} fill="none" stroke={color} strokeWidth={1.5} />
      {hasCompetitors && (
        <Polyline
          points={compPoints}
          fill="none"
          stroke={SLATE}
          strokeWidth={1.2}
          strokeDasharray="3 2"
        />
      )}
      <Line x1={0} y1={height} x2={width} y2={height} stroke={BORDER} strokeWidth={1} />
    </Svg>
  );
}

function HBar({
  label,
  pct,
  value,
  color,
}: {
  label: string;
  pct: number;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${Math.min(Math.max(pct, 0), 100)}%`, backgroundColor: color },
          ]}
        />
      </View>
      <Text style={styles.barValue}>{value}</Text>
    </View>
  );
}

function PromptTable({ title, prompts }: { title: string; prompts: ReportPromptPerf[] }) {
  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Prompt</Text>
        <Text style={[styles.tableHeaderCell, { width: 60, textAlign: 'right' }]}>Visibility</Text>
        <Text style={[styles.tableHeaderCell, { width: 40, textAlign: 'right' }]}>Runs</Text>
      </View>
      {prompts.map((p) => (
        <View key={p.text} style={styles.tableRow}>
          <Text style={[styles.cell, { flex: 1, paddingRight: 8 }]}>{p.text}</Text>
          <Text style={[styles.cell, { width: 60, textAlign: 'right' }]}>
            {typeof p.score === 'number'
              ? p.score
              : typeof p.visibilityRate === 'number'
                ? `${p.visibilityRate}%`
                : `${p.avgVisibility}/100`}
          </Text>
          <Text style={[styles.cell, { width: 40, textAlign: 'right', color: MUTED }]}>
            {p.runs}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function ReportPdfDocument({
  report,
  branding = null,
}: {
  report: Report;
  /** The kit in use, its logos as PNG or JPEG; null for GetCito's look. */
  branding?: ReportBranding | null;
}) {
  const { payload } = report;
  const look = reportLook(branding);
  // Every metric field is optional — templates only gather their own
  // sections, so each block below guards on its payload field.
  const maxSov = Math.max(...(payload.shareOfVoice?.byPlatform.map((p) => p.sov) ?? []), 1);
  const trend = payload.visibilityTrend ?? [];
  const hasCompetitorTrend = trend.some((d) => d.competitors !== null);
  // Reports generated before #492 have no `visibilityRate` — fall back to
  // the old score-only KPI box so those snapshots keep rendering unchanged.
  const kpiEntries: {
    label: string;
    value: string;
    change: number | null;
    zeroBaseCount?: number;
    sub?: string;
  }[] = payload.insights
    ? [
        ...(payload.visibilityRate
          ? [
              {
                label: 'Visibility',
                value:
                  typeof payload.visibilityRate.score === 'number'
                    ? String(payload.visibilityRate.score)
                    : `${payload.visibilityRate.ratePct}%`,
                change: null,
                sub: `${payload.visibilityRate.visiblePrompts}/${payload.visibilityRate.promptCount} prompts`,
              },
              {
                label: 'Avg. Score',
                value: `${payload.insights.avgVisibilityScore}%`,
                change: payload.insights.visibilityChange,
              },
            ]
          : [
              {
                label: 'Visibility',
                value: `${payload.insights.avgVisibilityScore}%`,
                change: payload.insights.visibilityChange,
              },
            ]),
        {
          label: 'Mentions',
          value: String(payload.insights.totalMentions),
          change: payload.insights.mentionsChange,
          zeroBaseCount:
            Object.hasOwn(payload.insights, 'prevMentions') &&
            payload.insights.prevMentions === 0 &&
            payload.insights.totalMentions > 0
              ? payload.insights.totalMentions
              : undefined,
        },
        {
          label: 'Brand Citations',
          value: String(payload.insights.totalCitations),
          change: payload.insights.citationsChange,
          zeroBaseCount:
            Object.hasOwn(payload.insights, 'prevCitations') &&
            payload.insights.prevCitations === 0 &&
            payload.insights.totalCitations > 0
              ? payload.insights.totalCitations
              : undefined,
        },
        {
          label: 'Positive Sentiment',
          value: `${payload.insights.positiveSentimentPct}%`,
          change: payload.insights.sentimentChange,
        },
      ]
    : [];
  // Reports generated before #492 stored competitor entries without these
  // fields even though the type now declares them required — check at
  // runtime rather than trusting the type for immutable, pre-existing data.
  const hasCompetitorVisibilityRate = Boolean(
    payload.competitors?.length &&
    typeof payload.competitors[0].visibilityRate === 'number' &&
    typeof payload.competitors[0].promptCount === 'number',
  );

  return (
    <Document title={report.title} author={look.author} creator={look.author}>
      <Page size="A4" style={styles.page}>
        {/* The kit's cover: the agency, and the client it is prepared for. */}
        {branding && (
          <View style={styles.coverRow}>
            {branding.logo ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- a PDF image has no alt text
              <Image src={branding.logo} style={styles.coverLogo} />
            ) : (
              <Text style={styles.coverCompany}>{branding.companyName ?? ''}</Text>
            )}
            {branding.clientLogo && (
              // eslint-disable-next-line jsx-a11y/alt-text -- a PDF image has no alt text
              <Image src={branding.clientLogo} style={styles.coverLogo} />
            )}
          </View>
        )}

        {/* Header */}
        <Text style={styles.title}>{report.title}</Text>
        {branding && (
          <Text style={[styles.preparedFor, { color: look.textAccent }]}>
            Prepared for {payload.brandName}
          </Text>
        )}
        <Text style={styles.subtitle}>
          {payload.brandName} · {formatDate(report.dateFrom)} — {formatDate(report.dateTo)} ·
          Generated on {formatDate(report.createdAt)}
        </Text>
        <View style={[styles.rule, { backgroundColor: look.accent }]} />

        {/* Executive summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Executive Summary</Text>
          <Text style={styles.paragraph}>{payload.summaryText}</Text>
        </View>

        {/* KPI row */}
        {payload.insights && (
          <View style={[styles.section, styles.kpiRow]} wrap={false}>
            {kpiEntries.map((entry) => (
              <View key={entry.label} style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>{entry.label}</Text>
                <View style={styles.kpiValueRow}>
                  <Text style={styles.kpiValue}>{entry.value}</Text>
                  <DeltaText value={entry.change} zeroBaseCount={entry.zeroBaseCount} />
                </View>
                {entry.sub && <Text style={styles.kpiSub}>{entry.sub}</Text>}
              </View>
            ))}
          </View>
        )}
        {payload.insights && (
          <Text style={{ fontSize: 7, color: MUTED, marginTop: -8, marginBottom: 12 }}>
            &quot;Brand Citations&quot; counts citations of your own site in AI answers.
          </Text>
        )}

        {/* Visibility trend */}
        {trend.length > 1 && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Visibility Trend</Text>
            <TrendSvg data={trend} width={515} height={110} color={look.accent} />
            <View style={styles.axisLabelRow}>
              <Text style={styles.axisLabel}>{trend[0].date}</Text>
              <Text style={styles.axisLabel}>{trend[trend.length - 1].date}</Text>
            </View>
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: look.accent }]} />
                <Text style={styles.legendText}>Your Brand</Text>
              </View>
              {hasCompetitorTrend && (
                <View style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: SLATE }]} />
                  <Text style={styles.legendText}>Avg. Competitor</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Share of Voice */}
        {payload.shareOfVoice && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>
              Share of Voice — {payload.shareOfVoice.overallSov}%
            </Text>
            {payload.shareOfVoice.byPlatform.map((p) => (
              <HBar
                key={p.provider}
                label={p.provider}
                pct={(p.sov / maxSov) * 100}
                value={`${p.sov}%`}
                color={look.accent}
              />
            ))}
          </View>
        )}

        {/* Competitor leaderboard */}
        {payload.competitors && payload.competitors.length > 0 && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Competitor Leaderboard</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Brand</Text>
              <Text style={[styles.tableHeaderCell, { width: 60, textAlign: 'right' }]}>
                Visibility
              </Text>
              <Text style={[styles.tableHeaderCell, { width: 50, textAlign: 'right' }]}>
                Change
              </Text>
              <Text style={[styles.tableHeaderCell, { width: 55, textAlign: 'right' }]}>
                Mentions
              </Text>
              <Text style={[styles.tableHeaderCell, { width: 55, textAlign: 'right' }]}>
                Citations
              </Text>
            </View>
            {payload.competitors.map((c) => (
              <View key={c.name} style={styles.tableRow}>
                <Text
                  style={[
                    styles.cell,
                    { flex: 1, paddingRight: 8 },
                    c.isOwnBrand ? { fontWeight: 700, color: look.textAccent } : {},
                  ]}
                >
                  {c.name}
                  {c.isOwnBrand ? ' (you)' : ''}
                </Text>
                <View style={{ width: 60, alignItems: 'flex-end' }}>
                  <Text style={styles.cell}>
                    {typeof c.score === 'number'
                      ? c.score
                      : `${hasCompetitorVisibilityRate ? c.visibilityRate : c.avgVisibilityScore}%`}
                  </Text>
                  {hasCompetitorVisibilityRate && (
                    <Text style={styles.kpiSub}>
                      {c.visiblePrompts}/{c.promptCount} prompts
                    </Text>
                  )}
                </View>
                <View style={{ width: 50, alignItems: 'flex-end' }}>
                  <DeltaText value={c.change} />
                </View>
                <Text style={[styles.cell, { width: 55, textAlign: 'right' }]}>
                  {c.totalMentions}
                </Text>
                <Text style={[styles.cell, { width: 55, textAlign: 'right' }]}>
                  {c.totalCitations}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Topic performance */}
        {payload.topicPerformance && payload.topicPerformance.length > 0 && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Topic Performance</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Topic</Text>
              <Text style={[styles.tableHeaderCell, { width: 60, textAlign: 'right' }]}>
                Visibility
              </Text>
              <Text style={[styles.tableHeaderCell, { width: 50, textAlign: 'right' }]}>
                Change
              </Text>
              <Text style={[styles.tableHeaderCell, { width: 50, textAlign: 'right' }]}>
                Results
              </Text>
            </View>
            {payload.topicPerformance.map((tp) => (
              <View key={tp.name} style={styles.tableRow}>
                <Text style={[styles.cell, { flex: 1, paddingRight: 8 }]}>{tp.name}</Text>
                <Text style={[styles.cell, { width: 60, textAlign: 'right' }]}>
                  {typeof tp.score === 'number'
                    ? tp.score
                    : typeof tp.visibilityRate === 'number'
                      ? `${tp.visibilityRate}%`
                      : `${tp.avgVisibility}/100`}
                </Text>
                <View style={{ width: 50, alignItems: 'flex-end' }}>
                  <DeltaText value={tp.change} />
                </View>
                <Text style={[styles.cell, { width: 50, textAlign: 'right', color: MUTED }]}>
                  {tp.results}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Best / worst prompts */}
        {payload.promptPerformance && payload.promptPerformance.best.length > 0 && (
          <PromptTable title="Best Performing Prompts" prompts={payload.promptPerformance.best} />
        )}
        {payload.promptPerformance && payload.promptPerformance.worst.length > 0 && (
          <PromptTable title="Weakest Prompts" prompts={payload.promptPerformance.worst} />
        )}

        {/* Mention evidence (#429) — which answers mentioned the brand, and how */}
        {payload.mentionEvidence && payload.mentionEvidence.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Mention Evidence</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, { width: 130 }]}>Prompt</Text>
              <Text style={[styles.tableHeaderCell, { width: 60 }]}>Platform</Text>
              <Text style={[styles.tableHeaderCell, { width: 50 }]}>Date</Text>
              <Text style={[styles.tableHeaderCell, { flex: 1 }]}>How you were mentioned</Text>
            </View>
            {payload.mentionEvidence.map((m, idx) => (
              <View key={`${m.promptText}-${idx}`} style={styles.tableRow}>
                <Text style={[styles.cell, { width: 130, paddingRight: 6 }]}>{m.promptText}</Text>
                <Text style={[styles.cell, { width: 60, color: MUTED }]}>{m.platform}</Text>
                <Text style={[styles.cell, { width: 50, color: MUTED }]}>{formatDate(m.date)}</Text>
                <Text style={[styles.cell, { flex: 1, color: MUTED }]}>{m.excerpt}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Query fan-out */}
        {payload.queryFanout && payload.queryFanout.length > 0 && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Query Fan-out</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Query</Text>
              <Text style={[styles.tableHeaderCell, { width: 150 }]}>Engines</Text>
              <Text style={[styles.tableHeaderCell, { width: 60, textAlign: 'right' }]}>
                Searched
              </Text>
            </View>
            {payload.queryFanout.map((q) => (
              <View key={q.query} style={styles.tableRow}>
                <Text style={[styles.cell, { flex: 1, paddingRight: 8 }]}>{q.query}</Text>
                <Text style={[styles.cell, { width: 150, color: MUTED }]}>
                  {q.engines.join(', ')}
                </Text>
                <Text style={[styles.cell, { width: 60, textAlign: 'right' }]}>
                  {q.timesSearched}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* AI traffic */}
        {payload.aiTraffic && (
          <View style={styles.section} wrap={false}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
              <Text style={styles.sectionTitle}>
                AI Traffic — {payload.aiTraffic.totalVisits} visits
              </Text>
              <View style={{ marginBottom: 6 }}>
                <DeltaText value={payload.aiTraffic.change} />
                {/* No % on a handful of visits, as on the AI Traffic page. */}
                {payload.aiTraffic.changeNote === 'new' && (
                  <Text style={[styles.delta, { color: GREEN }]}>new</Text>
                )}
                {payload.aiTraffic.changeNote === 'lowSample' && (
                  <Text style={[styles.delta, { color: MUTED }]}>Low sample</Text>
                )}
              </View>
            </View>
            {payload.aiTraffic.platformBreakdown.map((p) => (
              <View key={p.platform} style={styles.tableRow}>
                <Text style={[styles.cell, { flex: 1 }]}>{p.platform}</Text>
                <Text style={[styles.cell, { width: 60, textAlign: 'right' }]}>{p.visits}</Text>
              </View>
            ))}
            {payload.aiTraffic.topPages.length > 0 && (
              <View style={{ marginTop: 6 }}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Top Page</Text>
                  <Text style={[styles.tableHeaderCell, { width: 60, textAlign: 'right' }]}>
                    Visits
                  </Text>
                </View>
                {payload.aiTraffic.topPages.map((p) => (
                  <View key={p.url} style={styles.tableRow}>
                    <Text style={[styles.cell, { flex: 1, paddingRight: 8 }]}>{p.url}</Text>
                    <Text style={[styles.cell, { width: 60, textAlign: 'right' }]}>{p.visits}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Product Visibility */}
        {payload.shoppingVisibility && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Product Visibility</Text>
            <View style={styles.kpiRow}>
              <View style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>Product SoV</Text>
                <View style={styles.kpiValueRow}>
                  <Text style={styles.kpiValue}>{payload.shoppingVisibility.shoppingSovPct}%</Text>
                  <DeltaText value={payload.shoppingVisibility.sovChange} />
                </View>
              </View>
              <View style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>Products Surfaced</Text>
                <Text style={styles.kpiValue}>{payload.shoppingVisibility.productsSurfaced}</Text>
              </View>
              <View style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>Card Rate</Text>
                <Text style={styles.kpiValue}>{payload.shoppingVisibility.cardRatePct}%</Text>
              </View>
              <View style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>Top Merchant</Text>
                <Text style={[styles.cell, { fontWeight: 700 }]}>
                  {payload.shoppingVisibility.topMerchant ?? '—'}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Site audit score */}
        {payload.auditScore && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Site Audit Score</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <Text style={{ fontSize: 18, fontWeight: 700 }}>
                {payload.auditScore.totalScore ?? '—'}
              </Text>
              {payload.auditScore.totalScore !== null &&
                payload.auditScore.previousScore !== null && (
                  <View style={{ marginBottom: 2 }}>
                    <DeltaText
                      value={
                        Math.round(
                          (payload.auditScore.totalScore - payload.auditScore.previousScore) * 10,
                        ) / 10
                      }
                    />
                  </View>
                )}
              <Text style={[styles.cell, { color: MUTED, marginBottom: 2 }]}>
                {payload.auditScore.url} · audited {formatDate(payload.auditScore.auditedAt)}
              </Text>
            </View>
          </View>
        )}

        {/* Citations */}
        {payload.citations && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>
              Top Citation Sources — {payload.citations.totals.domains} domains ·{' '}
              {payload.citations.totals.citations} citations
            </Text>
            {payload.citations.topDomains.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Domain</Text>
                  <Text style={[styles.tableHeaderCell, { width: 80 }]}>Source Type</Text>
                  <Text style={[styles.tableHeaderCell, { width: 60, textAlign: 'right' }]}>
                    Citations
                  </Text>
                  <Text style={[styles.tableHeaderCell, { width: 50, textAlign: 'right' }]}>
                    Usage
                  </Text>
                </View>
                {payload.citations.topDomains.map((d) => (
                  <View key={d.domain} style={styles.tableRow}>
                    <Text style={[styles.cell, { flex: 1, paddingRight: 8 }]}>{d.domain}</Text>
                    <Text style={[styles.cell, { width: 80, color: MUTED }]}>{d.category}</Text>
                    <Text style={[styles.cell, { width: 60, textAlign: 'right' }]}>
                      {d.totalCitations}
                    </Text>
                    <Text style={[styles.cell, { width: 50, textAlign: 'right' }]}>
                      {d.usagePct}%
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Citation evidence (#429) — the exact URLs and the prompts that surfaced them */}
        {payload.citationEvidence && payload.citationEvidence.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Citation Evidence</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, { flex: 1 }]}>URL</Text>
              <Text style={[styles.tableHeaderCell, { width: 55, textAlign: 'right' }]}>
                Citations
              </Text>
              <Text style={[styles.tableHeaderCell, { width: 170 }]}>Cited in</Text>
            </View>
            {payload.citationEvidence.map((c) => (
              <View key={c.url} style={styles.tableRow}>
                <View style={{ flex: 1, paddingRight: 6 }}>
                  <Text style={styles.cell}>{c.title || c.url}</Text>
                  <Text style={[styles.cell, { color: MUTED, fontSize: 7 }]}>{c.url}</Text>
                </View>
                <Text style={[styles.cell, { width: 55, textAlign: 'right' }]}>
                  {c.totalCitations}
                </Text>
                <Text style={[styles.cell, { width: 170, color: MUTED, fontSize: 7 }]}>
                  {c.sourcedPrompts.join(' · ')}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          {/* GetCito's line, the kit's own, or none. */}
          <Text style={styles.footerText}>{look.footer ?? ''}</Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
