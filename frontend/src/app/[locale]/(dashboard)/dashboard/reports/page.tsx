'use client';

import { useState, useEffect, useCallback } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useBrandStore } from '@/state/useBrandStore';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { createReport, getReports, deleteReport, type ReportListItem } from '@/lib/actions/reports';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { useChatAgentic } from '@/components/context/ChatAgenticProvider';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Check, FileBarChart, Loader2, Plus, Trash2 } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  REPORT_TEMPLATES,
  ALL_REPORT_SECTIONS,
  type ReportSection,
  type ReportTemplateId,
} from '@/lib/reports/templates';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

type DatePreset = '7d' | '30d' | '90d' | 'custom';

const KNOWN_TEMPLATE_IDS = new Set<string>(REPORT_TEMPLATES.map((tpl) => tpl.id));

/** Resolve a preset into the concrete [from, to] ISO range a report snapshots. */
function getDateRange(preset: DatePreset, custom: { from: string; to: string }) {
  if (preset === 'custom') {
    return {
      dateFrom: custom.from ? `${custom.from}T00:00:00.000Z` : '',
      dateTo: custom.to ? `${custom.to}T23:59:59.999Z` : '',
    };
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
}

export default function ReportsPage() {
  const t = useTranslations('reports');
  const chatAgentic = useChatAgentic();
  const tc = useTranslations('common');
  // A read-only workspace (plan not active): Generate report and Delete open
  // the upgrade dialog instead; reading and downloading reports stay open.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const router = useRouter();
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const brands = useBrandStore((s) => s.brands);

  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);

  const [template, setTemplate] = useState<ReportTemplateId>('executive_summary');
  const [preset, setPreset] = useState<DatePreset>('30d');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [reportTitle, setReportTitle] = useState('');
  // US-1.1: the dialog can generate for any brand, defaulting to the active one.
  const [reportBrandId, setReportBrandId] = useState<string | null>(activeBrandId);
  // US-1.3: templates only pre-select; the user adjusts the module set freely.
  const [sections, setSections] = useState<Set<ReportSection>>(
    () => new Set(REPORT_TEMPLATES.find((tpl) => tpl.id === 'executive_summary')!.sections),
  );

  const reportBrand = brands.find((b) => b.id === (reportBrandId ?? activeBrandId));
  // Shopping is brand-pref-gated: hidden here exactly like the sidebar hides
  // the Shopping nav item (and the server refuses to gather it regardless).
  const pickableSections = ALL_REPORT_SECTIONS.filter(
    (s) => s !== 'shoppingVisibility' || reportBrand?.shoppingModeEnabled,
  );

  const selectTemplate = (id: ReportTemplateId) => {
    setTemplate(id);
    // Templates carry a sensible default window (weekly → 7d) and a default
    // module set; the user can still override both below.
    const def = REPORT_TEMPLATES.find((tpl) => tpl.id === id);
    if (def) {
      setPreset(def.defaultPreset);
      setSections(new Set(def.sections));
    }
  };

  const toggleSection = (s: ReportSection) => {
    setSections((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const openDialog = guard(
    () => {
      setReportBrandId(activeBrandId);
      setDialogOpen(true);
    },
    { action: tActions('generateReports') },
  );

  const load = useCallback(async () => {
    if (!activeBrandId) return;
    setLoading(true);
    try {
      setReports(await getReports(activeBrandId));
    } catch (err) {
      console.error('Failed to load reports:', err);
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [activeBrandId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleGenerate = async () => {
    const targetBrandId = reportBrandId ?? activeBrandId;
    if (!targetBrandId) return;
    const { dateFrom, dateTo } = getDateRange(preset, customRange);
    if (!dateFrom || !dateTo) {
      toast.error(t('selectDates'));
      return;
    }
    if (sections.size === 0) {
      toast.error(t('selectSections'));
      return;
    }
    setGenerating(true);
    try {
      const { id } = await createReport(targetBrandId, {
        dateFrom,
        dateTo,
        title: reportTitle || undefined,
        template,
        sections: pickableSections.filter((s) => sections.has(s)),
      });
      toast.success(t('generated'));
      setDialogOpen(false);
      router.push(`/dashboard/reports/${id}`);
    } catch (err) {
      console.error('Report generation error:', err);
      toast.error(t('generateFailed'));
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteReport(id);
      setReports((prev) => prev.filter((r) => r.id !== id));
      setPendingConfirm(null);
    } catch (err) {
      console.error('Report delete error:', err);
      toast.error(t('deleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-muted-foreground">{t('description')}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* What GetCito did for you (CHAT-22 §2 item 5): kept only with the new Chat on. */}
            {chatAgentic && (
              <Link
                href="/dashboard/reports/impact"
                data-action="reports.openImpact"
                className={buttonVariants({ variant: 'outline' })}
              >
                {t('impactLink')}
              </Link>
            )}
            <Button className="gap-2" onClick={openDialog} disabled={!activeBrandId}>
              <Plus className="h-4 w-4" />
              {t('generateReport')}
            </Button>
          </div>
        </div>
      </HeaderWithAiUsage>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('libraryTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {tc('loading')}
            </div>
          ) : reports.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <FileBarChart className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t('emptyLibrary')}</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.title')}</TableHead>
                    <TableHead>{t('columns.period')}</TableHead>
                    <TableHead>{t('columns.created')}</TableHead>
                    <TableHead className="w-[140px] text-right">{t('columns.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell>
                        <span className="font-medium">{report.title}</span>
                        {KNOWN_TEMPLATE_IDS.has(report.template) &&
                          t.has(`templates.${report.template}.name`) && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {t(`templates.${report.template}.name`)}
                            </span>
                          )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(report.dateFrom)} — {formatDate(report.dateTo)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(report.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => router.push(`/dashboard/reports/${report.id}`)}
                          >
                            {tc('view')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={deletingId === report.id}
                            onClick={guard(() => setPendingConfirm(report.id), {
                              action: tActions('deleteReports'),
                            })}
                          >
                            {deletingId === report.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Dialog
                open={pendingConfirm !== null}
                onOpenChange={(v) => !v && setPendingConfirm(null)}
              >
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>{t('deleteTitle')}</DialogTitle>
                    <DialogDescription>{t('deleteConfirm')}</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose render={<Button variant="outline" />}>{tc('cancel')}</DialogClose>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={deletingId === pendingConfirm}
                      onClick={(e) => {
                        e.stopPropagation();

                        if (pendingConfirm === null) {
                          return;
                        }

                        void handleDelete(pendingConfirm);
                      }}
                    >
                      {deletingId === pendingConfirm && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {tc('delete')}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => !generating && setDialogOpen(open)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>{t('dialogDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('templateLabel')}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {REPORT_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => selectTemplate(tpl.id)}
                    disabled={generating}
                    className={cn(
                      'rounded-lg border p-3 text-left transition-colors',
                      template === tpl.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground/40',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {t.has(`templates.${tpl.id}.name`) ? t(`templates.${tpl.id}.name`) : tpl.id}
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {t(`presets.${tpl.defaultPreset}`)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.has(`templates.${tpl.id}.description`) &&
                        t(`templates.${tpl.id}.description`)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tpl.sections.map((s) => (
                        <span
                          key={s}
                          className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {t(`sections.${s}`)}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {brands.length > 1 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('brandLabel')}</p>
                <Select value={reportBrandId ?? ''} onValueChange={(v) => v && setReportBrandId(v)}>
                  <SelectTrigger className="w-full" disabled={generating}>
                    <SelectValue>
                      {(v: string) => brands.find((b) => b.id === v)?.name ?? t('brandLabel')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium">{t('sectionsLabel')}</p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {pickableSections.map((s) => {
                  const on = sections.has(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSection(s)}
                      disabled={generating}
                      className={cn(
                        'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
                        on
                          ? 'border-primary bg-primary/5'
                          : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                          on
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground/30',
                        )}
                      >
                        {on && <Check className="h-2.5 w-2.5" />}
                      </span>
                      {t(`sections.${s}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t('reportTitleLabel')}</p>
              <Input
                placeholder={t('reportTitlePlaceholder')}
                value={reportTitle}
                onChange={(e) => setReportTitle(e.target.value)}
                disabled={generating}
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t('dateRange')}</p>
              <div className="flex gap-1">
                {(['7d', '30d', '90d', 'custom'] as DatePreset[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPreset(p)}
                    disabled={generating}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-xs transition-colors',
                      preset === p
                        ? 'border-primary bg-primary/10 font-medium text-primary'
                        : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                    )}
                  >
                    {t(`presets.${p}`)}
                  </button>
                ))}
              </div>
              {preset === 'custom' && (
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    type="date"
                    value={customRange.from}
                    onChange={(e) => setCustomRange((r) => ({ ...r, from: e.target.value }))}
                    disabled={generating}
                    className="text-sm"
                  />
                  <span className="text-xs text-muted-foreground">—</span>
                  <Input
                    type="date"
                    value={customRange.to}
                    onChange={(e) => setCustomRange((r) => ({ ...r, to: e.target.value }))}
                    disabled={generating}
                    className="text-sm"
                  />
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={generating}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleGenerate} disabled={generating} className="gap-2">
              {generating && <Loader2 className="h-4 w-4 animate-spin" />}
              {generating ? t('generating') : t('generateReport')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
