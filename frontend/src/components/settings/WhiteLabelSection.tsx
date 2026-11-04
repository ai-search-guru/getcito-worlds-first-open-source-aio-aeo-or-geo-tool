'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Crown, Loader2, Lock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { LogoField } from '@/components/settings/LogoField';
import { PLANS } from '@/config/plans';
import { formatDate } from '@/lib/format';
import {
  getWhiteLabelSettings,
  prepareWhiteLabelLogoUpload,
  saveWhiteLabelKit,
  setWhiteLabelLogo,
  type WhiteLabelFailure,
  type WhiteLabelSettingsView,
} from '@/lib/actions/whiteLabel';
import {
  COMPANY_NAME_MAX,
  FOOTER_MAX,
  MIN_TEXT_CONTRAST,
  contrastRatio,
  normalizeHex,
  readableOn,
  REPORT_ACCENT,
} from '@/lib/white-label/kit';
import { uploadLogo, type LogoUploadError } from '@/lib/white-label/logoUpload';
import { forgetExportBranding } from '@/lib/white-label/exportName';

/** The reports' own accent while a kit has no color. */
const DEFAULT_ACCENT = REPORT_ACCENT;

const FAILED = { ok: false, failure: 'failed' } as const;

/**
 * Settings › White label (00429): the workspace's kit for what it sends
 * clients — logo, main color, company name and report footer — with a
 * preview of a report's first lines. Everyone sees it; only an Admin
 * changes it. On a plan without white label it is locked, with the way to
 * the plan that has it.
 */
