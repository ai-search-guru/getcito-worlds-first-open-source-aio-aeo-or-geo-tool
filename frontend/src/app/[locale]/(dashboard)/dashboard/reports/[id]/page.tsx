'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';

// Reuse the insights page's Recharts trend chart (same VisibilityTrendPoint
// shape the report payload stores), loaded client-only like insights does.
const TrendChart = dynamic(() => import('../../insights/_charts').then((m) => m.TrendChart), {
  ssr: false,
  loading: () => <Skeleton className="h-48 w-full" />,
});
import { toast } from 'sonner';
import { getReport, type Report } from '@/lib/actions/reports';
import { getReportBranding } from '@/lib/actions/whiteLabel';
import { reportFileName, reportLook, type ReportBranding } from '@/lib/white-label/kit';
import { pdfImage } from '@/lib/white-label/pdfImage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, FileDown, Loader2, RotateCw } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PLATFORM_LABELS } from '@/config/platformLabels';
import { REPORT_TEMPLATES } from '@/lib/reports/templates';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

const KNOWN_TEMPLATE_IDS = new Set<string>(REPORT_TEMPLATES.map((tpl) => tpl.id));

const BRANDING_FAILED = { ok: false, failure: 'failed' } as const;

/** Signed percentage delta, or an explicit raw count for a new zero-base metric. */
function Delta({ value, zeroBaseCount }: { value: number | null; zeroBaseCount?: number }) {
  if (zeroBaseCount !== undefined) {
    return <span className="text-xs font-medium text-emerald-600">+{zeroBaseCount} new</span>;
  }
  if (value === null) return null;
  const up = value >= 0;
  return (
    <span className={cn('text-xs font-medium', up ? 'text-emerald-600' : 'text-red-600')}>
      {up ? '+' : ''}
      {value}%
    </span>
  );
}

