import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { getBrands } from '@/lib/actions/brand';
import { getPlan, isCloud as checkIsCloud } from '@/config/plans';
import { getOrgPlan } from '@/lib/guards/planGuard';
import { countPlanBrands } from '@/lib/planBrandCount';
import { BrandsClient } from './_BrandsClient';
import { WorkspaceSettingsMenu } from '@/components/layout/WorkspaceSettingsMenu';
import { AddBrandLink } from '@/components/dashboard/AddBrandLink';
import { Button } from '@/components/ui/button';
import { Crown, Plus } from 'lucide-react';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

function BrandsHeader({
  canManage,
  canAddBrand,
  needsUpgrade,
}: {
  /** Admins and managers add brands (brands: admin/manager insert). */
  canManage: boolean;
  canAddBrand: boolean;
  needsUpgrade: boolean;
}) {
  const t = useTranslations('brands');
  return (
    <HeaderWithAiUsage>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <WorkspaceSettingsMenu />
          {!canManage ? null : canAddBrand ? (
            <AddBrandLink>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                {t('addBrand')}
              </Button>
            </AddBrandLink>
          ) : needsUpgrade ? (
            <AddBrandLink href="/dashboard/settings?tab=billing">
              <Button variant="outline" className="gap-2">
                <Crown className="h-4 w-4" />
                {t('addBrand')}
              </Button>
            </AddBrandLink>
          ) : null}
        </div>
      </div>
    </HeaderWithAiUsage>
  );
}

export default async function BrandsPage() {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .single();

  const orgId = profile?.organization_id;
  const canManage = profile?.role === 'admin' || profile?.role === 'manager';

  // getOrgPlan, not getPlan(org.plan): the limit shown here must be the one
  // createBrand enforces, Enterprise plan_overrides included. Reading the bare
  // plan offered "Add brand" to an override-capped org and failed on submit.
  // The count is the organization's, not this list's: a person with Selected
  // brands sees fewer brands than the plan counts (00390).
  const [brands, plan, counted] = await Promise.all([
    orgId ? getBrands(orgId) : [],
    orgId ? getOrgPlan(orgId) : getPlan(null),
    orgId ? countPlanBrands(supabase, orgId) : 0,
  ]);

  // The demo brand (sample data) is none of the plan's brands: never counted,
  // and not listed while hidden.
  const listed = brands.filter((b) => !(b.isDemo && b.demoHiddenAt));
  const maxBrands = plan.limits.maxBrands;
  const canAddBrand = maxBrands === -1 || counted < maxBrands;
  const needsUpgrade = !canAddBrand && checkIsCloud();

  return (
    <div className="space-y-6">
      <BrandsHeader canManage={canManage} canAddBrand={canAddBrand} needsUpgrade={needsUpgrade} />
      <BrandsClient brands={listed} />
    </div>
  );
}