export function WhiteLabelSection() {
  const t = useTranslations('settings.whiteLabel');
  const tSettings = useTranslations('settings');
  const tCommon = useTranslations('common');
  const tActions = useTranslations('readOnly.actions');
  const { guard, openUpgrade } = useUpgradeGate();

  const [view, setView] = useState<WhiteLabelSettingsView | null>(null);
  const [failed, setFailed] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [footerText, setFooterText] = useState('');
  const [saving, setSaving] = useState(false);

  /**
   * Shows what was read. `keepForm`: a logo change, which leaves the name,
   * color and footer as typed, saved or not, and updates only the rest.
   */
  const show = useCallback(
    (read: Awaited<ReturnType<typeof getWhiteLabelSettings>>, keepForm = false) => {
      if (!read.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setView(read.view);
      if (keepForm) return;
      setCompanyName(read.view.companyName ?? '');
      setAccentColor(read.view.accentColor ?? '');
      setFooterText(read.view.footerText ?? '');
    },
    [],
  );
  const load = useCallback(
    (keepForm = false) =>
      getWhiteLabelSettings()
        .catch(() => FAILED)
        .then((read) => show(read, keepForm)),
    [show],
  );

  useEffect(() => {
    let live = true;
    void getWhiteLabelSettings()
      .catch(() => FAILED)
      .then((read) => {
        if (live) show(read);
      });
    return () => {
      live = false;
    };
  }, [show]);

  /** Says why a change didn't go: the upgrade dialog while read-only, else a toast. */
  const fail = (failure: WhiteLabelFailure | LogoUploadError, action: string) => {
    if (failure === 'read_only') openUpgrade(action);
    else toast.error(t(`errors.${failure}`));
  };

  if (failed && !view) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-6 text-sm text-muted-foreground">
          {t('loadFailed')}
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {tCommon('retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!view) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-1 h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-40" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  const planName = PLANS[view.requiredPlan].name;

  if (!view.available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t('title')}
            <Badge variant="outline" className="gap-1">
              <Crown aria-hidden className="h-3 w-3" />
              {planName}
            </Badge>
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Crown aria-hidden className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-medium">{t('lockedTitle', { plan: planName })}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('lockedDescription')}</p>
            </div>
          </div>
          {view.canEdit ? (
            <Link href="/dashboard/settings/billing" className={buttonVariants()}>
              {t('upgrade')}
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">{t('askAdmin')}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const color = accentColor.trim() ? normalizeHex(accentColor) : null;
  const colorInvalid = Boolean(accentColor.trim()) && !color;
  const shownAccent = color ?? DEFAULT_ACCENT;
  const darkened = color !== null && contrastRatio(color, '#ffffff') < MIN_TEXT_CONTRAST;
  const changed =
    companyName.trim() !== (view.companyName ?? '') ||
    (color ?? '') !== (view.accentColor ?? '') ||
    footerText.trim() !== (view.footerText ?? '');

  async function handleSave() {
    setSaving(true);
    const result = await saveWhiteLabelKit({
      companyName,
      accentColor: color,
      footerText,
    }).catch(() => FAILED);
    setSaving(false);
    if (!result.ok) {
      fail(result.failure, tActions('saveWhiteLabel'));
      return;
    }
    toast.success(t('saved'));
    // Downloads are named after the kit: read it again on the next one.
    forgetExportBranding();
    await load();
  }

  async function pickLogo(file: File) {
    const uploaded = await uploadLogo(file, prepareWhiteLabelLogoUpload);
    if (!uploaded.ok) return fail(uploaded.error, tActions('saveWhiteLabel'));
    const set = await setWhiteLabelLogo(uploaded.path).catch(() => FAILED);
    if (!set.ok) return fail(set.failure, tActions('saveWhiteLabel'));
    toast.success(t('logoSaved'));
    forgetExportBranding();
    await load(true);
  }

  async function removeLogo() {
    const set = await setWhiteLabelLogo(null).catch(() => FAILED);
    if (!set.ok) return fail(set.failure, tActions('saveWhiteLabel'));
    toast.success(t('logoRemoved'));
    forgetExportBranding();
    await load(true);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            {view.inUse ? t('inUse') : t('notInUse')}
            {view.updatedAt && (
              <>
                {' '}
                {view.updatedByName
                  ? t('lastChanged', {
                      date: formatDate(view.updatedAt),
                      name: view.updatedByName,
                    })
                  : t('lastChangedNoName', { date: formatDate(view.updatedAt) })}
              </>
            )}
          </p>

          <LogoField
            label={t('logo')}
            url={view.logoUrl}
            canEdit={view.canEdit}
            action={tActions('saveWhiteLabel')}
            onPick={pickLogo}
            onRemove={removeLogo}
          />

          <div className="space-y-2">
            <Label htmlFor="white-label-company">{t('companyName')}</Label>
            <Input
              id="white-label-company"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              maxLength={COMPANY_NAME_MAX}
              placeholder={t('companyNamePlaceholder')}
              disabled={!view.canEdit}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="white-label-color">{t('accentColor')}</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={t('accentColorPicker')}
                value={shownAccent}
                onChange={(e) => setAccentColor(e.target.value)}
                disabled={!view.canEdit}
                className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <Input
                id="white-label-color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                maxLength={7}
                placeholder={DEFAULT_ACCENT}
                aria-invalid={colorInvalid}
                disabled={!view.canEdit}
                className="w-32 font-mono"
              />
            </div>
            {colorInvalid && <p className="text-xs text-destructive">{t('accentColorInvalid')}</p>}
            {darkened && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {t('accentColorDarkened')}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="white-label-footer">{t('footer')}</Label>
            <Input
              id="white-label-footer"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              maxLength={FOOTER_MAX}
              placeholder={t('footerPlaceholder')}
              disabled={!view.canEdit}
            />
            <p className="text-xs text-muted-foreground">{t('footerHint')}</p>
          </div>

          {view.canEdit ? (
            <Button
              onClick={guard(() => void handleSave(), { action: tActions('saveWhiteLabel') })}
              disabled={saving || colorInvalid || !changed}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tSettings('save')}
            </Button>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lock aria-hidden className="h-3.5 w-3.5" />
              <span>{t('adminOnly')}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('preview')}</CardTitle>
        </CardHeader>
        <CardContent>
          <KitPreview
            logoUrl={view.logoUrl}
            companyName={companyName.trim() || null}
            accent={shownAccent}
            footerText={footerText.trim() || null}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * A report's first lines and footer with the kit as typed, before it is
 * saved. The paper is white in both themes, as the PDF it stands for.
 */
function KitPreview({
  logoUrl,
  companyName,
  accent,
  footerText,
}: {
  logoUrl: string | null;
  companyName: string | null;
  accent: string;
  footerText: string | null;
}) {
  const t = useTranslations('settings.whiteLabel');
  return (
    <div className="rounded-md border bg-white p-5 text-zinc-900 shadow-sm">
      <div className="flex min-h-8 items-center justify-between gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed address
          <img src={logoUrl} alt={companyName ?? ''} className="max-h-8 max-w-40 object-contain" />
        ) : (
          <span className="text-sm font-semibold">{companyName}</span>
        )}
        {logoUrl && companyName && <span className="text-xs text-zinc-500">{companyName}</span>}
      </div>
      <p className="mt-4 text-base font-bold" style={{ color: readableOn(accent) }}>
        {t('previewTitle')}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        {t('previewPreparedFor', { brand: t('previewClient') })}
      </p>
      <div className="mt-3 h-0.5" style={{ backgroundColor: accent }} />
      <div className="mt-10 flex justify-between border-t border-zinc-200 pt-2 text-[10px] text-zinc-500">
        <span>{footerText}</span>
        <span>1 / 4</span>
      </div>
    </div>
  );
}
