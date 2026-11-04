'use client';

import { ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Said on the competitors step when setup found the brand sells online and
 * turned on Shopping mode, so Product Visibility appearing in the menu isn't
 * a surprise, with where to turn it off.
 */
export function EcommerceNote({ brandName }: { brandName: string }) {
  const t = useTranslations('brands.wizard');
  return (
    <div className="mb-6 flex items-start gap-3 rounded-md border bg-muted/40 p-3 text-sm">
      <ShoppingBag className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <p className="text-muted-foreground">{t('ecommerceDetected', { brand: brandName })}</p>
    </div>
  );
}
