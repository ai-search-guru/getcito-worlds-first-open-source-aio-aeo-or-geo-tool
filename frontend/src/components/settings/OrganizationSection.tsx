'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Loader2, Lock } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import {
  getOrganization,
  updateOrganizationName,
  type OrganizationInfo,
} from '@/lib/actions/organization';

/**
 * Settings → Organization.
 *
 * Replaces the inert "Project" tab (#753).  Admins can rename the
 * organisation; all other fields are read-only.  The slug is intentionally
 * not exposed for editing — it is used in external integrations and must
 * remain stable.
 *
 * Follows the TeamSection / AiProvidersSection pattern exactly:
 *   - load via useEffect / useCallback
 *   - Skeleton while loading
 *   - admin-gate via useUserRole().canAdmin
 *   - toast on success / error, saving spinner on the button
 */
export function OrganizationSection() {
  const t = useTranslations('settings');
  const { canAdmin } = useUserRole();

  const [org, setOrg] = useState<OrganizationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [nameInput, setNameInput] = useState('');
  const [saving, setSaving] = useState(false);
  // A read-only workspace (plan not active): Save opens the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  const loadOrg = useCallback(async () => {
    try {
      const data = await getOrganization();
      setOrg(data);
      setNameInput(data.name);
    } catch {
      toast.error(t('org_loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadOrg();
  }, [loadOrg]);

  async function handleSave() {
    if (!canAdmin) return;
    setSaving(true);
    try {
      await updateOrganizationName(nameInput);
      setOrg((prev) => (prev ? { ...prev, name: nameInput.trim() } : prev));
      toast.success(t('saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('org_saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-64 mt-1" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-24" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('org_title')}</CardTitle>
          <CardDescription>{t('org_description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Organization name — editable by admins only */}
          <div className="space-y-2">
            <Label htmlFor="org-name">{t('org_name')}</Label>
            {canAdmin ? (
              <Input
                id="org-name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={100}
                placeholder={t('org_namePlaceholder')}
              />
            ) : (
              <Input id="org-name" value={org?.name ?? ''} disabled />
            )}
          </div>

          {/* Slug — always read-only */}
          <div className="space-y-2">
            <Label htmlFor="org-slug">{t('org_slug')}</Label>
            <Input id="org-slug" value={org?.slug ?? ''} disabled />
            <p className="text-xs text-muted-foreground">{t('org_slugHint')}</p>
          </div>

          <Separator />

          {/* Read-only stats */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">{t('org_plan')}</p>
              <p className="font-medium capitalize">{org?.plan ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('org_members')}</p>
              <p className="font-medium">{org?.memberCount ?? '—'}</p>
            </div>
          </div>

          {canAdmin ? (
            <Button
              onClick={guard(handleSave, { action: tActions('renameOrganization') })}
              disabled={saving || !nameInput.trim() || nameInput.trim() === org?.name}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              <span>{t('org_adminOnly')}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
