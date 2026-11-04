'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { setBrandRules, type ContentSettings } from '@/lib/actions/contentSettings';
import { MAX_BRAND_RULES, MAX_BRAND_RULE_LENGTH, parseBrandRules } from '@/lib/content/brandRules';

/**
 * Settings › Content › Brand rules (customer priorities item 8, 00450): per
 * brand, rules in its own words that Site Audit's AI recommendations, new
 * opportunities and the Content Agent follow. Admins and managers edit;
 * anyone else sees them.
 */
export function BrandRulesCard({
  read,
  onSaved,
}: {
  read: ContentSettings;
  onSaved: (brandId: string, rules: string[]) => void;
}) {
  const t = useTranslations('settings.content.rules');
  const tActions = useTranslations('readOnly.actions');
  const { guard } = useUpgradeGate();
  // The brand being edited, and what's typed for it.
  const [editing, setEditing] = useState<{ brandId: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const typed = editing ? parseBrandRules(editing.text) : null;
  const tooMany = typed ? typed.rules.length - MAX_BRAND_RULES : 0;
  const blocked = !typed || typed.tooLong.length > 0 || tooMany > 0;

  const save = async () => {
    if (!editing || !typed || blocked) return;
    setSaving(true);
    const result = await setBrandRules(editing.brandId, typed.rules);
    setSaving(false);
    if (!result.ok) {
      toast.error(t(result.reason === 'unavailable' ? 'unavailable' : 'saveFailed'));
      return;
    }
    onSaved(editing.brandId, result.rules);
    setEditing(null);
    toast.success(t('saved'));
  };

  return (
    <Card data-slot="brand-rules">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y rounded-xl border">
          {read.brands.map((brand) =>
            editing?.brandId === brand.id ? (
              <li key={brand.id} className="space-y-2 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">
                    {brand.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('count', { count: typed?.rules.length ?? 0 })}
                  </span>
                </div>
                <Textarea
                  aria-label={t('label', { brand: brand.name })}
                  rows={4}
                  autoFocus
                  value={editing.text}
                  onChange={(e) => setEditing({ brandId: brand.id, text: e.target.value })}
                  className="text-[13px]"
                />
                {typed && typed.tooLong.length > 0 ? (
                  <p role="alert" className="text-xs text-destructive">
                    {t('tooLong', {
                      count: typed.tooLong.length,
                      lines: typed.tooLong.join(', '),
                      length: MAX_BRAND_RULE_LENGTH,
                    })}
                  </p>
                ) : tooMany > 0 ? (
                  <p role="alert" className="text-xs text-destructive">
                    {t('tooMany', { max: MAX_BRAND_RULES, count: tooMany })}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t('hint', { length: MAX_BRAND_RULE_LENGTH, max: MAX_BRAND_RULES })}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                    {t('cancel')}
                  </Button>
                  <Button size="sm" disabled={blocked || saving} onClick={() => void save()}>
                    {t('save')}
                  </Button>
                </div>
              </li>
            ) : (
              <li key={brand.id} className="space-y-2 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">
                    {brand.name}
                  </span>
                  {brand.brandRules.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      {t('count', { count: 0 })}
                    </span>
                  )}
                  {read.canManage && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={editing !== null}
                      onClick={guard(
                        () => setEditing({ brandId: brand.id, text: brand.brandRules.join('\n') }),
                        { action: tActions('changeContentSettings') },
                      )}
                    >
                      {t('edit')}
                    </Button>
                  )}
                </div>
                {brand.brandRules.length > 0 && (
                  <ul className="space-y-1">
                    {brand.brandRules.map((rule) => (
                      <li key={rule} className="flex items-start gap-2 text-sm">
                        <span
                          aria-hidden
                          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/50"
                        />
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{rule}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ),
          )}
        </ul>
        <p className="text-xs text-muted-foreground">{t('note')}</p>
      </CardContent>
    </Card>
  );
}
