'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { setBrandTrustedSources, type ContentSettings } from '@/lib/actions/contentSettings';
import { MAX_TRUSTED_SOURCES, parseTrustedSources } from '@/lib/content/trustedSources';

/** The shared list's kinds, as the audit report's What counts lists them. */
const COUNTED = ['official', 'international', 'research', 'news'] as const;

/**
 * Settings › Content › Trusted sources (customer priorities item 6, 00449):
 * per brand, the sites it trusts besides the shared list. Site Audit counts
 * a link to one as an authority link; the Content Editor's Trust reads it as
 * a primary source. Admins and managers edit; anyone else sees them.
 */
export function TrustedSourcesCard({
  read,
  onSaved,
}: {
  read: ContentSettings;
  onSaved: (brandId: string, sources: string[]) => void;
}) {
  const t = useTranslations('settings.content.trusted');
  const tCounts = useTranslations('audit.authority.counts');
  const tActions = useTranslations('readOnly.actions');
  const { guard } = useUpgradeGate();
  // The brand being edited, and what's typed for it.
  const [editing, setEditing] = useState<{ brandId: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const typed = editing ? parseTrustedSources(editing.text) : null;
  const tooMany = typed ? typed.sources.length - MAX_TRUSTED_SOURCES : 0;
  const blocked = !typed || typed.invalid.length > 0 || tooMany > 0;

  const save = async () => {
    if (!editing || !typed || blocked) return;
    setSaving(true);
    const result = await setBrandTrustedSources(editing.brandId, typed.sources);
    setSaving(false);
    if (!result.ok) {
      toast.error(t(result.reason === 'unavailable' ? 'unavailable' : 'saveFailed'));
      return;
    }
    onSaved(editing.brandId, result.sources);
    setEditing(null);
    toast.success(t('saved'));
  };

  return (
    <Card data-slot="trusted-sources">
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
                    {t('count', { count: typed?.sources.length ?? 0 })}
                  </span>
                </div>
                <Textarea
                  aria-label={t('label', { brand: brand.name })}
                  rows={4}
                  autoFocus
                  value={editing.text}
                  onChange={(e) => setEditing({ brandId: brand.id, text: e.target.value })}
                  className="font-mono text-[13px]"
                />
                {typed && typed.invalid.length > 0 ? (
                  <p role="alert" className="text-xs text-destructive">
                    {t('invalid', { count: typed.invalid.length, lines: typed.invalid.join(', ') })}
                  </p>
                ) : tooMany > 0 ? (
                  <p role="alert" className="text-xs text-destructive">
                    {t('tooMany', { max: MAX_TRUSTED_SOURCES, count: tooMany })}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t('hint', { max: MAX_TRUSTED_SOURCES })}
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
              <li key={brand.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">
                  {brand.name}
                </span>
                {brand.trustedSources.length > 0 ? (
                  <span className="flex min-w-0 flex-wrap justify-end gap-1">
                    {brand.trustedSources.map((site) => (
                      <span
                        key={site}
                        className="inline-flex items-center rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
                      >
                        {site}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{t('count', { count: 0 })}</span>
                )}
                {read.canManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={editing !== null}
                    onClick={guard(
                      () =>
                        setEditing({ brandId: brand.id, text: brand.trustedSources.join('\n') }),
                      { action: tActions('changeContentSettings') },
                    )}
                  >
                    {t('edit')}
                  </Button>
                )}
              </li>
            ),
          )}
        </ul>
        <details className="rounded-xl border px-3 py-2.5">
          <summary className="cursor-pointer text-sm font-medium">{t('counted')}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {COUNTED.map((kind) => (
              <li key={kind}>{tCounts(kind)}</li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
