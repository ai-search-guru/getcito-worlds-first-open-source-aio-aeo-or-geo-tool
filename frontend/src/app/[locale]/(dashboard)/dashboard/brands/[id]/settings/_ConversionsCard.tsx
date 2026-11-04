'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Copy, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LoadingDots } from '@/components/ui/loading-dots';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getPublicApiBaseUrl } from '@/config/api';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { updateBrand } from '@/lib/actions/brand';
import {
  CONSENT_CALL,
  CONSENT_MODES,
  CONVERSION_CALL,
  DENY_CALL,
  FORM_GOAL_ATTRIBUTE,
  FORM_OFF_ATTRIBUTE,
  ORDER_CALL,
  SHOPIFY_CONSENT_BRIDGE,
  isConversionsConsent,
  shopifyPixelCode,
  trackingSnippetTag,
  type ConversionsConsent,
} from '@/lib/conversionTracking';
import { siteTypeOf } from '@/lib/content/pageTypes';
import type { Brand } from '@/types';

const code = (chunks: ReactNode) => (
  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{chunks}</code>
);

/**
 * Code to copy, wrapping in its box so a long line never widens the card;
 * its button says what it copies.
 */
function CopyBlock({ text, label }: { text: string; label: string }) {
  const t = useTranslations('brands.settings.conversions');
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative min-w-0">
      <pre className="whitespace-pre-wrap break-all rounded-md bg-muted py-3 pr-10 pl-4 font-mono text-[12px] leading-relaxed">
        {text}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-7 w-7"
        onClick={copy}
        aria-label={copied ? t('copied') : label}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}

/** One step of the set-up: its title, what it says, and its code. */
function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="text-sm font-medium">{title}</p>
      {children}
    </div>
  );
}

/**
 * Brand settings › Tracking › Conversions from AI visits (CE-017): turns the
 * snippet's conversions on or off and sets its consent mode, then says what
 * the site adds: the tag with conversions, the consent call, forms' goals,
 * the site's own calls, and the Shopify pixel (shown at once for an
 * e-commerce site, behind a button for others). Off, the snippet keeps
 * nothing in the browser. Admins and managers change it, as the brands
 * writes allow; the rest read it.
 */
