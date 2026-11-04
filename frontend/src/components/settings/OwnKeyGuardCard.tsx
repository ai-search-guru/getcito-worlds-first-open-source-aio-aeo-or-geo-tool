'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import {
  OWN_KEY_GUARD_MAX_USD,
  OWN_KEY_GUARD_MIN_USD,
  type OwnKeyGuard,
} from '@/lib/chat/ownKeyGuard';
import { cn } from '@/lib/utils';

/** From this share of the guard the bar turns amber, as the notices say (PR 10). */
const WARN_AT = 0.8;

const dollars = (usd: number, cents = false) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(usd);

/** A limit as an Admin set it: whole dollars, or cents when it has them. */
const limitOf = (usd: number) => dollars(usd, !Number.isInteger(usd));

const range = { min: limitOf(OWN_KEY_GUARD_MIN_USD), max: limitOf(OWN_KEY_GUARD_MAX_USD) };

/**
 * Settings › AI Providers › Agents on your key (AGENT-OWN-KEY §4.3, PR 9):
 * the most all agents may spend on the workspace's own AI key a month, and
 * this month's estimate at the providers' list prices. Admins only (the
 * route sends it to nobody else); `guard` null when the server didn't answer.
 */
export function OwnKeyGuardCard({
  guard,
  onSaved,
}: {
  guard: OwnKeyGuard | null;
  onSaved: (guard: OwnKeyGuard | null) => void;
}) {
  const t = useTranslations('settings.ownKeyGuard');
  const tActions = useTranslations('readOnly.actions');
  const { guard: gate } = useUpgradeGate();
  const [value, setValue] = useState(guard ? String(guard.capUsd) : '');
  const [saving, setSaving] = useState(false);

  const capUsd = Number(value);
  const valid =
    value.trim() !== '' &&
    Number.isFinite(capUsd) &&
    capUsd >= OWN_KEY_GUARD_MIN_USD &&
    capUsd <= OWN_KEY_GUARD_MAX_USD;
  const changed =
    guard !== null && valid && Math.round(capUsd * 100) !== Math.round(guard.capUsd * 100);

  const save = async () => {
    if (!changed) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/ai-providers/guard', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capUsd }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        guard?: OwnKeyGuard | null;
        code?: string;
      };
      if (!res.ok) {
        toast.error(t(body.code === 'unavailable' ? 'unavailable' : 'failed'));
        return;
      }
      // Saved: the guard read again, or this month's last read with the new limit.
      const next = body.guard ?? (guard && { ...guard, capUsd });
      onSaved(next);
      if (next) setValue(String(next.capUsd));
      toast.success(t('saved'));
    } catch {
      toast.error(t('failed'));
    } finally {
      setSaving(false);
    }
  };

  const share = guard && guard.capUsd > 0 ? Math.min(1, guard.usedUsd / guard.capUsd) : 0;
  const renews = guard?.renewsAt
    ? new Date(guard.renewsAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  return (
    <Card data-slot="own-key-guard">
      <CardHeader>
        <CardTitle className="text-base">{t('title')}</CardTitle>
        <CardDescription>{t('description', range)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {guard === null ? (
          <p className="text-sm text-muted-foreground">{t('unreadable')}</p>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="own-key-guard" className="text-sm font-medium">
                {t('label')}
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  id="own-key-guard"
                  type="number"
                  inputMode="decimal"
                  min={OWN_KEY_GUARD_MIN_USD}
                  max={OWN_KEY_GUARD_MAX_USD}
                  step={1}
                  value={value}
                  aria-invalid={!valid}
                  onChange={(e) => setValue(e.target.value)}
                  className="w-28 tabular-nums"
                />
                <Button
                  size="sm"
                  disabled={!changed || saving}
                  onClick={gate(() => void save(), { action: tActions('saveAiKeyLimit') })}
                  className="gap-2"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t('save')}
                </Button>
              </div>
              <p className={cn('text-xs', valid ? 'text-muted-foreground' : 'text-destructive')}>
                {valid ? t('note') : t('range', range)}
              </p>
            </div>
            <div className="space-y-1.5 border-t pt-3">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span>
                  {t.rich(renews ? 'month' : 'monthNoDate', {
                    used: dollars(guard.usedUsd),
                    cap: limitOf(guard.capUsd),
                    date: renews ?? '',
                    b: (chunks) => <b className="font-semibold">{chunks}</b>,
                  })}
                </span>
                <Badge variant="outline" className="font-normal text-muted-foreground">
                  {t('estimated')}
                </Badge>
              </p>
              <div
                role="progressbar"
                aria-label={t('progress')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(share * 100)}
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={cn(
                    'h-full rounded-full',
                    share >= 1
                      ? 'bg-destructive'
                      : share >= WARN_AT
                        ? 'bg-amber-500 dark:bg-amber-400'
                        : 'bg-foreground/70',
                  )}
                  style={{ width: `${Math.round(share * 100)}%` }}
                />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
