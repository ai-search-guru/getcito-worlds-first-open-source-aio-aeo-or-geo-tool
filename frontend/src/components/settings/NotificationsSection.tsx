'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { parseRecipients } from '@/lib/pulseRecipients';

/**
 * Settings → Notifications: Daily Pulse delivery preferences per brand
 * (#540). Frequency + optional explicit recipient list; an empty list
 * means every organization member receives the pulse. The AI Traffic weekly
 * digest (AT-013) goes to the same recipients, and can be turned off here.
 */

interface BrandPulseSettings {
  brandId: string;
  brandName: string;
  frequency: string;
  recipients: string[];
  trafficDigest: boolean;
}

const FREQUENCIES = ['daily', 'weekly', 'notable', 'off'] as const;

export function NotificationsSection() {
  const t = useTranslations('settings');
  const { canManage } = useUserRole();
  const [brands, setBrands] = useState<BrandPulseSettings[]>([]);
  const [recipientDrafts, setRecipientDrafts] = useState<Record<string, string>>({});
  // Addresses that failed validation, per brand, shown under the field.
  const [invalidRecipients, setInvalidRecipients] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [savingBrand, setSavingBrand] = useState<string | null>(null);
  // A read-only workspace (plan not active): Save opens the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/pulse');
      const body = (await res.json().catch(() => ({}))) as {
        brands?: BrandPulseSettings[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || 'Failed to load notification settings');
      const rows = body.brands ?? [];
      setBrands(rows);
      setRecipientDrafts(
        Object.fromEntries(rows.map((row) => [row.brandId, row.recipients.join(', ')])),
      );
    } catch {
      toast.error(t('pulseLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(brandId: string, frequency: string, trafficDigest: boolean) {
    if (savingBrand) return;
    const { valid: recipients, invalid } = parseRecipients(
      (recipientDrafts[brandId] ?? '').split(','),
    );
    setInvalidRecipients((prev) => ({ ...prev, [brandId]: invalid }));
    if (invalid.length) return;
    setSavingBrand(brandId);
    try {
      const res = await fetch('/api/settings/pulse', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, frequency, recipients, trafficDigest }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; invalid?: string[] };
      if (body.invalid?.length) {
        setInvalidRecipients((prev) => ({ ...prev, [brandId]: body.invalid ?? [] }));
        return;
      }
      if (!res.ok) throw new Error(body.error || 'Save failed');
      setBrands((prev) =>
        prev.map((b) =>
          b.brandId === brandId ? { ...b, frequency, recipients, trafficDigest } : b,
        ),
      );
      setRecipientDrafts((prev) => ({ ...prev, [brandId]: recipients.join(', ') }));
      toast.success(t('pulseSaved'));
    } catch {
      toast.error(t('pulseSaveFailed'));
    } finally {
      setSavingBrand(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('notifications')}</CardTitle>
        <CardDescription>{t('notificationsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : brands.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('pulseNoBrands')}</p>
        ) : (
          brands.map((brand) => (
            <div key={brand.brandId} className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{brand.brandName}</p>
                <Select
                  value={brand.frequency}
                  onValueChange={(value) => {
                    if (!value) return;
                    setBrands((prev) =>
                      prev.map((b) =>
                        b.brandId === brand.brandId ? { ...b, frequency: value } : b,
                      ),
                    );
                  }}
                  disabled={!canManage}
                >
                  <SelectTrigger size="sm" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((freq) => (
                      <SelectItem key={freq} value={freq}>
                        {t(`pulseFrequency_${freq}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`pulse-recipients-${brand.brandId}`}>{t('pulseRecipients')}</Label>
                <Input
                  id={`pulse-recipients-${brand.brandId}`}
                  value={recipientDrafts[brand.brandId] ?? ''}
                  onChange={(e) => {
                    setRecipientDrafts((prev) => ({ ...prev, [brand.brandId]: e.target.value }));
                    setInvalidRecipients((prev) => ({ ...prev, [brand.brandId]: [] }));
                  }}
                  placeholder={t('pulseRecipientsPlaceholder')}
                  disabled={!canManage}
                  aria-invalid={invalidRecipients[brand.brandId]?.length ? true : undefined}
                />
                {invalidRecipients[brand.brandId]?.length ? (
                  <p className="text-xs text-destructive">
                    {t('pulseRecipientsInvalid', {
                      emails: invalidRecipients[brand.brandId].join(', '),
                    })}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('pulseRecipientsHint')}</p>
                )}
              </div>
              <div className="flex items-start gap-2.5">
                {/* Not sent while the pulse is off; the brand's own choice is kept for when it's back. */}
                <Checkbox
                  id={`traffic-digest-${brand.brandId}`}
                  className="mt-0.5"
                  checked={brand.trafficDigest && brand.frequency !== 'off'}
                  onCheckedChange={(on) =>
                    setBrands((prev) =>
                      prev.map((b) =>
                        b.brandId === brand.brandId ? { ...b, trafficDigest: on === true } : b,
                      ),
                    )
                  }
                  disabled={!canManage || brand.frequency === 'off'}
                />
                <div className="space-y-0.5">
                  <Label htmlFor={`traffic-digest-${brand.brandId}`}>{t('trafficDigest')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {brand.frequency === 'off'
                      ? t('trafficDigestPulseOff')
                      : t('trafficDigestHint')}
                  </p>
                </div>
              </div>
              {canManage && (
                <Button
                  size="sm"
                  onClick={guard(
                    () => void save(brand.brandId, brand.frequency, brand.trafficDigest),
                    { action: tActions('saveNotifications') },
                  )}
                  disabled={savingBrand !== null}
                  className="gap-2"
                >
                  {savingBrand === brand.brandId && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('save')}
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