function KpiCard({
  label,
  value,
  change,
  zeroBaseCount,
  sub,
}: {
  label: string;
  value: string;
  change: number | null;
  zeroBaseCount?: number;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-bold">{value}</span>
          <Delta value={change} zeroBaseCount={zeroBaseCount} />
        </div>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * The white label kit's cover (00429), as the PDF opens: the agency's logo
 * (or its name), "Prepared for" the brand, the client's logo, and the kit's
 * color under them. The paper is white in both themes, as the PDF is.
 */
function ReportCover({ branding, brandName }: { branding: ReportBranding; brandName: string }) {
  const t = useTranslations('reports');
  const look = reportLook(branding);
  return (
    <div className="rounded-lg border bg-white p-5 text-zinc-900 shadow-sm">
      <div className="flex min-h-10 items-center justify-between gap-4">
        {branding.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- the logo itself, as a data URL
          <img
            src={branding.logo}
            alt={branding.companyName ?? ''}
            className="max-h-10 max-w-48 object-contain"
          />
        ) : (
          <span className="font-semibold">{branding.companyName}</span>
        )}
        {branding.clientLogo && (
          // eslint-disable-next-line @next/next/no-img-element -- the logo itself, as a data URL
          <img
            src={branding.clientLogo}
            alt={brandName}
            className="max-h-10 max-w-48 object-contain"
          />
        )}
      </div>
      <p className="mt-3 text-sm font-medium" style={{ color: look.textAccent }}>
        {t('preparedFor', { brand: brandName })}
      </p>
      <div className="mt-3 h-0.5" style={{ backgroundColor: look.accent }} />
    </div>
  );
}

export default function ReportDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const t = useTranslations('reports');
  const tCommon = useTranslations('common');

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  // The white label kit the report is shown and downloaded with (null: none);
  // undefined until it is read, or when it couldn't be.
  const [branding, setBranding] = useState<ReportBranding | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setBranding(undefined);
    getReport(id)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        if (!r) return;
        void getReportBranding(r.brandId)
          .catch(() => BRANDING_FAILED)
          .then((read) => {
            if (!cancelled && read.ok) setBranding(read.branding);
          });
      })
      .catch((err) => {
        console.error('Failed to load report:', err);
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // A failed load is not a missing report: offer a retry instead of
  // reporting it as not found.
  if (loadFailed) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-sm text-muted-foreground">{t('loadReportFailed')}</p>
        <Button variant="outline" className="gap-2" onClick={() => setAttempt((n) => n + 1)}>
          <RotateCw className="h-4 w-4" />
          {tCommon('retry')}
        </Button>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-sm text-muted-foreground">{t('notFound')}</p>
        <Link
          href="/dashboard/reports"
          className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backToReports')}
        </Link>
      </div>
    );
  }

  const { payload } = report;
  const maxSov = Math.max(...(payload.shareOfVoice?.byPlatform.map((p) => p.sov) ?? []), 1);
  // Reports generated before #492 stored competitor entries without these
  // fields even though the type now declares them required — check at
  // runtime rather than trusting the type for immutable, pre-existing data.
  const hasCompetitorVisibilityRate = Boolean(
    payload.competitors?.length &&
    typeof payload.competitors[0].visibilityRate === 'number' &&
    typeof payload.competitors[0].promptCount === 'number',
  );
  // Same story for prompt/topic performance: reports generated before the
  // rate switch stored an all-runs average score, which is 0-100 intensity —
  // not a percentage — so those payloads keep their old (unsuffixed) cells.
  const hasPromptVisibilityRate = Boolean(
    payload.promptPerformance &&
    [...payload.promptPerformance.best, ...payload.promptPerformance.worst].some(
      (p) => typeof p.visibilityRate === 'number',
    ),
  );
  const hasTopicVisibilityRate = Boolean(
    payload.topicPerformance?.some((tp) => typeof tp.visibilityRate === 'number'),
  );

  // Render a true vector PDF from the saved payload with @react-pdf/renderer
  // (selectable text, exact layout — no screenshot artifacts). The renderer
  // and the document component both load on demand: PDF export is rare and
  // the library is heavy.
  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      // A kit that couldn't be read is read again: a PDF in GetCito's look
      // must not go to an agency's client by mistake.
      let kit = branding;
      if (kit === undefined) {
        const read = await getReportBranding(report.brandId).catch(() => BRANDING_FAILED);
        if (!read.ok) {
          toast.error(t('brandingFailed'));
          return;
        }
        kit = read.branding;
        setBranding(kit);
      }
      const [{ pdf }, { ReportPdfDocument }, logo, clientLogo] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./_ReportPdf'),
        pdfImage(kit?.logo ?? null),
        pdfImage(kit?.clientLogo ?? null),
      ]);
      const blob = await pdf(
        <ReportPdfDocument report={report} branding={kit && { ...kit, logo, clientLogo }} />,
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = reportFileName(kit, payload.brandName, report.dateTo);
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF download error:', err);
      toast.error(t('downloadFailed'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Link
              href="/dashboard/reports"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('backToReports')}
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">{report.title}</h1>
            <p className="text-sm text-muted-foreground">
              {KNOWN_TEMPLATE_IDS.has(report.template) &&
                t.has(`templates.${report.template}.name`) && (
                  <>{t(`templates.${report.template}.name`)} · </>
                )}
              {formatDate(report.dateFrom)} — {formatDate(report.dateTo)} · {t('generatedOn')}{' '}
              {formatDate(report.createdAt)}
            </p>
          </div>
          <Button onClick={handleDownloadPdf} disabled={downloading} className="gap-2">
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            {t('downloadPDF')}
          </Button>
        </div>
      </HeaderWithAiUsage>

      {/* Everything below renders from the immutable saved payload; the
          container id is the future PDF capture root. */}
      <div id="report-root" className="space-y-6">
        {branding && <ReportCover branding={branding} brandName={payload.brandName} />}

        {/* A section that could not be gathered is named here rather than
            silently absent — otherwise the report reads as though the brand
            had no data for it. */}
        {payload.missingSections && payload.missingSections.length > 0 && (
          <Card className="border-amber-500/40">
            <CardContent className="py-4 text-sm text-muted-foreground">
              {t('missingSections')}{' '}
              <span className="text-foreground">
                {payload.missingSections.map((s) => t(`sections.${s}`)).join(', ')}
              </span>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('executiveSummary')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {payload.summaryText}
            </p>
          </CardContent>
        </Card>

        {/* Every metric section guards on its payload field: templates only
            gather their own sections, and older (immutable) reports may
            predate a field entirely. */}
        {payload.insights && (
          <div
            className={cn(
              'grid gap-4',
              payload.visibilityRate
                ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-5'
                : 'sm:grid-cols-2 lg:grid-cols-4',
            )}
          >
            {payload.visibilityRate ? (
              <>
                <KpiCard
                  label={t('kpi.visibilityRate')}
                  value={
                    typeof payload.visibilityRate.score === 'number'
                      ? String(payload.visibilityRate.score)
                      : `${payload.visibilityRate.ratePct}%`
                  }
                  change={null}
                  sub={t('kpi.visibilityRateSub', {
                    visible: payload.visibilityRate.visiblePrompts,
                    total: payload.visibilityRate.promptCount,
                  })}
                />
                <KpiCard
                  label={t('kpi.avgScore')}
                  value={`${payload.insights.avgVisibilityScore}%`}
                  change={payload.insights.visibilityChange}
                />
              </>
            ) : (
              <KpiCard
                label={t('kpi.visibility')}
                value={`${payload.insights.avgVisibilityScore}%`}
                change={payload.insights.visibilityChange}
              />
            )}
            <KpiCard
              label={t('kpi.mentions')}
              value={String(payload.insights.totalMentions)}
              change={payload.insights.mentionsChange}
              zeroBaseCount={
                Object.hasOwn(payload.insights, 'prevMentions') &&
                payload.insights.prevMentions === 0 &&
                payload.insights.totalMentions > 0
                  ? payload.insights.totalMentions
                  : undefined
              }
            />
            <KpiCard
              label={t('kpi.citations')}
              value={String(payload.insights.totalCitations)}
              change={payload.insights.citationsChange}
              zeroBaseCount={
                Object.hasOwn(payload.insights, 'prevCitations') &&
                payload.insights.prevCitations === 0 &&
                payload.insights.totalCitations > 0
                  ? payload.insights.totalCitations
                  : undefined
              }
            />
            <KpiCard
              label={t('kpi.sentiment')}
              value={`${payload.insights.positiveSentimentPct}%`}
              change={payload.insights.sentimentChange}
            />
            <p
              className={cn(
                'text-xs text-muted-foreground',
                payload.visibilityRate
                  ? 'col-span-2 sm:col-span-3 xl:col-span-5'
                  : 'sm:col-span-2 lg:col-span-4',
              )}
            >
              {t('kpiCitationsNote')}
            </p>
          </div>
        )}
        {payload.visibilityTrend && payload.visibilityTrend.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('visibilityTrend')}</CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart data={payload.visibilityTrend} />
            </CardContent>
          </Card>
        )}

        {payload.shareOfVoice && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-baseline gap-2 text-base">
                {t('shareOfVoice')}
                <span className="text-2xl font-bold">{payload.shareOfVoice.overallSov}%</span>
                <Delta value={payload.shareOfVoice.overallSovChange} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {payload.shareOfVoice.byPlatform.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noData')}</p>
              ) : (
                payload.shareOfVoice.byPlatform.map((p) => (
                  <div key={p.provider} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 truncate text-sm">{p.provider}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.min((p.sov / maxSov) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-sm font-medium">{p.sov}%</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}

        {payload.competitors && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('competitorLeaderboard')}</CardTitle>
            </CardHeader>
            <CardContent>
              {payload.competitors.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noData')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('columns.brand')}</TableHead>
                      <TableHead className="text-right">
                        {hasCompetitorVisibilityRate
                          ? t('kpi.visibilityRate')
                          : t('kpi.visibility')}
                      </TableHead>
                      <TableHead className="text-right">{t('columns.change')}</TableHead>
                      <TableHead className="text-right">{t('kpi.mentions')}</TableHead>
                      <TableHead className="text-right">{t('kpi.citations')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payload.competitors.map((c) => (
                      <TableRow key={c.name} className={cn(c.isOwnBrand && 'bg-primary/5')}>
                        <TableCell className={cn('font-medium', c.isOwnBrand && 'text-primary')}>
                          {c.name}
                          {c.isOwnBrand && (
                            <span className="ml-2 text-xs text-muted-foreground">{t('you')}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {typeof c.score === 'number' ? (
                            <>
                              <div>{c.score}</div>
                              <div className="text-xs font-normal text-muted-foreground">
                                {t('kpi.visibilityRateSub', {
                                  visible: c.visiblePrompts,
                                  total: c.promptCount,
                                })}
                              </div>
                            </>
                          ) : hasCompetitorVisibilityRate ? (
                            <>
                              <div>{c.visibilityRate}%</div>
                              <div className="text-xs font-normal text-muted-foreground">
                                {t('kpi.visibilityRateSub', {
                                  visible: c.visiblePrompts,
                                  total: c.promptCount,
                                })}
                              </div>
                            </>
                          ) : (
                            `${c.avgVisibilityScore}%`
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Delta value={c.change} />
                        </TableCell>
                        <TableCell className="text-right">{c.totalMentions}</TableCell>
                        <TableCell className="text-right">{c.totalCitations}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {payload.topicPerformance && payload.topicPerformance.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('topicPerformance')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.topic')}</TableHead>
                    <TableHead className="w-28 text-right">
                      {hasTopicVisibilityRate ? t('kpi.visibilityRate') : t('kpi.visibility')}
                    </TableHead>
                    <TableHead className="w-24 text-right">{t('columns.change')}</TableHead>
                    <TableHead className="w-24 text-right">{t('columns.results')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payload.topicPerformance.map((tp) => (
                    <TableRow key={tp.name}>
                      <TableCell className="max-w-[280px] truncate font-medium">
                        {tp.name}
                      </TableCell>
                      <TableCell className="text-right">
                        {typeof tp.score === 'number'
                          ? tp.score
                          : typeof tp.visibilityRate === 'number'
                            ? `${tp.visibilityRate}%`
                            : `${tp.avgVisibility}/100`}
                      </TableCell>
                      <TableCell className="text-right">
                        <Delta value={tp.change} />
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {tp.results}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {payload.promptPerformance &&
          (payload.promptPerformance.best.length > 0 ||
            payload.promptPerformance.worst.length > 0) && (
            <div className="grid gap-6 lg:grid-cols-2">
              {(
                [
                  ['bestPrompts', payload.promptPerformance.best],
                  ['worstPrompts', payload.promptPerformance.worst],
                ] as const
              ).map(
                ([key, prompts]) =>
                  prompts.length > 0 && (
                    <Card key={key}>
                      <CardHeader>
                        <CardTitle className="text-base">{t(key)}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t('columns.prompt')}</TableHead>
                              <TableHead className="w-24 text-right">
                                {hasPromptVisibilityRate
                                  ? t('kpi.visibilityRate')
                                  : t('kpi.visibility')}
                              </TableHead>
                              <TableHead className="w-16 text-right">{t('columns.runs')}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {prompts.map((p) => (
                              <TableRow key={p.text}>
                                <TableCell className="max-w-[280px] truncate font-medium">
                                  {p.text}
                                </TableCell>
                                <TableCell className="text-right">
                                  {typeof p.score === 'number'
                                    ? p.score
                                    : typeof p.visibilityRate === 'number'
                                      ? `${p.visibilityRate}%`
                                      : `${p.avgVisibility}/100`}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                  {p.runs}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  ),
              )}
            </div>
          )}

        {payload.mentionEvidence && payload.mentionEvidence.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('mentionEvidence')}</CardTitle>
              <p className="text-sm text-muted-foreground">{t('mentionEvidenceDescription')}</p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[220px]">{t('columns.prompt')}</TableHead>
                    <TableHead className="w-28">{t('columns.platform')}</TableHead>
                    <TableHead className="w-24">{t('columns.date')}</TableHead>
                    <TableHead>{t('columns.excerpt')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payload.mentionEvidence.map((m, idx) => (
                    <TableRow key={`${m.promptText}-${idx}`}>
                      <TableCell className="max-w-[220px] truncate font-medium">
                        {m.promptText}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {PLATFORM_LABELS[m.platform] ?? m.platform}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(m.date)}</TableCell>
                      <TableCell className="whitespace-normal text-sm text-muted-foreground">
                        {m.excerpt}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {payload.queryFanout && payload.queryFanout.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('queryFanout')}</CardTitle>
              <p className="text-sm text-muted-foreground">{t('queryFanoutDescription')}</p>
            </CardHeader>
            <CardContent>
              {/* The table ranks by repeats of the same string, which favours
                  engines that reuse their phrasing. Without this an engine that
                  searches the most but rephrases every time reads as one that
                  does not fan out at all. */}
              {payload.queryFanoutEngines && payload.queryFanoutEngines.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                  {payload.queryFanoutEngines.map((e) => (
                    <span key={e.engine}>
                      <span className="text-foreground">
                        {PLATFORM_LABELS[e.engine] ?? e.engine}
                      </span>{' '}
                      {t('fanoutCoverage', {
                        queries: e.distinctQueries,
                        answers: e.answersWithFanout,
                      })}
                    </span>
                  ))}
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.query')}</TableHead>
                    <TableHead>{t('columns.engines')}</TableHead>
                    <TableHead className="w-32 text-right">{t('columns.timesSearched')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payload.queryFanout.map((q) => (
                    <TableRow key={q.query}>
                      <TableCell className="max-w-[320px] truncate font-medium">
                        {q.query}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {q.engines.map((e) => PLATFORM_LABELS[e] ?? e).join(', ')}
                      </TableCell>
                      <TableCell className="text-right">{q.timesSearched}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {payload.aiTraffic && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-baseline gap-2 text-base">
                {t('aiTraffic')}
                <span className="text-2xl font-bold">{payload.aiTraffic.totalVisits}</span>
                <Delta value={payload.aiTraffic.change} />
                {/* No % on a handful of visits, as on the AI Traffic page. */}
                {payload.aiTraffic.changeNote === 'new' && (
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    {t('aiTrafficNew')}
                  </span>
                )}
                {payload.aiTraffic.changeNote === 'lowSample' && (
                  <span
                    className="text-xs font-medium text-muted-foreground"
                    title={t('aiTrafficLowSampleHint')}
                  >
                    {t('aiTrafficLowSample')}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t('columns.platform')}
                </p>
                {payload.aiTraffic.platformBreakdown.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noData')}</p>
                ) : (
                  payload.aiTraffic.platformBreakdown.map((p) => (
                    <div key={p.platform} className="flex items-center justify-between text-sm">
                      <span className="truncate">{PLATFORM_LABELS[p.platform] ?? p.platform}</span>
                      <span className="font-medium tabular-nums">{p.visits}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t('columns.topPages')}
                </p>
                {payload.aiTraffic.topPages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noData')}</p>
                ) : (
                  payload.aiTraffic.topPages.map((p) => (
                    <div key={p.url} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-muted-foreground">{p.url}</span>
                      <span className="shrink-0 font-medium tabular-nums">{p.visits}</span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {payload.shoppingVisibility && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('shoppingVisibility')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t('shopping.sov')}
                </p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold">
                    {payload.shoppingVisibility.shoppingSovPct}%
                  </span>
                  <Delta value={payload.shoppingVisibility.sovChange} />
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t('shopping.products')}
                </p>
                <p className="mt-1 text-2xl font-bold">
                  {payload.shoppingVisibility.productsSurfaced}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t('shopping.cardRate')}
                </p>
                <p className="mt-1 text-2xl font-bold">{payload.shoppingVisibility.cardRatePct}%</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t('shopping.topMerchant')}
                </p>
                <p className="mt-1 truncate text-sm font-medium">
                  {payload.shoppingVisibility.topMerchant ?? '—'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {payload.auditScore && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('auditScore')}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-6">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold">{payload.auditScore.totalScore ?? '—'}</span>
                {payload.auditScore.totalScore !== null &&
                  payload.auditScore.previousScore !== null && (
                    <Delta
                      value={
                        Math.round(
                          (payload.auditScore.totalScore - payload.auditScore.previousScore) * 10,
                        ) / 10
                      }
                    />
                  )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{payload.auditScore.url}</p>
                <p className="text-xs text-muted-foreground">
                  {t('auditedOn')} {formatDate(payload.auditScore.auditedAt)}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {payload.citations && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('topCitationSources')}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t('citationTotals', {
                  domains: payload.citations.totals.domains,
                  citations: payload.citations.totals.citations,
                })}{' '}
                {t('citationsSectionNote')}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {payload.citations.topDomains.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noData')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('columns.domain')}</TableHead>
                      <TableHead>{t('columns.sourceType')}</TableHead>
                      <TableHead className="text-right">{t('columns.citations')}</TableHead>
                      <TableHead className="text-right">{t('columns.usage')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payload.citations.topDomains.map((d) => (
                      <TableRow key={d.domain}>
                        <TableCell className="font-medium">{d.domain}</TableCell>
                        <TableCell className="capitalize text-muted-foreground">
                          {d.category}
                        </TableCell>
                        <TableCell className="text-right">{d.totalCitations}</TableCell>
                        <TableCell className="text-right">{d.usagePct}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {payload.citationEvidence && payload.citationEvidence.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('citationEvidence')}</CardTitle>
              <p className="text-sm text-muted-foreground">{t('citationEvidenceDescription')}</p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.url')}</TableHead>
                    <TableHead className="w-24 text-right">{t('columns.citations')}</TableHead>
                    <TableHead className="w-[280px]">{t('columns.citedIn')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payload.citationEvidence.map((c) => (
                    <TableRow key={c.url}>
                      <TableCell className="max-w-[320px]">
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate font-medium hover:underline"
                          title={c.title || c.url}
                        >
                          {c.title || c.url}
                        </a>
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.domain}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{c.totalCitations}</TableCell>
                      <TableCell className="whitespace-normal text-xs text-muted-foreground">
                        {c.sourcedPrompts.join(' · ')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
