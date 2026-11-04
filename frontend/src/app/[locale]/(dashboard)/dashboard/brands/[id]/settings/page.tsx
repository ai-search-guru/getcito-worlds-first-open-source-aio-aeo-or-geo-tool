'use client';

import { use, useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, Link } from '@/i18n/navigation';
import { useBrandStore } from '@/state/useBrandStore';
import {
  updateBrand,
  deleteBrand,
  setBrandShoppingMode,
  setBrandActive,
} from '@/lib/actions/brand';
import { syncDomains } from '@/lib/actions/brandDomain';
import { getCompetitors, addCompetitor, deleteCompetitor } from '@/lib/actions/competitor';
import { getSiteIconUrl } from '@/lib/siteIcon';
import type { Competitor } from '@/types';
import { INDUSTRIES, type Brand, type BrandDomain } from '@/types';
import { REGIONS, REGION_ITEMS, US_STATES, US_STATE_ITEMS } from '@/config/promptOptions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Check,
  Code,
  Copy,
  Globe,
  Loader2,
  Pause,
  Play,
  Plus,
  Save,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useUserRole } from '@/hooks/useUserRole';
import { useFeatureGate } from '@/hooks/useFeatureGate';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getPublicApiBaseUrl } from '@/config/api';
import { SITE_TYPES, guessSiteType, isSiteType, type SiteType } from '@/lib/content/pageTypes';
import { qualityPhase } from '@/lib/content/quality';
import { BrandFactsTab } from './_BrandFactsTab';
import { ConversionsCard } from './_ConversionsCard';
import { ClientLogoCard } from './_ClientLogoCard';
import { trackingSnippetTag } from '@/lib/conversionTracking';

interface PageProps {
  params: Promise<{ id: string }>;
  /** `?tab=facts` opens Brand facts (the editor's to-do links there). */
  searchParams?: Promise<{ tab?: string }>;
}

const TABS = ['general', 'domains', 'tracking', 'competitors', 'facts', 'danger'];
/** No search params: one promise for every render, as use() needs. */
const NO_SEARCH: Promise<{ tab?: string }> = Promise.resolve({});

const INDUSTRY_ITEMS = INDUSTRIES.map((industry) => ({ value: industry, label: industry }));