export function ConversionsCard({
  brand,
  onUpdate,
}: {
  brand: Brand;
  onUpdate: (updates: Partial<Brand>) => void;
}) {
  const t = useTranslations('brands.settings.conversions');
  const { canManage } = useUserRole();
  const [enabled, setEnabled] = useState(brand.conversionsEnabled === true);
  const [consent, setConsent] = useState<ConversionsConsent>(brand.conversionsConsent ?? 'wait');
  // As the brand reads now: another admin's change, or the store read again.
  const [read, setRead] = useState({
    on: brand.conversionsEnabled,
    consent: brand.conversionsConsent,
  });
  if (read.on !== brand.conversionsEnabled || read.consent !== brand.conversionsConsent) {
    setRead({ on: brand.conversionsEnabled, consent: brand.conversionsConsent });
    setEnabled(brand.conversionsEnabled === true);
    setConsent(brand.conversionsConsent ?? 'wait');
  }
  const [saving, setSaving] = useState(false);
  // A read-only workspace (plan not active): the box and the consent mode
  // open the upgrade dialog instead; the code to copy stays.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const [showPixel, setShowPixel] = useState(siteTypeOf(brand) === 'ecommerce');
  const apiUrl = getPublicApiBaseUrl();
  const tag = trackingSnippetTag(apiUrl, brand.trackingCode, consent);
  const pixel = shopifyPixelCode(apiUrl, brand.trackingCode);
  const consentItems = CONSENT_MODES.map((value) => ({
    value,
    label: t(`consent.${value}`),
  }));

  const save = async (updates: Pick<Brand, 'conversionsEnabled' | 'conversionsConsent'>) => {
    if (!canManage) return false;
    setSaving(true);
    try {
      await updateBrand(brand.id, updates);
      onUpdate(updates);
      return true;
    } catch (err) {
      console.error('Failed to save the conversions setting:', err);
      toast.error(t('saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (next: boolean) => {
    setEnabled(next);
    if (await save({ conversionsEnabled: next })) toast.success(t(next ? 'on' : 'off'));
    else setEnabled(!next);
  };

  const pickConsent = async (next: ConversionsConsent) => {
    if (next === consent) return;
    const before = consent;
    setConsent(next);
    if (!(await save({ conversionsConsent: next }))) setConsent(before);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-4 w-4" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-6">
        <div className="flex items-start gap-3">
          <Checkbox
            id="conversions-on"
            checked={enabled}
            disabled={saving || !canManage}
            onCheckedChange={guard((v: boolean) => void toggle(v === true), {
              action: tActions('changeConversions'),
            })}
          />
          <div className="min-w-0 space-y-1">
            <Label htmlFor="conversions-on" className="font-medium">
              {t('label')}
            </Label>
            <p className="text-xs text-muted-foreground">{t('help')}</p>
            {!canManage && <p className="text-xs text-muted-foreground">{t('managersOnly')}</p>}
          </div>
          {saving && <LoadingDots className="ml-auto" />}
        </div>

        {enabled && (
          <>
            <div className="space-y-2">
              <Label htmlFor="conversions-consent">{t('consent.label')}</Label>
              <Select
                items={consentItems}
                value={consent}
                disabled={saving || !canManage}
                onValueChange={guard(
                  (v: string | null) => {
                    if (isConversionsConsent(v)) void pickConsent(v);
                  },
                  { action: tActions('changeConversions') },
                )}
              >
                <SelectTrigger id="conversions-consent" className="w-full sm:w-96">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {consentItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t(`consent.${consent}Hint`)}</p>
            </div>

            {tag ? (
              <div className="space-y-5 border-t pt-5">
                <Step title={t('steps.tag')}>
                  <p className="text-xs text-muted-foreground">
                    {t.rich('steps.tagHelp', { tag: '</head>', code })}
                  </p>
                  <CopyBlock text={tag} label={t('copyTag')} />
                </Step>
                {/* Waiting: the grant and the refusal; not waiting, the refusal only. */}
                <Step title={t(consent === 'wait' ? 'steps.consent' : 'steps.refuse')}>
                  {consent === 'wait' && (
                    <>
                      <p className="text-xs text-muted-foreground">{t('steps.consentHelp')}</p>
                      <CopyBlock text={CONSENT_CALL} label={t('copyConsent')} />
                      <p className="pt-1 text-xs font-medium">{t('steps.refuse')}</p>
                    </>
                  )}
                  <p className="text-xs text-muted-foreground">{t('steps.denyHelp')}</p>
                  <CopyBlock text={DENY_CALL} label={t('copyDeny')} />
                  <p className="text-xs text-muted-foreground">
                    {t.rich('steps.consentMode', { name: 'analytics_storage', code })}
                  </p>
                </Step>
                <Step title={t('steps.forms')}>
                  <p className="text-xs text-muted-foreground">
                    {t.rich('steps.formsHelp', {
                      goal: FORM_GOAL_ATTRIBUTE,
                      off: FORM_OFF_ATTRIBUTE,
                      code,
                    })}
                  </p>
                </Step>
                <Step title={t('steps.calls')}>
                  <p className="text-xs text-muted-foreground">{t('steps.callsHelp')}</p>
                  <CopyBlock text={CONVERSION_CALL} label={t('copyCall')} />
                  <CopyBlock text={ORDER_CALL} label={t('copyOrderCall')} />
                </Step>
                <Step title={t('steps.shopify')}>
                  {showPixel && pixel ? (
                    <>
                      <p className="text-xs text-muted-foreground">{t('steps.shopifyHelp')}</p>
                      <CopyBlock text={pixel} label={t('copyPixel')} />
                      {consent === 'wait' && (
                        <>
                          <p className="text-xs text-muted-foreground">
                            {t('steps.shopifyConsent')}
                          </p>
                          <CopyBlock text={SHOPIFY_CONSENT_BRIDGE} label={t('copyBridge')} />
                        </>
                      )}
                      <p className="text-xs text-muted-foreground">{t('steps.shopifyHeadless')}</p>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setShowPixel(true)}>
                      {t('steps.showPixel')}
                    </Button>
                  )}
                </Step>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t('noTag')}</p>
            )}

            <div className="space-y-1.5 rounded-lg border p-4">
              <p className="text-sm font-medium">{t('limits.title')}</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                <li>{t('limits.consent')}</li>
                <li>{t('limits.direct')}</li>
                <li>{t('limits.estimate')}</li>
                <li>{t('limits.domains')}</li>
                <li>{t('limits.iframes')}</li>
                <li>{t('limits.personal')}</li>
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
