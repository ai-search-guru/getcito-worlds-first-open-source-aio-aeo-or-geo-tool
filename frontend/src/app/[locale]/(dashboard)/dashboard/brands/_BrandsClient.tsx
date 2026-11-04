'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useBrandStore } from '@/state/useBrandStore';
import { useUserRole } from '@/hooks/useUserRole';
import { BrandCard } from '@/components/dashboard/BrandCard';
import { AddBrandLink } from '@/components/dashboard/AddBrandLink';
import { Button } from '@/components/ui/button';
import type { Brand } from '@/types';
import { Building2, Plus } from 'lucide-react';

interface BrandsClientProps {
  brands: Brand[];
}

export function BrandsClient({ brands }: BrandsClientProps) {
  const { setBrands } = useBrandStore();

  useEffect(() => {
    setBrands(brands);
  }, [brands, setBrands]);

  if (brands.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {brands.map((brand) => (
        <BrandCard key={brand.id} brand={brand} />
      ))}
    </div>
  );
}

function EmptyState() {
  const t = useTranslations('brands');
  // Only admins and managers add a brand (brands: admin/manager insert).
  const { canManage } = useUserRole();
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Building2 className="h-7 w-7 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold">{t('noBrands')}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t('noBrandsDescription')}</p>
      {canManage && (
        <AddBrandLink className="mt-6">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            {t('addBrand')}
          </Button>
        </AddBrandLink>
      )}
    </div>
  );
}