export default function BrandSettingsPage({ params, searchParams }: PageProps) {
  const { id } = use(params);
  const { tab } = use(searchParams ?? NO_SEARCH);
  // Brand facts with Quality's second phase (CE-047).
  const factsOn = qualityPhase() >= 2;
  const opened = tab && TABS.includes(tab) && (tab !== 'facts' || factsOn) ? tab : 'general';
  const t = useTranslations('brands');
  const router = useRouter();
  const { brands, updateBrand: updateBrandStore, removeBrand } = useBrandStore();

  const brand = brands.find((b) => b.id === id);

  if (!brand) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h2 className="text-lg font-semibold">Brand not found</h2>
        <p className="text-muted-foreground text-sm mt-1">This brand may have been deleted.</p>
        <Link href="/dashboard/brands" className="mt-4">
          <Button variant="outline">Back to Brands</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue={opened} className="space-y-4">
        <TabsList>
          <TabsTrigger value="general">{t('settings.generalTab')}</TabsTrigger>
          <TabsTrigger value="domains">{t('settings.domainsTab')}</TabsTrigger>
          <TabsTrigger value="tracking">Tracking</TabsTrigger>
          <TabsTrigger value="competitors">Competitors</TabsTrigger>
          {factsOn && <TabsTrigger value="facts">{t('settings.facts.tab')}</TabsTrigger>}
          <TabsTrigger
            value="danger"
            className="text-destructive data-[state=active]:text-destructive"
          >
            {t('settings.dangerTab')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <GeneralTab brand={brand} onUpdate={(updated) => updateBrandStore(brand.id, updated)} />
          <ClientLogoCard brand={brand} />
          <ShoppingModeCard
            brand={brand}
            onUpdate={(updated) => updateBrandStore(brand.id, updated)}
          />
          <PauseBrandCard
            brand={brand}
            onUpdate={(updated) => updateBrandStore(brand.id, updated)}
          />
        </TabsContent>

        <TabsContent value="domains">
          <DomainsTab brand={brand} onUpdate={(updated) => updateBrandStore(brand.id, updated)} />
        </TabsContent>

        <TabsContent value="tracking" className="space-y-6">
          <TrackingTab brand={brand} />
          <ConversionsCard
            brand={brand}
            onUpdate={(updated) => updateBrandStore(brand.id, updated)}
          />
        </TabsContent>

        <TabsContent value="competitors">
          <CompetitorsTab brandId={brand.id} />
        </TabsContent>

        {factsOn && (
          <TabsContent value="facts">
            <BrandFactsTab brandId={brand.id} />
          </TabsContent>
        )}

        <TabsContent value="danger">
          <DangerTab
            brand={brand}
            onDelete={async (pending) => {
              removeBrand(brand.id);
              toast.success(
                pending
                  ? 'Deleting the brand. It has a lot of data, so this can take a few minutes.'
                  : 'Brand deleted.',
              );
              router.push('/dashboard/brands');
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── General Tab ──────────────────────────────────────────────────────────────

function GeneralTab({
  brand,
  onUpdate,
}: {
  brand: Brand;
  onUpdate: (updates: Partial<Brand>) => void;
}) {
  const t = useTranslations('brands');
  const { canManage } = useUserRole();
  // A read-only workspace (plan not active): the settings show; Save opens
  // the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const [name, setName] = useState(brand.name);
  const [logoUrl, setLogoUrl] = useState(brand.logoUrl ?? '');
  const [industry, setIndustry] = useState(brand.industry ?? '');
  const [description, setDescription] = useState(brand.description ?? '');
  const [region, setRegion] = useState(brand.region ?? 'US');
  const [usState, setUsState] = useState(brand.state ?? '');
  // Null until someone picks one: the guess follows the industry meanwhile.
  const [siteType, setSiteType] = useState<SiteType | null>(
    isSiteType(brand.siteType) ? brand.siteType : null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const stateItems = [{ value: 'nationwide', label: t('settings.nationwide') }, ...US_STATE_ITEMS];
  const siteTypeItems = SITE_TYPES.map((value) => ({ value, label: t(`siteTypes.${value}`) }));
  const guessedSiteType = guessSiteType({
    industry,
    shoppingModeEnabled: brand.shoppingModeEnabled,
  });

  const handleSave = async () => {
    if (!name.trim()) return;
    const trimmedLogoUrl = logoUrl.trim();
    if (trimmedLogoUrl && !trimmedLogoUrl.match(/^https?:\/\/.+/)) return;
    setIsSaving(true);
    try {
      const updated = await updateBrand(brand.id, {
        name: name.trim(),
        logoUrl: trimmedLogoUrl || null,
        industry: industry || null,
        description: description || null,
        region,
        state: region === 'US' ? usState || null : null,
        ...(siteType ? { siteType } : {}),
      });
      onUpdate({
        name: updated.name,
        slug: updated.slug,
        logoUrl: updated.logoUrl,
        industry: updated.industry,
        description: updated.description,
        region: updated.region,
        state: updated.state,
        siteType: updated.siteType,
        updatedAt: updated.updatedAt,
      });
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save changes.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.generalTab')}</CardTitle>
        <CardDescription>Update your brand&apos;s basic information.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Admins and managers write the brand (RLS); others read it. */}
        <fieldset disabled={!canManage} className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t('brandName')} *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('brandNamePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="logo-url">{t('logoUrl')}</Label>
            <Input
              id="logo-url"
              type="text"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
            />
            {logoUrl.trim() && !logoUrl.trim().match(/^https?:\/\/.+/) && (
              <p className="text-xs text-destructive">URL must start with https:// or http://</p>
            )}
            <p className="text-xs text-muted-foreground">{t('logoUrlHint')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="industry">{t('industry')}</Label>
            <Select
              items={INDUSTRY_ITEMS}
              value={industry}
              onValueChange={(v) => setIndustry(v ?? '')}
            >
              <SelectTrigger id="industry">
                <SelectValue placeholder={t('industryPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map((ind) => (
                  <SelectItem key={ind} value={ind}>
                    {ind}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="site-type">{t('siteType')}</Label>
            <Select
              items={siteTypeItems}
              value={siteType ?? guessedSiteType}
              onValueChange={(v) => {
                if (isSiteType(v)) setSiteType(v);
              }}
            >
              <SelectTrigger id="site-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {siteTypeItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t('settings.siteTypeHint')}
              {siteType === null && ` ${t('settings.siteTypeGuessed')}`}
              {siteType !== null &&
                siteType === brand.siteType &&
                brand.siteTypeSource === 'auto' &&
                ` ${t('settings.siteTypeDetected')}`}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t('description_field')}</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('settings.region')}</Label>
            <Select
              items={REGION_ITEMS}
              value={region}
              onValueChange={(v) => {
                if (!v) return;
                setRegion(v);
                if (v !== 'US') setUsState('');
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {region === 'US' && (
            <div className="space-y-2">
              <Label>{t('settings.stateOptional')}</Label>
              <Select
                items={stateItems}
                value={usState || 'nationwide'}
                onValueChange={(v) => setUsState(!v || v === 'nationwide' ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nationwide">{t('settings.nationwide')}</SelectItem>
                  {US_STATES.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('settings.stateHint')}</p>
            </div>
          )}

          <Button
            onClick={guard(handleSave, { action: tActions('saveBrandSettings') })}
            disabled={isSaving || !name.trim()}
            className="gap-2"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t('settings.saveChanges')}
          </Button>
        </fieldset>
        {!canManage && (
          <p className="text-xs text-muted-foreground">{t('settings.managersOnlyEdit')}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Shopping mode (#155) ────────────────────────────────────────────────────

function ShoppingModeCard({
  brand,
  onUpdate,
}: {
  brand: Brand;
  onUpdate: (updates: Partial<Brand>) => void;
}) {
  const t = useTranslations('brands');
  // Admins and managers, as the brands, prompts and brand_platforms writes allow.
  const { canManage } = useUserRole();
  // ChatGPT Shopping is tracked only on plans with the Shopping page (#1212):
  // on others the prompts still carry it, but nothing runs it.
  const { canUse, requiredPlanFor } = useFeatureGate();
  const tracked = canUse('shopping_analytics');
  const [enabled, setEnabled] = useState(brand.shoppingModeEnabled);
  const [saving, setSaving] = useState(false);
  // A read-only workspace (plan not active): the box opens the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  async function handleToggle(next: boolean) {
    if (!canManage) return;
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    try {
      const { promptsUpdated } = await setBrandShoppingMode(brand.id, next);
      onUpdate({ shoppingModeEnabled: next });
      if (next && promptsUpdated > 0) {
        toast.success(t('settings.shopping.onWithPrompts', { count: promptsUpdated }));
      } else {
        toast.success(next ? t('settings.shopping.on') : t('settings.shopping.off'));
      }
    } catch (err) {
      setEnabled(previous);
      toast.error(err instanceof Error ? err.message : t('settings.shopping.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingBag className="h-4 w-4" />
          {t('settings.shopping.title')}
        </CardTitle>
        <CardDescription>{t('settings.shopping.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-3">
          <Checkbox
            id="shopping-mode"
            checked={enabled}
            disabled={saving || !canManage}
            onCheckedChange={guard((v: boolean) => void handleToggle(v === true), {
              action: tActions('changeShoppingMode'),
            })}
          />
          <div className="space-y-1">
            <Label htmlFor="shopping-mode" className="font-medium">
              {t('settings.shopping.label')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t.rich('settings.shopping.help', {
                code: (chunks) => (
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{chunks}</code>
                ),
              })}
            </p>
            {!tracked && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {t('settings.shopping.planNote', { plan: requiredPlanFor('shopping_analytics') })}
              </p>
            )}
            {!canManage && (
              <p className="text-xs text-muted-foreground">{t('settings.shopping.managersOnly')}</p>
            )}
          </div>
          {saving && <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Pause / resume tracking (#286) ──────────────────────────────────────────

function PauseBrandCard({
  brand,
  onUpdate,
}: {
  brand: Brand;
  onUpdate: (updates: Partial<Brand>) => void;
}) {
  const { canAdmin } = useUserRole();
  const paused = !brand.isActive;
  const [saving, setSaving] = useState(false);
  // A read-only workspace (plan not active): Pause and Resume open the
  // upgrade dialog instead. Nothing runs for it meanwhile: there is no cost
  // for Pause to stop.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  async function handleToggle(nextActive: boolean) {
    if (!canAdmin) return;
    setSaving(true);
    try {
      await setBrandActive(brand.id, nextActive);
      onUpdate({ isActive: nextActive });
      toast.success(nextActive ? 'Tracking resumed' : 'Tracking paused');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className={paused ? 'border-amber-500/40' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {paused ? (
            <Pause className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Tracking
          {paused && (
            <Badge
              variant="secondary"
              className="gap-1 border-amber-500/30 bg-amber-500/15 text-[10px] text-amber-700 dark:text-amber-400"
            >
              Paused
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {paused
            ? 'Tracking is paused — historical data is kept and stays viewable, but daily tracking is suspended and on-demand runs are blocked. No credits are spent until you resume.'
            : 'Pause this brand to stop daily tracking and all on-demand runs. Historical data is preserved and stays viewable; resume any time to pick tracking back up on the next run.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <Button
            variant={paused ? 'default' : 'outline'}
            disabled={saving || !canAdmin}
            onClick={guard(() => void handleToggle(paused), {
              action: tActions(paused ? 'resumeBrands' : 'pauseBrands'),
            })}
            className="gap-2"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : paused ? (
              <Play className="h-4 w-4" />
            ) : (
              <Pause className="h-4 w-4" />
            )}
            {paused ? 'Resume tracking' : 'Pause tracking'}
          </Button>
          {!canAdmin && (
            <p className="text-xs text-muted-foreground">Only admins can change this setting.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Domains Tab ──────────────────────────────────────────────────────────────

function DomainsTab({
  brand,
  onUpdate,
}: {
  brand: Brand;
  onUpdate: (updates: Partial<Brand>) => void;
}) {
  const t = useTranslations('brands');
  const { canManage } = useUserRole();
  // A read-only workspace (plan not active): Save opens the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const [domains, setDomains] = useState<BrandDomain[]>(brand.domains);
  const [isSaving, setIsSaving] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [newCountry, setNewCountry] = useState('');

  const addDomain = () => {
    if (!newDomain.trim()) return;
    const entry: BrandDomain = {
      id: crypto.randomUUID(),
      brandId: brand.id,
      domain: newDomain.trim(),
      country: newCountry.trim() || undefined,
      isPrimary: domains.length === 0,
    };
    setDomains((prev) => [...prev, entry]);
    setNewDomain('');
    setNewCountry('');
  };

  const removeDomainLocal = (id: string) => {
    setDomains((prev) => {
      const updated = prev.filter((d) => d.id !== id);
      if (prev.find((d) => d.id === id)?.isPrimary && updated.length > 0) {
        updated[0] = { ...updated[0], isPrimary: true };
      }
      return updated;
    });
  };

  const setPrimary = (id: string) => {
    setDomains((prev) => prev.map((d) => ({ ...d, isPrimary: d.id === id })));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const savedDomains = await syncDomains(
        brand.id,
        domains.map((d) => ({
          domain: d.domain,
          country: d.country,
          isPrimary: d.isPrimary,
        })),
      );
      setDomains(savedDomains);

      // logo_url is never written here. BrandIdentity derives the favicon at
      // render time (bundled logo or local initials), so there is nothing
      // to store. Keeping logo_url = null for new brands ensures the chain runs.
      onUpdate({
        domains: savedDomains,
        updatedAt: new Date().toISOString(),
      });
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save domains.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.domainsTab')}</CardTitle>
        <CardDescription>
          Manage the domains tracked for this brand. One domain must be set as primary.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Admins and managers write the brand (RLS); others read it. */}
        <fieldset disabled={!canManage} className="min-w-0 space-y-4">
          <div className="space-y-2">
            {domains.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1 overflow-hidden">
                  <p className="truncate text-sm font-medium">{d.domain}</p>
                  {d.country && <p className="text-xs text-muted-foreground">{d.country}</p>}
                </div>
                {d.isPrimary && (
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {t('primaryDomain')}
                  </Badge>
                )}
                {!d.isPrimary && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs shrink-0"
                    onClick={() => setPrimary(d.id)}
                  >
                    {t('setPrimary')}
                  </Button>
                )}
                {domains.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                    onClick={() => removeDomainLocal(d.id)}
                    aria-label="Remove domain"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-sm font-medium">{t('addDomain')}</Label>
            <div className="flex gap-2">
              <Input
                placeholder={t('domainPlaceholder')}
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addDomain()}
                className="flex-1"
              />
              <Input
                placeholder={t('countryPlaceholder')}
                value={newCountry}
                onChange={(e) => setNewCountry(e.target.value)}
                className="w-28"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={addDomain}
                disabled={!newDomain.trim()}
                aria-label="Add domain"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <Button
            onClick={guard(handleSave, { action: tActions('saveDomains') })}
            disabled={isSaving || domains.length === 0}
            className="gap-2"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t('settings.saveChanges')}
          </Button>
        </fieldset>
        {!canManage && (
          <p className="text-xs text-muted-foreground">{t('settings.managersOnlyEdit')}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Competitors Tab ──────────────────────────────────────────────────────────

function CompetitorsTab({ brandId }: { brandId: string }) {
  const t = useTranslations('brands');
  const { canManage } = useUserRole();
  // A read-only workspace (plan not active): Add and Remove (before its
  // confirm) open the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState('');

  const load = useCallback(
    async (isCancelled?: () => boolean) => {
      setIsLoading(true);
      try {
        const data = await getCompetitors(brandId);
        if (isCancelled?.()) return;
        setCompetitors(data);
      } catch {
        if (isCancelled?.()) return;
        toast.error('Failed to load competitors');
      } finally {
        if (!isCancelled?.()) setIsLoading(false);
      }
    },
    [brandId],
  );

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setIsAdding(true);
    try {
      const added = await addCompetitor(brandId, {
        name: newName.trim(),
        domain: newDomain.trim(),
      });
      setCompetitors((prev) => [...prev, added]);
      setNewName('');
      setNewDomain('');
      toast.success(`${added.name} added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add competitor');
    } finally {
      setIsAdding(false);
    }
  };
  const submitAdd = guard(handleAdd, { action: tActions('addCompetitors') });

  const handleDelete = async (id: string) => {
    try {
      await deleteCompetitor(id);
      setCompetitors((prev) => prev.filter((c) => c.id !== id));
      setDeletingId(null);
      toast.success('Competitor removed');
    } catch {
      toast.error('Failed to remove competitor');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Competitors</CardTitle>
        <CardDescription>
          Add your competitors to compare AI visibility. When prompts run, the system will
          automatically detect how often each competitor is mentioned alongside your brand.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Admins and managers write the brand (RLS); others read it. */}
        <fieldset disabled={!canManage} className="min-w-0 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {competitors.length > 0 && (
                <div className="space-y-2">
                  {competitors.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                    >
                      {c.domain ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={getSiteIconUrl(c.domain, 64)}
                          alt={c.name}
                          className="h-8 w-8 shrink-0 rounded-full bg-white object-contain"
                        />
                      ) : (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold">
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 overflow-hidden">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        {c.domain && <p className="text-xs text-muted-foreground">{c.domain}</p>}
                      </div>
                      <Dialog
                        open={deletingId === c.id}
                        onOpenChange={(open) => !open && setDeletingId(null)}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                          onClick={guard(() => setDeletingId(c.id), {
                            action: tActions('deleteCompetitors'),
                          })}
                          aria-label="Delete competitor"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Remove {c.name}?</DialogTitle>
                            <DialogDescription>
                              This will remove the competitor and its comparison data. This action
                              cannot be undone.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setDeletingId(null)}>
                              Cancel
                            </Button>
                            <Button variant="destructive" onClick={() => handleDelete(c.id)}>
                              Remove
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  ))}
                </div>
              )}

              {competitors.length === 0 && (
                <div className="rounded-lg border border-dashed py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No competitors added yet. Add your competitors below.
                  </p>
                </div>
              )}

              <Separator />

              <div className="space-y-2">
                <Label className="text-sm font-medium">Add Competitor</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Competitor name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && newName.trim() && submitAdd()}
                    className="flex-1"
                  />
                  <Input
                    placeholder="domain.com"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && newName.trim() && submitAdd()}
                    className="w-40"
                  />
                  <Button
                    variant="outline"
                    onClick={submitAdd}
                    disabled={isAdding || !newName.trim()}
                    className="gap-1.5 shrink-0"
                  >
                    {isAdding ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Add
                  </Button>
                </div>
              </div>
            </>
          )}
        </fieldset>
        {!canManage && (
          <p className="text-xs text-muted-foreground">{t('settings.managersOnlyEdit')}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Tracking Tab ────────────────────────────────────────────────────────

function TrackingTab({ brand }: { brand: Brand }) {
  const [copied, setCopied] = useState<'code' | 'snippet' | null>(null);
  const apiUrl = getPublicApiBaseUrl();
  // With conversions on, the tag that follows AI visitors to them (CE-017).
  const snippet =
    trackingSnippetTag(
      apiUrl,
      brand.trackingCode,
      brand.conversionsEnabled ? (brand.conversionsConsent ?? 'wait') : null,
    ) ?? '';

  const copyToClipboard = (text: string, key: 'code' | 'snippet') => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code className="h-4 w-4" />
          AI Traffic Tracking
        </CardTitle>
        <CardDescription>
          Track visits to your website that come from AI platforms like ChatGPT, Perplexity, Claude,
          and more.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {brand.trackingCode ? (
          <>
            {!apiUrl && (
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-sm">
                <p className="font-medium text-yellow-700 dark:text-yellow-400">
                  Server URL not configured
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Set{' '}
                  <code className="text-[11px] bg-muted px-1 py-0.5 rounded">
                    NEXT_PUBLIC_API_URL
                  </code>{' '}
                  in your <code className="text-[11px] bg-muted px-1 py-0.5 rounded">.env</code>{' '}
                  file to your aeo-server URL (e.g.{' '}
                  <code className="text-[11px] bg-muted px-1 py-0.5 rounded">
                    https://api.yourdomain.com
                  </code>
                  ).
                </p>
              </div>
            )}

            {/* Tracking Code */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Tracking Code</Label>
              <div className="flex items-center gap-2">
                <Input value={brand.trackingCode} readOnly className="font-mono text-sm" />
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => copyToClipboard(brand.trackingCode!, 'code')}
                  aria-label="Copy tracking code"
                >
                  {copied === 'code' ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Snippet */}
            {apiUrl && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Installation Snippet</Label>
                <p className="text-xs text-muted-foreground">
                  Add this script tag before the closing{' '}
                  <code className="text-[11px]">&lt;/head&gt;</code> tag of your website.
                </p>
                <div className="relative">
                  <pre className="text-[12px] bg-muted rounded-md px-4 py-3 overflow-x-auto font-mono leading-relaxed">
                    {snippet}
                  </pre>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 h-7 w-7"
                    onClick={() => copyToClipboard(snippet, 'snippet')}
                    aria-label="Copy tracking script"
                  >
                    {copied === 'snippet' ? (
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* How it works */}
            <div className="rounded-lg border p-4 space-y-2">
              <p className="text-sm font-medium">How it works</p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                <li>
                  The script detects visitors coming from AI platforms (ChatGPT, Perplexity, Claude,
                  Gemini, Copilot, etc.)
                </li>
                <li>Only AI-referred visits are tracked — regular traffic is ignored</li>
                <li>Data appears in your AI Traffic Analytics dashboard</li>
                <li>The script is lightweight (~1KB) and does not affect page performance</li>
              </ul>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed py-8 text-center">
            <Code className="h-8 w-8 mx-auto text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground mt-2">
              No tracking code available for this brand.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              A tracking code is automatically generated when the brand is created.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Danger Tab ───────────────────────────────────────────────────────────────

function DangerTab({
  brand,
  onDelete,
}: {
  brand: Brand;
  onDelete: (pending: boolean) => Promise<void>;
}) {
  const t = useTranslations('brands');
  const { canAdmin } = useUserRole();
  const [confirmValue, setConfirmValue] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  // Delete stays open on a read-only workspace (plan not active): it only
  // removes what the person gave us (GetCito, 2026-10-27). The demo brand
  // is never deleted, only hidden from the brand menu.
  const demo = brand.isDemo === true;

  const canDelete = confirmValue === brand.name;

  const handleDelete = async () => {
    if (!canDelete) return;
    setIsDeleting(true);
    try {
      const result = await deleteBrand(brand.id);
      if ('error' in result) {
        toast.error(result.error);
        setIsDeleting(false);
        return;
      }
      await onDelete(Boolean(result.pending));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete brand.');
      setIsDeleting(false);
    }
  };

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">{t('settings.dangerTab')}</CardTitle>
        <CardDescription>{t('settings.deleteWarning')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Only an admin deletes a brand (the server's rule). */}
        <fieldset disabled={!canAdmin || demo} className="min-w-0 space-y-4">
          {demo ? (
            <p data-slot="demo-cant-delete" className="text-sm text-muted-foreground">
              {t('settings.demoCantDelete')}
            </p>
          ) : (
            <div className="space-y-2">
              <Label className="text-sm">
                {t('settings.confirmDelete')} <span className="font-semibold">{brand.name}</span>
              </Label>
              <Input
                placeholder={t('settings.deleteConfirmPlaceholder')}
                value={confirmValue}
                onChange={(e) => setConfirmValue(e.target.value)}
              />
            </div>
          )}
          <Button
            variant="destructive"
            disabled={demo || !canDelete || isDeleting}
            onClick={handleDelete}
            className="gap-2"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {t('settings.deleteButton')}
          </Button>
        </fieldset>
        {!canAdmin && !demo && (
          <p className="text-xs text-muted-foreground">{t('settings.adminsOnlyDelete')}</p>
        )}
      </CardContent>
    </Card>
  );
}
